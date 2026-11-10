//! Shared helpers for integration tests: an isolated git environment that is
//! identical on macOS, Linux and Windows (no user/system config, fixed identity).
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Once;

static INIT: Once = Once::new();

fn empty_config() -> PathBuf {
    let p = std::env::temp_dir().join("kromagit-tests-empty.gitconfig");
    std::fs::write(&p, "").expect("write empty gitconfig");
    p
}

/// Applies to every git process started by the tests *and* by the library.
pub fn isolate() {
    INIT.call_once(|| {
        let cfg = empty_config();
        for (k, v) in [
            ("GIT_CONFIG_GLOBAL", cfg.to_string_lossy().as_ref()),
            ("GIT_CONFIG_NOSYSTEM", "1"),
            ("GIT_AUTHOR_NAME", "Test User"),
            ("GIT_AUTHOR_EMAIL", "test@example.dev"),
            ("GIT_COMMITTER_NAME", "Test User"),
            ("GIT_COMMITTER_EMAIL", "test@example.dev"),
        ] {
            std::env::set_var(k, v);
        }
    });
}

pub fn git(dir: &Path, args: &[&str]) -> String {
    git_with_date(dir, args, None)
}

pub fn git_with_date(dir: &Path, args: &[&str], date: Option<&str>) -> String {
    isolate();
    let mut cmd = Command::new("git");
    cmd.current_dir(dir).args(args);
    if let Some(d) = date {
        cmd.env("GIT_AUTHOR_DATE", d).env("GIT_COMMITTER_DATE", d);
    }
    let out = cmd.output().expect("git runs");
    assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

pub fn write(dir: &Path, file: &str, content: &str) {
    let p = dir.join(file);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(p, content).unwrap();
}

pub fn read(dir: &Path, file: &str) -> String {
    std::fs::read_to_string(dir.join(file)).unwrap()
}

pub fn init_repo(dir: &Path) {
    git(dir, &["-c", "init.defaultBranch=main", "init", "-q"]);
}

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}
