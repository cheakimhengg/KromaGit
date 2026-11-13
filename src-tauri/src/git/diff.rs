use super::model::{CommitDetails, DiffHunk, DiffLine, DiffRequest, FileChange, FileDiff, Person};
use super::runner::{split_nul, Git};
use super::status::parse_numstat;
use crate::error::AppResult;

pub const SHOW_FORMAT: &str = "%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B";
const MAX_DIFF_LINES: usize = 20_000;

pub fn get_commit_details(git: &Git, hash: &str) -> AppResult<CommitDetails> {
    let format = format!("--format={SHOW_FORMAT}");
    let mut details = parse_show(&git.run(&["show", "-s", "-z", &format, hash, "--"])?);
    let base: Vec<&str> = match details.parents.first() {
        Some(p) => vec![p.as_str(), hash],
        None => vec![hash],
    };
    let mut ns_args = vec!["diff-tree", "-r", "-z", "-M", "--root", "--no-commit-id", "--name-status"];
    ns_args.extend(&base);
    let mut num_args = vec!["diff-tree", "-r", "-z", "-M", "--root", "--no-commit-id", "--numstat"];
    num_args.extend(&base);
    let mut files = parse_name_status(&git.run(&ns_args)?);
    let stats = parse_numstat(&git.run(&num_args)?);
    for f in &mut files {
        if let Some(&(a, d)) = stats.get(&f.path) {
            f.additions = a;
            f.deletions = d;
        }
    }
    details.files = files;
    Ok(details)
}

pub fn get_file_diff(git: &Git, req: &DiffRequest) -> AppResult<FileDiff> {
    let mut paths = vec![req.path.as_str()];
    if let Some(old) = req.old_path.as_deref() {
        paths.push(old);
    }
    let context = if req.full_file { "-U1000000" } else { "-U3" };
    let mut common = vec!["--no-color", "--no-ext-diff", context, "-M", "--src-prefix=a/", "--dst-prefix=b/"];
    if req.ignore_whitespace {
        common.push("-w");
    }
    let common = common.as_slice();
    let raw = match (req.source.as_str(), req.untracked) {
        (_, true) => {
            let mut args = vec!["diff", "--no-index"];
            args.extend(common);
            args.extend(["--", null_path(), req.path.as_str()]);
            git.run_with_codes(&args, &[0, 1])?
        }
        ("commit", _) => {
            let commit = req.commit.as_deref().unwrap_or("HEAD");
            let mut args = vec!["diff-tree", "-p", "-r", "--root", "--no-commit-id"];
            args.extend(common);
            if let Some(parent) = req.parent.as_deref() {
                args.push(parent);
            }
            args.push(commit);
            args.push("--");
            args.extend(&paths);
            git.run(&args)?
        }
        (source, _) => {
            let mut args = vec!["diff"];
            if source == "staged" {
                args.push("--cached");
            }
            args.extend(common);
            args.push("--");
            args.extend(&paths);
            git.run(&args)?
        }
    };
    let mut diff = parse_unified_diff(&raw);
    diff.path = req.path.clone();
    if diff.old_path.is_none() {
        diff.old_path = req.old_path.clone();
    }
    Ok(diff)
}

fn null_path() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

/// Parses `git show -s -z --format=SHOW_FORMAT`.
pub fn parse_show(raw: &[u8]) -> CommitDetails {
    let text = String::from_utf8_lossy(raw);
    let f: Vec<&str> = text.splitn(9, '\0').collect();
    let get = |i: usize| f.get(i).copied().unwrap_or_default();
    let message = get(8).trim_end_matches('\0').trim();
    let (subject, body) = split_message(message);
    CommitDetails {
        hash: get(0).trim().to_string(),
        parents: get(1).split_whitespace().map(str::to_owned).collect(),
        author: Person { name: get(2).into(), email: get(3).into() },
        author_date: get(4).parse().unwrap_or(0),
        committer: Person { name: get(5).into(), email: get(6).into() },
        commit_date: get(7).parse().unwrap_or(0),
        subject,
        body,
        files: Vec::new(),
    }
}

