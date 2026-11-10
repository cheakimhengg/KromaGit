//! Provider-agnostic text generation. Request bodies and response parsing are
//! pure functions so they can be unit tested without the network.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::redact::redact;
use crate::error::{AppError, AppResult};
use crate::secrets;
use crate::settings::AiSettings;

pub const ANTHROPIC_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub system: String,
    pub user: String,
    /// JSON schema for structured output; None = plain text
    pub schema: Option<Value>,
    pub max_tokens: Option<u32>,
    /// "low" | "medium" | "high" (Anthropic effort; ignored elsewhere)
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiResponse {
    pub text: String,
    pub provider: String,
    pub model: String,
}

pub struct Target {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
}

impl std::fmt::Debug for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Target")
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "***"))
            .finish()
    }
}

pub fn resolve_target(settings: &AiSettings) -> AppResult<Target> {
    let provider = settings.provider.clone();
    if provider == "none" || provider.is_empty() {
        return Err(AppError::Internal("No AI provider is configured. Choose one in Settings → AI.".into()));
    }
    let model = settings.models.get(&provider).cloned().unwrap_or_default();
    if model.trim().is_empty() {
        return Err(AppError::Internal(format!("Choose a model for {provider} in Settings → AI.")));
    }
    let api_key = if provider == "ollama" {
        None
    } else {
        Some(secrets::get_key(&provider)?.ok_or_else(|| AppError::Internal(format!("No API key saved for {provider}. Add one in Settings → AI.")))?)
    };
    let base_url = match provider.as_str() {
        "ollama" => settings.ollama_url.trim_end_matches('/').to_string(),
        "anthropic" => "https://api.anthropic.com".into(),
        "openai" => "https://api.openai.com".into(),
        "gemini" => "https://generativelanguage.googleapis.com".into(),
        other => return Err(AppError::Internal(format!("Unknown provider {other}"))),
    };
    Ok(Target { provider, model, base_url, api_key })
}

fn is_current_claude(model: &str) -> bool {
    ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5", "claude-mythos-5"]
        .iter()
        .any(|p| model.starts_with(p))
}

fn supports_default_fallbacks(model: &str) -> bool {
    ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"].contains(&model)
}

/// Builds (url, headers, body) for a provider call.
pub fn build_request(t: &Target, req: &AiRequest) -> (String, Vec<(String, String)>, Value) {
    let max_tokens = req.max_tokens.unwrap_or(16_000);
    let key = t.api_key.clone().unwrap_or_default();
    match t.provider.as_str() {
        "anthropic" => {
            let mut body = json!({
                "model": t.model,
                "max_tokens": max_tokens,
                "system": req.system,
                "messages": [{ "role": "user", "content": req.user }],
            });
            let mut headers = vec![
                ("x-api-key".into(), key),
                ("anthropic-version".into(), ANTHROPIC_VERSION.into()),
            ];
            if is_current_claude(&t.model) {
                let mut output = serde_json::Map::new();
                if let Some(e) = &req.effort {
                    output.insert("effort".into(), json!(e));
                }
                if let Some(schema) = &req.schema {
                    output.insert("format".into(), json!({ "type": "json_schema", "schema": schema }));
                }
                if !output.is_empty() {
                    body["output_config"] = Value::Object(output);
                }
            }
            if supports_default_fallbacks(&t.model) {
                body["fallbacks"] = json!("default");
                headers.push(("anthropic-beta".into(), FALLBACK_BETA.into()));
            }
            (format!("{}/v1/messages", t.base_url), headers, body)
        }
        "openai" => {
            let mut body = json!({
                "model": t.model,
                "max_completion_tokens": max_tokens,
                "messages": [
                    { "role": "system", "content": req.system },
                    { "role": "user", "content": req.user },
                ],
            });
            if req.schema.is_some() {
                body["response_format"] = json!({ "type": "json_object" });
            }
            (format!("{}/v1/chat/completions", t.base_url), vec![("authorization".into(), format!("Bearer {key}"))], body)
        }
        "gemini" => {
            let mut config = json!({ "maxOutputTokens": max_tokens });
            if req.schema.is_some() {
                config["responseMimeType"] = json!("application/json");
            }
            let body = json!({
                "systemInstruction": { "parts": [{ "text": req.system }] },
                "contents": [{ "role": "user", "parts": [{ "text": req.user }] }],
                "generationConfig": config,
            });
            let url = format!("{}/v1beta/models/{}:generateContent", t.base_url, t.model);
            (url, vec![("x-goog-api-key".into(), key)], body)
        }
        _ => {
            let mut body = json!({
                "model": t.model,
                "stream": false,
                "messages": [
                    { "role": "system", "content": req.system },
                    { "role": "user", "content": req.user },
                ],
                "options": { "num_ctx": 16384 },
            });
            if req.schema.is_some() {
                body["format"] = json!("json");
            }
            (format!("{}/api/chat", t.base_url), vec![], body)
        }
    }
}

