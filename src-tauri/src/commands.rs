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

#[tauri::command]
pub async fn git_action(repo: String, action: git::ops::Action) -> AppResult<git::ops::OpOutcome> {
    blocking(move || git::ops::run_action(&Git::new(repo), &action)).await
}

#[tauri::command]
pub async fn open_in_terminal(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let choice = crate::settings::load(&config_dir(&app)?).general.terminal_app;
    blocking(move || crate::system::open_terminal(&path, &choice)).await
}

#[tauri::command]
pub async fn open_in_editor(app: tauri::AppHandle, path: String) -> AppResult<()> {
    let choice = crate::settings::load(&config_dir(&app)?).general.editor_app;
    blocking(move || crate::system::open_editor(&path, &choice)).await
}

// ---------- settings, keychain, AI ----------

use tauri::Manager;

fn config_dir(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    app.path().app_config_dir().map_err(|e| AppError::Internal(format!("No config directory: {e}")))
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> AppResult<crate::settings::Settings> {
    Ok(crate::settings::load(&config_dir(&app)?))
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: crate::settings::Settings) -> AppResult<()> {
    crate::settings::save(&config_dir(&app)?, &settings)
}

#[tauri::command]
pub async fn set_api_key(provider: String, key: String) -> AppResult<()> {
    blocking(move || crate::secrets::set_key(&provider, &key)).await
}

#[tauri::command]
pub async fn delete_api_key(provider: String) -> AppResult<()> {
    blocking(move || crate::secrets::delete_key(&provider)).await
}

#[tauri::command]
pub async fn api_key_status() -> AppResult<std::collections::HashMap<String, bool>> {
    blocking(|| Ok(crate::secrets::key_status())).await
}

#[tauri::command]
pub async fn ai_complete(app: tauri::AppHandle, request: crate::ai::client::AiRequest) -> AppResult<crate::ai::client::AiResponse> {
    let settings = crate::settings::load(&config_dir(&app)?);
    let ai = settings.ai.clone();
    let ai_for_key = ai.clone();
    // keychain access can block (OS prompt), so resolve it off the async runtime first
    blocking(move || crate::ai::client::resolve_target(&ai_for_key).map(|_| ())).await?;
    crate::ai::client::complete(&ai, &request).await
}

#[tauri::command]
pub async fn ollama_models(url: String) -> AppResult<Vec<String>> {
    crate::ai::client::ollama_models(&url).await
}

#[tauri::command]
pub async fn ai_collect_diff(repo: String, scope: String, per_file_cap: usize) -> AppResult<crate::ai::collect::AiDiffBundle> {
    blocking(move || crate::ai::collect::collect(&Git::new(repo), &scope, per_file_cap)).await
}

#[tauri::command]
pub async fn recent_messages(repo: String, count: usize) -> AppResult<Vec<String>> {
    blocking(move || crate::ai::history::recent_messages(&Git::new(repo), count)).await
}

#[tauri::command]
pub async fn git_user_email(repo: String) -> AppResult<String> {
    blocking(move || crate::ai::history::user_email(&Git::new(repo))).await
}

#[tauri::command]
pub async fn standup_commits(paths: Vec<String>, since: String, until: String, author: String) -> AppResult<Vec<crate::ai::history::StandupRepo>> {
    blocking(move || Ok(crate::ai::history::standup_commits(&paths, &since, &until, &author))).await
}

#[tauri::command]
pub async fn cleanup_candidates(repo: String, bases: Vec<String>, stale_days: u32) -> AppResult<Vec<crate::ai::history::CleanupCandidate>> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    blocking(move || crate::ai::history::cleanup_candidates(&Git::new(repo), &bases, stale_days, now)).await
}
