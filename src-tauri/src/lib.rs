pub mod commands;
pub mod error;
pub mod git;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running KromaGit");
}