/// Splits a raw message into subject (first paragraph, joined) and body.
pub fn split_message(message: &str) -> (String, String) {
    let normalized = message.replace("\r\n", "\n");
    let (head, rest) = normalized.split_once("\n\n").unwrap_or((normalized.as_str(), ""));
    let subject = head.lines().map(str::trim).collect::<Vec<_>>().join(" ");
    (subject, rest.trim().to_string())
}

/// Parses `--name-status -z` output.
pub fn parse_name_status(raw: &[u8]) -> Vec<FileChange> {
    let tokens = split_nul(raw);
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let code = tokens[i].trim();
        i += 1;
        let first = code.chars().next().unwrap_or('M');
        let status: &'static str = match first {
            'A' | 'C' => "A",
            'D' => "D",
            'R' => "R",
            'U' => "U",
            _ => "M",
        };
        if matches!(first, 'R' | 'C') {
            let old = tokens.get(i).cloned().unwrap_or_default();
            let new = tokens.get(i + 1).cloned().unwrap_or_default();
            i += 2;
            out.push(FileChange {
                path: new,
                old_path: (first == 'R').then_some(old),
                status,
                additions: 0,
                deletions: 0,
            });
        } else {
            let path = tokens.get(i).cloned().unwrap_or_default();
            i += 1;
            out.push(FileChange { path, old_path: None, status, additions: 0, deletions: 0 });
        }
    }
    out
}

fn parse_range(s: &str) -> (u32, u32) {
    match s.split_once(',') {
        Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
        None => (s.parse().unwrap_or(0), 1),
    }
}

