//! Talking to plex.tv (the PIN sign-in, the account's servers) and to a
//! Plex Media Server, with the HTTP rules shared with Jellyfin (see
//! `media_server`): http and LAN addresses allowed for the person's own
//! server, never a redirect from a public host into the LAN, size caps and
//! timeouts. Tokens travel only in the `X-Plex-Token` header, never in a URL,
//! and a request carrying one never follows a redirect to another host.

use std::time::Duration;

use reqwest::{Method, Url};
use serde_json::Value;

use crate::media_server::{self, Header, NetError, clean, device_name};

/// Where accounts, PINs and the list of servers live.
pub const PLEX_TV: &str = "https://plex.tv";
const SMALL_LIMIT: usize = 1024 * 1024;
/// How long a server gets to answer "who are you" before another address is tried.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// More servers or addresses than any account has; stops a runaway answer.
const MAX_RESOURCES: usize = 50;
const MAX_CONNECTIONS: usize = 30;

fn platform() -> &'static str {
    if cfg!(windows) {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    }
}

/// The headers every Plex client sends: what it is (shown in the account's
/// Authorized Devices and the server's dashboard), its identifier (one per
/// connection, random), and the token once there is one.
pub fn headers<'a>(client_id: &'a str, token: Option<&'a str>) -> Vec<Header<'a>> {
    let mut list = vec![
        ("X-Plex-Product", "Orbit", false),
        ("X-Plex-Version", env!("CARGO_PKG_VERSION"), false),
        ("X-Plex-Client-Identifier", client_id, false),
        ("X-Plex-Platform", platform(), false),
        ("X-Plex-Device", platform(), false),
        ("X-Plex-Device-Name", device_name(), false),
    ];
    if let Some(token) = token {
        list.push(("X-Plex-Token", token, true));
    }
    list
}

/// Plex tokens are short and plain; anything else (which could break out of
/// a header or an mpv option) is refused.
pub fn is_token(token: &str) -> bool {
    (8..=128).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A server's `machineIdentifier` (also a resource's `clientIdentifier`).
pub fn is_server_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Who answered, for the words of an error.
#[derive(Clone, Copy)]
pub enum Who {
    Account,
    Server,
}

fn describe(err: &NetError, who: Who) -> String {
    match (who, err) {
        (_, NetError::Scheme | NetError::Header) => "err.address.invalid".into(),
        (Who::Account, NetError::Timeout) => "err.plextv.timeout".into(),
        (Who::Account, NetError::Connect) => "err.plextv.unreachable".into(),
        (Who::Account, NetError::Denied) => "err.plex.signed-out".into(),
        (Who::Account, NetError::Status(status)) => crate::user_error::coded("plextv.status", &[("status", &status.to_string())]),
        (Who::Account, _) => "err.plextv.failed".into(),
        (Who::Server, NetError::Timeout) => "err.plex.timeout".into(),
        (Who::Server, NetError::Redirect) => "err.server.redirect".into(),
        (Who::Server, NetError::Connect) => "err.plex.server-unreachable".into(),
        (Who::Server, NetError::Denied) => "err.plex.signed-out".into(),
        (Who::Server, NetError::Status(status)) => crate::user_error::coded("plex.status", &[("status", &status.to_string())]),
        (Who::Server, NetError::TooLarge) => "err.plex.invalid".into(),
        (Who::Server, _) => "err.plex.failed".into(),
    }
}

