//! Gathers diffs for AI features: split per file, sensitive files omitted,
//! secrets redacted and each file capped — this is exactly what may be sent.

use serde::Serialize;

use super::redact::{is_sensitive_path, redact};
use crate::error::AppResult;
use crate::git::runner::{split_nul, Git};

const MAX_UNTRACKED_FILES: usize = 100;
const MAX_UNTRACKED_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: &'static str,
    pub additions: u32,
    pub deletions: u32,
    /// unified diff text after redaction/capping (empty when omitted)
    pub patch: String,
    pub truncated: bool,
    pub redactions: u32,
    pub omitted: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiDiffBundle {
    pub files: Vec<AiFileDiff>,
    pub redactions: u32,
}

/// `scope` is `"staged"`, `"all"` (staged + unstaged + untracked) or
/// `"commit:<sha>"` (that commit against its first parent).
pub fn collect(git: &Git, scope: &str, per_file_cap: usize) -> AppResult<AiDiffBundle> {
    let common = ["--no-color", "--no-ext-diff", "-U3", "-M", "--src-prefix=a/", "--dst-prefix=b/"];
    if let Some(sha) = scope.strip_prefix("commit:") {
        if !(4..=64).contains(&sha.len()) || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(crate::error::AppError::Internal(format!("Not a commit id: {sha}")));
        }
        let mut args = vec!["diff-tree", "-p", "-r", "--root", "--no-commit-id", "--diff-merges=first-parent"];
        args.extend(common);
        args.push(sha);
        let raw = git.run(&args)?;
        let mut bundle = AiDiffBundle::default();
        for (path, patch) in split_patches(&String::from_utf8_lossy(&raw)) {
            bundle.files.push(prepare(path, patch, per_file_cap));
        }
        bundle.redactions = bundle.files.iter().map(|f| f.redactions).sum();
        return Ok(bundle);
    }
    let has_head = !git.run_with_codes(&["rev-parse", "-q", "--verify", "HEAD"], &[0, 1])?.is_empty();
    let mut raw = Vec::new();
    if scope == "staged" || !has_head {
        let mut args = vec!["diff", "--cached"];
        args.extend(common);
        raw.extend(git.run(&args)?);
    }
    if scope != "staged" {
        let mut args = vec!["diff"];
        if has_head {
            args.push("HEAD");
        }
        args.extend(common);
        raw.extend(git.run(&args)?);
    }

    let mut bundle = AiDiffBundle::default();
    for (path, patch) in split_patches(&String::from_utf8_lossy(&raw)) {
        bundle.files.push(prepare(path, patch, per_file_cap));
    }

    if scope != "staged" {
        let untracked = split_nul(&git.run(&["ls-files", "--others", "--exclude-standard", "-z"])?);
        for path in untracked.into_iter().take(MAX_UNTRACKED_FILES) {
            let patch = untracked_patch(git, &path);
            bundle.files.push(prepare(path, patch, per_file_cap));
        }
    }
    bundle.redactions = bundle.files.iter().map(|f| f.redactions).sum();
    Ok(bundle)
}

fn untracked_patch(git: &Git, path: &str) -> String {
    let full = git.cwd().join(path);
    let header = format!("diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n");
    match std::fs::metadata(&full) {
        Ok(m) if m.len() > MAX_UNTRACKED_BYTES => format!("{header}[large new file, {} bytes]\n", m.len()),
        Ok(_) => match std::fs::read(&full) {
            Ok(bytes) if bytes.contains(&0) => format!("{header}Binary files /dev/null and b/{path} differ\n"),
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                let lines: Vec<&str> = text.lines().collect();
                let mut out = format!("{header}@@ -0,0 +1,{} @@\n", lines.len());
                for l in lines {
                    out.push('+');
                    out.push_str(l);
                    out.push('\n');
                }
                out
            }
            Err(_) => header,
        },
        Err(_) => header,
    }
}

