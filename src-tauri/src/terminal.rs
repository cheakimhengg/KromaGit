//! Built-in terminal: each session is the user's login shell running in a
//! pseudo-terminal, started in the repository folder. Output is streamed to
//! the webview as `terminal://data` events (base64, so multi-byte characters
//! split across reads arrive intact); `terminal://exit` fires when it ends.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::git::image::base64;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct DataEvent {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent {
    id: u32,
}

fn err(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(format!("Terminal: {e}"))
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }
}

impl Terminals {
    pub fn open(&self, app: &AppHandle, cwd: &str, cols: u16, rows: u16) -> AppResult<u32> {
        let (a, b) = (app.clone(), app.clone());
        self.open_with(
            cwd,
            cols,
            rows,
            move |id, bytes| {
                let _ = a.emit("terminal://data", DataEvent { id, data: base64(bytes) });
            },
            move |id| {
                let _ = b.emit("terminal://exit", ExitEvent { id });
            },
        )
    }

    /// Starts a shell; `on_data` receives its output, `on_exit` fires once when it ends.
    pub fn open_with(
        &self,
        cwd: &str,
        cols: u16,
        rows: u16,
        on_data: impl Fn(u32, &[u8]) + Send + 'static,
        on_exit: impl FnOnce(u32) + Send + 'static,
    ) -> AppResult<u32> {
        if !Path::new(cwd).is_dir() {
            return Err(AppError::PathNotFound(cwd.to_string()));
        }
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(err)?;
        let mut cmd = CommandBuilder::new_default_prog();
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "KromaGit");
        let child = pair.slave.spawn_command(cmd).map_err(err)?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(err)?;
        let writer = pair.master.take_writer().map_err(err)?;

        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, child });

        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_data(id, &buf[..n]),
                }
            }
            on_exit(id);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> AppResult<()> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(&id).ok_or_else(|| err("session has ended"))?;
        s.writer.write_all(data.as_bytes()).map_err(err)?;
        s.writer.flush().map_err(err)
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(s) = sessions.get(&id) {
            s.master.resize(size(cols, rows)).map_err(err)?;
        }
        Ok(())
    }

    pub fn close(&self, id: u32) {
        if let Some(mut s) = self.sessions.lock().unwrap().remove(&id) {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }

    pub fn close_all(&self) {
        let ids: Vec<u32> = self.sessions.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.close(id);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn runs_a_shell_in_the_folder_and_streams_output() {
        let dir = std::env::temp_dir().canonicalize().unwrap();
        let terms = Terminals::default();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (done_tx, done_rx) = mpsc::channel::<u32>();
        let id = terms
            .open_with(dir.to_str().unwrap(), 80, 24, move |_, b| { let _ = tx.send(b.to_vec()); }, move |id| { let _ = done_tx.send(id); })
            .unwrap();
        terms.resize(id, 100, 30).unwrap();
        terms.write(id, "printf 'kroma-%s\\n' ok; pwd\r").unwrap();

        let mut out = String::new();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(10) && !(out.contains("kroma-ok") && out.contains(dir.to_str().unwrap())) {
            if let Ok(b) = rx.recv_timeout(Duration::from_millis(200)) {
                out.push_str(&String::from_utf8_lossy(&b));
            }
        }
        assert!(out.contains("kroma-ok"), "command output arrives: {out}");
        assert!(out.contains(dir.to_str().unwrap()), "shell starts in the folder: {out}");

        terms.close(id);
        assert_eq!(done_rx.recv_timeout(Duration::from_secs(5)).unwrap(), id, "exit is reported");
        assert!(terms.write(id, "x").is_err(), "closed session rejects input");
        assert!(terms.open_with("/definitely/missing", 80, 24, |_, _| {}, |_| {}).is_err());
    }
}