/// Sends a request, keeping why it failed (so an unreachable server can be tried at another address).
pub async fn send_raw(method: Method, url: Url, headers: &[Header<'_>], limit: usize, timeout: Duration) -> Result<media_server::Reply, NetError> {
    media_server::send(method, url, headers, None, limit, timeout).await
}

/// GETs JSON (Plex answers JSON when asked to; XML otherwise).
pub async fn get_json(method: Method, url: Url, headers: &[Header<'_>], who: Who) -> Result<Value, String> {
    let reply = send_raw(method, url, headers, media_server::JSON_LIMIT, media_server::JSON_TIMEOUT).await.map_err(|e| describe(&e, who))?;
    parse_json(&reply.body, who)
}

pub fn parse_json(body: &[u8], who: Who) -> Result<Value, String> {
    serde_json::from_slice(body).map_err(|_| match who {
        Who::Account => "err.plextv.invalid".into(),
        Who::Server => "err.plex.invalid".into(),
    })
}

pub fn error_text(err: &NetError, who: Who) -> String {
    describe(err, who)
}

/// A plex.tv address.
pub fn account_url(path: &str, query: &[(&str, &str)]) -> Result<Url, String> {
    media_server::endpoint(&Url::parse(PLEX_TV).map_err(|_| "invalid address")?, path, query)
}

/// A PIN to sign in with: Plex's page claims it once the person allows Orbit.
#[derive(Debug, PartialEq)]
pub struct Pin {
    pub id: u64,
    pub code: String,
    /// Seconds until it expires.
    pub expires_in: u64,
}

pub fn parse_pin(value: &Value) -> Result<Pin, String> {
    let bad = || "err.plextv.invalid".to_string();
    let id = value.get("id").and_then(Value::as_u64).filter(|id| *id > 0).ok_or_else(bad)?;
    let code = value.get("code").and_then(Value::as_str).filter(|c| (1..=64).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_alphanumeric())).ok_or_else(bad)?;
    // Plex gives strong PINs 30 minutes; waiting is capped at 15 either way.
    let expires_in = value.get("expiresIn").and_then(Value::as_u64).unwrap_or(900).clamp(60, 900);
    Ok(Pin { id, code: code.to_string(), expires_in })
}

/// The account token once the person has allowed Orbit; None while waiting.
pub fn pin_token(value: &Value) -> Result<Option<String>, String> {
    match value.get("authToken") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(t)) if t.is_empty() => Ok(None),
        Some(Value::String(t)) if is_token(t) => Ok(Some(t.clone())),
        _ => Err("err.plextv.invalid".into()),
    }
}

/// Plex's sign-in page for a PIN, opened in the person's browser. The code
/// and Orbit's identifier go in the fragment (as Plex's page expects), which
/// browsers don't send to the server; neither is a token: the token is only
/// ever handed to this identifier, by plex.tv, when Orbit asks for the PIN.
pub fn auth_page(client_id: &str, code: &str) -> Result<Url, String> {
    let plain = |s: &str| s.bytes().all(|b| b.is_ascii_alphanumeric());
    if !plain(client_id) || !plain(code) {
        return Err("invalid sign-in".into());
    }
    Url::parse(&format!("https://app.plex.tv/auth#?clientID={client_id}&code={code}&context%5Bdevice%5D%5Bproduct%5D=Orbit")).map_err(|_| "invalid sign-in".into())
}

/// The account's name, for "Connected as …".
pub fn user_name(value: &Value) -> String {
    ["username", "title", "friendlyName"]
        .iter()
        .find_map(|k| value.get(*k).and_then(Value::as_str).map(|n| clean(n, 80)).filter(|n| !n.is_empty()))
        .unwrap_or_else(|| "Plex".into())
}

/// A Plex Media Server the account can use.
pub struct Resource {
    pub id: String,
    pub name: String,
    /// The person's own (not one shared with them).
    pub owned: bool,
    /// This server's token for the account.
    pub token: String,
    /// Its addresses, best first (see `rank`).
    pub connections: Vec<Url>,
}

impl Drop for Resource {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.token);
    }
}

/// Which address to try first: on this network before over the internet, a
/// direct connection before Plex's relay (slow and capped), https before http.
fn rank(local: bool, relay: bool, https: bool) -> u8 {
    u8::from(relay) * 4 + u8::from(!local) * 2 + u8::from(!https)
}

/// A server address as plex.tv lists it: http(s), a host and port, no path.
fn connection(value: &Value) -> Option<(u8, Url)> {
    let url = media_server::parse_server(value.get("uri")?.as_str()?).ok()?;
    if url.path() != "/" && !url.path().is_empty() {
        return None;
    }
    let flag = |k: &str| value.get(k).and_then(Value::as_bool).unwrap_or(false);
    Some((rank(flag("local"), flag("relay"), url.scheme() == "https"), url))
}