/// Extracts the generated text, turning refusals and truncation into clear errors.
pub fn parse_response(provider: &str, v: &Value) -> AppResult<String> {
    let fail = |m: String| Err(AppError::Internal(m));
    match provider {
        "anthropic" => {
            match v["stop_reason"].as_str() {
                Some("refusal") => {
                    let cat = v["stop_details"]["category"].as_str().unwrap_or("unspecified");
                    return fail(format!("The model declined this request (category: {cat})."));
                }
                Some("max_tokens") => return fail("The response was cut off (max tokens). Try a smaller change set.".into()),
                _ => {}
            }
            let text: String = v["content"]
                .as_array()
                .map(|blocks| blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect())
                .unwrap_or_default();
            if text.trim().is_empty() { fail("The model returned no text.".into()) } else { Ok(text) }
        }
        "openai" => {
            let choice = &v["choices"][0];
            if let Some(r) = choice["message"]["refusal"].as_str() {
                return fail(format!("The model declined: {r}"));
            }
            if choice["finish_reason"] == "length" {
                return fail("The response was cut off (max tokens). Try a smaller change set.".into());
            }
            choice["message"]["content"].as_str().map(str::to_owned).ok_or_else(|| AppError::Internal("The model returned no text.".into()))
        }
        "gemini" => {
            let cand = &v["candidates"][0];
            match cand["finishReason"].as_str() {
                Some("SAFETY") | Some("PROHIBITED_CONTENT") | Some("BLOCKLIST") => return fail("The model declined this request (safety filter).".into()),
                Some("MAX_TOKENS") => return fail("The response was cut off (max tokens). Try a smaller change set.".into()),
                _ => {}
            }
            let text: String = cand["content"]["parts"]
                .as_array()
                .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect())
                .unwrap_or_default();
            if text.trim().is_empty() { fail("The model returned no text.".into()) } else { Ok(text) }
        }
        _ => v["message"]["content"].as_str().map(str::to_owned).ok_or_else(|| AppError::Internal("Ollama returned no text.".into())),
    }
}

pub fn parse_error(provider: &str, status: u16, body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let detail = v["error"]["message"].as_str().or_else(|| v["error"].as_str()).map(str::to_owned).unwrap_or_else(|| body.chars().take(300).collect());
    let name = match provider {
        "anthropic" => "Anthropic",
        "openai" => "OpenAI",
        "gemini" => "Gemini",
        _ => "Ollama",
    };
    match status {
        401 | 403 => format!("{name} rejected the API key ({status}). Check it in Settings → AI. {detail}"),
        404 if provider == "ollama" => format!("Ollama doesn't have that model. Run `ollama pull <model>` or pick an installed one. {detail}"),
        429 => format!("{name} rate limit or quota reached (429). {detail}"),
        _ => format!("{name} error {status}: {detail}"),
    }
}

