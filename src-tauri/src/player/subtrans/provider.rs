//! The translation services: OpenAI, Google Gemini, Anthropic Claude, or a
//! model server on this PC (LM Studio, Ollama, anything that speaks OpenAI's
//! chat API).
//!
//! Where subtitle text and keys may go is fixed here, not by the page: the
//! three cloud services' own https hosts, built from constants, or a local
//! server at 127.0.0.1 / localhost / ::1 on a port the person chose. Any
//! other address (another machine, a hostname that merely resolves to this
//! one) is refused, so neither the text nor a key can be sent anywhere the
//! person didn't pick. Redirects are never followed, for the same reason.
//!
//! Keys travel only as a header (`Authorization: Bearer` for OpenAI-style
//! servers, `x-goog-api-key` for Gemini, `x-api-key` for Claude), marked sensitive, and never in an
//! address. reqwest's errors include the request address, so they're
//! reduced to a kind here and never formatted. Answers are size-capped and
//! every request has a timeout.

use std::sync::LazyLock;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, HeaderValue};
use reqwest::{Client, Method, Url, redirect};
use serde_json::{Value, json};
use zeroize::Zeroize;

const OPENAI_BASE: &str = "https://api.openai.com/v1/";
const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/";
const ANTHROPIC_BASE: &str = "https://api.anthropic.com/v1/";
/// The Messages API version Orbit's requests and answers are written for.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Room for a batch's answer plus the model's (low-effort) thinking, which counts against it.
const ANTHROPIC_MAX_TOKENS: u32 = 16_000;
/// A batch's answer is a few kilobytes; model lists are larger but bounded.
const ANSWER_LIMIT: usize = 4 * 1024 * 1024;
const LIST_TIMEOUT: Duration = Duration::from_secs(15);
const CLOUD_TIMEOUT: Duration = Duration::from_secs(120);
/// A local model on a modest PC (and one that reasons first) can take minutes per batch.
const LOCAL_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_MODELS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Local,
    OpenAi,
    Gemini,
    Claude,
}

impl Provider {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "local" => Some(Self::Local),
            "openai" => Some(Self::OpenAi),
            "gemini" => Some(Self::Gemini),
            "claude" => Some(Self::Claude),
            _ => None,
        }
    }

    pub const fn key(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
            Self::Claude => "claude",
        }
    }

    /// The cloud services need the person's key; a local server doesn't.
    pub const fn needs_key(self) -> bool {
        !matches!(self, Self::Local)
    }
}

/// Why a request failed. Holds no address, key or body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fail {
    /// 401/403: the key was refused.
    Denied,
    NoKey,
    RateLimited,
    /// 529: the service is overloaded for everyone just now (Claude).
    Overloaded,
    /// The local address isn't on this PC (or isn't an address).
    NotLocal,
    /// The model name has characters a model name doesn't, or the service doesn't know it (404).
    BadModel,
    /// 400: the service refused the request as sent.
    Rejected,
    Status(u16),
    Timeout,
    /// Nothing answered (a local server that isn't running, no internet).
    Unreachable,
    TooLarge,
    /// An answer that isn't what the service's API returns.
    BadAnswer,
    /// The model stopped at its output limit before finishing.
    Truncated,
    /// The service declined to translate (a safety filter).
    Refused,
}

impl Fail {
    /// What the page shows a message for.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Denied => "denied",
            Self::NoKey => "no-key",
            Self::RateLimited => "rate-limited",
            Self::Overloaded => "overloaded",
            Self::NotLocal => "not-local",
            Self::BadModel => "bad-model",
            Self::Rejected => "rejected",
            Self::Status(_) => "server-error",
            Self::Timeout => "timeout",
            Self::Unreachable => "unreachable",
            Self::TooLarge | Self::BadAnswer | Self::Truncated => "bad-answer",
            Self::Refused => "refused",
        }
    }

    /// Every other batch would fail the same way: the translation stops instead of retrying each.
    pub const fn stops_everything(self) -> bool {
        matches!(self, Self::Denied | Self::NoKey | Self::RateLimited | Self::Overloaded | Self::NotLocal | Self::BadModel | Self::Unreachable)
    }
}

