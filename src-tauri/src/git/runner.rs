use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct RunOptions<'a> {
    pub input: Option<&'a [u8]>,
    pub ok_codes: &'a [i32],
    pub timeout: Option<Duration>,
}

pub struct RunOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// PATH for git and its hooks. Apps opened from the Dock get a minimal PATH, so hooks that run
/// `node`, `npx` or `pnpm` (husky, lint-staged…) would fail; borrow the login shell's PATH instead.
pub fn user_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let current = std::env::var("PATH").unwrap_or_default();
        let mut parts: Vec<String> = Vec::new();
        #[cfg(unix)]
        if let Some(shell_path) = login_shell_path() {
            parts.extend(shell_path.split(':').map(str::to_string));
        }
        parts.extend(current.split(if cfg!(windows) { ';' } else { ':' }).map(str::to_string));
        #[cfg(target_os = "macos")]
        parts.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(str::to_string));
        let mut seen = std::collections::HashSet::new();
        parts.retain(|p| !p.is_empty() && seen.insert(p.clone()));
        parts.join(if cfg!(windows) { ";" } else { ":" })
    })
}

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    const MARK: &str = "__KROMAGIT_PATH__";
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '%s%s' '{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.rsplit_once(MARK)?.1.trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Resolves the git executable once. GUI apps on macOS start with a minimal
/// PATH, so prefer Homebrew installs before falling back to `git` on PATH.
pub fn git_binary() -> &'static str {
    static BIN: OnceLock<String> = OnceLock::new();
    BIN.get_or_init(|| {
        if let Ok(p) = std::env::var("KROMAGIT_GIT") {
            if !p.is_empty() {
                return p;
            }
        }
        #[cfg(target_os = "macos")]
        for p in ["/opt/homebrew/bin/git", "/usr/local/bin/git"] {
            if Path::new(p).exists() {
                return p.to_string();
            }
        }
        "git".to_string()
    })
}

#[derive(Debug, Clone)]
pub struct Git {
    cwd: PathBuf,
}

impl Git {
    pub fn new(cwd: impl Into<PathBuf>) -> Self {
        Self { cwd: cwd.into() }
    }

    pub fn cwd(&self) -> &Path {
        &self.cwd
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(git_binary());
        cmd.current_dir(&self.cwd)
            .args([
                "--no-optional-locks",
                "-c",
                "core.quotepath=false",
                "-c",
                "color.ui=never",
                "-c",
                "log.showSignature=false",
            ])
            .args(args)
            .env("PATH", user_path())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_MERGE_AUTOEDIT", "no")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        cmd
    }

    pub fn run(&self, args: &[&str]) -> AppResult<Vec<u8>> {
        self.run_with_codes(args, &[0])
    }

    /// Runs git and treats any exit code in `ok_codes` as success.
    pub fn run_with_codes(&self, args: &[&str], ok_codes: &[i32]) -> AppResult<Vec<u8>> {
        Ok(self.exec(args, &RunOptions { ok_codes, ..Default::default() })?.stdout)
    }

    /// Runs git with stdin input, returning stdout.
    pub fn run_with_input(&self, args: &[&str], input: &[u8]) -> AppResult<Vec<u8>> {
        Ok(self.exec(args, &RunOptions { input: Some(input), ..Default::default() })?.stdout)
    }

    /// Full-control runner: optional stdin, extra ok codes and a kill timeout
    /// (used for network commands so a stuck remote can never hang the app).
    pub fn exec(&self, args: &[&str], opts: &RunOptions) -> AppResult<RunOutput> {
        let mut cmd = self.command(args);
        if opts.input.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().map_err(|e| self.spawn_error(e))?;

        let stdin_thread = match (opts.input, child.stdin.take()) {
            (Some(input), Some(mut stdin)) => {
                let data = input.to_vec();
                Some(std::thread::spawn(move || {
                    let _ = stdin.write_all(&data);
                }))
            }
            _ => None,
        };
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let out_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(s) = stdout.as_mut() {
                let _ = s.read_to_end(&mut buf);
            }
            buf
        });
        let err_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(s) = stderr.as_mut() {
                let _ = s.read_to_end(&mut buf);
            }
            buf
        });

        let started = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait()? {
                break status;
            }
            if opts.timeout.is_some_and(|t| started.elapsed() > t) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AppError::Git {
                    command: format!("git {}", args.join(" ")),
                    message: format!(
                        "Timed out after {}s. Check your network and credentials (KromaGit cannot answer interactive prompts).",
                        opts.timeout.unwrap_or_default().as_secs()
                    ),
                });
            }
            std::thread::sleep(Duration::from_millis(15));
        };
        if let Some(t) = stdin_thread {
            let _ = t.join();
        }
        let stdout = out_thread.join().unwrap_or_default();
        let stderr = err_thread.join().unwrap_or_default();

        let code = status.code().unwrap_or(-1);
        let ok_codes = if opts.ok_codes.is_empty() { &[0][..] } else { opts.ok_codes };
        if ok_codes.contains(&code) {
            Ok(RunOutput { stdout, stderr })
        } else {
            let msg = String::from_utf8_lossy(&stderr).trim().to_string();
            let msg = if msg.is_empty() { String::from_utf8_lossy(&stdout).trim().to_string() } else { msg };
            Err(AppError::Git {
                command: format!("git {}", args.join(" ")),
                message: if msg.is_empty() { format!("git exited with code {code}") } else { msg },
            })
        }
    }

    fn spawn_error(&self, e: std::io::Error) -> AppError {
        if !self.cwd.is_dir() {
            AppError::PathNotFound(self.cwd.display().to_string())
        } else if e.kind() == std::io::ErrorKind::NotFound {
            AppError::GitNotFound
        } else {
            AppError::Io(e)
        }
    }

    pub fn run_string(&self, args: &[&str]) -> AppResult<String> {
        Ok(String::from_utf8_lossy(&self.run(args)?).into_owned())
    }
}

/// Splits NUL-separated output, dropping the trailing terminator.
pub fn split_nul(raw: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(raw);
    let mut parts: Vec<String> = text.split('\0').map(str::to_owned).collect();
    if parts.last().is_some_and(|s| s.is_empty()) {
        parts.pop();
    }
    parts
}
