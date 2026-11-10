//! Opening a repository in external apps (terminal, editor). These never touch git state.

use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{AppError, AppResult};

fn spawn(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

fn ensure_dir(path: &str) -> AppResult<()> {
    if Path::new(path).is_dir() {
        Ok(())
    } else {
        Err(AppError::PathNotFound(path.to_string()))
    }
}

pub fn open_terminal(path: &str) -> AppResult<()> {
    ensure_dir(path)?;
    let ok = if cfg!(target_os = "macos") {
        spawn("open", &["-a", "Terminal", path])
    } else if cfg!(windows) {
        spawn("cmd", &["/C", "start", "", "wt", "-d", path])
            || spawn("cmd", &["/C", "start", "", "cmd", "/K", "cd", "/d", path])
    } else {
        spawn("x-terminal-emulator", &["--working-directory", path])
            || spawn("gnome-terminal", &["--working-directory", path])
            || spawn("konsole", &["--workdir", path])
            || spawn("xterm", &["-e", &format!("cd '{}' && $SHELL", path.replace('\'', "'\\''"))])
    };
    if ok { Ok(()) } else { Err(AppError::Internal("No terminal application found.".into())) }
}

pub fn open_editor(path: &str) -> AppResult<()> {
    ensure_dir(path)?;
    let ok = if cfg!(target_os = "macos") {
        let vscode = ["/Applications/Visual Studio Code.app", "/Applications/Cursor.app"]
            .into_iter()
            .find(|a| Path::new(a).exists());
        match vscode {
            Some(app) => spawn("open", &["-a", app, path]),
            None => spawn("open", &[path]),
        }
    } else if cfg!(windows) {
        spawn("cmd", &["/C", "code", path]) || spawn("explorer", &[path])
    } else {
        spawn("code", &[path]) || spawn("xdg-open", &[path])
    };
    if ok { Ok(()) } else { Err(AppError::Internal("No editor found.".into())) }
}
