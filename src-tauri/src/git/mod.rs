pub mod diff;
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
