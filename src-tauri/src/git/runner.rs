use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use crate::error::{AppError, AppResult};

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
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .stdin(Stdio::null());
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
        let out = self.command(args).output().map_err(|e| {
            if e.kind() != std::io::ErrorKind::NotFound {
                AppError::Io(e)
            } else if !self.cwd.is_dir() {
                AppError::PathNotFound(self.cwd.display().to_string())
            } else {
                AppError::GitNotFound
            }
        })?;
        let code = out.status.code().unwrap_or(-1);
        if ok_codes.contains(&code) {
            Ok(out.stdout)
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(AppError::Git {
                command: format!("git {}", args.join(" ")),
                message: if stderr.is_empty() { format!("git exited with code {code}") } else { stderr },
            })
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
