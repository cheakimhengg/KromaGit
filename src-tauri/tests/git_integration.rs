use std::path::Path;

use kromagit_lib::git::{self, model::DiffRequest, runner::Git};

mod common;
use common::{git as sh_out, write};

fn sh(dir: &Path, args: &[&str]) {
    sh_out(dir, args);
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
    common::init_repo(tmp.path());
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

    let err = serde_json::to_value(git::open_repo(&common::path_str(&std::env::temp_dir().join("kromagit-definitely-missing"))).unwrap_err()).unwrap();
    assert_eq!(keys(&err), ["command", "kind", "message"]);
    assert_eq!(err["kind"], "pathNotFound");
    assert!(err["message"].as_str().unwrap().starts_with("Folder not found: "));
}

fn req(path: &str, source: &str, untracked: bool, commit: Option<&str>, parent: Option<&str>) -> DiffRequest {
    DiffRequest {
        path: path.into(),
        old_path: None,
        source: source.into(),
        untracked,
        commit: commit.map(Into::into),
        parent: parent.map(Into::into),
        ignore_whitespace: false,
        full_file: false,
    }
}

fn png(tag: u8, len: usize) -> Vec<u8> {
    let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
    v.extend(std::iter::repeat_n(tag, len));
    v
}

fn image_req(path: &str, source: &str, untracked: bool, commit: Option<&str>) -> DiffRequest {
    DiffRequest {
        path: path.into(),
        old_path: None,
        source: source.into(),
        untracked,
        commit: commit.map(Into::into),
        parent: None,
        ignore_whitespace: false,
        full_file: false,
    }
}

#[test]
fn image_preview_reads_each_side_from_the_right_place() {
    use git::image::{base64, get_file_image};
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    std::fs::write(d.join("logo.png"), png(1, 40)).unwrap();
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "add logo"]);
    std::fs::write(d.join("logo.png"), png(2, 60)).unwrap();
    sh(d, &["commit", "-qam", "new logo"]);
    std::fs::write(d.join("logo.png"), png(3, 80)).unwrap();
    sh(d, &["add", "logo.png"]);
    std::fs::write(d.join("logo.png"), png(4, 100)).unwrap();
    std::fs::write(d.join("new.webp"), png(5, 20)).unwrap();
    let g = Git::new(d);
    let url = |b: &[u8], mime: &str| format!("data:{mime};base64,{}", base64(b));

    let unstaged = get_file_image(&g, &image_req("logo.png", "unstaged", false, None)).unwrap();
    assert_eq!(unstaged.before.unwrap().data_url, url(&png(3, 80), "image/png"), "index");
    assert_eq!(unstaged.after.unwrap().data_url, url(&png(4, 100), "image/png"), "working tree");

    let staged = get_file_image(&g, &image_req("logo.png", "staged", false, None)).unwrap();
    assert_eq!(staged.before.unwrap().bytes, png(2, 60).len(), "HEAD");
    assert_eq!(staged.after.unwrap().bytes, png(3, 80).len(), "index");

    let first = sh_out(d, &["rev-list", "--max-parents=0", "HEAD"]);
    let root = get_file_image(&g, &image_req("logo.png", "commit", false, Some(&first))).unwrap();
    assert!(root.before.is_none(), "root commit has no parent");
    assert_eq!(root.after.unwrap().bytes, png(1, 40).len());
    let second = get_file_image(&g, &image_req("logo.png", "commit", false, Some("HEAD"))).unwrap();
    assert_eq!(second.before.unwrap().bytes, png(1, 40).len());
    assert_eq!(second.after.unwrap().bytes, png(2, 60).len());

    let added = get_file_image(&g, &image_req("new.webp", "unstaged", true, None)).unwrap();
    assert!(added.before.is_none());
    assert!(added.after.unwrap().data_url.starts_with("data:image/webp;base64,"));

    std::fs::remove_file(d.join("logo.png")).unwrap();
    let deleted = get_file_image(&g, &image_req("logo.png", "unstaged", false, None)).unwrap();
    assert!(deleted.before.is_some() && deleted.after.is_none());

    let escape = get_file_image(&g, &image_req("../outside.png", "unstaged", true, None)).unwrap();
    assert!(escape.after.is_none(), "never reads outside the repository");
}

