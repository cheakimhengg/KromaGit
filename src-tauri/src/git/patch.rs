//! Builds partial patches for staging, unstaging or discarding selected hunks/lines.
//!
//! The approach mirrors `git add -p`:
//! * Forward patches are applied to the diff's old side (index) — used to stage.
//!   Unselected additions are dropped and unselected deletions become context.
//! * Reverse patches are applied with `--reverse` to the diff's new side — used to
//!   unstage (new side = index) or discard (new side = working tree).
//!   Unselected additions become context and unselected deletions are dropped.

use serde::Deserialize;

use super::model::DiffHunk;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchMode {
    Forward,
    Reverse,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkSelection {
    /// The `@@ … @@` header the UI was showing; used to detect stale diffs.
    pub header: String,
    /// Indexes into the hunk's lines; `None` selects every change in the hunk.
    pub lines: Option<Vec<usize>>,
}

pub fn build_patch(
    path: &str,
    old_path: Option<&str>,
    hunks: &[DiffHunk],
    selections: &[HunkSelection],
    mode: PatchMode,
) -> AppResult<String> {
    let stale = || AppError::Internal("The file changed since the diff was shown. Refresh and try again.".into());
    let a = old_path.unwrap_or(path);
    let mut out = format!("diff --git a/{a} b/{path}\n--- a/{a}\n+++ b/{path}\n");
    let mut shift: i64 = 0;
    let mut wrote_any = false;

    let mut chosen: Vec<(&DiffHunk, &HunkSelection)> = Vec::new();
    for sel in selections {
        let hunk = hunks.iter().find(|h| h.header == sel.header).ok_or_else(stale)?;
        if let Some(lines) = &sel.lines {
            if lines.iter().any(|&i| i >= hunk.lines.len()) {
                return Err(stale());
            }
        }
        chosen.push((hunk, sel));
    }
    chosen.sort_by_key(|(h, _)| h.old_start);

    for (hunk, sel) in chosen {
        let selected = |i: usize| sel.lines.as_ref().is_none_or(|l| l.contains(&i));
        let mut body = String::new();
        let (mut old_count, mut new_count, mut changes) = (0i64, 0i64, 0usize);

        for (i, line) in hunk.lines.iter().enumerate() {
            let prefix = match (line.kind, mode, selected(i)) {
                ("context", _, _) => Some(' '),
                ("add", _, true) => Some('+'),
                ("del", _, true) => Some('-'),
                ("add", PatchMode::Forward, false) => None,
                ("del", PatchMode::Forward, false) => Some(' '),
                ("add", PatchMode::Reverse, false) => Some(' '),
                ("del", PatchMode::Reverse, false) => None,
                _ => None,
            };
            let Some(prefix) = prefix else { continue };
            match prefix {
                ' ' => {
                    old_count += 1;
                    new_count += 1;
                }
                '+' => {
                    new_count += 1;
                    changes += 1;
                }
                _ => {
                    old_count += 1;
                    changes += 1;
                }
            }
            body.push(prefix);
            body.push_str(&line.text);
            body.push('\n');
            if line.no_eol {
                body.push_str("\\ No newline at end of file\n");
            }
        }
        if changes == 0 {
            continue;
        }

        let (old_start, new_start) = match mode {
            PatchMode::Forward => (hunk.old_start as i64, hunk.old_start as i64 + shift),
            PatchMode::Reverse => (hunk.new_start as i64 - shift, hunk.new_start as i64),
        };
        let fix = |start: i64, count: i64| if count == 0 { start.max(0) } else { start.max(1) };
        out.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            fix(old_start, old_count),
            old_count,
            fix(new_start, new_count),
            new_count
        ));
        out.push_str(&body);
        shift += new_count - old_count;
        wrote_any = true;
    }

    if !wrote_any {
        return Err(AppError::Internal("Nothing selected to apply.".into()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::diff::parse_unified_diff;

    const DIFF: &[u8] = b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n-d\n+D\n@@ -10,2 +10,3 @@ fn x()\n x\n+y\n z\n";

    fn sel(header: &str, lines: Option<Vec<usize>>) -> HunkSelection {
        HunkSelection { header: header.into(), lines }
    }

    #[test]
    fn forward_whole_hunk_keeps_all_changes() {
        let d = parse_unified_diff(DIFF);
        let p = build_patch("f", None, &d.hunks, &[sel("@@ -1,4 +1,4 @@", None)], PatchMode::Forward).unwrap();
        assert_eq!(p, "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n-d\n+D\n");
    }

    #[test]
    fn forward_selected_lines_drop_adds_and_keep_dels_as_context() {
        let d = parse_unified_diff(DIFF);
        let p = build_patch("f", None, &d.hunks, &[sel("@@ -1,4 +1,4 @@", Some(vec![1, 2]))], PatchMode::Forward).unwrap();
        assert!(p.ends_with("@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n d\n"), "{p}");
    }

    #[test]
    fn reverse_selected_lines_keep_adds_as_context_and_drop_dels() {
        let d = parse_unified_diff(DIFF);
        let p = build_patch("f", None, &d.hunks, &[sel("@@ -1,4 +1,4 @@", Some(vec![5]))], PatchMode::Reverse).unwrap();
        assert!(p.ends_with("@@ -1,3 +1,4 @@\n a\n B\n c\n+D\n"), "{p}");
    }

    #[test]
    fn later_hunk_start_shifts_by_earlier_net_change() {
        let d = parse_unified_diff(DIFF);
        let both = [sel("@@ -1,4 +1,4 @@", Some(vec![1])), sel("@@ -10,2 +10,3 @@ fn x()", None)];
        let p = build_patch("f", None, &d.hunks, &both, PatchMode::Forward).unwrap();
        assert!(p.contains("@@ -1,4 +1,3 @@\n a\n-b\n c\n d\n"), "{p}");
        assert!(p.contains("@@ -10,2 +9,3 @@\n x\n+y\n z\n"), "{p}");
    }

    #[test]
    fn keeps_no_newline_marker() {
        let raw = b"--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
        let d = parse_unified_diff(raw);
        let p = build_patch("f", None, &d.hunks, &[sel("@@ -1 +1 @@", None)], PatchMode::Forward).unwrap();
        assert!(p.ends_with("-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n"), "{p}");
    }

    #[test]
    fn rejects_stale_headers_and_empty_selection() {
        let d = parse_unified_diff(DIFF);
        assert!(build_patch("f", None, &d.hunks, &[sel("@@ -2,4 +2,4 @@", None)], PatchMode::Forward).is_err());
        assert!(build_patch("f", None, &d.hunks, &[sel("@@ -1,4 +1,4 @@", Some(vec![0]))], PatchMode::Forward).is_err());
        assert!(build_patch("f", None, &d.hunks, &[sel("@@ -1,4 +1,4 @@", Some(vec![99]))], PatchMode::Forward).is_err());
    }
}
