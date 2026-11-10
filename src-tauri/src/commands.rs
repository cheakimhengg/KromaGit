use crate::error::{AppError, AppResult};
use crate::git::{self, model::*, runner::Git};

/// Every git call runs on the blocking pool so the UI thread never waits on a process.
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: String,
    git_version: Option<String>,
}

#[tauri::command]
pub async fn app_info() -> AppInfo {
    let git_version = blocking(git::git_version).await.ok();
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        git_version,
    }
}

/// Paths passed on the command line (`kromagit ~/code/app`), opened as tabs at startup.
#[tauri::command]
pub fn startup_paths() -> Vec<String> {
    std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect()
}

#[tauri::command]
pub async fn open_repo(path: String) -> AppResult<RepoInfo> {
    blocking(move || git::open_repo(&path)).await
}

#[tauri::command]
pub async fn get_commits(repo: String, limit: Option<usize>) -> AppResult<Vec<Commit>> {
    blocking(move || git::log::get_commits(&Git::new(repo), limit)).await
}

#[tauri::command]
pub async fn get_refs(repo: String) -> AppResult<RefsPayload> {
    blocking(move || git::refs::get_refs(&Git::new(repo))).await
}

#[tauri::command]
pub async fn get_status(repo: String) -> AppResult<StatusPayload> {
    blocking(move || git::status::get_status(&Git::new(repo))).await
}

#[tauri::command]
pub async fn get_commit_details(repo: String, hash: String) -> AppResult<CommitDetails> {
    blocking(move || git::diff::get_commit_details(&Git::new(repo), &hash)).await
}

#[tauri::command]
pub async fn get_file_diff(repo: String, request: DiffRequest) -> AppResult<FileDiff> {
    blocking(move || git::diff::get_file_diff(&Git::new(repo), &request)).await
}