#[test]
fn clones_a_repository_and_refuses_to_overwrite() {
    use git::{clone_repo, repo_name_from_url};
    assert_eq!(repo_name_from_url("https://github.com/cheakimhengg/KromaGit.git"), "KromaGit");
    assert_eq!(repo_name_from_url("git@github.com:org/tools.git/"), "tools");
    assert_eq!(repo_name_from_url("/tmp/local-repo"), "local-repo");

    let src = sample_repo();
    let dest = tempfile::tempdir().unwrap();
    let parent = dest.path().to_string_lossy().to_string();
    let url = src.path().to_string_lossy().to_string();
    let info = clone_repo(&url, &parent, "copy").unwrap();
    assert_eq!(info.name, "copy");
    assert!(dest.path().join("copy/a.txt").exists());

    assert!(clone_repo(&url, &parent, "copy").is_err(), "existing folder is never overwritten");
    assert!(clone_repo(&url, &parent, "../escape").is_err());
    assert!(clone_repo("--upload-pack=evil", &parent, "x").is_err());
    assert!(clone_repo(&url, "/definitely/not/here", "x").is_err());
}

#[test]
fn file_history_follows_renames_and_blame_reads_lines() {
    use git::history::{blame, file_history};
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    write(d, "old.txt", "one\ntwo\nthree\nfour\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "add old"]);
    sh(d, &["mv", "old.txt", "new.txt"]);
    sh(d, &["commit", "-qm", "rename"]);
    write(d, "new.txt", "one\nTWO\nthree\nfour\n");
    sh(d, &["commit", "-qam", "edit"]);
    let g = Git::new(d);
    let h = file_history(&g, "new.txt", 50).unwrap();
    let subjects: Vec<_> = h.iter().map(|e| e.commit.subject.as_str()).collect();
    assert_eq!(subjects, ["edit", "rename", "add old"]);
    assert_eq!(h[2].path, "old.txt", "path before the rename");
    assert_eq!(h[0].path, "new.txt");

    let b = blame(&g, "new.txt", None).unwrap();
    assert_eq!(b.len(), 4);
    assert_eq!((b[1].content.as_str(), b[1].summary.as_str()), ("TWO", "edit"));
    assert_eq!(b[0].summary, "add old");
    let at = blame(&g, "new.txt", Some(&h[1].commit.hash)).unwrap();
    assert_eq!(at[1].content, "two", "blame at an older commit");
    assert!(file_history(&g, "--evil", 5).is_err());
}

#[test]
fn diff_can_ignore_whitespace_and_show_the_whole_file() {
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    let body: String = (1..=20).map(|i| format!("line {i}\n")).collect();
    write(d, "f.txt", &body);
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "base"]);
    write(d, "f.txt", &body.replace("line 10\n", "line  10   \n").replace("line 15\n", "line fifteen\n"));
    let g = Git::new(d);
    let base = req("f.txt", "unstaged", false, None, None);
    let normal = git::diff::get_file_diff(&g, &base).unwrap();
    let changed = |f: &kromagit_lib::git::model::FileDiff| f.hunks.iter().flat_map(|h| &h.lines).filter(|l| l.kind != "context").count();
    assert_eq!(changed(&normal), 4);
    let ws = git::diff::get_file_diff(&g, &DiffRequest { ignore_whitespace: true, ..base.clone() }).unwrap();
    assert_eq!(changed(&ws), 2, "whitespace-only change hidden");
    let full = git::diff::get_file_diff(&g, &DiffRequest { full_file: true, ..base }).unwrap();
    assert_eq!(full.hunks.len(), 1);
    assert_eq!(full.hunks[0].lines.len(), 22, "every line of the file is shown");
}
