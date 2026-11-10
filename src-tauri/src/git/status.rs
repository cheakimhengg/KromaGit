use std::collections::HashMap;
use std::io::Read;

use super::model::{FileChange, HeadInfo, StatusPayload};
use super::runner::{split_nul, Git};
use crate::error::AppResult;

const MAX_UNTRACKED_LINE_COUNTS: usize = 200;
const MAX_UNTRACKED_BYTES: u64 = 2 * 1024 * 1024;

pub fn get_status(git: &Git) -> AppResult<StatusPayload> {
    let (status, unstaged, staged) = std::thread::scope(|s| {
        let status = s.spawn(|| git.run(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]));
        let unstaged = s.spawn(|| git.run(&["diff", "--numstat", "-z", "-M"]));
        let staged = s.spawn(|| git.run(&["diff", "--cached", "--numstat", "-z", "-M"]));
        (status.join(), unstaged.join(), staged.join())
    });
    let join_err = |_| crate::error::AppError::Internal("git worker thread panicked".into());
    let mut payload = parse_status(&status.map_err(join_err)??);
    let unstaged_stats = parse_numstat(&unstaged.map_err(join_err)??);
    let staged_stats = parse_numstat(&staged.map_err(join_err)??);

    apply_stats(&mut payload.staged, &staged_stats);
    apply_stats(&mut payload.unstaged, &unstaged_stats);

    payload.operation = super::ops::operation_in_progress(git)?;
    for f in payload.unstaged.iter_mut().filter(|f| f.status == "?").take(MAX_UNTRACKED_LINE_COUNTS) {
        f.additions = count_lines(&git.cwd().join(&f.path)).unwrap_or(0);
    }
    Ok(payload)
}

fn apply_stats(files: &mut [FileChange], stats: &HashMap<String, (u32, u32)>) {
    for f in files {
        if let Some(&(a, d)) = stats.get(&f.path) {
            f.additions = a;
            f.deletions = d;
        }
    }
}

fn count_lines(path: &std::path::Path) -> Option<u32> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_UNTRACKED_BYTES {
        return None;
    }
    let mut buf = Vec::with_capacity(meta.len() as usize);
    std::fs::File::open(path).ok()?.read_to_end(&mut buf).ok()?;
    if buf.contains(&0) {
        return None;
    }
    let n = buf.iter().filter(|&&b| b == b'\n').count();
    let trailing = usize::from(!buf.is_empty() && buf.last() != Some(&b'\n'));
    Some((n + trailing) as u32)
}

fn map_code(c: char) -> Option<&'static str> {
    match c {
        '.' => None,
        'M' | 'T' => Some("M"),
        'A' | 'C' => Some("A"),
        'D' => Some("D"),
        'R' => Some("R"),
        'U' => Some("U"),
        _ => Some("M"),
    }
}

fn change(path: &str, old_path: Option<&str>, status: &'static str) -> FileChange {
    FileChange {
        path: path.to_string(),
        old_path: old_path.map(str::to_owned),
        status,
        additions: 0,
        deletions: 0,
    }
}