/// Parses a single-file unified diff (`git diff` / `git diff-tree -p`).
pub fn parse_unified_diff(raw: &[u8]) -> FileDiff {
    let text = String::from_utf8_lossy(raw);
    let mut diff = FileDiff::default();
    let mut hunk: Option<DiffHunk> = None;
    let (mut old_no, mut new_no, mut old_left, mut new_left) = (0u32, 0u32, 0u32, 0u32);
    let mut total = 0usize;

    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.starts_with('\\') {
            if let Some(last) = hunk.as_mut().and_then(|h| h.lines.last_mut()) {
                last.no_eol = true;
            }
            continue;
        }
        let in_hunk = hunk.is_some() && (old_left > 0 || new_left > 0);

        if in_hunk {
            if total >= MAX_DIFF_LINES {
                diff.truncated = true;
                break;
            }
            let h = hunk.as_mut().unwrap();
            let (kind, body) = match line.as_bytes().first() {
                Some(b'+') => ("add", &line[1..]),
                Some(b'-') => ("del", &line[1..]),
                Some(b' ') => ("context", &line[1..]),
                None => ("context", ""),
                _ => continue,
            };
            let (o, n) = match kind {
                "add" => {
                    new_left = new_left.saturating_sub(1);
                    new_no += 1;
                    (None, Some(new_no - 1))
                }
                "del" => {
                    old_left = old_left.saturating_sub(1);
                    old_no += 1;
                    (Some(old_no - 1), None)
                }
                _ => {
                    old_left = old_left.saturating_sub(1);
                    new_left = new_left.saturating_sub(1);
                    old_no += 1;
                    new_no += 1;
                    (Some(old_no - 1), Some(new_no - 1))
                }
            };
            h.lines.push(DiffLine { kind, old_no: o, new_no: n, text: body.to_string(), no_eol: false });
            total += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("@@ -") {
            if let Some(h) = hunk.take() {
                diff.hunks.push(h);
            }
            let Some((ranges, _)) = rest.split_once(" @@") else { continue };
            let Some((old, new)) = ranges.split_once(" +") else { continue };
            let (os, ol) = parse_range(old);
            let (ns, nl) = parse_range(new);
            old_no = os;
            new_no = ns;
            old_left = ol;
            new_left = nl;
            hunk = Some(DiffHunk {
                header: line.to_string(),
                old_start: os,
                old_lines: ol,
                new_start: ns,
                new_lines: nl,
                lines: Vec::new(),
            });
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            diff.binary = true;
        } else if let Some(old) = line.strip_prefix("rename from ") {
            diff.old_path = Some(old.to_string());
        }
    }
    if let Some(h) = hunk {
        diff.hunks.push(h);
    }
    diff
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFF: &[u8] = include_bytes!("../../tests/fixtures/diff_readme.txt");
    const SHOW: &[u8] = include_bytes!("../../tests/fixtures/show.bin");
    const NAME_STATUS: &[u8] = include_bytes!("../../tests/fixtures/name_status.bin");

    #[test]
    fn parses_real_unified_diff() {
        let d = parse_unified_diff(DIFF);
        assert!(!d.binary);
        assert_eq!(d.hunks.len(), 1);
        let h = &d.hunks[0];
        assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (2, 3, 2, 4));
        assert_eq!(h.lines.len(), 4);
        assert_eq!(h.lines[0].kind, "context");
        assert_eq!((h.lines[0].old_no, h.lines[0].new_no), (Some(2), Some(2)));
        let add = h.lines.last().unwrap();
        assert_eq!((add.kind, add.text.as_str(), add.new_no, add.old_no), ("add", "unstaged line", Some(5), None));
    }

    #[test]
    fn handles_multiple_hunks_deleted_dash_lines_and_no_newline_marker() {
        let raw = b"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n--- not a header\n keep\n@@ -10 +9,2 @@ fn f()\n-old\n+new\n+more\n\\ No newline at end of file\n";
        let d = parse_unified_diff(raw);
        assert_eq!(d.hunks.len(), 2);
        assert_eq!(d.hunks[0].lines[0].kind, "del");
        assert_eq!(d.hunks[0].lines[0].text, "-- not a header");
        assert_eq!(d.hunks[1].old_lines, 1);
        assert_eq!(d.hunks[1].lines.len(), 3);
        assert_eq!(d.hunks[1].lines[2].new_no, Some(10));
        assert!(d.hunks[1].lines[2].no_eol);
        assert!(!d.hunks[1].lines[1].no_eol);
    }

    #[test]
    fn detects_binary_and_renames() {
        let raw = b"diff --git a/a.png b/b.png\nsimilarity index 90%\nrename from a.png\nrename to b.png\nBinary files a/a.png and b/b.png differ\n";
        let d = parse_unified_diff(raw);
        assert!(d.binary);
        assert_eq!(d.old_path.as_deref(), Some("a.png"));
        assert!(d.hunks.is_empty());
    }

    #[test]
    fn parses_show_and_splits_message() {
        let c = parse_show(SHOW);
        assert_eq!(c.subject, "fix(parser): return a value");
        assert_eq!(c.body, "");
        assert_eq!(c.parents.len(), 1);
        assert_eq!(c.author.email, "mara@example.dev");
        assert_eq!(c.committer.name, "Mara Okafor");
        assert!(c.author_date > 1_700_000_000);

        let (s, b) = split_message("feat: a\ncontinued\n\nBody one.\nBody two.\n");
        assert_eq!(s, "feat: a continued");
        assert_eq!(b, "Body one.\nBody two.");
    }

    #[test]
    fn parses_name_status_with_renames() {
        let real: Vec<_> = parse_name_status(NAME_STATUS).into_iter().map(|f| (f.status, f.path)).collect();
        assert_eq!(real, vec![("A", ".gitmodules".to_string()), ("A", "vendor/upstream".to_string())]);
        let files = parse_name_status(b"R087\0old.rs\0new.rs\0D\0gone.txt\0A\0added.txt\0");
        assert_eq!(files.len(), 3);
        assert_eq!((files[0].status, files[0].path.as_str(), files[0].old_path.as_deref()), ("R", "new.rs", Some("old.rs")));
        assert_eq!(files[1].status, "D");
        assert_eq!(files[2].status, "A");
    }
}