/// An API key, wiped from memory when dropped and never printed.
pub struct Key(String);

impl Key {
    pub fn new(key: String) -> Self {
        Self(key)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Shape {
    /// OpenAI's chat completions (OpenAI, LM Studio, Ollama…).
    OpenAi,
    /// Gemini's generateContent.
    Gemini,
    /// Anthropic's Messages API.
    Anthropic,
}

/// Where requests go: one of the fixed hosts, or a checked local server.
#[derive(Debug, Clone)]
pub struct Endpoint {
    shape: Shape,
    base: Url,
    local: bool,
}

impl Endpoint {
    /// `server` is used only for the local provider (its address, e.g. `http://127.0.0.1:1234/v1`).
    pub fn new(provider: Provider, server: &str) -> Result<Self, Fail> {
        let fixed = |base: &str, shape| Url::parse(base).map(|base| Self { shape, base, local: false }).map_err(|_| Fail::BadAnswer);
        match provider {
            Provider::OpenAi => fixed(OPENAI_BASE, Shape::OpenAi),
            Provider::Gemini => fixed(GEMINI_BASE, Shape::Gemini),
            Provider::Claude => fixed(ANTHROPIC_BASE, Shape::Anthropic),
            Provider::Local => Ok(Self { shape: Shape::OpenAi, base: local_base(server)?, local: true }),
        }
    }

    pub const fn is_local(&self) -> bool {
        self.local
    }

    /// A stand-in server on this PC answering as `gemini` or OpenAI would (tests only).
    #[cfg(test)]
    pub fn mock(gemini: bool, port: u16) -> Self {
        Self { shape: if gemini { Shape::Gemini } else { Shape::OpenAi }, base: Url::parse(&format!("http://127.0.0.1:{port}/v1/")).unwrap(), local: true }
    }

    /// A stand-in server on this PC answering as Anthropic's Messages API would (tests only).
    #[cfg(test)]
    pub fn mock_claude(port: u16) -> Self {
        Self { shape: Shape::Anthropic, base: Url::parse(&format!("http://127.0.0.1:{port}/v1/")).unwrap(), local: true }
    }
}

/// A local server's base address, rebuilt from its checked parts: http(s)
/// on 127.0.0.1, ::1 or localhost (taken as 127.0.0.1, so a hosts-file
/// entry can't point it elsewhere), any port, path `/v1` or none.
pub fn local_base(text: &str) -> Result<Url, Fail> {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 {
        return Err(Fail::NotLocal);
    }
    let url = Url::parse(text).map_err(|_| Fail::NotLocal)?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(Fail::NotLocal);
    }
    // The url crate writes IPv4 in its plain form (`127.1` is `127.0.0.1`), IPv6 in brackets, names in lower case.
    let host = match url.host_str() {
        Some("127.0.0.1" | "localhost") => "127.0.0.1",
        Some("[::1]") => "[::1]",
        _ => return Err(Fail::NotLocal),
    };
    let path = url.path().trim_end_matches('/');
    if !(path.is_empty() || path == "/v1") {
        return Err(Fail::NotLocal);
    }
    let port = url.port_or_known_default().ok_or(Fail::NotLocal)?;
    Url::parse(&format!("{}://{host}:{port}/v1/", url.scheme())).map_err(|_| Fail::NotLocal)
}

/// Model names as the services spell them (`gpt-…`, `openai/gpt-oss-20b`, `llama3:8b`). Gemini's
/// goes into the request path, so it may hold neither `/` nor `:`; Claude's (`claude-haiku-5-5`) never do.
fn check_model(model: &str, shape: Shape) -> Result<(), Fail> {
    let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') || (shape == Shape::OpenAi && matches!(c, ':' | '/' | '@'));
    if model.is_empty() || model.len() > 128 || !model.chars().all(allowed) || model.contains("..") {
        return Err(Fail::BadModel);
    }
    Ok(())
}

fn builder() -> reqwest::ClientBuilder {
    Client::builder().user_agent(concat!("Orbit/", env!("CARGO_PKG_VERSION"))).connect_timeout(Duration::from_secs(10)).referer(false).redirect(redirect::Policy::none())
}

static CLOUD: LazyLock<Option<Client>> = LazyLock::new(|| builder().https_only(true).build().ok());
/// A local server is reached directly, never through a system proxy.
static LOCAL: LazyLock<Option<Client>> = LazyLock::new(|| builder().no_proxy().build().ok());

async fn send(endpoint: &Endpoint, method: Method, path: &str, key: Option<&Key>, body: Option<&Value>, timeout: Duration) -> Result<Value, Fail> {
    let url = endpoint.base.join(path).map_err(|_| Fail::BadModel)?;
    // The path is built here from constants and a checked model name; this only makes sure.
    if url.host() != endpoint.base.host() || url.port_or_known_default() != endpoint.base.port_or_known_default() || !url.path().starts_with(endpoint.base.path()) {
        return Err(Fail::BadModel);
    }
    let client = if endpoint.local { LOCAL.as_ref() } else { CLOUD.as_ref() }.ok_or(Fail::Unreachable)?;
    let mut request = client.request(method, url).timeout(timeout).header("Accept", "application/json");
    if let Some(Key(key)) = key {
        let (name, mut value) = match endpoint.shape {
            Shape::OpenAi => (AUTHORIZATION.as_str(), format!("Bearer {key}")),
            Shape::Gemini => ("x-goog-api-key", key.clone()),
            Shape::Anthropic => ("x-api-key", key.clone()),
        };
        let header = HeaderValue::from_str(&value).map_err(|_| Fail::Denied);
        value.zeroize();
        let mut header = header?;
        header.set_sensitive(true);
        request = request.header(name, header);
    }
    if endpoint.shape == Shape::Anthropic {
        request = request.header("anthropic-version", ANTHROPIC_VERSION);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let mut response = request.send().await.map_err(|e| if e.is_timeout() { Fail::Timeout } else { Fail::Unreachable })?;
    match response.status().as_u16() {
        401 | 403 => return Err(Fail::Denied),
        404 => return Err(Fail::BadModel),
        429 => return Err(Fail::RateLimited),
        529 => return Err(Fail::Overloaded),
        400 | 422 => return Err(Fail::Rejected),
        status if !response.status().is_success() => return Err(Fail::Status(status)),
        _ => {}
    }
    if response.content_length().is_some_and(|len| len > ANSWER_LIMIT as u64) {
        return Err(Fail::TooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| if e.is_timeout() { Fail::Timeout } else { Fail::Unreachable })? {
        if bytes.len() + chunk.len() > ANSWER_LIMIT {
            return Err(Fail::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| Fail::BadAnswer)
}

/// The models the service offers (also a test of the connection and the key).
pub async fn models(endpoint: &Endpoint, key: Option<&Key>) -> Result<Vec<String>, Fail> {
    let mut names: Vec<String> = match endpoint.shape {
        Shape::OpenAi => {
            let answer = send(endpoint, Method::GET, "models", key, None, LIST_TIMEOUT).await?;
            let list = answer.get("data").and_then(Value::as_array).ok_or(Fail::BadAnswer)?;
            list.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).map(str::to_string).collect()
        }
        Shape::Gemini => {
            let answer = send(endpoint, Method::GET, "models?pageSize=1000", key, None, LIST_TIMEOUT).await?;
            let list = answer.get("models").and_then(Value::as_array).ok_or(Fail::BadAnswer)?;
            list.iter()
                .filter(|m| m.get("supportedGenerationMethods").and_then(Value::as_array).is_some_and(|ways| ways.iter().any(|w| w == "generateContent")))
                .filter_map(|m| m.get("name").and_then(Value::as_str))
                .map(|name| name.trim_start_matches("models/").to_string())
                .collect()
        }
        Shape::Anthropic => {
            // One page of up to 1000 models covers Anthropic's whole line-up.
            let answer = send(endpoint, Method::GET, "models?limit=1000", key, None, LIST_TIMEOUT).await?;
            let list = answer.get("data").and_then(Value::as_array).ok_or(Fail::BadAnswer)?;
            list.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).map(str::to_string).collect()
        }
    };
    names.retain(|name| check_model(name, endpoint.shape).is_ok());
    names.sort();
    names.dedup();
    names.truncate(MAX_MODELS);
    Ok(names)
}

/// Structured output: the reply must be `{"lines": [{"id", "text"}]}`.
fn schema() -> Value {
    json!({
        "type": "object",
        "properties": { "lines": { "type": "array", "items": {
            "type": "object",
            "properties": { "id": { "type": "integer" }, "text": { "type": "string" } },
            "required": ["id", "text"],
            "additionalProperties": false
        } } },
        "required": ["lines"],
        "additionalProperties": false
    })
}

/// Gemini's dialect of the same schema (no `additionalProperties`).
fn gemini_schema() -> Value {
    json!({
        "type": "OBJECT",
        "properties": { "lines": { "type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": { "id": { "type": "INTEGER" }, "text": { "type": "STRING" } },
            "required": ["id", "text"]
        } } },
        "required": ["lines"]
    })
}

/// Asks the model once; its answer's text (still to be checked by the caller).
pub async fn complete(endpoint: &Endpoint, key: Option<&Key>, model: &str, system: &str, user: &str) -> Result<String, Fail> {
    check_model(model, endpoint.shape)?;
    let timeout = if endpoint.local { LOCAL_TIMEOUT } else { CLOUD_TIMEOUT };
    match endpoint.shape {
        Shape::OpenAi => {
            let mut body = json!({
                "model": model,
                "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
                "response_format": { "type": "json_schema", "json_schema": { "name": "subtitles", "strict": true, "schema": schema() } },
            });
            // Reasoning models on OpenAI accept only their default temperature; local ones translate steadier when it's low.
            if endpoint.local {
                body["temperature"] = json!(0.2);
            }
            let answer = match send(endpoint, Method::POST, "chat/completions", key, Some(&body), timeout).await {
                // Some servers and models don't take structured output: the reply is checked either way.
                Err(Fail::Rejected) => {
                    if let Some(fields) = body.as_object_mut() {
                        fields.remove("response_format");
                    }
                    send(endpoint, Method::POST, "chat/completions", key, Some(&body), timeout).await?
                }
                other => other?,
            };
            openai_text(&answer)
        }
        Shape::Gemini => {
            let body = json!({
                "systemInstruction": { "parts": [{ "text": system }] },
                "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                "generationConfig": { "responseMimeType": "application/json", "responseSchema": gemini_schema(), "temperature": 0.2 },
            });
            let answer = send(endpoint, Method::POST, &format!("models/{model}:generateContent"), key, Some(&body), timeout).await?;
            gemini_text(&answer)
        }
        Shape::Anthropic => {
            let answer = send(endpoint, Method::POST, "messages", key, Some(&anthropic_body(model, system, user)), timeout).await?;
            anthropic_text(&answer)
        }
    }
}

/// A Messages API request. Effort is low on every request: current Claude models think
/// adaptively by default and that thinking bills as output, while translating needs little of it.
/// Thinking isn't switched off instead: Haiku 5.5 and Sonnet 5.5 refuse a thinking budget, and
/// `disabled` too in the cases that matter, so effort is the one control that works on both.
fn anthropic_body(model: &str, system: &str, user: &str) -> Value {
    json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
        "output_config": { "effort": "low", "format": { "type": "json_schema", "schema": schema() } },
    })
}

