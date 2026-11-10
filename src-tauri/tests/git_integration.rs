use std::path::Path;
use std::process::Command;

use kromagit_lib::git::{self, model::DiffRequest, runner::Git};

fn sh(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Test User")
        .env("GIT_AUTHOR_EMAIL", "test@example.dev")
        .env("GIT_COMMITTER_NAME", "Test User")
        .env("GIT_COMMITTER_EMAIL", "test@example.dev")
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
}

fn write(dir: &Path, file: &str, content: &str) {
    let p = dir.join(file);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(p, content).unwrap();
}

fn sample_repo() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    write(d, "a.txt", "one\ntwo\nthree\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "initial"]);
    sh(d, &["checkout", "-qb", "feature/x"]);
    write(d, "b.txt", "bee\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "add b", "-m", "with a body"]);
    sh(d, &["checkout", "-q", "main"]);
    write(d, "a.txt", "one\nTWO\nthree\n");
    sh(d, &["commit", "-qam", "change a"]);
    sh(d, &["merge", "-q", "--no-ff", "feature/x", "-m", "merge feature"]);
    sh(d, &["tag", "v1"]);
    tmp
}

#[test]
fn reads_a_real_repository_end_to_end() {
    let tmp = sample_repo();
    let d = tmp.path();
    let sub = d.join("nested");
    std::fs::create_dir_all(&sub).unwrap();

    let info = git::open_repo(sub.to_str().unwrap()).unwrap();
    assert_eq!(Path::new(&info.root).canonicalize().unwrap(), d.canonicalize().unwrap());

    let g = Git::new(&info.root);
    let commits = git::log::get_commits(&g, None).unwrap();
    assert_eq!(commits.len(), 4);
    assert_eq!(commits[0].subject, "merge feature");
    assert_eq!(commits[0].parents.len(), 2);
    assert!(commits[0].refs.iter().any(|r| r.name == "main" && r.current));
    assert_eq!(git::log::get_commits(&g, Some(2)).unwrap().len(), 2);

    let refs = git::refs::get_refs(&g).unwrap();
    assert_eq!(refs.branches.len(), 2);
    assert_eq!(refs.tags[0].name, "v1");
    assert_eq!(refs.worktrees.len(), 1);
    assert!(refs.stashes.is_empty() && refs.remotes.is_empty() && refs.submodules.is_empty());

    write(d, "a.txt", "one\nTWO\nthree\nfour\n");
    sh(d, &["add", "a.txt"]);
    write(d, "a.txt", "zero\none\nTWO\nthree\nfour\n");
    write(d, "new file.txt", "x\ny\n");
    let status = git::status::get_status(&g).unwrap();
    assert_eq!(status.head.branch.as_deref(), Some("main"));
    assert_eq!(status.staged.len(), 1);
    assert_eq!((status.staged[0].additions, status.staged[0].deletions), (1, 0));
    let untracked = status.unstaged.iter().find(|f| f.status == "?").unwrap();
    assert_eq!((untracked.path.as_str(), untracked.additions), ("new file.txt", 2));

    let staged = git::diff::get_file_diff(&g, &req("a.txt", "staged", false, None, None)).unwrap();
    assert_eq!(staged.hunks[0].lines.iter().filter(|l| l.kind == "add").count(), 1);
    let unstaged = git::diff::get_file_diff(&g, &req("a.txt", "unstaged", false, None, None)).unwrap();
    assert_eq!(unstaged.hunks[0].lines[0].text, "zero");
    let new = git::diff::get_file_diff(&g, &req("new file.txt", "unstaged", true, None, None)).unwrap();
    assert_eq!(new.hunks[0].lines.len(), 2);

    let feature_commit = commits.iter().find(|c| c.subject == "add b").unwrap();
    let details = git::diff::get_commit_details(&g, &feature_commit.hash).unwrap();
    assert_eq!(details.body, "with a body");
    assert_eq!(details.files.len(), 1);
    assert_eq!((details.files[0].path.as_str(), details.files[0].status, details.files[0].additions), ("b.txt", "A", 1));

    let root = commits.last().unwrap();
    let root_details = git::diff::get_commit_details(&g, &root.hash).unwrap();
    assert_eq!(root_details.files[0].path, "a.txt");
    let root_diff = git::diff::get_file_diff(&g, &req("a.txt", "commit", false, Some(&root.hash), None)).unwrap();
    assert_eq!(root_diff.hunks[0].lines.len(), 3);

    let merge = &commits[0];
    let merge_details = git::diff::get_commit_details(&g, &merge.hash).unwrap();
    assert_eq!(merge_details.files[0].path, "b.txt");
    let merge_diff = git::diff::get_file_diff(
        &g,
        &req("b.txt", "commit", false, Some(&merge.hash), Some(&merge.parents[0])),
    )
    .unwrap();
    assert_eq!(merge_diff.hunks[0].lines[0].text, "bee");
}

#[test]
fn handles_empty_repository_and_non_repo() {
    let tmp = tempfile::tempdir().unwrap();
    sh(tmp.path(), &["-c", "init.defaultBranch=main", "init", "-q"]);
    let g = Git::new(tmp.path());
    assert!(git::log::get_commits(&g, Some(100)).unwrap().is_empty());
    let status = git::status::get_status(&g).unwrap();
    assert_eq!(status.head.branch.as_deref(), Some("main"));
    assert!(status.head.oid.is_none());
    assert!(git::refs::get_refs(&g).unwrap().branches.is_empty());

    let plain = tempfile::tempdir().unwrap();
    let err = git::open_repo(plain.path().to_str().unwrap()).unwrap_err();
    assert!(matches!(err, kromagit_lib::error::AppError::NotARepo(_)));
}

/// Guards the IPC contract: these exact keys are read by src/types/git.ts.
#[test]
fn payload_json_keys_match_the_frontend_types() {
    let tmp = sample_repo();
    let g = Git::new(tmp.path());
    write(tmp.path(), "a.txt", "changed\n");

    let keys = |v: &serde_json::Value| -> Vec<String> {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    };

    let commits = serde_json::to_value(git::log::get_commits(&g, None).unwrap()).unwrap();
    assert_eq!(keys(&commits[0]), ["author", "date", "hash", "parents", "refs", "subject"]);
    assert_eq!(keys(&commits[0]["refs"][0]), ["current", "kind", "name"]);
    assert!(commits[3].get("refs").is_none(), "empty refs are omitted to keep IPC small");

    let refs = serde_json::to_value(git::refs::get_refs(&g).unwrap()).unwrap();
    assert_eq!(keys(&refs), ["branches", "lastFetch", "remotes", "stashes", "submodules", "tags", "worktrees"]);
    assert_eq!(keys(&refs["branches"][0]), ["ahead", "behind", "current", "name", "tipHash", "upstream", "upstreamGone"]);
    assert_eq!(keys(&refs["worktrees"][0]), ["branch", "head", "isMain", "path"]);

    let status = serde_json::to_value(git::status::get_status(&g).unwrap()).unwrap();
    assert_eq!(keys(&status), ["head", "operation", "staged", "unstaged"]);
    assert_eq!(keys(&status["head"]), ["ahead", "behind", "branch", "detached", "oid", "upstream"]);
    assert_eq!(keys(&status["unstaged"][0]), ["additions", "deletions", "path", "status"]);

    let hash = commits[1]["hash"].as_str().unwrap();
    let details = serde_json::to_value(git::diff::get_commit_details(&g, hash).unwrap()).unwrap();
    assert_eq!(
        keys(&details),
        ["author", "authorDate", "body", "commitDate", "committer", "files", "hash", "parents", "subject"]
    );

    let diff = serde_json::to_value(git::diff::get_file_diff(&g, &req("a.txt", "unstaged", false, None, None)).unwrap()).unwrap();
    assert_eq!(keys(&diff), ["binary", "hunks", "path", "truncated"]);
    assert_eq!(keys(&diff["hunks"][0]), ["header", "lines", "newLines", "newStart", "oldLines", "oldStart"]);
    assert_eq!(keys(&diff["hunks"][0]["lines"][0]), ["kind", "oldNo", "text"]);

    let err = serde_json::to_value(git::open_repo("/definitely/not/a/repo").unwrap_err()).unwrap();
    assert_eq!(keys(&err), ["command", "kind", "message"]);
    assert_eq!(err["kind"], "pathNotFound");
    assert_eq!(err["message"], "Folder not found: /definitely/not/a/repo");
}

fn req(path: &str, source: &str, untracked: bool, commit: Option<&str>, parent: Option<&str>) -> DiffRequest {
    DiffRequest {
        path: path.into(),
        old_path: None,
        source: source.into(),
        untracked,
        commit: commit.map(Into::into),
        parent: parent.map(Into::into),
    }
}
