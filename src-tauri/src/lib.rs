pub mod ai;
pub mod avatars;
pub mod commands;
pub mod error;
pub mod git;
#[cfg(target_os = "macos")]
mod menu;
pub mod secrets;
pub mod settings;
pub mod system;
pub mod terminal;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::thread::spawn(|| {
        git::runner::user_path();
    });
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(terminal::Terminals::default())
        .manage(watcher::RepoWatcher::default())
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::startup_paths,
            commands::open_repo,
            commands::get_commits,
            commands::get_refs,
            commands::get_status,
            commands::get_commit_details,
            commands::get_file_diff,
            commands::get_file_image,
            commands::clone_repo,
            commands::file_history,
            commands::blame_file,
            commands::list_tree,
            commands::read_conflict,
            commands::write_resolved,
            commands::merge_message,
            commands::terminal_open,
            commands::watch_repo,
            commands::unwatch_repo,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::repo_name_from_url,
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
            commands::github_commit_avatar,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KromaGit")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<terminal::Terminals>().close_all();
            }
        });
}