/// The servers in plex.tv's `/api/v2/resources` answer, each checked on its
/// own (one that doesn't fit is left out), with their addresses ranked.
pub fn parse_resources(value: &Value) -> Vec<Resource> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_RESOURCES)
        .filter_map(|r| {
            let provides = r.get("provides").and_then(Value::as_str)?;
            if !provides.split(',').any(|p| p.trim() == "server") {
                return None;
            }
            let id = r.get("clientIdentifier").and_then(Value::as_str).filter(|id| is_server_id(id))?;
            let token = r.get("accessToken").and_then(Value::as_str).filter(|t| is_token(t))?;
            let mut connections: Vec<(u8, Url)> = r.get("connections").and_then(Value::as_array).into_iter().flatten().take(MAX_CONNECTIONS).filter_map(connection).collect();
            connections.sort_by_key(|(rank, _)| *rank);
            let mut seen = std::collections::HashSet::new();
            let connections: Vec<Url> = connections.into_iter().map(|(_, u)| u).filter(|u| seen.insert(u.to_string())).collect();
            if connections.is_empty() {
                return None;
            }
            let name = r.get("name").and_then(Value::as_str).map(|n| clean(n, 80)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Plex Media Server".into());
            Some(Resource { id: id.to_string(), name, owned: r.get("owned").and_then(Value::as_bool).unwrap_or(false), token: token.to_string(), connections })
        })
        .collect()
}

/// The `machineIdentifier` a server's `/identity` gives.
pub fn identity_of(value: &Value) -> Option<&str> {
    value.get("MediaContainer")?.get("machineIdentifier")?.as_str()
}

/// Asks `url` who it is, without any token: only an address that answers
/// as `server_id` is ever sent one. No redirect is followed, so the answer is
/// from `url` itself (and a public address can't hand the check to the LAN).
async fn probe(url: Url, server_id: String, client_id: String) -> bool {
    let Ok(identity) = media_server::endpoint(&url, "/identity", &[]) else { return false };
    let Ok(reply) = media_server::probe(identity, &headers(&client_id, None), 64 * 1024, PROBE_TIMEOUT).await else { return false };
    serde_json::from_slice::<Value>(&reply.body).ok().is_some_and(|v| identity_of(&v) == Some(server_id.as_str()))
}

/// The best of `connections` (in their order) that answers as the server, tried all at once.
pub async fn reachable(connections: &[Url], server_id: &str, client_id: &str) -> Option<Url> {
    let mut tries = tokio::task::JoinSet::new();
    for (i, url) in connections.iter().enumerate() {
        let (url, server_id, client_id) = (url.clone(), server_id.to_string(), client_id.to_string());
        tries.spawn(async move { (i, probe(url, server_id, client_id).await) });
    }
    let mut best: Option<usize> = None;
    while let Some(done) = tries.join_next().await {
        if let Ok((i, true)) = done {
            best = Some(best.map_or(i, |b| b.min(i)));
            // The first choice answered: no need to wait for the rest.
            if i == 0 {
                break;
            }
        }
    }
    best.and_then(|i| connections.get(i).cloned())
}

/// The account's servers, from plex.tv.
pub async fn resources(account_token: &str, client_id: &str) -> Result<Vec<Resource>, String> {
    let url = account_url("/api/v2/resources", &[("includeHttps", "1"), ("includeRelay", "1")])?;
    let value = get_json(Method::GET, url, &headers(client_id, Some(account_token)), Who::Account).await?;
    Ok(parse_resources(&value))
}

