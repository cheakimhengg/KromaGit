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

/// A user-chosen app: on macOS an application name for `open -a`; elsewhere a
/// command line where `{path}` is replaced by the folder (appended if absent).
fn spawn_custom(app: &str, path: &str) -> bool {
    let app = app.trim();
    if app.is_empty() {
        return false;
    }
    if cfg!(target_os = "macos") && !app.contains("{path}") && !app.starts_with('/') {
        return spawn("open", &["-a", app, path]);
    }
    let parts = split_command(app);
    let Some((program, rest)) = parts.split_first() else { return false };
    let mut args: Vec<String> = rest.iter().map(|a| a.replace("{path}", path)).collect();
    if !app.contains("{path}") {
        args.push(path.to_string());
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    spawn(program, &args)
}

/// Splits a command line on whitespace, honouring double quotes.
pub fn split_command(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in cmd.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn ensure_dir(path: &str) -> AppResult<()> {
    if Path::new(path).is_dir() {
        Ok(())
    } else {
        Err(AppError::PathNotFound(path.to_string()))
    }
}

pub fn open_terminal(path: &str, app: &str) -> AppResult<()> {
    ensure_dir(path)?;
    if !app.trim().is_empty() {
        return if spawn_custom(app, path) { Ok(()) } else { Err(AppError::Internal(format!("Could not start “{app}”. Check Settings → General."))) };
    }
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

pub fn open_editor(path: &str, app: &str) -> AppResult<()> {
    ensure_dir(path)?;
    if !app.trim().is_empty() {
        return if spawn_custom(app, path) { Ok(()) } else { Err(AppError::Internal(format!("Could not start “{app}”. Check Settings → General."))) };
    }
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

#[cfg(test)]
mod tests {
    use super::split_command;

    #[test]
    fn splits_commands_with_quotes() {
        assert_eq!(split_command("code -n"), ["code", "-n"]);
        assert_eq!(split_command(r#""C:\Program Files\Zed\zed.exe" {path}"#), [r"C:\Program Files\Zed\zed.exe", "{path}"]);
        assert_eq!(split_command("  wezterm  start --cwd {path} "), ["wezterm", "start", "--cwd", "{path}"]);
        assert!(split_command("   ").is_empty());
    }
}
