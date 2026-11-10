//! Read-only history queries used by AI features: recent commit style, standup
//! commits across repos, and branch-cleanup candidates.

use serde::Serialize;

use crate::error::AppResult;
use crate::git::refs::parse_track;
use crate::git::runner::Git;

pub fn recent_messages(git: &Git, n: usize) -> AppResult<Vec<String>> {
    let has_head = !git.run_with_codes(&["rev-parse", "-q", "--verify", "HEAD"], &[0, 1])?.is_empty();
    if !has_head {
        return Ok(Vec::new());
    }
    let count = format!("-n{n}");
    let raw = git.run(&["log", &count, "--no-merges", "--format=%B%x1e"])?;
    Ok(String::from_utf8_lossy(&raw)
        .split('\x1e')
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .map(|m| m.chars().take(400).collect())
        .collect())
}

pub fn user_email(git: &Git) -> AppResult<String> {
    git.run_with_codes(&["config", "user.email"], &[0, 1]).map(|b| String::from_utf8_lossy(&b).trim().to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StandupCommit {
    pub hash: String,
    pub subject: String,
    pub date: i64,
    /// ref through which the commit was reached (feature-branch hint)
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StandupRepo {
    pub path: String,
    pub commits: Vec<StandupCommit>,
    pub error: Option<String>,
}

pub fn parse_standup_log(raw: &[u8]) -> Vec<StandupCommit> {
    String::from_utf8_lossy(raw)
        .split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            let mut f = rec.splitn(4, '\0');
            let hash = f.next()?.trim().to_string();
            if hash.is_empty() {
                return None;
            }
            let subject = f.next()?.to_string();
            let date = f.next()?.trim().parse().unwrap_or(0);
            let source = f.next().unwrap_or_default().trim().to_string();
            let source = source
                .strip_prefix("refs/heads/")
                .or_else(|| source.strip_prefix("refs/remotes/"))
                .unwrap_or(&source)
                .to_string();
            Some(StandupCommit { hash, subject, date, source })
        })
        .collect()
}

pub fn standup_commits(paths: &[String], since: &str, until: &str, author: &str) -> Vec<StandupRepo> {
    std::thread::scope(|s| {
        let handles: Vec<_> = paths
            .iter()
            .map(|path| {
                s.spawn(move || {
                    let git = Git::new(path);
                    let since = format!("--since={since}");
                    let until = format!("--until={until}");
                    let author = format!("--author={author}");
                    let result = git.run(&[
                        "log", "--all", "--no-merges", "--source", "--fixed-strings", "--date-order",
                        &since, &until, &author, "--format=%H%x00%s%x00%at%x00%S%x1e",
                    ]);
                    match result {
                        Ok(raw) => StandupRepo { path: path.clone(), commits: parse_standup_log(&raw), error: None },
                        Err(e) => StandupRepo { path: path.clone(), commits: Vec::new(), error: Some(e.to_string()) },
                    }
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().expect("standup worker")).collect()
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    pub name: String,
    pub merged_into: Vec<String>,
    pub upstream_gone: bool,
    pub stale_days: Option<u32>,
    pub last_commit: i64,
    /// "origin/feature-x" when a live remote branch exists and could be deleted too
    pub remote_branch: Option<String>,
}

pub fn cleanup_candidates(git: &Git, bases: &[String], stale_days: u32, now: i64) -> AppResult<Vec<CleanupCandidate>> {
    let raw = git.run(&[
        "for-each-ref",
        "--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)%00%(HEAD)",
        "refs/heads",
    ])?;
    let existing_bases: Vec<&String> = bases
        .iter()
        .filter(|b| git.run_with_codes(&["rev-parse", "-q", "--verify", &format!("refs/heads/{b}")], &[0, 1]).map(|o| !o.is_empty()).unwrap_or(false))
        .collect();
    let mut merged: Vec<(String, Vec<String>)> = Vec::new();
    for base in &existing_bases {
        let out = git.run(&["branch", "--format=%(refname:short)", "--merged", base])?;
        for name in String::from_utf8_lossy(&out).lines().map(str::trim).filter(|n| !n.is_empty()) {
            match merged.iter_mut().find(|(n, _)| n == name) {
                Some((_, into)) => into.push(base.to_string()),
                None => merged.push((name.to_string(), vec![base.to_string()])),
            }
        }
    }

    let mut out = Vec::new();
    for line in String::from_utf8_lossy(&raw).lines() {
        let f: Vec<&str> = line.split('\0').collect();
        if f.len() < 5 {
            continue;
        }
        let (name, upstream, track, date, head) = (f[0], f[1], f[2], f[3].parse::<i64>().unwrap_or(now), f[4]);
        if head == "*" || bases.iter().any(|b| b == name) {
            continue;
        }
        let (_, _, gone) = parse_track(track);
        let age_days = ((now - date).max(0) / 86_400) as u32;
        let merged_into = merged.iter().find(|(n, _)| n == name).map(|(_, b)| b.clone()).unwrap_or_default();
        let stale = (age_days >= stale_days).then_some(age_days);
        if merged_into.is_empty() && !gone && stale.is_none() {
            continue;
        }
        out.push(CleanupCandidate {
            name: name.to_string(),
            merged_into,
            upstream_gone: gone,
            stale_days: stale,
            last_commit: date,
            remote_branch: (!upstream.is_empty() && !gone).then(|| upstream.to_string()),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standup_records_with_sources() {
        let raw = b"abc\0feat(ui): add tabs\x001700000000\0refs/heads/feature/tabs\x1e\ndef\0fix: crash\x001700003600\0refs/remotes/origin/main\x1e\n";
        let c = parse_standup_log(raw);
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].subject.as_str(), c[0].source.as_str(), c[0].date), ("feat(ui): add tabs", "feature/tabs", 1_700_000_000));
        assert_eq!(c[1].source, "origin/main");
        assert!(parse_standup_log(b"").is_empty());
    }
}