/// Reads at most `SMALL_LIMIT` bytes of JSON from plex.tv.
pub async fn account_json(method: Method, url: Url, client_id: &str, token: Option<&str>) -> Result<Value, String> {
    let reply = send_raw(method, url, &headers(client_id, token), SMALL_LIMIT, media_server::JSON_TIMEOUT).await.map_err(|e| describe(&e, Who::Account))?;
    parse_json(&reply.body, Who::Account)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_address_that_redirects_its_identity_check_is_not_the_server() {
        let identity = r#"{"MediaContainer":{"machineIdentifier":"abc"}}"#;
        let found = |url: Url| tauri::async_runtime::block_on(reachable(std::slice::from_ref(&url), "abc", "client")).is_some();
        assert!(found(media_server::test_server(false, identity)));
        assert!(!found(media_server::test_server(true, identity)));
    }

    #[test]
    fn headers_name_orbit_and_carry_the_token_only_when_given() {
        let anonymous = headers("abc123", None);
        assert!(anonymous.contains(&("X-Plex-Product", "Orbit", false)));
        assert!(anonymous.contains(&("X-Plex-Client-Identifier", "abc123", false)));
        assert!(anonymous.iter().all(|(name, _, _)| *name != "X-Plex-Token"));
        let signed_in = headers("abc123", Some("tok"));
        // The token is marked secret.
        assert!(signed_in.contains(&("X-Plex-Token", "tok", true)));
        assert!(signed_in.iter().all(|(name, _, secret)| *secret == (*name == "X-Plex-Token")));
    }

    #[test]
    fn pins_are_read_and_checked() {
        let pin = parse_pin(&json!({ "id": 123, "code": "abcd1234efgh", "expiresIn": 1800, "authToken": null })).unwrap();
        assert_eq!(pin, Pin { id: 123, code: "abcd1234efgh".into(), expires_in: 900 });
        assert!(parse_pin(&json!({ "id": 123, "code": "ab&cd" })).is_err());
        assert!(parse_pin(&json!({ "code": "abcd" })).is_err());
        assert_eq!(pin_token(&json!({ "authToken": null })).unwrap(), None);
        assert_eq!(pin_token(&json!({})).unwrap(), None);
        assert_eq!(pin_token(&json!({ "authToken": "AbCdEf123456_-xyz" })).unwrap().as_deref(), Some("AbCdEf123456_-xyz"));
        // A token that could break out of a header or an mpv option is refused.
        assert!(pin_token(&json!({ "authToken": "abc\r\nX-Evil: 1" })).is_err());
        assert!(pin_token(&json!({ "authToken": "abcdefgh,ijk" })).is_err());
    }

    #[test]
    fn the_sign_in_page_is_plex_and_holds_no_token() {
        let page = auth_page("0123abcd", "pin42").unwrap();
        assert_eq!(page.host_str(), Some("app.plex.tv"));
        assert_eq!(page.scheme(), "https");
        assert!(page.query().is_none());
        assert!(page.fragment().unwrap().contains("clientID=0123abcd&code=pin42"));
        assert!(auth_page("0123abcd", "x&forwardUrl=https://evil").is_err());
    }

    fn resource(extra: Value) -> Value {
        let mut base = json!({
            "name": "Den\u{0}", "provides": "server", "clientIdentifier": "0123456789abcdef0123456789abcdef01234567",
            "owned": true, "accessToken": "srvTOKEN123456",
            "connections": [
                { "protocol": "https", "uri": "https://1-2-3-4.abc.plex.direct:32400", "local": false, "relay": false },
                { "protocol": "https", "uri": "https://5-6-7-8.abc.plex.direct:8443", "local": false, "relay": true },
                { "protocol": "http", "uri": "http://192.168.1.5:32400", "local": true, "relay": false },
                { "protocol": "https", "uri": "https://192-168-1-5.abc.plex.direct:32400", "local": true, "relay": false },
                { "protocol": "http", "uri": "http://user:pw@10.0.0.1:32400", "local": true },
                { "protocol": "http", "uri": "http://10.0.0.1:32400/web?x=1", "local": true },
                { "uri": "file:///etc/passwd", "local": true }
            ]
        });
        if let (Some(b), Value::Object(e)) = (base.as_object_mut(), extra) {
            b.extend(e);
        }
        base
    }

    #[test]
    fn servers_and_their_addresses_best_first() {
        let list = parse_resources(&json!([resource(json!({})), { "provides": "client,player", "clientIdentifier": "x", "accessToken": "abcdefgh12" }, 5]));
        assert_eq!(list.len(), 1);
        let den = &list[0];
        assert_eq!((den.name.as_str(), den.owned, den.token.as_str()), ("Den", true, "srvTOKEN123456"));
        let order: Vec<String> = den.connections.iter().map(ToString::to_string).collect();
        assert_eq!(
            order,
            ["https://192-168-1-5.abc.plex.direct:32400/", "http://192.168.1.5:32400/", "https://1-2-3-4.abc.plex.direct:32400/", "https://5-6-7-8.abc.plex.direct:8443/"]
        );
        // A server whose token or id doesn't fit is left out.
        assert!(parse_resources(&json!([resource(json!({ "accessToken": "a b" }))])).is_empty());
        assert!(parse_resources(&json!([resource(json!({ "clientIdentifier": "../x" }))])).is_empty());
        assert!(parse_resources(&json!([resource(json!({ "connections": [] }))])).is_empty());
        assert!(parse_resources(&json!({ "not": "a list" })).is_empty());
    }

    #[test]
    fn identity_and_names() {
        assert_eq!(identity_of(&json!({ "MediaContainer": { "machineIdentifier": "abc" } })), Some("abc"));
        assert_eq!(identity_of(&json!({ "machineIdentifier": "abc" })), None);
        assert_eq!(user_name(&json!({ "username": "sam\u{7}", "title": "Sam" })), "sam");
        assert_eq!(user_name(&json!({ "title": "Sam" })), "Sam");
        assert_eq!(user_name(&json!({})), "Plex");
    }
}
