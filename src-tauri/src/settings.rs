//! App settings, stored as a JSON file in the OS app-config directory.
//! API keys are NOT stored here — see `secrets.rs` (OS keychain).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const CLOUD_PROVIDERS: [&str; 3] = ["anthropic", "openai", "gemini"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// "none" | "ollama" | "anthropic" | "openai" | "gemini"
    pub provider: String,
    /// model per provider
    pub models: HashMap<String, String>,
    pub ollama_url: String,
    /// providers the user agreed to send code to (first-use consent)
    pub cloud_consent: HashMap<String, bool>,
}

impl Default for AiSettings {
    fn default() -> Self {
        let models = [
            ("ollama", ""),
            ("anthropic", "claude-opus-5-5"),
            ("openai", "gpt-4.1-mini"),
            ("gemini", "gemini-2.5-flash"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        Self {
            provider: "none".into(),
            models,
            ollama_url: "http://localhost:11434".into(),
            cloud_consent: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoSettings {
    /// e.g. "{type}({scope}): {summary}" or "[{Feature}] {Type}: {summary}"; empty = infer from history
    pub commit_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StandupSettings {
    pub author_email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CleanupSettings {
    pub base_branches: Vec<String>,
    pub stale_days: u32,
}

impl Default for CleanupSettings {
    fn default() -> Self {
        Self { base_branches: vec!["main".into(), "master".into(), "staging".into()], stale_days: 90 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppearanceSettings {
    /// "dark" | "light" | "system"
    pub theme: String,
    /// percent, 70-150
    pub zoom: u32,
    /// "theme" | "blue" | "violet" | "teal" | "pink" | "amber" | "green"
    pub accent: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self { theme: "dark".into(), zoom: 100, accent: "theme".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    /// app name (macOS) or command line; empty = system default
    pub terminal_app: String,
    pub editor_app: String,
    /// fetch author pictures from GitHub / Gravatar (initials otherwise)
    pub show_avatars: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self { terminal_app: String::new(), editor_app: String::new(), show_avatars: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub appearance: AppearanceSettings,
    pub general: GeneralSettings,
    pub ai: AiSettings,
    /// keyed by repository root path
    pub repos: HashMap<String, RepoSettings>,
    pub standup: StandupSettings,
    pub cleanup: CleanupSettings,
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

/// Missing or unreadable files fall back to defaults so a bad file never blocks startup.
pub fn load(config_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_path(config_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Atomic write: temp file + rename, so a crash never leaves half a settings file.
pub fn save(config_dir: &Path, settings: &Settings) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| AppError::Internal(e.to_string()))?;
    let tmp = config_dir.join("settings.json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, settings_path(config_dir))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_have_ai_off_and_a_round_trip_is_lossless() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(dir.path());
        assert_eq!(s.ai.provider, "none");
        assert_eq!(s.ai.models["anthropic"], "claude-opus-5-5");
        assert_eq!(s.cleanup.stale_days, 90);
        assert!(s.general.show_avatars, "profile pictures are on by default");

        let mut changed = s.clone();
        changed.ai.provider = "ollama".into();
        changed.repos.insert("/r".into(), RepoSettings { commit_template: "[{Feature}] {Type}: {summary}".into() });
        save(dir.path(), &changed).unwrap();
        assert_eq!(load(dir.path()), changed);
    }

    #[test]
    fn partial_or_corrupt_files_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(settings_path(dir.path()), r#"{"ai":{"provider":"gemini"}}"#).unwrap();
        let s = load(dir.path());
        assert_eq!(s.ai.provider, "gemini");
        assert_eq!(s.ai.ollama_url, "http://localhost:11434");

        std::fs::write(settings_path(dir.path()), "{ not json").unwrap();
        assert_eq!(load(dir.path()), Settings::default());
    }
}
