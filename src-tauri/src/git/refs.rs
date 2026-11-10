use super::model::{Branch, RefsPayload, Remote, Stash, Submodule, Tag, Worktree};
use super::runner::Git;
use crate::error::{AppError, AppResult};

pub const REF_FORMAT: &str =
    "%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(upstream:track)%00%(HEAD)";

pub fn get_refs(git: &Git) -> AppResult<RefsPayload> {
    let has_submodules = git.cwd().join(".gitmodules").exists();
    let format = format!("--format={REF_FORMAT}");
    let results = std::thread::scope(|s| {
        let refs = s.spawn(|| git.run(&["for-each-ref", &format, "refs/heads", "refs/remotes", "refs/tags"]));
        let remotes = s.spawn(|| git.run(&["remote", "-v"]));
        let stash = s.spawn(|| git.run(&["stash", "list", "--format=%gd%x00%ct%x00%gs"]));
        let worktrees = s.spawn(|| git.run(&["worktree", "list", "--porcelain", "-z"]));
        let submodules = s.spawn(|| {
            if has_submodules {
                git.run(&["submodule", "status"])
            } else {
                Ok(Vec::new())
            }
        });
        let fetch_head = s.spawn(|| git.run(&["rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD"]));
        [refs.join(), remotes.join(), stash.join(), worktrees.join(), submodules.join(), fetch_head.join()]
    });
    let mut outs = Vec::with_capacity(results.len());
    for r in results {
        outs.push(r.map_err(|_| AppError::Internal("git worker thread panicked".into()))??);
    }

    let remote_urls = parse_remotes(&outs[1]);
    let remote_names: Vec<String> = remote_urls.iter().map(|(n, _)| n.clone()).collect();
    let (branches, remote_branches, tags) = parse_refs(&outs[0], &remote_names);

    let remotes = remote_urls
        .into_iter()
        .map(|(name, url)| {
            let branches = remote_branches
                .iter()
                .filter(|(r, _)| *r == name)
                .map(|(_, b)| b.clone())
                .collect();
            Remote { name, url, branches }
        })
        .collect();

    Ok(RefsPayload {
        branches,
        remotes,
        tags,
        stashes: parse_stashes(&outs[2]),
        worktrees: parse_worktrees(&outs[3]),
        submodules: parse_submodules(&outs[4]),
        last_fetch: file_mtime(String::from_utf8_lossy(&outs[5]).trim()),
    })
}

fn file_mtime(path: &str) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let secs = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    i64::try_from(secs).ok()
}

/// Parses `git for-each-ref --format=REF_FORMAT` into local branches,
/// (remote, branch) pairs and tags (peeled to their commit).
pub fn parse_refs(raw: &[u8], remotes: &[String]) -> (Vec<Branch>, Vec<(String, String)>, Vec<Tag>) {
    let text = String::from_utf8_lossy(raw);
    let mut branches = Vec::new();
    let mut remote_branches = Vec::new();
    let mut tags = Vec::new();

    for line in text.lines().filter(|l| !l.is_empty()) {
        let f: Vec<&str> = line.split('\0').collect();
        if f.len() < 6 {
            continue;
        }
        let (refname, oid, peeled, upstream, track, head) = (f[0], f[1], f[2], f[3], f[4], f[5]);
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            let (ahead, behind, gone) = parse_track(track);
            let upstream = upstream
                .strip_prefix("refs/remotes/")
                .or_else(|| upstream.strip_prefix("refs/heads/"))
                .filter(|u| !u.is_empty())
                .map(str::to_owned);
            branches.push(Branch {
                name: name.to_string(),
                current: head == "*",
                upstream,
                upstream_gone: gone,
                ahead,
                behind,
                tip_hash: oid.to_string(),
            });
        } else if let Some(rest) = refname.strip_prefix("refs/remotes/") {
            let remote = remotes
                .iter()
                .filter(|r| rest.starts_with(&format!("{r}/")))
                .max_by_key(|r| r.len())
                .cloned()
                .unwrap_or_else(|| rest.split('/').next().unwrap_or_default().to_string());
            let branch = rest[remote.len()..].trim_start_matches('/');
            if branch != "HEAD" && !branch.is_empty() {
                remote_branches.push((remote, branch.to_string()));
            }
        } else if let Some(name) = refname.strip_prefix("refs/tags/") {
            let hash = if peeled.is_empty() { oid } else { peeled };
            tags.push(Tag { name: name.to_string(), hash: hash.to_string() });
        }
    }
    (branches, remote_branches, tags)
}

/// Parses `%(upstream:track)`: "[ahead 1, behind 2]", "[gone]" or "".
pub fn parse_track(track: &str) -> (u32, u32, bool) {
    let inner = track.trim().trim_start_matches('[').trim_end_matches(']');
    if inner == "gone" {
        return (0, 0, true);
    }
    let (mut ahead, mut behind) = (0, 0);
    for part in inner.split(',').map(str::trim) {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, false)
}

/// Parses `git remote -v`, keeping fetch URLs in order.
pub fn parse_remotes(raw: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(raw);
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url)) = (parts.next(), parts.next()) else { continue };
        let kind = parts.next().unwrap_or("(fetch)");
        if kind == "(fetch)" && !out.iter().any(|(n, _)| n == name) {
            out.push((name.to_string(), url.to_string()));
        }
    }
    out
}

/// Parses `git stash list --format=%gd%x00%ct%x00%gs`.
pub fn parse_stashes(raw: &[u8]) -> Vec<Stash> {
    String::from_utf8_lossy(raw)
        .lines()
        .filter_map(|line| {
            let mut f = line.splitn(3, '\0');
            let selector = f.next()?;
            let date = f.next()?.parse().unwrap_or(0);
            let message = f.next().unwrap_or_default().to_string();
            let index = selector.trim_start_matches("stash@{").trim_end_matches('}').parse().ok()?;
            Some(Stash { index, message, date })
        })
        .collect()
}

