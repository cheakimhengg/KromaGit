//! API keys live in the OS keychain (macOS Keychain, Windows Credential Manager,
//! Secret Service on Linux). They are read only inside Rust when a request is
//! made and are never sent to the webview.

use crate::error::{AppError, AppResult};
use crate::settings::CLOUD_PROVIDERS;

const SERVICE: &str = "dev.kromagit.app";

fn entry(provider: &str) -> AppResult<keyring::Entry> {
    if !CLOUD_PROVIDERS.contains(&provider) {
        return Err(AppError::Internal(format!("Unknown provider {provider}")));
    }
    keyring::Entry::new(SERVICE, &format!("{provider}-api-key")).map_err(keychain_err)
}

fn keychain_err(e: keyring::Error) -> AppError {
    AppError::Internal(format!("Keychain error: {e}"))
}

pub fn set_key(provider: &str, key: &str) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Internal("API key is empty.".into()));
    }
    entry(provider)?.set_password(key).map_err(keychain_err)
}

pub fn get_key(provider: &str) -> AppResult<Option<String>> {
    match entry(provider)?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keychain_err(e)),
    }
}

pub fn delete_key(provider: &str) -> AppResult<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keychain_err(e)),
    }
}

/// Which providers have a stored key — booleans only, never the key itself.
/// Reads every keychain entry, so macOS may ask for the login password;
/// only used once to build the index when it doesn't exist yet.
pub fn key_status() -> std::collections::HashMap<String, bool> {
    CLOUD_PROVIDERS
        .iter()
        .map(|p| (p.to_string(), get_key(p).ok().flatten().is_some()))
        .collect()
}

/// A small file in the app config folder listing which providers have a key
/// (names only). Checking it instead of the keychain means opening the app or
/// the settings never triggers a keychain password prompt.
const INDEX_FILE: &str = "saved-keys.json";

fn read_index(dir: &std::path::Path) -> Option<Vec<String>> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(INDEX_FILE)).ok()?).ok()
}

fn write_index(dir: &std::path::Path, providers: &[String]) {
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(INDEX_FILE), serde_json::to_string(providers).unwrap_or_default());
}

pub fn indexed_status(dir: &std::path::Path) -> std::collections::HashMap<String, bool> {
    let saved = match read_index(dir) {
        Some(s) => s,
        None => {
            let found: Vec<String> = key_status().into_iter().filter(|(_, v)| *v).map(|(k, _)| k).collect();
            write_index(dir, &found);
            found
        }
    };
    CLOUD_PROVIDERS.iter().map(|p| (p.to_string(), saved.iter().any(|s| s == p))).collect()
}

pub fn remember_key(dir: &std::path::Path, provider: &str, present: bool) {
    let mut saved = read_index(dir).unwrap_or_default();
    saved.retain(|p| p != provider);
    if present {
        saved.push(provider.to_string());
    }
    write_index(dir, &saved);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_tracks_saved_providers_without_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        write_index(dir.path(), &[]);
        remember_key(dir.path(), "anthropic", true);
        remember_key(dir.path(), "openai", true);
        remember_key(dir.path(), "openai", false);
        let s = indexed_status(dir.path());
        assert_eq!(s.get("anthropic"), Some(&true));
        assert_eq!(s.get("openai"), Some(&false));
        assert_eq!(s.get("gemini"), Some(&false));
    }
}