/// Parses `git status --porcelain=v2 --branch -z` output.
pub fn parse_status(raw: &[u8]) -> StatusPayload {
    let tokens = split_nul(raw);
    let mut out = StatusPayload::default();
    let mut head = HeadInfo::default();
    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].as_str();
        i += 1;
        if let Some(h) = t.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.oid ") {
                head.oid = (v != "(initial)").then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.head ") {
                head.detached = v == "(detached)";
                head.branch = (!head.detached).then(|| v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                head.upstream = Some(v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                for part in v.split_whitespace() {
                    if let Some(n) = part.strip_prefix('+') {
                        head.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix('-') {
                        head.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = t.chars().next().unwrap_or(' ');
        match kind {
            '1' => {
                let f: Vec<&str> = t.splitn(9, ' ').collect();
                if f.len() < 9 {
                    continue;
                }
                let mut xy = f[1].chars();
                let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
                if let Some(s) = map_code(x) {
                    out.staged.push(change(f[8], None, s));
                }
                if let Some(s) = map_code(y) {
                    out.unstaged.push(change(f[8], None, s));
                }
            }
            '2' => {
                let f: Vec<&str> = t.splitn(10, ' ').collect();
                let orig = tokens.get(i).cloned().unwrap_or_default();
                i += 1;
                if f.len() < 10 {
                    continue;
                }
                let mut xy = f[1].chars();
                let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
                if let Some(s) = map_code(x) {
                    out.staged.push(change(f[9], Some(&orig), s));
                }
                if let Some(s) = map_code(y) {
                    let s = if s == "R" { "M" } else { s };
                    out.unstaged.push(change(f[9], None, s));
                }
            }
            'u' => {
                let f: Vec<&str> = t.splitn(11, ' ').collect();
                if let Some(path) = f.get(10) {
                    out.unstaged.push(change(path, None, "U"));
                }
            }
            '?' => out.unstaged.push(change(&t[2..], None, "?")),
            _ => {}
        }
    }
    out.head = head;
    out
}

/// Parses `git diff --numstat -z` output into path -> (additions, deletions).
/// Binary files report `-` and map to zero.
pub fn parse_numstat(raw: &[u8]) -> HashMap<String, (u32, u32)> {
    let tokens = split_nul(raw);
    let mut out = HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        let t = &tokens[i];
        i += 1;
        let mut f = t.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (f.next(), f.next(), f.next()) else { continue };
        let a = a.parse().unwrap_or(0);
        let d = d.parse().unwrap_or(0);
        if path.is_empty() {
            let new = tokens.get(i + 1).cloned().unwrap_or_default();
            i += 2;
            out.insert(new, (a, d));
        } else {
            out.insert(path.to_string(), (a, d));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &[u8] = include_bytes!("../../tests/fixtures/status.bin");
    const NUMSTAT_STAGED: &[u8] = include_bytes!("../../tests/fixtures/numstat_staged.bin");
    const NUMSTAT_UNSTAGED: &[u8] = include_bytes!("../../tests/fixtures/numstat_unstaged.bin");

    #[test]
    fn parses_branch_headers() {
        let s = parse_status(STATUS);
        assert_eq!(s.head.branch.as_deref(), Some("main"));
        assert_eq!(s.head.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.head.ahead, 2);
        assert_eq!(s.head.behind, 0);
        assert!(!s.head.detached);
        assert_eq!(s.head.oid.as_ref().map(String::len), Some(40));
    }

    #[test]
    fn splits_staged_and_unstaged_entries() {
        let s = parse_status(STATUS);
        let staged: Vec<_> = s.staged.iter().map(|f| (f.status, f.path.as_str())).collect();
        assert_eq!(staged, vec![("M", "README.md"), ("R", "src/parse.rs")]);
        assert_eq!(s.staged[1].old_path.as_deref(), Some("src/parser.rs"));

        let unstaged: Vec<_> = s.unstaged.iter().map(|f| (f.status, f.path.as_str())).collect();
        assert_eq!(
            unstaged,
            vec![("D", "LICENSE"), ("M", "README.md"), ("M", "src/main.rs"), ("?", "notes café.md")]
        );
    }

    #[test]
    fn parses_detached_initial_and_unmerged() {
        let raw = b"# branch.oid (initial)\0# branch.head (detached)\0u UU N... 100644 100644 100644 100644 a b c conflict file.txt\0";
        let s = parse_status(raw);
        assert!(s.head.detached);
        assert!(s.head.branch.is_none());
        assert!(s.head.oid.is_none());
        assert_eq!(s.unstaged[0].path, "conflict file.txt");
        assert_eq!(s.unstaged[0].status, "U");
    }

    #[test]
    fn parses_numstat_including_renames() {
        let staged = parse_numstat(NUMSTAT_STAGED);
        assert_eq!(staged.get("README.md"), Some(&(1, 0)));
        assert_eq!(staged.get("src/parse.rs"), Some(&(0, 0)));
        assert!(!staged.contains_key("src/parser.rs"));

        let unstaged = parse_numstat(NUMSTAT_UNSTAGED);
        assert_eq!(unstaged.get("src/main.rs"), Some(&(1, 1)));
        assert_eq!(parse_numstat(b"-\t-\timage.png\0").get("image.png"), Some(&(0, 0)));
    }
}