fn prepare(path: String, patch: String, cap: usize) -> AiFileDiff {
    let status = if patch.contains("\nnew file mode") || patch.contains("--- /dev/null") {
        "A"
    } else if patch.contains("\ndeleted file mode") || patch.contains("+++ /dev/null") {
        "D"
    } else if patch.contains("\nrename from ") {
        "R"
    } else {
        "M"
    };
    let old_path = patch.lines().find_map(|l| l.strip_prefix("rename from ")).map(str::to_owned);
    let (mut additions, mut deletions) = (0, 0);
    for l in patch.lines() {
        if l.starts_with('+') && !l.starts_with("+++") {
            additions += 1;
        } else if l.starts_with('-') && !l.starts_with("---") {
            deletions += 1;
        }
    }
    if is_sensitive_path(&path) {
        return AiFileDiff {
            path,
            old_path,
            status,
            additions,
            deletions,
            patch: String::new(),
            truncated: false,
            redactions: 0,
            omitted: Some("sensitive file (not sent)".into()),
        };
    }
    if patch.contains("\nBinary files ") || patch.contains("\nGIT binary patch") {
        return AiFileDiff { path, old_path, status, additions, deletions, patch: String::new(), truncated: false, redactions: 0, omitted: Some("binary file".into()) };
    }
    let (patch, truncated) = cap_text(&patch, cap);
    let (patch, redactions) = redact(&patch);
    AiFileDiff { path, old_path, status, additions, deletions, patch, truncated, redactions, omitted: None }
}

/// Cuts at a line boundary and notes how many lines were dropped.
pub fn cap_text(text: &str, cap: usize) -> (String, bool) {
    if text.len() <= cap {
        return (text.to_string(), false);
    }
    let mut end = cap;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let cut = text[..end].rfind('\n').map(|i| i + 1).unwrap_or(end);
    let dropped = text[cut..].lines().count();
    (format!("{}[... {dropped} more lines truncated]\n", &text[..cut]), true)
}

/// Splits multi-file `git diff` output into (path, patch) pairs.
pub fn split_patches(raw: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current = String::new();
    let flush = |current: &mut String, out: &mut Vec<(String, String)>| {
        if !current.is_empty() {
            let path = patch_path(current);
            out.push((path, std::mem::take(current)));
        }
    };
    for line in raw.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            flush(&mut current, &mut out);
        }
        current.push_str(line);
    }
    flush(&mut current, &mut out);
    out
}

fn patch_path(patch: &str) -> String {
    for line in patch.lines() {
        if let Some(p) = line.strip_prefix("+++ b/") {
            return p.trim_end().to_string();
        }
        if line.starts_with("@@") {
            break;
        }
    }
    for line in patch.lines() {
        if let Some(p) = line.strip_prefix("--- a/") {
            return p.trim_end().to_string();
        }
        if let Some(p) = line.strip_prefix("rename to ") {
            return p.to_string();
        }
    }
    let first = patch.lines().next().unwrap_or_default();
    first.rsplit_once(" b/").map(|(_, p)| p.to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &str = "diff --git a/src/a.rs b/src/a.rs\nindex 1..2 100644\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\ndiff --git a/.env b/.env\nnew file mode 100644\n--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+DB_PASSWORD=hunter22\n";

    #[test]
    fn splits_and_classifies_files() {
        let parts = split_patches(RAW);
        let paths: Vec<_> = parts.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths, ["src/a.rs", "gone.txt", ".env"]);
        let files: Vec<_> = parts.into_iter().map(|(p, t)| prepare(p, t, 10_000)).collect();
        assert_eq!((files[0].status, files[0].additions, files[0].deletions), ("M", 1, 1));
        assert_eq!(files[1].status, "D");
        assert_eq!(files[2].status, "A");
        let renamed = prepare("new.rs".into(), "diff --git a/old.rs b/new.rs\nsimilarity index 90%\nrename from old.rs\nrename to new.rs\n".into(), 1000);
        assert_eq!((renamed.status, renamed.old_path.as_deref()), ("R", Some("old.rs")));
        assert!(files[2].patch.is_empty(), "sensitive file content must not be included");
        assert!(files[2].omitted.is_some());
    }

    #[test]
    fn caps_long_patches_at_line_boundaries() {
        let text = "line one\nline two\nline three\n";
        let (out, truncated) = cap_text(text, 12);
        assert!(truncated);
        assert_eq!(out, "line one\n[... 2 more lines truncated]\n");
        assert_eq!(cap_text(text, 100), (text.to_string(), false));
    }

    #[test]
    fn redacts_inside_patches() {
        let patch = "diff --git a/c.yml b/c.yml\n--- a/c.yml\n+++ b/c.yml\n@@ -1 +1 @@\n-api_key: old\n+api_key: abcd1234efgh5678\n".to_string();
        let f = prepare("c.yml".into(), patch, 10_000);
        assert!(f.redactions >= 1);
        assert!(!f.patch.contains("abcd1234efgh5678"));
    }
}
