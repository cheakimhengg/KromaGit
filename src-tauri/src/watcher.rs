use crate::error::{AppError, AppResult};
use crate::git::runner::Git;
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct RepoWatcher {
    current: Mutex<Option<(String, Debouncer<RecommendedWatcher>)>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedEvent {
    repo: String,
    refs: bool,
}

#[derive(PartialEq, Debug)]
pub enum Change {
    None,
    Files,
    Refs,
}

const GIT_STATE_FILES: [&str; 8] =
    ["HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "packed-refs", "index"];

pub fn classify(path: &Path, work: &Path, git_dir: &Path) -> Change {
    if let Ok(rel) = path.strip_prefix(git_dir) {
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.ends_with(".lock") {
            return Change::None;
        }
        if rel == "index" {
            return Change::Files;
        }
        if GIT_STATE_FILES.contains(&rel.as_str()) || rel.starts_with("refs/") || rel.starts_with("rebase-merge") || rel.starts_with("rebase-apply") {
            return Change::Refs;
        }
        return Change::None;
    }
    match path.strip_prefix(work) {
        Ok(rel) if !rel.components().any(|c| c.as_os_str() == ".git") => Change::Files,
        _ => Change::None,
    }
}

/// Calls `on_change(refs_changed)` shortly after files in the work tree or git's own state change.
pub fn watch_repo(repo: &str, on_change: impl Fn(bool) + Send + 'static) -> AppResult<Debouncer<RecommendedWatcher>> {
    let work = PathBuf::from(repo).canonicalize()?;
    let git_dir = PathBuf::from(Git::new(repo.to_string()).run_string(&["rev-parse", "--absolute-git-dir"])?.trim()).canonicalize()?;
    let (work2, git2) = (work.clone(), git_dir.clone());
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut files = false;
        let mut refs = false;
        for ev in &events {
            let path = ev.path.canonicalize().unwrap_or_else(|_| ev.path.clone());
            match classify(&path, &work2, &git2) {
                Change::Files => files = true,
                Change::Refs => refs = true,
                Change::None => {}
            }
        }
        if files || refs {
            on_change(refs);
        }
    })
    .map_err(|e| AppError::Internal(e.to_string()))?;
    debouncer.watcher().watch(&work, RecursiveMode::Recursive).map_err(|e| AppError::Internal(e.to_string()))?;
    if !git_dir.starts_with(&work) {
        let _ = debouncer.watcher().watch(&git_dir, RecursiveMode::Recursive);
    }
    Ok(debouncer)
}

impl RepoWatcher {
    pub fn watch(&self, app: &AppHandle, repo: &str) -> AppResult<()> {
        let mut current = self.current.lock().map_err(|_| AppError::Internal("watcher lock".into()))?;
        if current.as_ref().is_some_and(|(r, _)| r == repo) {
            return Ok(());
        }
        *current = None;
        let (app2, repo2) = (app.clone(), repo.to_string());
        let debouncer = watch_repo(repo, move |refs| {
            let _ = app2.emit("repo://changed", ChangedEvent { repo: repo2.clone(), refs });
        })?;
        *current = Some((repo.to_string(), debouncer));
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut c) = self.current.lock() {
            *c = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_paths() {
        let work = Path::new("/r");
        let git = Path::new("/r/.git");
        assert_eq!(classify(Path::new("/r/src/a.ts"), work, git), Change::Files);
        assert_eq!(classify(Path::new("/r/.git/index"), work, git), Change::Files);
        assert_eq!(classify(Path::new("/r/.git/HEAD"), work, git), Change::Refs);
        assert_eq!(classify(Path::new("/r/.git/refs/heads/main"), work, git), Change::Refs);
        assert_eq!(classify(Path::new("/r/.git/index.lock"), work, git), Change::None);
        assert_eq!(classify(Path::new("/r/.git/objects/ab/cd"), work, git), Change::None);
        assert_eq!(classify(Path::new("/r/.git/modules/x/index"), work, git), Change::None);
        assert_eq!(classify(Path::new("/r/sub/.git"), work, git), Change::None);
        let sub_git = Path::new("/r/.git/modules/sub");
        assert_eq!(classify(Path::new("/r/.git/modules/sub/HEAD"), Path::new("/r/sub"), sub_git), Change::Refs);
    }

    fn git(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap().status.success();
        assert!(ok, "git {args:?}");
    }

    fn wait_for(rx: &std::sync::mpsc::Receiver<bool>, want_refs: bool) -> bool {
        let end = std::time::Instant::now() + Duration::from_secs(5);
        while let Some(left) = end.checked_duration_since(std::time::Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(refs) if refs == want_refs || (want_refs && refs) => return true,
                Ok(_) => continue,
                Err(_) => return false,
            }
        }
        false
    }

    #[test]
    fn reports_file_edits_and_commits() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        git(d, &["init", "-q", "-b", "main"]);
        git(d, &["config", "user.email", "t@example.com"]);
        git(d, &["config", "user.name", "t"]);
        std::fs::write(d.join("a.txt"), "1").unwrap();
        git(d, &["add", "."]);
        git(d, &["commit", "-qm", "one"]);
        let (tx, rx) = std::sync::mpsc::channel();
        let _w = watch_repo(d.to_str().unwrap(), move |refs| {
            let _ = tx.send(refs);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
        std::fs::write(d.join("a.txt"), "2").unwrap();
        assert!(wait_for(&rx, false), "file edit not reported");
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
        git(d, &["commit", "-qam", "two"]);
        assert!(wait_for(&rx, true), "commit not reported as a ref change");
    }
}
