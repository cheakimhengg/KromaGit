//! Looks up GitHub avatars for commit authors. GitHub links a commit to the
//! account that owns its email, so asking for one commit by an author returns
//! that person's profile picture without any sign-in.

use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};

fn valid_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn valid_sha(s: &str) -> bool {
    (7..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// `Ok(None)` when GitHub has no linked account (or the repo is private);
/// an error only for rate limiting, so the caller can stop asking.
pub fn parse_commit_avatar(status: u16, body: &str) -> AppResult<Option<String>> {
    match status {
        200 => {
            let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            Ok(v["author"]["avatar_url"].as_str().filter(|u| u.starts_with("https://")).map(str::to_owned))
        }
        403 | 429 => Err(AppError::Internal("GitHub rate limit reached".into())),
        _ => Ok(None),
    }
}

pub async fn github_commit_avatar(owner: &str, repo: &str, sha: &str) -> AppResult<Option<String>> {
    if !valid_name(owner) || !valid_name(repo) || !valid_sha(sha) {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(concat!("KromaGit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let resp = client
        .get(format!("https://api.github.com/repos/{owner}/{repo}/commits/{sha}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Network error: {e}")))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    parse_commit_avatar(status, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_avatar_or_reports_none() {
        let ok = r#"{"author":{"login":"octo","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}}"#;
        assert_eq!(parse_commit_avatar(200, ok).unwrap().as_deref(), Some("https://avatars.githubusercontent.com/u/1?v=4"));
        assert_eq!(parse_commit_avatar(200, r#"{"author":null}"#).unwrap(), None);
        assert_eq!(parse_commit_avatar(404, "{}").unwrap(), None);
        assert!(parse_commit_avatar(403, "{}").is_err());
        assert_eq!(parse_commit_avatar(200, r#"{"author":{"avatar_url":"javascript:alert(1)"}}"#).unwrap(), None);
    }

    #[test]
    fn validates_inputs() {
        assert!(valid_name("Kroma-Git_1.0") && !valid_name("a/b") && !valid_name(""));
        assert!(valid_sha("4cd0360") && !valid_sha("4cd0360x") && !valid_sha("abc"));
    }
}
