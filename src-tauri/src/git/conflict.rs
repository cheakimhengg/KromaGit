//! Reading and writing a conflicted file for the in-app resolver.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use super::runner::Git;
use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    /// the working-tree file, including the <<<<<<< / ======= / >>>>>>> markers
    pub text: String,
    /// name of the checked-out branch ("HEAD" when detached)
    pub ours: String,
    /// what is being merged in, e.g. a branch name, taken from MERGE_MSG / the markers
    pub theirs: String,
}

/// A repo-relative path that cannot escape the repository.
fn safe_path(git: &Git, rel: &str) -> AppResult<PathBuf> {
    let p = Path::new(rel);
    let ok = !rel.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(AppError::Internal(format!("“{rel}” is not a file inside the repository.")));
    }
    Ok(git.cwd().join(p))
}

pub fn read(git: &Git, path: &str) -> AppResult<ConflictFile> {
    let full = safe_path(git, path)?;
    let bytes = std::fs::read(&full)?;
    let text = String::from_utf8(bytes).map_err(|_| AppError::Internal("This file is not text, so it can't be resolved here.".into()))?;
    let ours = git
        .run_string(&["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "HEAD".into());
    let theirs = text
        .lines()
        .find_map(|l| l.strip_prefix(">>>>>>> ").map(|s| s.trim().to_string()))
        .unwrap_or_else(|| "incoming".into());
    Ok(ConflictFile { text, ours, theirs })
}

/// The message git prepared for the merge commit (.git/MERGE_MSG), without comment lines.
pub fn merge_message(git: &Git) -> AppResult<Option<String>> {
    let rel = git.run_string(&["rev-parse", "--git-path", "MERGE_MSG"])?;
    let p = git.cwd().join(rel.trim());
    let Ok(raw) = std::fs::read_to_string(p) else { return Ok(None) };
    let msg: Vec<&str> = raw.lines().filter(|l| !l.starts_with('#')).collect();
    let msg = msg.join("\n").trim().to_string();
    Ok(if msg.is_empty() { None } else { Some(msg) })
}

pub fn write(git: &Git, path: &str, text: &str) -> AppResult<()> {
    let full = safe_path(git, path)?;
    if !full.is_file() {
        return Err(AppError::PathNotFound(path.to_string()));
    }
    std::fs::write(full, text)?;
    Ok(())
}
