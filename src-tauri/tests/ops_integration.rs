use std::path::Path;

use kromagit_lib::git::ops::{run_action, Action};
use kromagit_lib::git::{diff, model::DiffRequest, runner::Git, status};

mod common;
use common::{read, write};

fn sh(dir: &Path, args: &[&str]) -> String {
    common::git(dir, args)
}

/// Actions are run through the library with the test identity in the environment.
fn act(dir: &Path, json: serde_json::Value) -> kromagit_lib::git::ops::OpOutcome {
    let action: Action = serde_json::from_value(json.clone()).unwrap_or_else(|e| panic!("bad action {json}: {e}"));
    run_action(&Git::new(dir), &action).unwrap_or_else(|e| panic!("{json} failed: {e}"))
}

fn try_act(dir: &Path, json: serde_json::Value) -> Result<kromagit_lib::git::ops::OpOutcome, String> {
    let action: Action = serde_json::from_value(json).unwrap();
    run_action(&Git::new(dir), &action).map_err(|e| e.to_string())
}

fn repo() -> tempfile::TempDir {
    common::isolate();
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    write(d, "f.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "initial"]);
    tmp
}

fn st(d: &Path) -> kromagit_lib::git::model::StatusPayload {
    status::get_status(&Git::new(d)).unwrap()
}

#[test]
fn stage_unstage_commit_and_undo_commit() {
    let tmp = repo();
    let d = tmp.path();
    write(d, "f.txt", "one\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
    write(d, "new.txt", "n\n");

    act(d, serde_json::json!({ "type": "stage", "paths": ["f.txt", "new.txt"] }));
    assert_eq!(st(d).staged.len(), 2);
    act(d, serde_json::json!({ "type": "unstage", "paths": ["new.txt"] }));
    assert_eq!(st(d).staged.len(), 1);
    act(d, serde_json::json!({ "type": "stageAll" }));
    assert_eq!(st(d).staged.len(), 2);

    let out = act(d, serde_json::json!({ "type": "commit", "message": "feat: two files\n\nbody", "amend": false }));
    assert_ne!(out.before.oid, out.after.oid);
    assert_eq!(out.after.branch.as_deref(), Some("main"));
    assert_eq!(sh(d, &["log", "-1", "--format=%B"]), "feat: two files\n\nbody");
    assert!(st(d).staged.is_empty());

    act(d, serde_json::json!({ "type": "commit", "message": "feat: renamed", "amend": true }));
    assert_eq!(sh(d, &["log", "-1", "--format=%s"]), "feat: renamed");
    assert_eq!(sh(d, &["rev-list", "--count", "HEAD"]), "2");

    // undo = soft reset to the previous head; the changes come back staged
    act(d, serde_json::json!({ "type": "reset", "target": out.before.oid.unwrap(), "mode": "soft" }));
    assert_eq!(sh(d, &["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(st(d).staged.len(), 2);
}

#[test]
fn stages_unstages_and_discards_selected_lines() {
    let tmp = repo();
    let d = tmp.path();
    write(d, "f.txt", "ONE\n2\n3\n4\n5\n6\n7\n8\n9\nTEN\n");
    let g = Git::new(d);
    let req = |source: &str| DiffRequest { path: "f.txt".into(), old_path: None, source: source.into(), untracked: false, commit: None, parent: None };

    let unstaged = diff::get_file_diff(&g, &req("unstaged")).unwrap();
    assert_eq!(unstaged.hunks.len(), 2);
    let h0 = &unstaged.hunks[0];
    let add_idx = h0.lines.iter().position(|l| l.kind == "add").unwrap();
    let del_idx = h0.lines.iter().position(|l| l.kind == "del").unwrap();

    // stage only the first hunk's change
    let staged_out = act(d, serde_json::json!({
        "type": "applySelection", "path": "f.txt", "source": "unstaged", "discard": false,
        "hunks": [{ "header": h0.header, "lines": [del_idx, add_idx] }]
    }));
    assert_eq!(sh(d, &["show", ":f.txt"]).lines().next(), Some("ONE"));
    assert_eq!(sh(d, &["show", ":f.txt"]).lines().last(), Some("10"));
    let patch = staged_out.data.unwrap();

    // undo of a partial stage = reverse-apply the same patch to the index
    act(d, serde_json::json!({ "type": "applyPatch", "patch": patch, "cached": true, "reverse": true }));
    assert!(st(d).staged.is_empty());

    // stage the second hunk, then unstage it by line selection from the staged diff
    let h1 = unstaged.hunks[1].header.clone();
    act(d, serde_json::json!({ "type": "applySelection", "path": "f.txt", "source": "unstaged", "discard": false, "hunks": [{ "header": h1, "lines": null }] }));
    let staged = diff::get_file_diff(&g, &req("staged")).unwrap();
    act(d, serde_json::json!({ "type": "applySelection", "path": "f.txt", "source": "staged", "discard": false, "hunks": [{ "header": staged.hunks[0].header, "lines": null }] }));
    assert!(st(d).staged.is_empty());

    // discard only the first hunk from the working tree; second change survives
    let fresh = diff::get_file_diff(&g, &req("unstaged")).unwrap();
    let discard = act(d, serde_json::json!({ "type": "applySelection", "path": "f.txt", "source": "unstaged", "discard": true, "hunks": [{ "header": fresh.hunks[0].header, "lines": null }] }));
    assert_eq!(read(d, "f.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\nTEN\n");
    act(d, serde_json::json!({ "type": "applyPatch", "patch": discard.data.unwrap(), "cached": false, "reverse": false }));
    assert_eq!(read(d, "f.txt"), "ONE\n2\n3\n4\n5\n6\n7\n8\n9\nTEN\n");

    // stale selections are rejected rather than applied to the wrong lines
    let err = try_act(d, serde_json::json!({ "type": "applySelection", "path": "f.txt", "source": "unstaged", "discard": false, "hunks": [{ "header": "@@ -50,1 +50,1 @@", "lines": null }] })).unwrap_err();
    assert!(err.contains("changed since"), "{err}");
}

#[test]
fn discard_keeps_a_recoverable_backup() {
    let tmp = repo();
    let d = tmp.path();
    write(d, "f.txt", "precious work\n");
    write(d, "scratch.txt", "untracked\n");
    let out = act(d, serde_json::json!({ "type": "discard", "paths": ["f.txt"], "untracked": ["scratch.txt"] }));
    assert_eq!(read(d, "f.txt"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
    assert!(!d.join("scratch.txt").exists());
    let backup = out.data.expect("backup stash oid");

    act(d, serde_json::json!({ "type": "stashApplyOid", "oid": backup }));
    assert_eq!(read(d, "f.txt"), "precious work\n");

    write(d, "f.txt", "more work\n");
    let all = act(d, serde_json::json!({ "type": "discardAll" }));
    assert!(st(d).unstaged.is_empty());
    assert!(all.data.is_some());
}

#[test]
fn branches_tags_and_their_undo_data() {
    let tmp = repo();
    let d = tmp.path();
    let out = act(d, serde_json::json!({ "type": "createBranch", "name": "feature/x", "start": null, "checkout": true }));
    assert_eq!(out.after.branch.as_deref(), Some("feature/x"));
    act(d, serde_json::json!({ "type": "checkout", "branch": "main" }));
    act(d, serde_json::json!({ "type": "renameBranch", "old": "feature/x", "new": "feature/y" }));

    let del = act(d, serde_json::json!({ "type": "deleteBranch", "name": "feature/y", "force": false }));
    let oid = del.data.unwrap();
    assert_eq!(sh(d, &["branch", "--list", "feature/y"]), "");
    act(d, serde_json::json!({ "type": "restoreRef", "refname": "refs/heads/feature/y", "oid": oid }));
    assert_eq!(sh(d, &["branch", "--list", "feature/y"]), "feature/y");

    assert!(try_act(d, serde_json::json!({ "type": "createBranch", "name": "bad name", "start": null, "checkout": false })).is_err());
    assert!(try_act(d, serde_json::json!({ "type": "restoreRef", "refname": "HEAD", "oid": oid })).is_err());

    act(d, serde_json::json!({ "type": "createTag", "name": "v1", "target": null, "message": "release one" }));
    assert_eq!(sh(d, &["cat-file", "-t", "v1"]), "tag");
    let tag = act(d, serde_json::json!({ "type": "deleteTag", "name": "v1" }));
    act(d, serde_json::json!({ "type": "restoreRef", "refname": "refs/tags/v1", "oid": tag.data.unwrap() }));
    assert_eq!(sh(d, &["cat-file", "-t", "v1"]), "tag", "annotated tag object restored");

    let head = sh(d, &["rev-parse", "HEAD"]);
    let det = act(d, serde_json::json!({ "type": "checkoutDetached", "target": head }));
    assert!(det.after.branch.is_none());
}

#[test]
fn stash_cherry_pick_revert_reset() {
    let tmp = repo();
    let d = tmp.path();
    write(d, "f.txt", "stashed\n");
    act(d, serde_json::json!({ "type": "stashPush", "message": "wip", "includeUntracked": true }));
    assert!(st(d).unstaged.is_empty());
    let drop = act(d, serde_json::json!({ "type": "stashDrop", "index": 0 }));
    let data = drop.data.unwrap();
    let (oid, msg) = data.split_once('\n').unwrap();
    act(d, serde_json::json!({ "type": "stashStore", "oid": oid, "message": msg }));
    act(d, serde_json::json!({ "type": "stashPop", "index": 0 }));
    assert_eq!(read(d, "f.txt"), "stashed\n");
    sh(d, &["checkout", "-q", "--", "f.txt"]);

    sh(d, &["checkout", "-qb", "side"]);
    write(d, "side.txt", "s\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "side change"]);
    let pick = sh(d, &["rev-parse", "HEAD"]);
    sh(d, &["checkout", "-q", "main"]);
    act(d, serde_json::json!({ "type": "cherryPick", "hash": pick }));
    assert!(d.join("side.txt").exists());
    act(d, serde_json::json!({ "type": "revert", "hash": "HEAD" }));
    assert!(!d.join("side.txt").exists());

    write(d, "f.txt", "uncommitted\n");
    let first = sh(d, &["rev-list", "--max-parents=0", "HEAD"]);
    let reset = act(d, serde_json::json!({ "type": "reset", "target": first, "mode": "hard" }));
    assert_eq!(sh(d, &["rev-list", "--count", "HEAD"]), "1");
    act(d, serde_json::json!({ "type": "reset", "target": reset.before.oid.unwrap(), "mode": "keep" }));
    act(d, serde_json::json!({ "type": "stashApplyOid", "oid": reset.data.expect("hard reset backup") }));
    assert_eq!(read(d, "f.txt"), "uncommitted\n");
}

#[test]
fn merge_conflict_is_reported_and_abortable() {
    let tmp = repo();
    let d = tmp.path();
    sh(d, &["checkout", "-qb", "other"]);
    write(d, "f.txt", "theirs\n");
    sh(d, &["commit", "-qam", "theirs"]);
    sh(d, &["checkout", "-q", "main"]);
    write(d, "f.txt", "ours\n");
    sh(d, &["commit", "-qam", "ours"]);

    assert!(try_act(d, serde_json::json!({ "type": "merge", "target": "other" })).is_err());
    let s = st(d);
    assert_eq!(s.operation, Some("merge"));
    assert_eq!(s.unstaged[0].status, "U");
    act(d, serde_json::json!({ "type": "abortOperation" }));
    assert_eq!(st(d).operation, None);
    assert_eq!(read(d, "f.txt"), "ours\n");
}

#[test]
fn fetch_pull_push_against_local_remote() {
    let tmp = repo();
    let d = tmp.path();
    let remote = tempfile::tempdir().unwrap();
    sh(remote.path(), &["-c", "init.defaultBranch=main", "init", "-q", "--bare"]);
    sh(d, &["remote", "add", "origin", remote.path().to_str().unwrap()]);

    act(d, serde_json::json!({ "type": "push", "remote": "origin", "branch": "main", "setUpstream": true, "force": false }));
    assert_eq!(sh(d, &["rev-parse", "--abbrev-ref", "main@{upstream}"]), "origin/main");

    let clone = tempfile::tempdir().unwrap();
    sh(clone.path(), &["clone", "-q", remote.path().to_str().unwrap(), "."]);
    write(clone.path(), "f.txt", "from clone\n");
    sh(clone.path(), &["commit", "-qam", "clone change"]);
    sh(clone.path(), &["push", "-q"]);

    act(d, serde_json::json!({ "type": "fetch", "remote": null }));
    assert_eq!(st(d).head.behind, 1);
    act(d, serde_json::json!({ "type": "pull", "mode": "ffOnly" }));
    assert_eq!(read(d, "f.txt"), "from clone\n");

    sh(d, &["commit", "-q", "--amend", "-m", "rewritten"]);
    assert!(try_act(d, serde_json::json!({ "type": "push", "remote": null, "branch": null, "setUpstream": false, "force": false })).is_err());
    act(d, serde_json::json!({ "type": "push", "remote": null, "branch": null, "setUpstream": false, "force": true }));

    sh(d, &["push", "-q", "origin", "main:tmp"]);
    act(d, serde_json::json!({ "type": "deleteRemoteBranch", "remote": "origin", "branch": "tmp" }));
}

#[test]
fn first_commit_can_be_undone_in_an_unborn_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    repo();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    write(d, "a.txt", "a\n");
    act(d, serde_json::json!({ "type": "stage", "paths": ["a.txt"] }));
    act(d, serde_json::json!({ "type": "unstage", "paths": ["a.txt"] }));
    act(d, serde_json::json!({ "type": "stageAll" }));
    let c = act(d, serde_json::json!({ "type": "commit", "message": "first", "amend": false }));
    assert!(c.before.oid.is_none());
    act(d, serde_json::json!({ "type": "deleteHeadRef" }));
    let s = st(d);
    assert!(s.head.oid.is_none());
    assert_eq!(s.staged.len(), 1, "changes stay staged after undoing the first commit");
}