pub async fn complete(settings: &AiSettings, req: &AiRequest) -> AppResult<AiResponse> {
    let target = resolve_target(settings)?;
    // defense in depth: whatever the caller built, secrets never leave the machine
    let (user, _) = redact(&req.user);
    let safe = AiRequest { user, ..req.clone() };
    let (url, headers, body) = build_request(&target, &safe);

    let timeout = if target.provider == "ollama" { 600 } else { 180 };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .user_agent(concat!("KromaGit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mut rb = client.post(&url).json(&body);
    for (k, v) in &headers {
        rb = rb.header(k, v);
    }
    let resp = rb.send().await.map_err(|e| {
        if target.provider == "ollama" && (e.is_connect() || e.is_timeout()) {
            AppError::Internal(format!("Can't reach Ollama at {}. Is it running? Start it with `ollama serve`.", target.base_url))
        } else {
            AppError::Internal(format!("Network error: {e}"))
        }
    })?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| AppError::Internal(e.to_string()))?;
    if !(200..300).contains(&status) {
        return Err(AppError::Internal(parse_error(&target.provider, status, &text)));
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| AppError::Internal("The provider returned invalid JSON.".into()))?;
    Ok(AiResponse { text: parse_response(&target.provider, &v)?, provider: target.provider, model: target.model })
}

pub async fn ollama_models(url: &str) -> AppResult<Vec<String>> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().map_err(|e| AppError::Internal(e.to_string()))?;
    let resp = client
        .get(format!("{}/api/tags", url.trim_end_matches('/')))
        .send()
        .await
        .map_err(|_| AppError::Internal(format!("Can't reach Ollama at {url}. Is it running? Start it with `ollama serve`.")))?;
    let v: Value = resp.json().await.map_err(|e| AppError::Internal(e.to_string()))?;
    let mut names: Vec<String> = v["models"].as_array().map(|m| m.iter().filter_map(|x| x["name"].as_str().map(str::to_owned)).collect()).unwrap_or_default();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(provider: &str, model: &str) -> Target {
        Target { provider: provider.into(), model: model.into(), base_url: "https://x".into(), api_key: Some("KEY".into()) }
    }
    fn req(schema: bool) -> AiRequest {
        AiRequest {
            system: "sys".into(),
            user: "hello".into(),
            schema: schema.then(|| json!({ "type": "object" })),
            max_tokens: Some(2000),
            effort: Some("low".into()),
        }
    }

    #[test]
    fn anthropic_request_uses_current_api_shape() {
        let (url, headers, body) = build_request(&target("anthropic", "claude-opus-5-5"), &req(true));
        assert_eq!(url, "https://x/v1/messages");
        assert!(headers.contains(&("anthropic-version".into(), "2026-10-21".into())));
        assert!(headers.contains(&("anthropic-beta".into(), "server-side-fallback-2026-07-01".into())));
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["system"], "sys");
        assert!(body.get("temperature").is_none() && body.get("thinking").is_none());

        let (_, headers, body) = build_request(&target("anthropic", "claude-haiku-4-5"), &req(true));
        assert!(body.get("output_config").is_none() && body.get("fallbacks").is_none());
        assert!(!headers.iter().any(|(k, _)| k == "anthropic-beta"));
    }

    #[test]
    fn other_providers_request_shapes() {
        let (url, h, b) = build_request(&target("openai", "gpt-4.1-mini"), &req(true));
        assert_eq!(url, "https://x/v1/chat/completions");
        assert_eq!(h[0], ("authorization".to_string(), "Bearer KEY".to_string()));
        assert_eq!(b["response_format"]["type"], "json_object");
        assert_eq!(b["messages"][0]["role"], "system");

        let (url, h, b) = build_request(&target("gemini", "gemini-2.5-flash"), &req(true));
        assert_eq!(url, "https://x/v1beta/models/gemini-2.5-flash:generateContent");
        assert_eq!(h[0].0, "x-goog-api-key");
        assert_eq!(b["generationConfig"]["responseMimeType"], "application/json");

        let (url, h, b) = build_request(&Target { api_key: None, ..target("ollama", "qwen2.5-coder") }, &req(false));
        assert_eq!(url, "https://x/api/chat");
        assert!(h.is_empty());
        assert_eq!(b["stream"], false);
        assert!(b.get("format").is_none());
    }

    #[test]
    fn parses_text_and_reports_refusals_and_truncation() {
        let ok = json!({ "stop_reason": "end_turn", "content": [{ "type": "thinking", "thinking": "" }, { "type": "text", "text": "{\"a\":1}" }] });
        assert_eq!(parse_response("anthropic", &ok).unwrap(), "{\"a\":1}");
        let refused = json!({ "stop_reason": "refusal", "stop_details": { "category": "cyber" }, "content": [] });
        assert!(parse_response("anthropic", &refused).unwrap_err().to_string().contains("cyber"));
        let cut = json!({ "stop_reason": "max_tokens", "content": [{ "type": "text", "text": "{" }] });
        assert!(parse_response("anthropic", &cut).is_err());

        assert_eq!(parse_response("openai", &json!({ "choices": [{ "message": { "content": "hi" }, "finish_reason": "stop" }] })).unwrap(), "hi");
        assert_eq!(parse_response("gemini", &json!({ "candidates": [{ "content": { "parts": [{ "text": "a" }, { "text": "b" }] }, "finishReason": "STOP" }] })).unwrap(), "ab");
        assert!(parse_response("gemini", &json!({ "candidates": [{ "finishReason": "SAFETY" }] })).is_err());
        assert_eq!(parse_response("ollama", &json!({ "message": { "content": "yo" } })).unwrap(), "yo");
    }

    #[test]
    fn explains_common_http_errors() {
        assert!(parse_error("anthropic", 401, r#"{"error":{"message":"invalid x-api-key"}}"#).contains("rejected the API key"));
        assert!(parse_error("ollama", 404, r#"{"error":"model not found"}"#).contains("ollama pull"));
        assert!(parse_error("openai", 429, "{}").contains("429"));
    }

    #[test]
    fn requires_a_provider_and_model() {
        let mut s = AiSettings::default();
        assert!(resolve_target(&s).is_err());
        s.provider = "ollama".into();
        assert!(resolve_target(&s).unwrap_err().to_string().contains("Choose a model"));
        s.models.insert("ollama".into(), "llama3.1".into());
        let t = resolve_target(&s).unwrap();
        assert_eq!(t.base_url, "http://localhost:11434");
        assert!(t.api_key.is_none());
    }
}