/// Parses `git worktree list --porcelain -z`.
pub fn parse_worktrees(raw: &[u8]) -> Vec<Worktree> {
    let text = String::from_utf8_lossy(raw);
    let mut out = Vec::new();
    let mut current: Option<Worktree> = None;
    for token in text.split('\0') {
        if token.is_empty() {
            if let Some(w) = current.take() {
                out.push(w);
            }
        } else if let Some(path) = token.strip_prefix("worktree ") {
            if let Some(w) = current.take() {
                out.push(w);
            }
            current = Some(Worktree {
                path: path.to_string(),
                branch: String::new(),
                head: String::new(),
                is_main: out.is_empty(),
            });
        } else if let Some(w) = current.as_mut() {
            if let Some(h) = token.strip_prefix("HEAD ") {
                w.head = h.to_string();
            } else if let Some(b) = token.strip_prefix("branch ") {
                w.branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
            } else if token == "detached" {
                w.branch = "(detached)".into();
            } else if token == "bare" {
                w.branch = "(bare)".into();
            }
        }
    }
    if let Some(w) = current {
        out.push(w);
    }
    out
}

/// Parses `git submodule status`: "<flag><sha> <path>[ (<describe>)]".
pub fn parse_submodules(raw: &[u8]) -> Vec<Submodule> {
    String::from_utf8_lossy(raw)
        .lines()
        .filter(|l| l.len() > 42)
        .map(|line| {
            let status = match line.as_bytes()[0] {
                b'-' => "uninitialized",
                b'+' => "modified",
                b'U' => "conflict",
                _ => "clean",
            };
            let rest = &line[1..];
            let (hash, path) = rest.split_once(' ').unwrap_or((rest, ""));
            let path = match path.rfind(" (") {
                Some(i) if path.ends_with(')') => &path[..i],
                _ => path,
            };
            Submodule { path: path.to_string(), hash: hash.to_string(), status }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFS: &[u8] = include_bytes!("../../tests/fixtures/refs.bin");
    const REMOTES: &[u8] = include_bytes!("../../tests/fixtures/remotes.txt");
    const STASH: &[u8] = include_bytes!("../../tests/fixtures/stash.bin");
    const WORKTREES: &[u8] = include_bytes!("../../tests/fixtures/worktrees.bin");
    const SUBMODULES: &[u8] = include_bytes!("../../tests/fixtures/submodules.txt");

    #[test]
    fn parses_branches_with_tracking() {
        let (branches, _, _) = parse_refs(REFS, &["origin".into()]);
        let main = branches.iter().find(|b| b.name == "main").unwrap();
        assert!(main.current);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!((main.ahead, main.behind, main.upstream_gone), (2, 0, false));

        let gone = branches.iter().find(|b| b.name == "fix/gone").unwrap();
        assert!(gone.upstream_gone);
        assert!(!gone.current);
        assert!(branches.iter().any(|b| b.name == "feature/ünïcode" && b.upstream.is_none()));
    }

    #[test]
    fn parses_remote_branches_and_peels_annotated_tags() {
        let (_, remote_branches, tags) = parse_refs(REFS, &["origin".into()]);
        assert_eq!(remote_branches, vec![("origin".to_string(), "main".to_string())]);
        let v1 = tags.iter().find(|t| t.name == "v0.1.0").unwrap();
        let v2 = tags.iter().find(|t| t.name == "v0.2.0").unwrap();
        assert_eq!(v1.hash.len(), 40);
        assert_eq!(v2.hash.len(), 40);
        let raw = String::from_utf8_lossy(REFS);
        let v1_line = raw.lines().find(|l| l.starts_with("refs/tags/v0.1.0")).unwrap();
        assert_eq!(v1_line.split('\0').nth(2), Some(v1.hash.as_str()));
    }

    #[test]
    fn matches_longest_remote_name() {
        let raw = b"refs/remotes/team/a/feature/x\0abc\0\0\0\0 \n";
        let (_, rb, _) = parse_refs(raw, &["team".into(), "team/a".into()]);
        assert_eq!(rb, vec![("team/a".to_string(), "feature/x".to_string())]);
    }

    #[test]
    fn parses_track_variants() {
        assert_eq!(parse_track("[ahead 3, behind 1]"), (3, 1, false));
        assert_eq!(parse_track("[behind 4]"), (0, 4, false));
        assert_eq!(parse_track("[gone]"), (0, 0, true));
        assert_eq!(parse_track(""), (0, 0, false));
    }

    #[test]
    fn parses_remotes_stashes_worktrees_submodules() {
        assert_eq!(parse_remotes(REMOTES), vec![("origin".to_string(), "../upstream.git".to_string())]);

        let stashes = parse_stashes(STASH);
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].index, 0);
        assert_eq!(stashes[0].message, "On main: wip readme");
        assert!(stashes[0].date > 1_700_000_000);

        let wts = parse_worktrees(WORKTREES);
        assert_eq!(wts.len(), 2);
        assert!(wts[0].is_main && wts[0].path.ends_with("/repo") && wts[0].branch == "main");
        assert!(!wts[1].is_main && wts[1].branch == "hotfix/crlf");

        let subs = parse_submodules(SUBMODULES);
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].path, "vendor/upstream");
        assert_eq!(subs[0].status, "clean");
        assert_eq!(parse_submodules(b"-0123456789012345678901234567890123456789 libs/x\n")[0].status, "uninitialized");
    }
}
