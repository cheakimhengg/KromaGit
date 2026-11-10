pub mod ai;
pub mod commands;
pub mod error;
pub mod git;
pub mod secrets;
pub mod settings;
pub mod system;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::startup_paths,
            commands::open_repo,
            commands::get_commits,
            commands::get_refs,
            commands::get_status,
            commands::get_commit_details,
            commands::get_file_diff,
            commands::git_action,
            commands::open_in_terminal,
            commands::open_in_editor,
            commands::get_settings,
            commands::save_settings,
            commands::set_api_key,
            commands::delete_api_key,
            commands::api_key_status,
            commands::ai_complete,
            commands::ollama_models,
            commands::ai_collect_diff,
            commands::recent_messages,
            commands::git_user_email,
            commands::standup_commits,
            commands::cleanup_candidates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KromaGit");
}
