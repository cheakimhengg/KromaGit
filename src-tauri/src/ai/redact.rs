//! Strips likely secrets from text before it can leave the machine.

use std::sync::OnceLock;

use regex::Regex;

pub const REDACTED: &str = "[REDACTED]";

struct Rule {
    re: Regex,
    replacement: &'static str,
}

fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        let r = |p: &str, replacement: &'static str| Rule { re: Regex::new(p).expect("valid regex"), replacement };
        let keyish = r"[\w.\-]*(?i:password|passwd|secret|token|api[_\-]?key|apikey|access[_\-]?key|private[_\-]?key|client[_\-]?secret|auth[_\-]?key|credentials?)[\w.\-]*";
        vec![
            r(r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", "[REDACTED PRIVATE KEY]"),
            r(r"\bAKIA[0-9A-Z]{16}\b", REDACTED),
            r(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b", REDACTED),
            r(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b", REDACTED),
            r(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}", REDACTED),
            r(r"\bsk-ant-[A-Za-z0-9_\-]{20,}", REDACTED),
            r(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}", REDACTED),
            r(r"\bAIza[0-9A-Za-z_\-]{35}\b", REDACTED),
            r(r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}", REDACTED),
            // scheme://user:password@host
            r(r"([A-Za-z][A-Za-z0-9+.\-]*://[^:/\s@]+):([^@\s/]+)@", "$1:[REDACTED]@"),
            // connection strings: Password=...; Pwd=...
            r(r"(?i)\b((?:password|pwd)\s*=\s*)([^;'\x22\s]+)", "$1[REDACTED]"),
            // quoted assignment: apiKey = "value", "client_secret": "value"
            Rule {
                re: Regex::new(&format!(r#"({keyish}["']?\s*(?::|=>|=|:=)\s*)(["'])([^"'\n]{{4,}})(["'])"#)).unwrap(),
                replacement: "$1$2[REDACTED]$4",
            },
            // env / yaml style, unquoted: API_TOKEN=abc123..., password: hunter22
            Rule {
                re: Regex::new(&format!(r#"(?m)^([+\- ]?\s*(?:export\s+)?{keyish}\s*[:=]\s*)([^\s"'#]{{6,}})"#)).unwrap(),
                replacement: "$1[REDACTED]",
            },
        ]
    })
}

/// Returns the redacted text and how many replacements were made.
pub fn redact(text: &str) -> (String, u32) {
    let mut out = text.to_string();
    let mut count = 0u32;
    for rule in rules() {
        let n = rule.re.find_iter(&out).count() as u32;
        if n > 0 {
            count += n;
            out = rule.re.replace_all(&out, rule.replacement).into_owned();
        }
    }
    (out, count)
}

/// Files whose whole content should never be sent anywhere.
pub fn is_sensitive_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    let safe_env = [".env.example", ".env.sample", ".env.template", ".env.dist"];
    if (name == ".env" || name.starts_with(".env.")) && !safe_env.contains(&name.as_str()) {
        return true;
    }
    let exact = [
        "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", ".npmrc", ".pypirc", ".netrc", "credentials",
        "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml", ".htpasswd", "service-account.json",
    ];
    if exact.contains(&name.as_str()) {
        return true;
    }
    let ext = name.rsplit('.').next().unwrap_or("");
    name.contains('.') && ["pem", "key", "p12", "pfx", "jks", "keystore", "tfvars", "kdbx"].contains(&ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_known_token_formats() {
        let samples = [
            "aws = AKIAIOSFODNN7EXAMPLE",
            "+const t = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'",
            "ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwx",
            "openai sk-proj-abcdefghijklmnopqrstuvwxyz",
            "google AIzaSyA1234567890abcdefghijklmnopqrstuv",
            "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
            "slack xoxb-1234567890-abcdefghij",
        ];
        for s in samples {
            let (out, n) = redact(s);
            assert!(n >= 1, "nothing redacted in {s}");
            assert!(out.contains("[REDACTED]"), "{out}");
        }
    }

    #[test]
    fn redacts_connection_strings_urls_and_assignments() {
        let (out, _) = redact("Server=db;Database=Main;User Id=sa;Password=Sup3rSecret!;");
        assert!(out.contains("Password=[REDACTED];") && !out.contains("Sup3rSecret"), "{out}");

        let (out, _) = redact("DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app");
        assert!(out.contains("admin:[REDACTED]@db.internal") && !out.contains("hunter2"), "{out}");

        let (out, _) = redact(r#"+  "client_secret": "abc123def456","#);
        assert!(out.contains(r#""client_secret": "[REDACTED]""#), "{out}");

        let (out, _) = redact("+API_TOKEN=abcd1234efgh\n+DEBUG=true");
        assert!(out.contains("API_TOKEN=[REDACTED]") && out.contains("DEBUG=true"), "{out}");

        let (out, _) = redact("+-----BEGIN RSA PRIVATE KEY-----\n+MIIEow\n+-----END RSA PRIVATE KEY-----");
        assert_eq!(out, "+[REDACTED PRIVATE KEY]");
    }

    #[test]
    fn leaves_ordinary_code_alone() {
        let code = "+const tokenCount = tokens.length\n+function getPassword(user) { return prompt(user) }\n+let x = 42";
        let (out, n) = redact(code);
        assert_eq!(n, 0, "{out}");
        assert_eq!(out, code);
    }

    #[test]
    fn flags_sensitive_files() {
        for p in [".env", "config/.env.production", "certs/server.pem", "deploy/prod.key", "id_ed25519", ".npmrc", "infra/prod.tfvars"] {
            assert!(is_sensitive_path(p), "{p}");
        }
        for p in [".env.example", "src/env.ts", "README.md", "keyboard.rs", "src/keys.ts"] {
            assert!(!is_sensitive_path(p), "{p}");
        }
    }
}
