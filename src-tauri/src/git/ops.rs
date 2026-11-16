//! State-changing git operations. Every action is triggered by an explicit user
//! click in the UI; the frontend confirms destructive ones before calling in.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::diff::get_file_diff;
use super::model::DiffRequest;
use super::patch::{build_patch, HunkSelection, PatchMode};
use super::runner::{Git, RunOptions};
use crate::error::{AppError, AppResult};

const NETWORK_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Action {
    Stage { paths: Vec<String> },
    Unstage { paths: Vec<String> },
    StageAll,
    UnstageAll,
    Discard { paths: Vec<String>, untracked: Vec<String> },
    DiscardAll,
    ApplySelection { path: String, source: String, hunks: Vec<HunkSelection>, discard: bool },
    ApplyPatch { patch: String, cached: bool, reverse: bool },
    Commit { message: String, amend: bool },
    Checkout { branch: String },
    CheckoutDetached { target: String },
    CheckoutRemote { remote_branch: String, name: String },
    CreateBranch { name: String, start: Option<String>, checkout: bool },
    DeleteBranch { name: String, force: bool },
    DeleteRemoteBranch { remote: String, branch: String },
    RenameBranch { old: String, new: String },
    CreateTag { name: String, target: Option<String>, message: Option<String> },
    DeleteTag { name: String },
    RestoreRef { refname: String, oid: String },
    DeleteHeadRef,
    Fetch { remote: Option<String> },
    Pull { mode: String },
    Push { remote: Option<String>, branch: Option<String>, set_upstream: bool, force: bool },
    Merge { target: String },
    Rebase { onto: String },
    CherryPick { hash: String },
    Revert { hash: String },
    Reset { target: String, mode: String },
    StashPush { message: Option<String>, include_untracked: bool },
    StashPop { index: u32 },
    StashApply { index: u32 },
    StashApplyOid { oid: String },
    StashDrop { index: u32 },
    StashStore { oid: String, message: String },
    AbortOperation,
    ContinueOperation,
    /// `git submodule update --init --recursive -- <path>`: checks out the commit the parent repo records
    SubmoduleUpdate { path: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
pub struct HeadState {
    pub oid: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpOutcome {
    pub before: HeadState,
    pub after: HeadState,
    /// Action-specific undo data: a backup stash oid, the applied patch, a deleted ref's oid…
    pub data: Option<String>,
    pub output: String,
}

pub fn head_state(git: &Git) -> AppResult<HeadState> {
    let oid = git.run_with_codes(&["rev-parse", "-q", "--verify", "HEAD"], &[0, 1])?;
    let branch = git.run_with_codes(&["symbolic-ref", "-q", "--short", "HEAD"], &[0, 1])?;
    let s = |b: Vec<u8>| Some(String::from_utf8_lossy(&b).trim().to_string()).filter(|s| !s.is_empty());
    Ok(HeadState { oid: s(oid), branch: s(branch) })
}

/// "merge" | "rebase" | "cherryPick" | "revert" when an operation is paused (e.g. on conflicts).
pub fn operation_in_progress(git: &Git) -> AppResult<Option<&'static str>> {
    let dir = git.run_string(&["rev-parse", "--absolute-git-dir"])?;
    let dir = std::path::Path::new(dir.trim());
    Ok(if dir.join("rebase-merge").exists() || dir.join("rebase-apply").exists() {
        Some("rebase")
    } else if dir.join("MERGE_HEAD").exists() {
        Some("merge")
    } else if dir.join("CHERRY_PICK_HEAD").exists() {
        Some("cherryPick")
    } else if dir.join("REVERT_HEAD").exists() {
        Some("revert")
    } else {
        None
    })
}

struct Out {
    data: Option<String>,
    text: String,
}

impl Out {
    fn none() -> Self {
        Out { data: None, text: String::new() }
    }
}

fn text(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn nul_list(paths: &[String]) -> Vec<u8> {
    let mut buf = Vec::new();
    for p in paths {
        buf.extend_from_slice(p.as_bytes());
        buf.push(0);
    }
    buf
}

/// Resolves `rev`, or returns an empty string when it doesn't exist
/// (`--verify -q` exits 1 silently for a missing ref — that is not an error).
fn rev_parse(git: &Git, rev: &str) -> AppResult<String> {
    let out = git.run_with_codes(&["rev-parse", "--verify", "-q", rev], &[0, 1])?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

/// Snapshot of tracked changes (index + worktree) without touching anything.
/// Returns `None` when there is nothing to back up.
fn backup_stash(git: &Git) -> AppResult<Option<String>> {
    let oid = git.run_string(&["stash", "create", "KromaGit backup"])?.trim().to_string();
    Ok(Some(oid).filter(|o| !o.is_empty()))
}

fn has_head(git: &Git) -> AppResult<bool> {
    Ok(!git.run_with_codes(&["rev-parse", "-q", "--verify", "HEAD"], &[0, 1])?.is_empty())
}

fn is_merge_commit(git: &Git, hash: &str) -> AppResult<bool> {
    let out = git.run_string(&["rev-list", "--parents", "-n", "1", hash])?;
    Ok(out.split_whitespace().count() > 2)
}

fn network(git: &Git, args: &[&str]) -> AppResult<Out> {
    let out = git.exec(args, &RunOptions { timeout: Some(NETWORK_TIMEOUT), ..Default::default() })?;
    let mut t = text(out.stderr);
    let o = text(out.stdout);
    if !o.is_empty() {
        if !t.is_empty() {
            t.push('\n');
        }
        t.push_str(&o);
    }
    Ok(Out { data: None, text: t })
}

fn validate_ref_name(git: &Git, name: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.starts_with('-') {
        return Err(AppError::Internal(format!("“{name}” is not a valid name.")));
    }
    git.run(&["check-ref-format", "--branch", name])
        .map(|_| ())
        .map_err(|_| AppError::Internal(format!("“{name}” is not a valid branch or tag name.")))
}

pub fn run_action(git: &Git, action: &Action) -> AppResult<OpOutcome> {
    let before = head_state(git)?;
    let out = perform(git, action)?;
    let after = head_state(git)?;
    Ok(OpOutcome { before, after, data: out.data, output: out.text })
}

fn perform(git: &Git, action: &Action) -> AppResult<Out> {
    use Action::*;
    Ok(match action {
        Stage { paths } => {
            git.run_with_input(&["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_list(paths))?;
            Out::none()
        }
        Unstage { paths } => {
            if has_head(git)? {
                git.run_with_input(&["restore", "--staged", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_list(paths))?;
            } else {
                git.run_with_input(&["rm", "--cached", "-r", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_list(paths))?;
            }
            Out::none()
        }
        StageAll => {
            git.run(&["add", "-A"])?;
            Out::none()
        }
        UnstageAll => {
            if has_head(git)? {
                git.run(&["reset", "-q"])?;
            } else {
                git.run_with_codes(&["rm", "--cached", "-r", "-q", "--ignore-unmatch", "."], &[0])?;
            }
            Out::none()
        }
        Discard { paths, untracked } => {
            let backup = backup_stash(git)?;
            if !paths.is_empty() {
                git.run_with_input(&["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_list(paths))?;
            }
            for chunk in untracked.chunks(200) {
                let mut args = vec!["clean", "-f", "-q", "--"];
                args.extend(chunk.iter().map(String::as_str));
                git.run(&args)?;
            }
            Out { data: backup, text: String::new() }
        }
        DiscardAll => {
            let backup = backup_stash(git)?;
            git.run(&["restore", "--worktree", "--", "."])?;
            git.run(&["clean", "-f", "-d", "-q"])?;
            Out { data: backup, text: String::new() }
        }
        ApplySelection { path, source, hunks, discard } => {
            let staged = source == "staged";
            if staged && *discard {
                return Err(AppError::Internal("Discarding staged lines is not supported; unstage them first.".into()));
            }
            let req = DiffRequest {
                path: path.clone(),
                old_path: None,
                source: source.clone(),
                untracked: false,
                commit: None,
                parent: None,
                ignore_whitespace: false,
                full_file: false,
            };
            let diff = get_file_diff(git, &req)?;
            let forward = !staged && !*discard;
            let mode = if forward { PatchMode::Forward } else { PatchMode::Reverse };
            let patch = build_patch(path, None, &diff.hunks, hunks, mode)?;
            let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
            if !*discard {
                args.push("--cached");
            }
            if !forward {
                args.push("--reverse");
            }
            args.push("-");
            git.run_with_input(&args, patch.as_bytes())?;
            Out { data: Some(patch), text: String::new() }
        }
        ApplyPatch { patch, cached, reverse } => {
            let mut args = vec!["apply", "--recount", "--whitespace=nowarn"];
            if *cached {
                args.push("--cached");
            }
            if *reverse {
                args.push("--reverse");
            }
            args.push("-");
            git.run_with_input(&args, patch.as_bytes())?;
            Out::none()
        }
        Commit { message, amend } => {
            if message.trim().is_empty() {
                return Err(AppError::Internal("Commit message is empty.".into()));
            }
            let mut args = vec!["commit", "-F", "-", "--cleanup=strip"];
            if *amend {
                args.push("--amend");
            }
            let out = git.run_with_input(&args, message.as_bytes())?;
            Out { data: None, text: text(out) }
        }
        Checkout { branch } => {
            git.run(&["switch", "--no-guess", branch])?;
            Out::none()
        }
        CheckoutDetached { target } => {
            git.run(&["switch", "--detach", target])?;
            Out::none()
        }
        CheckoutRemote { remote_branch, name } => {
            validate_ref_name(git, name)?;
            if rev_parse(git, &format!("refs/heads/{name}"))?.is_empty() {
                git.run(&["switch", "-c", name, "--track", remote_branch])?;
            } else {
                git.run(&["switch", "--no-guess", name])?;
            }
            Out::none()
        }
        CreateBranch { name, start, checkout } => {
            validate_ref_name(git, name)?;
            let mut args = if *checkout { vec!["switch", "-c", name] } else { vec!["branch", name] };
            if let Some(s) = start.as_deref() {
                args.push(s);
            }
            git.run(&args)?;
            Out::none()
        }
        DeleteBranch { name, force } => {
            let oid = rev_parse(git, &format!("refs/heads/{name}"))?;
            git.run(&["branch", if *force { "-D" } else { "-d" }, name])?;
            Out { data: Some(oid), text: String::new() }
        }
        DeleteRemoteBranch { remote, branch } => network(git, &["push", remote, "--delete", branch])?,
        RenameBranch { old, new } => {
            validate_ref_name(git, new)?;
            git.run(&["branch", "-m", old, new])?;
            Out::none()
        }
        CreateTag { name, target, message } => {
            validate_ref_name(git, name)?;
            let mut args = vec!["tag"];
            if let Some(m) = message.as_deref().filter(|m| !m.trim().is_empty()) {
                args.extend(["-a", name, "-m", m]);
            } else {
                args.push(name);
            }
            if let Some(t) = target.as_deref() {
                args.push(t);
            }
            git.run(&args)?;
            Out::none()
        }
        SubmoduleUpdate { path } => {
            git.run(&["submodule", "update", "--init", "--recursive", "--", path])?;
            Out::none()
        }
        DeleteTag { name } => {
            let oid = rev_parse(git, &format!("refs/tags/{name}"))?;
            git.run(&["tag", "-d", name])?;
            Out { data: Some(oid), text: String::new() }
        }
        RestoreRef { refname, oid } => {
            if !(refname.starts_with("refs/heads/") || refname.starts_with("refs/tags/")) {
                return Err(AppError::Internal(format!("Refusing to restore {refname}")));
            }
            git.run(&["update-ref", refname, oid, ""])?;
            Out::none()
        }
        DeleteHeadRef => {
            git.run(&["update-ref", "-d", "HEAD"])?;
            Out::none()
        }
        Fetch { remote } => match remote.as_deref() {
            Some(r) => network(git, &["fetch", "--prune", r])?,
            None => network(git, &["fetch", "--prune", "--all"])?,
        },
        Pull { mode } => {
            let flag = match mode.as_str() {
                "rebase" => "--rebase",
                "ffOnly" => "--ff-only",
                _ => "--no-rebase",
            };
            network(git, &["pull", "--prune", "--no-edit", flag])?
        }
        Push { remote, branch, set_upstream, force } => {
            let mut args = vec!["push"];
            if *force {
                args.push("--force-with-lease");
            }
            if *set_upstream {
                args.push("-u");
            }
            if let Some(r) = remote.as_deref() {
                args.push(r);
                if let Some(b) = branch.as_deref() {
                    args.push(b);
                }
            }
            network(git, &args)?
        }
        Merge { target } => Out { data: None, text: text(git.run(&["merge", "--no-edit", target])?) },
        Rebase { onto } => Out { data: None, text: text(git.run(&["rebase", onto])?) },
        CherryPick { hash } => {
            let mut args = vec!["cherry-pick"];
            if is_merge_commit(git, hash)? {
                args.extend(["-m", "1"]);
            }
            args.push(hash);
            Out { data: None, text: text(git.run(&args)?) }
        }
        Revert { hash } => {
            let mut args = vec!["revert", "--no-edit"];
            if is_merge_commit(git, hash)? {
                args.extend(["-m", "1"]);
            }
            args.push(hash);
            Out { data: None, text: text(git.run(&args)?) }
        }
        Reset { target, mode } => {
            let flag = match mode.as_str() {
                "soft" => "--soft",
                "mixed" => "--mixed",
                "hard" => "--hard",
                "keep" => "--keep",
                other => return Err(AppError::Internal(format!("Unknown reset mode {other}"))),
            };
            let backup = if mode == "hard" { backup_stash(git)? } else { None };
            git.run(&["reset", "-q", flag, target])?;
            Out { data: backup, text: String::new() }
        }
        StashPush { message, include_untracked } => {
            let mut args = vec!["stash", "push"];
            if *include_untracked {
                args.push("-u");
            }
            if let Some(m) = message.as_deref().filter(|m| !m.trim().is_empty()) {
                args.extend(["-m", m]);
            }
            Out { data: None, text: text(git.run(&args)?) }
        }
        StashPop { index } => {
            let s = format!("stash@{{{index}}}");
            let oid = rev_parse(git, &s)?;
            git.run(&["stash", "pop", &s])?;
            Out { data: Some(oid), text: String::new() }
        }
        StashApply { index } => {
            git.run(&["stash", "apply", &format!("stash@{{{index}}}")])?;
            Out::none()
        }
        StashApplyOid { oid } => {
            git.run(&["stash", "apply", oid])?;
            Out::none()
        }
        StashDrop { index } => {
            let s = format!("stash@{{{index}}}");
            let oid = rev_parse(git, &s)?;
            let msg = git.run_string(&["log", "-1", "--format=%gs", "-g", &s]).unwrap_or_default();
            git.run(&["stash", "drop", &s])?;
            Out { data: Some(format!("{oid}\n{}", msg.trim())), text: String::new() }
        }
        StashStore { oid, message } => {
            git.run(&["stash", "store", "-m", message, oid])?;
            Out::none()
        }
        AbortOperation => {
            let op = operation_in_progress(git)?.ok_or_else(|| AppError::Internal("Nothing to abort.".into()))?;
            git.run(&[op_command(op), "--abort"])?;
            Out::none()
        }
        ContinueOperation => {
            let op = operation_in_progress(git)?.ok_or_else(|| AppError::Internal("Nothing to continue.".into()))?;
            Out { data: None, text: text(git.run(&[op_command(op), "--continue"])?) }
        }
    })
}

fn op_command(op: &str) -> &'static str {
    match op {
        "rebase" => "rebase",
        "cherryPick" => "cherry-pick",
        "revert" => "revert",
        _ => "merge",
    }
}

#[cfg(test)]
mod tests {
    use super::Action;

    /// Every shape the frontend's `GitAction` union can send (src/types/git.ts).
    #[test]
    fn deserializes_every_frontend_action_shape() {
        let samples = r#"[
            {"type":"stage","paths":["a"]},
            {"type":"unstage","paths":["a"]},
            {"type":"stageAll"},
            {"type":"unstageAll"},
            {"type":"discard","paths":["a"],"untracked":["b"]},
            {"type":"discardAll"},
            {"type":"applySelection","path":"a","source":"unstaged","hunks":[{"header":"@@ -1 +1 @@","lines":[1,2]},{"header":"@@ -9 +9 @@","lines":null}],"discard":false},
            {"type":"applyPatch","patch":"p","cached":true,"reverse":false},
            {"type":"commit","message":"m","amend":false},
            {"type":"checkout","branch":"main"},
            {"type":"checkoutDetached","target":"abc"},
            {"type":"checkoutRemote","remoteBranch":"origin/x","name":"x"},
            {"type":"createBranch","name":"x","start":null,"checkout":true},
            {"type":"deleteBranch","name":"x","force":false},
            {"type":"deleteRemoteBranch","remote":"origin","branch":"x"},
            {"type":"renameBranch","old":"a","new":"b"},
            {"type":"createTag","name":"v1","target":null,"message":null},
            {"type":"deleteTag","name":"v1"},
            {"type":"restoreRef","refname":"refs/tags/v1","oid":"abc"},
            {"type":"deleteHeadRef"},
            {"type":"fetch","remote":null},
            {"type":"pull","mode":"ffOnly"},
            {"type":"push","remote":"origin","branch":"main","setUpstream":true,"force":false},
            {"type":"merge","target":"x"},
            {"type":"rebase","onto":"x"},
            {"type":"cherryPick","hash":"abc"},
            {"type":"revert","hash":"abc"},
            {"type":"reset","target":"abc","mode":"hard"},
            {"type":"stashPush","message":null,"includeUntracked":true},
            {"type":"stashPop","index":0},
            {"type":"stashApply","index":1},
            {"type":"stashApplyOid","oid":"abc"},
            {"type":"stashDrop","index":0},
            {"type":"stashStore","oid":"abc","message":"m"},
            {"type":"abortOperation"},
            {"type":"continueOperation"},
            {"type":"submoduleUpdate","path":"libs/x"}
        ]"#;
        let actions: Vec<Action> = serde_json::from_str(samples).expect("all frontend action shapes deserialize");
        assert_eq!(actions.len(), 37);
        assert!(matches!(&actions[11], Action::CheckoutRemote { remote_branch, .. } if remote_branch == "origin/x"));
        assert!(matches!(&actions[28], Action::StashPush { include_untracked: true, .. }));
    }
}
