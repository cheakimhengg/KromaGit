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
pub fn key_status() -> std::collections::HashMap<String, bool> {
    CLOUD_PROVIDERS
        .iter()
        .map(|p| (p.to_string(), get_key(p).ok().flatten().is_some()))
        .collect()
}
