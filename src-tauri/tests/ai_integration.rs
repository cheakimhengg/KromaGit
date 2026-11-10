use std::path::Path;
use std::process::Command;

use kromagit_lib::ai::{collect, history};
use kromagit_lib::git::runner::Git;

fn sh_env(dir: &Path, args: &[&str], date: Option<&str>) {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Mara")
        .env("GIT_AUTHOR_EMAIL", "mara@example.dev")
        .env("GIT_COMMITTER_NAME", "Mara")
        .env("GIT_COMMITTER_EMAIL", "mara@example.dev");
    if let Some(d) = date {
        cmd.env("GIT_AUTHOR_DATE", d).env("GIT_COMMITTER_DATE", d);
    }
    let out = cmd.output().unwrap();
    assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
}
fn sh(dir: &Path, args: &[&str]) {
    sh_env(dir, args, None)
}
fn write(dir: &Path, f: &str, c: &str) {
    if let Some(p) = dir.join(f).parent() {
        std::fs::create_dir_all(p).unwrap();
    }
    std::fs::write(dir.join(f), c).unwrap();
}

fn repo() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    let d = tmp.path();
    sh(d, &["-c", "init.defaultBranch=main", "init", "-q"]);
    sh(d, &["config", "user.email", "mara@example.dev"]);
    write(d, "src/app.ts", "export const a = 1\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "feat(app): first"]);
    tmp
}

#[test]
fn collects_staged_and_all_changes_with_redaction() {
    let tmp = repo();
    let d = tmp.path();
    write(d, "src/app.ts", "export const a = 2\nconst apiKey = \"abcd1234efgh5678\"\n");
    write(d, ".env", "DB_PASSWORD=hunter22\n");
    sh(d, &["add", "src/app.ts", ".env"]);
    write(d, "notes.md", "untracked notes\n");

    let staged = collect::collect(&Git::new(d), "staged", 20_000).unwrap();
    let paths: Vec<_> = staged.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, [".env", "src/app.ts"]);
    let env = &staged.files[0];
    assert!(env.patch.is_empty() && env.omitted.is_some(), "env content must never be included");
    let app = &staged.files[1];
    assert!(!app.patch.contains("abcd1234efgh5678"));
    assert!(staged.redactions >= 1);

    let all = collect::collect(&Git::new(d), "all", 20_000).unwrap();
    let notes = all.files.iter().find(|f| f.path == "notes.md").expect("untracked included");
    assert_eq!((notes.status, notes.additions), ("A", 1));
    assert!(notes.patch.contains("+untracked notes"));
}

#[test]
fn recent_messages_and_user_email() {
    let tmp = repo();
    let g = Git::new(tmp.path());
    assert_eq!(history::recent_messages(&g, 20).unwrap(), vec!["feat(app): first".to_string()]);
    assert_eq!(history::user_email(&g).unwrap(), "mara@example.dev");
}

#[test]
fn finds_merged_gone_and_stale_branches() {
    let tmp = repo();
    let d = tmp.path();
    let remote = tempfile::tempdir().unwrap();
    sh(remote.path(), &["-c", "init.defaultBranch=main", "init", "-q", "--bare"]);
    sh(d, &["remote", "add", "origin", remote.path().to_str().unwrap()]);
    sh(d, &["push", "-q", "-u", "origin", "main"]);

    sh(d, &["branch", "merged-one"]);

    sh(d, &["checkout", "-qb", "gone-one"]);
    write(d, "g.txt", "g\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "gone work"]);
    sh(d, &["push", "-q", "-u", "origin", "gone-one"]);
    sh(d, &["push", "-q", "origin", "--delete", "gone-one"]);

    sh(d, &["checkout", "-q", "main"]);
    sh(d, &["checkout", "-qb", "old-one"]);
    write(d, "o.txt", "o\n");
    sh(d, &["add", "-A"]);
    sh_env(d, &["commit", "-qm", "old work"], Some("@1600000000 +0000"));

    sh(d, &["checkout", "-q", "main"]);
    sh(d, &["checkout", "-qb", "active"]);
    write(d, "a.txt", "a\n");
    sh(d, &["add", "-A"]);
    sh(d, &["commit", "-qm", "active work"]);
    sh(d, &["push", "-q", "-u", "origin", "active"]);
    sh(d, &["checkout", "-q", "main"]);

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let c = history::cleanup_candidates(&Git::new(d), &["main".into(), "staging".into()], 90, now).unwrap();
    let names: Vec<_> = c.iter().map(|x| x.name.as_str()).collect();
    assert!(names.contains(&"merged-one") && names.contains(&"gone-one") && names.contains(&"old-one"), "{names:?}");
    assert!(!names.contains(&"active") && !names.contains(&"main"), "{names:?}");

    let merged = c.iter().find(|x| x.name == "merged-one").unwrap();
    assert_eq!(merged.merged_into, vec!["main".to_string()]);
    let gone = c.iter().find(|x| x.name == "gone-one").unwrap();
    assert!(gone.upstream_gone && gone.remote_branch.is_none());
    let old = c.iter().find(|x| x.name == "old-one").unwrap();
    assert!(old.stale_days.unwrap() > 90);
}

#[test]
fn standup_spans_repos_and_filters_by_author() {
    let a = repo();
    let b = repo();
    sh(b.path(), &["checkout", "-qb", "feature/login"]);
    write(b.path(), "l.txt", "l\n");
    sh(b.path(), &["add", "-A"]);
    sh(b.path(), &["commit", "-qm", "feat(auth): login form"]);

    let paths = vec![a.path().to_string_lossy().into_owned(), b.path().to_string_lossy().into_owned(), "/no/such/repo".into()];
    let res = history::standup_commits(&paths, "1 week ago", "now", "mara@example.dev");
    assert_eq!(res[0].commits.len(), 1);
    assert_eq!(res[1].commits.len(), 2);
    assert!(res[1].commits.iter().any(|c| c.subject == "feat(auth): login form" && c.source == "feature/login"));
    assert!(res[2].error.is_some());

    let none = history::standup_commits(&paths[..1], "1 week ago", "now", "someone-else@example.dev");
    assert!(none[0].commits.is_empty());
}
