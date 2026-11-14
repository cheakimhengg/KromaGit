use super::model::{Commit, Person, RefKind, RefLabel};
use super::runner::Git;
use crate::error::AppResult;

pub const LOG_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%D";
const FIELDS: usize = 7;

pub fn get_commits(git: &Git, limit: Option<usize>) -> AppResult<Vec<Commit>> {
    let head = git.run_with_codes(&["rev-parse", "--verify", "-q", "HEAD"], &[0, 1])?;
    let format = format!("--format={LOG_FORMAT}");
    let mut args = vec![
        "log",
        "--date-order",
        "--no-color",
        "--decorate=full",
        "-z",
        format.as_str(),
        "--branches",
        "--remotes",
        "--tags",
    ];
    if !head.is_empty() {
        args.push("HEAD");
    }
    let n;
    if let Some(limit) = limit {
        n = format!("-n{limit}");
        args.push(n.as_str());
    }
    Ok(parse_log(&git.run(&args)?))
}

/// Parses `git log -z --format=LOG_FORMAT --decorate=full` output.
pub fn parse_log(raw: &[u8]) -> Vec<Commit> {
    let text = String::from_utf8_lossy(raw);
    let mut parts: Vec<&str> = text.split('\0').collect();
    if parts.len() % FIELDS == 1 && parts.last() == Some(&"") {
        parts.pop();
    }
    parts
        .chunks_exact(FIELDS)
        .map(|f| Commit {
            hash: f[0].trim_start_matches('\n').to_string(),
            parents: f[1].split_whitespace().map(str::to_owned).collect(),
            author: Person { name: f[2].to_string(), email: f[3].to_string() },
            date: f[4].parse().unwrap_or(0),
            subject: f[5].to_string(),
            refs: parse_decorations(f[6]),
        })
        .collect()
}

/// Parses a full-name decoration list such as
/// `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main`.
pub fn parse_decorations(s: &str) -> Vec<RefLabel> {
    let mut out = Vec::new();
    for part in s.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        if let Some(rest) = part.strip_prefix("HEAD -> ") {
            let name = rest.strip_prefix("refs/heads/").unwrap_or(rest);
            out.push(RefLabel { name: name.to_string(), kind: RefKind::Local, current: true });
        } else if part == "HEAD" {
            out.push(RefLabel { name: "HEAD".into(), kind: RefKind::Head, current: true });
        } else if let Some(tag) = part.strip_prefix("tag: ") {
            let name = tag.strip_prefix("refs/tags/").unwrap_or(tag);
            out.push(RefLabel { name: name.to_string(), kind: RefKind::Tag, current: false });
        } else if let Some(name) = part.strip_prefix("refs/heads/") {
            out.push(RefLabel { name: name.to_string(), kind: RefKind::Local, current: false });
        } else if let Some(name) = part.strip_prefix("refs/remotes/") {
            if !name.ends_with("/HEAD") {
                out.push(RefLabel { name: name.to_string(), kind: RefKind::Remote, current: false });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &[u8] = include_bytes!("../../tests/fixtures/log.bin");

    #[test]
    fn parses_real_log_output() {
        let commits = parse_log(LOG);
        assert_eq!(commits.len(), 9);

        let tip = &commits[0];
        assert_eq!(tip.subject, "chore: add submodule");
        assert_eq!(tip.author.name, "Mara Okafor");
        assert_eq!(tip.author.email, "mara@example.dev");
        assert_eq!(tip.hash.len(), 40);
        assert_eq!(tip.parents.len(), 1);
        assert!(tip.refs.iter().any(|r| r.name == "main" && r.kind == RefKind::Local && r.current));
        assert!(tip.refs.iter().any(|r| r.name == "hotfix/crlf" && !r.current));

        let merge = commits.iter().find(|c| c.subject.starts_with("Merge branch")).unwrap();
        assert_eq!(merge.parents.len(), 2);
        assert!(merge.refs.iter().any(|r| r.name == "v0.2.0" && r.kind == RefKind::Tag));
        assert!(merge.refs.iter().any(|r| r.name == "origin/main" && r.kind == RefKind::Remote));
        assert!(merge.refs.iter().any(|r| r.name == "feature/ünïcode"));

        let root = commits.last().unwrap();
        assert_eq!(root.subject, "chore: initial commit");
        assert!(root.parents.is_empty());
        assert!(root.refs.is_empty());
    }

    #[test]
    fn topo_order_puts_children_before_parents() {
        let commits = parse_log(LOG);
        let pos = |h: &str| commits.iter().position(|c| c.hash == h).unwrap();
        for (i, c) in commits.iter().enumerate() {
            for p in &c.parents {
                assert!(pos(p) > i, "parent {p} of {} appears before it", c.hash);
            }
        }
    }

    #[test]
    fn parses_detached_head_and_skips_remote_head() {
        let refs = parse_decorations("HEAD, refs/remotes/origin/HEAD, refs/remotes/origin/main, refs/stash");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].kind, RefKind::Head);
        assert_eq!(refs[1].name, "origin/main");
    }

    #[test]
    fn empty_output_yields_no_commits() {
        assert!(parse_log(b"").is_empty());
    }
}