/// `choices[0].message.content`; a model's reasoning (`reasoning`, `reasoning_content`) is ignored.
fn openai_text(answer: &Value) -> Result<String, Fail> {
    let choice = answer.get("choices").and_then(|c| c.get(0)).ok_or(Fail::BadAnswer)?;
    if choice.get("finish_reason").and_then(Value::as_str) == Some("length") {
        return Err(Fail::Truncated);
    }
    if choice.get("finish_reason").and_then(Value::as_str) == Some("content_filter") {
        return Err(Fail::Refused);
    }
    choice.pointer("/message/content").and_then(Value::as_str).filter(|t| !t.trim().is_empty()).map(str::to_string).ok_or(Fail::BadAnswer)
}

/// The first candidate's text parts (not its thoughts), joined.
fn gemini_text(answer: &Value) -> Result<String, Fail> {
    if answer.pointer("/promptFeedback/blockReason").is_some() {
        return Err(Fail::Refused);
    }
    let candidate = answer.get("candidates").and_then(|c| c.get(0)).ok_or(Fail::BadAnswer)?;
    match candidate.get("finishReason").and_then(Value::as_str) {
        Some("MAX_TOKENS") => return Err(Fail::Truncated),
        Some("SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "RECITATION" | "SPII") => return Err(Fail::Refused),
        _ => {}
    }
    let parts = candidate.pointer("/content/parts").and_then(Value::as_array).ok_or(Fail::BadAnswer)?;
    let text: String = parts.iter().filter(|p| p.get("thought").and_then(Value::as_bool) != Some(true)).filter_map(|p| p.get("text").and_then(Value::as_str)).collect();
    if text.trim().is_empty() { Err(Fail::BadAnswer) } else { Ok(text) }
}

/// The answer's text blocks, joined; its thinking blocks are ignored.
fn anthropic_text(answer: &Value) -> Result<String, Fail> {
    match answer.get("stop_reason").and_then(Value::as_str) {
        Some("max_tokens") => return Err(Fail::Truncated),
        Some("refusal") => return Err(Fail::Refused),
        _ => {}
    }
    let blocks = answer.get("content").and_then(Value::as_array).ok_or(Fail::BadAnswer)?;
    let text: String = blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect();
    if text.trim().is_empty() { Err(Fail::BadAnswer) } else { Ok(text) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_servers_must_be_on_this_pc() {
        let ok = |text: &str| local_base(text).map(|u| u.to_string());
        assert_eq!(ok("http://127.0.0.1:1234/v1").unwrap(), "http://127.0.0.1:1234/v1/");
        assert_eq!(ok("http://localhost:11434/v1/").unwrap(), "http://127.0.0.1:11434/v1/");
        assert_eq!(ok("http://LOCALHOST:8080").unwrap(), "http://127.0.0.1:8080/v1/");
        assert_eq!(ok("http://[::1]:1234/v1").unwrap(), "http://[::1]:1234/v1/");
        for remote in [
            "http://192.168.1.20:1234/v1",
            "http://10.0.0.1:1234/v1",
            "https://api.example.com/v1",
            "http://127.0.0.2:1234/v1",
            "http://0.0.0.0:1234/v1",
            "http://localhost.example.com:1234/v1",
            "http://127.0.0.1.nip.io:1234/v1",
            "http://user:pass@127.0.0.1:1234/v1",
            "http://evil.com@127.0.0.1:1234/v1/x",
            "http://127.0.0.1:1234/v1?u=https://evil.com",
            "http://127.0.0.1:1234/other",
            "file:///C:/models",
            "ftp://127.0.0.1/v1",
            "127.0.0.1:1234",
            "",
        ] {
            assert_eq!(ok(remote), Err(Fail::NotLocal), "{remote}");
        }
    }

    #[test]
    fn cloud_providers_use_only_their_own_hosts() {
        // The local address is ignored for the cloud services.
        let openai = Endpoint::new(Provider::OpenAi, "http://evil.example").unwrap();
        assert_eq!(openai.base.as_str(), OPENAI_BASE);
        assert!(!openai.is_local());
        assert_eq!(Endpoint::new(Provider::Gemini, "").unwrap().base.as_str(), GEMINI_BASE);
        let claude = Endpoint::new(Provider::Claude, "http://evil.example").unwrap();
        assert_eq!(claude.base.as_str(), "https://api.anthropic.com/v1/");
        assert!(!claude.is_local());
        assert_eq!(Provider::parse("claude"), Some(Provider::Claude));
        assert!(Provider::Claude.needs_key());
        assert_eq!(Endpoint::new(Provider::Local, "https://api.openai.com/v1").unwrap_err(), Fail::NotLocal);
    }

    #[test]
    fn model_names_cant_change_the_address() {
        assert!(check_model("gpt-4.1-mini", Shape::OpenAi).is_ok());
        assert!(check_model("openai/gpt-oss-20b", Shape::OpenAi).is_ok());
        assert!(check_model("llama3:8b", Shape::OpenAi).is_ok());
        assert!(check_model("gemini-2.5-flash", Shape::Gemini).is_ok());
        assert!(check_model("claude-haiku-5-5", Shape::Anthropic).is_ok());
        assert!(check_model("claude-sonnet-5-5", Shape::Anthropic).is_ok());
        assert!(check_model("x/y", Shape::Anthropic).is_err());
        for bad in ["", "a b", "../../x", "x?key=1", "x#y", "x/y", "x:streamGenerateContent"] {
            assert!(check_model(bad, Shape::Gemini).is_err(), "{bad}");
        }
        assert!(check_model("a\nb", Shape::OpenAi).is_err());
        assert!(check_model(&"a".repeat(129), Shape::OpenAi).is_err());
    }

    #[test]
    fn answers_are_read_in_each_shape() {
        let openai = json!({"choices":[{"finish_reason":"stop","message":{"content":"{\"lines\":[]}","reasoning":"thinking…"}}]});
        assert_eq!(openai_text(&openai).unwrap(), "{\"lines\":[]}");
        assert_eq!(openai_text(&json!({"choices":[{"finish_reason":"length","message":{"content":"{\"li"}}]})), Err(Fail::Truncated));
        assert_eq!(openai_text(&json!({"error":"x"})), Err(Fail::BadAnswer));
        let gemini = json!({"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"hmm","thought":true},{"text":"{\"lines\":"},{"text":"[]}"}]}}]});
        assert_eq!(gemini_text(&gemini).unwrap(), "{\"lines\":[]}");
        assert_eq!(gemini_text(&json!({"promptFeedback":{"blockReason":"SAFETY"}})), Err(Fail::Refused));
        assert_eq!(gemini_text(&json!({"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[]}}]})), Err(Fail::Truncated));
        let claude = json!({"type":"message","stop_reason":"end_turn","content":[{"type":"thinking","thinking":"","signature":"x"},{"type":"text","text":"{\"lines\":"},{"type":"text","text":"[]}"}]});
        assert_eq!(anthropic_text(&claude).unwrap(), "{\"lines\":[]}");
        assert_eq!(anthropic_text(&json!({"stop_reason":"max_tokens","content":[{"type":"text","text":"{\"li"}]})), Err(Fail::Truncated));
        assert_eq!(anthropic_text(&json!({"stop_reason":"refusal","content":[]})), Err(Fail::Refused));
        assert_eq!(anthropic_text(&json!({"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""}]})), Err(Fail::BadAnswer));
        assert_eq!(anthropic_text(&json!({"type":"error","error":{"type":"overloaded_error"}})), Err(Fail::BadAnswer));
    }

    #[test]
    fn claude_requests_ask_for_low_effort_and_structured_lines() {
        let body = anthropic_body("claude-haiku-5-5", "sys", "usr");
        assert_eq!(body["model"], "claude-haiku-5-5");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["system"], "sys");
        assert_eq!(body["messages"], json!([{ "role": "user", "content": "usr" }]));
        // Neither a disabled-thinking switch nor a thinking budget (both refused by current models).
        assert!(body.get("thinking").is_none());
        assert!(!body.to_string().contains("budget_tokens"));
    }
}
