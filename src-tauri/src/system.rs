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

/// Opens a web link (e.g. the "create merge request" link a server sends after a push) in the default browser.
pub fn open_url(url: &str) -> AppResult<()> {
    let ok_url = (url.starts_with("https://") || url.starts_with("http://")) && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if !ok_url {
        return Err(AppError::Internal("Only web links can be opened.".into()));
    }
    let opened = if cfg!(target_os = "macos") {
        spawn("open", &[url])
    } else if cfg!(target_os = "windows") {
        spawn("rundll32", &["url.dll,FileProtocolHandler", url])
    } else {
        spawn("xdg-open", &[url])
    };
    if opened {
        Ok(())
    } else {
        Err(AppError::Internal("Could not open the browser.".into()))
    }
}

/// A user-chosen app: on macOS an application name for `open -a`; elsewhere a
/// command line where `{path}` is replaced by the folder (appended if absent).
fn spawn_custom(app: &str, path: &str, extra: &[&str]) -> bool {
    let app = app.trim();
    if app.is_empty() {
        return false;
    }
    if cfg!(target_os = "macos") && !app.contains("{path}") && !app.starts_with('/') {
        let mut args = vec!["-a", app, path];
        args.extend(extra);
        return spawn("open", &args);
    }
    let parts = split_command(app);
    let Some((program, rest)) = parts.split_first() else { return false };
    let mut args: Vec<String> = rest.iter().map(|a| a.replace("{path}", path)).collect();
    if !app.contains("{path}") {
        args.push(path.to_string());
    }
    args.extend(extra.iter().map(|s| s.to_string()));
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
        return if spawn_custom(app, path, &[]) { Ok(()) } else { Err(AppError::Internal(format!("Could not start “{app}”. Check Settings → General."))) };
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

/// Opens the repository in the editor, and `file` (repo-relative) in it when given.
pub fn open_editor(path: &str, file: Option<&str>, app: &str) -> AppResult<()> {
    ensure_dir(path)?;
    let file_path = file
        .filter(|f| Path::new(f).components().all(|c| matches!(c, std::path::Component::Normal(_))))
        .map(|f| Path::new(path).join(f))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned());
    let extra: Vec<&str> = file_path.as_deref().into_iter().collect();
    if !app.trim().is_empty() {
        return if spawn_custom(app, path, &extra) { Ok(()) } else { Err(AppError::Internal(format!("Could not start “{app}”. Check Settings → General."))) };
    }
    let ok = if cfg!(target_os = "macos") {
        let vscode = ["/Applications/Visual Studio Code.app", "/Applications/Cursor.app"]
            .into_iter()
            .find(|a| Path::new(a).exists());
        match vscode {
            Some(app) => spawn("open", &[&["-a", app, path][..], &extra].concat()),
            None => spawn("open", &[&[path][..], &extra].concat()),
        }
    } else if cfg!(windows) {
        spawn("cmd", &[&["/C", "code", path][..], &extra].concat()) || spawn("explorer", &[path])
    } else {
        spawn("code", &[&[path][..], &extra].concat()) || spawn("xdg-open", &[path])
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

/// Folders passed on the command line. Stops at a shell comment marker and
/// keeps only arguments that are existing directories, so a pasted example
/// like `repo # or open…` doesn't try to open "#", "or", "open"…
pub fn startup_dirs(args: impl Iterator<Item = String>) -> Vec<String> {
    args.take_while(|a| !a.starts_with('#'))
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a).is_dir())
        .collect()
}

#[cfg(test)]
mod startup_tests {
    #[test]
    fn ignores_words_and_comments_after_the_folders() {
        let dir = std::env::temp_dir().to_string_lossy().to_string();
        let args = [dir.clone(), "--flag".into(), "/definitely/missing".into(), "#".into(), "or".into(), dir.clone()];
        assert_eq!(super::startup_dirs(args.into_iter()), vec![dir]);
    }
}
