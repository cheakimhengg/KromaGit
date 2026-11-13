//! Per-file history (following renames) and line-by-line blame.

use std::collections::HashMap;

use serde::Serialize;

use super::log::{parse_log, LOG_FORMAT};
use super::model::Commit;
use super::runner::Git;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub commit: Commit,
    /// the file's path in that commit (differs from today's after a rename)
    pub path: String,
}

fn check_path(path: &str) -> AppResult<()> {
    if path.is_empty() || path.starts_with('-') {
        return Err(AppError::Internal(format!("Not a file path: {path}")));
    }
    Ok(())
}

pub fn file_history(git: &Git, path: &str, limit: usize) -> AppResult<Vec<FileHistoryEntry>> {
    check_path(path)?;
    let n = format!("-n{}", limit.clamp(1, 5000));
    let format = format!("--format={LOG_FORMAT}");
    let commits = parse_log(&git.run(&["log", "--follow", "--no-color", "--decorate=full", "-z", &format, &n, "--", path])?);
    let names = git.run(&["log", "--follow", "--no-color", "--format=%x01%H", "--name-only", "-z", &n, "--", path])?;
    let paths = parse_follow_names(&String::from_utf8_lossy(&names));
    Ok(commits
        .into_iter()
        .map(|c| {
            let p = paths.get(&c.hash).cloned().unwrap_or_else(|| path.to_string());
            FileHistoryEntry { commit: c, path: p }
        })
        .collect())
}

/// `git log --format=%x01%H --name-only -z` → commit hash → path in that commit.
pub fn parse_follow_names(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for chunk in raw.split('\u{1}').filter(|c| !c.trim().is_empty()) {
        let parts: Vec<&str> = chunk.split(['\0', '\n']).map(str::trim).filter(|s| !s.is_empty()).collect();
        if let (Some(hash), Some(path)) = (parts.first(), parts.get(1..).and_then(|r| r.last())) {
            out.insert(hash.to_string(), path.to_string());
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    pub hash: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    pub content: String,
}

/// Blame of `path` at `rev`, or of the working-tree file when `rev` is None.
pub fn blame(git: &Git, path: &str, rev: Option<&str>) -> AppResult<Vec<BlameLine>> {
    check_path(path)?;
    let mut args = vec!["blame", "--porcelain"];
    if let Some(r) = rev {
        if r.starts_with('-') {
            return Err(AppError::Internal(format!("Not a revision: {r}")));
        }
        args.push(r);
    }
    args.extend(["--", path]);
    Ok(parse_blame(&String::from_utf8_lossy(&git.run(&args)?)))
}

#[derive(Default, Clone)]
struct Meta {
    author: String,
    email: String,
    time: i64,
    summary: String,
}

pub fn parse_blame(raw: &str) -> Vec<BlameLine> {
    let mut meta: HashMap<String, Meta> = HashMap::new();
    let mut out = Vec::new();
    let mut current: Option<(String, u32)> = None;
    for line in raw.lines() {
        if let Some(content) = line.strip_prefix('\t') {
            if let Some((hash, n)) = current.take() {
                let m = meta.get(&hash).cloned().unwrap_or_default();
                out.push(BlameLine { line: n, hash, author: m.author, email: m.email, time: m.time, summary: m.summary, content: content.to_string() });
            }
            continue;
        }
        let mut it = line.splitn(2, ' ');
        let (key, rest) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
        let is_header = key.len() == 40 && key.chars().all(|c| c.is_ascii_hexdigit());
        if is_header {
            let final_line = rest.split(' ').nth(1).and_then(|n| n.parse().ok()).unwrap_or(0);
            meta.entry(key.to_string()).or_default();
            current = Some((key.to_string(), final_line));
            continue;
        }
        if let Some((hash, _)) = &current {
            let m = meta.entry(hash.clone()).or_default();
            match key {
                "author" => m.author = rest.to_string(),
                "author-mail" => m.email = rest.trim_matches(|c| c == '<' || c == '>').to_string(),
                "author-time" => m.time = rest.parse().unwrap_or(0),
                "summary" => m.summary = rest.to_string(),
                _ => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_blame_and_reuses_commit_metadata() {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let raw = format!(
            "{a} 1 1 2\nauthor Ada\nauthor-mail <ada@x.dev>\nauthor-time 100\nsummary first\nfilename f\n\tline one\n{a} 2 2\n\tline two\n{b} 1 3 1\nauthor Bo\nauthor-mail <bo@x.dev>\nauthor-time 200\nsummary second\nfilename f\n\t\tindented\n"
        );
        let lines = parse_blame(&raw);
        assert_eq!(lines.len(), 3);
        assert_eq!((lines[0].line, lines[0].author.as_str(), lines[0].content.as_str()), (1, "Ada", "line one"));
        assert_eq!((lines[1].line, lines[1].summary.as_str()), (2, "first"));
        assert_eq!((lines[2].email.as_str(), lines[2].time, lines[2].content.as_str()), ("bo@x.dev", 200, "\tindented"));
    }

    #[test]
    fn maps_follow_names_per_commit() {
        let raw = "\u{1}h2\n\nnew.txt\0\u{1}h1\n\nold.txt\0";
        let m = parse_follow_names(raw);
        assert_eq!(m.get("h2").map(String::as_str), Some("new.txt"));
        assert_eq!(m.get("h1").map(String::as_str), Some("old.txt"));
    }
}
