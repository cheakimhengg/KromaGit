pub mod diff;
pub mod history;
pub mod image;
pub mod log;
pub mod model;
pub mod ops;
pub mod patch;
pub mod refs;
pub mod runner;
pub mod status;

use std::path::Path;

use crate::error::{AppError, AppResult};
use model::RepoInfo;
use runner::Git;

/// Resolves any path inside a working tree to the repository root.
pub fn open_repo(path: &str) -> AppResult<RepoInfo> {
    let git = Git::new(path);
    let root = match git.run_string(&["rev-parse", "--show-toplevel"]) {
        Ok(r) => r.trim().to_string(),
        Err(AppError::Git { .. }) => return Err(AppError::NotARepo(path.to_string())),
        Err(e) => return Err(e),
    };
    if root.is_empty() {
        return Err(AppError::NotARepo(path.to_string()));
    }
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());
    Ok(RepoInfo { root, name })
}

pub fn git_version() -> AppResult<String> {
    Ok(Git::new(".").run_string(&["--version"])?.trim().to_string())
}

/// Folder name git would pick for a clone URL: last path segment without ".git".
pub fn repo_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    let last = trimmed.rsplit(['/', '\\', ':']).next().unwrap_or(trimmed);
    last.strip_suffix(".git").unwrap_or(last).to_string()
}

const CLONE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// Clones `url` into `parent/name` and opens it. Refuses to overwrite anything.
pub fn clone_repo(url: &str, parent: &str, name: &str) -> AppResult<RepoInfo> {
    let url = url.trim();
    if url.is_empty() || url.starts_with('-') {
        return Err(AppError::Internal("Enter the URL of the repository to clone.".into()));
    }
    let name = name.trim();
    let bad_name = name.is_empty() || name == "." || name == ".." || name.starts_with('-') || name.contains(['/', '\\']);
    if bad_name {
        return Err(AppError::Internal(format!("“{name}” is not a valid folder name.")));
    }
    let parent_dir = Path::new(parent);
    if !parent_dir.is_dir() {
        return Err(AppError::PathNotFound(parent.to_string()));
    }
    let dest = parent_dir.join(name);
    if dest.exists() {
        return Err(AppError::Internal(format!("{} already exists — choose another folder name.", dest.display())));
    }
    Git::new(parent_dir).exec(
        &["clone", "--", url, name],
        &runner::RunOptions { timeout: Some(CLONE_TIMEOUT), ..Default::default() },
    )?;
    open_repo(&dest.to_string_lossy())
}
