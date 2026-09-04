use anyhow::{bail, Result};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{SecondsFormat, TimeZone, Utc};
use hmac::{Hmac, Mac};
use remote_codex_protocol::{ApiError, AuthSessionDto, Mode};
use remote_codex_runtime::{RuntimeConfig, Supervisor};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::sync::Arc;
use uuid::Uuid;

const AUTH_COOKIE_NAME: &str = "remote_codex_session";
const RELAY_FORWARD_HEADER: &str = "x-remote-codex-relay-forwarded";
const DEFAULT_SESSION_TTL_SECONDS: i64 = 60 * 60 * 24 * 7;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPayload {
    username: String,
    expires_at: i64,
    nonce: String,
}

pub fn validate_config(config: &RuntimeConfig) -> Result<()> {
    if !config.auth_required {
        return Ok(());
    }
    if config
        .admin_username
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        bail!(
            "{} mode requires REMOTE_CODEX_ADMIN_USERNAME",
            mode_name(config.mode)
        );
    }
    if config
        .admin_password
        .as_deref()
        .is_none_or(|value| value.is_empty())
    {
        bail!(
            "{} mode requires REMOTE_CODEX_ADMIN_PASSWORD",
            mode_name(config.mode)
        );
    }
    if config
        .session_secret
        .as_deref()
        .is_none_or(|value| value.len() < 16)
    {
        bail!(
            "{} mode requires REMOTE_CODEX_SESSION_SECRET with at least 16 characters",
            mode_name(config.mode)
        );
    }
    Ok(())
}

pub async fn require_auth(
    State(state): State<Arc<Supervisor>>,
    request: Request,
    next: Next,
) -> Response {
    if !state.config.auth_required || is_public_path(request.uri().path()) {
        return next.run(request).await;
    }
    if state.config.mode == Mode::Relay
        && request
            .headers()
            .get(RELAY_FORWARD_HEADER)
            .and_then(|value| value.to_str().ok())
            == Some("1")
    {
        return next.run(request).await;
    }
    if verify_request(&state.config, request.headers(), request.uri()).authenticated {
        return next.run(request).await;
    }
    (
        axum::http::StatusCode::UNAUTHORIZED,
        Json(ApiError::new("unauthorized", "Authentication is required.")),
    )
        .into_response()
}

fn is_public_path(path: &str) -> bool {
    matches!(
        path,
        "/healthz" | "/readyz" | "/api/auth/login" | "/api/auth/logout" | "/api/auth/session"
    ) || (!path.starts_with("/api/") && path != "/ws")
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Local => "local",
        Mode::Server => "server",
        Mode::Relay => "relay",
    }
}

pub fn local_session(config: &RuntimeConfig) -> AuthSessionDto {
    AuthSessionDto {
        authenticated: true,
        username: None,
        expires_at: None,
        mode: config.mode,
        auth_required: false,
    }
}

pub fn unauthenticated_session(config: &RuntimeConfig) -> AuthSessionDto {
    AuthSessionDto {
        authenticated: false,
        username: None,
        expires_at: None,
        mode: config.mode,
        auth_required: config.auth_required,
    }
}

pub fn verify_request(config: &RuntimeConfig, headers: &HeaderMap, uri: &Uri) -> AuthSessionDto {
    if !config.auth_required {
        return local_session(config);
    }
    let token = bearer_token(headers)
        .or_else(|| query_token(uri))
        .or_else(|| cookie_token(headers));
    token
        .and_then(|token| verify_token(config, &token))
        .unwrap_or_else(|| unauthenticated_session(config))
}

pub fn login(
    config: &RuntimeConfig,
    username: &str,
    password: &str,
) -> Option<(String, AuthSessionDto)> {
    if !config.auth_required {
        return Some((String::new(), local_session(config)));
    }
    let expected_username = config.admin_username.as_deref()?;
    let expected_password = config.admin_password.as_deref()?;
    if !constant_time_equal(username.as_bytes(), expected_username.as_bytes())
        || !constant_time_equal(password.as_bytes(), expected_password.as_bytes())
    {
        return None;
    }
    let ttl_seconds = session_ttl_seconds();
    let expires_at = Utc::now().timestamp_millis() + ttl_seconds * 1000;
    let payload = SessionPayload {
        username: expected_username.to_string(),
        expires_at,
        nonce: Uuid::new_v4().simple().to_string(),
    };
    let payload_text = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).ok()?);
    let signature = sign(config.session_secret.as_deref()?, &payload_text)?;
    let token = format!("{payload_text}.{signature}");
    Some((
        token,
        AuthSessionDto {
            authenticated: true,
            username: Some(expected_username.to_string()),
            expires_at: timestamp_string(expires_at),
            mode: config.mode,
            auth_required: true,
        },
    ))
}

pub fn session_cookie(token: &str) -> String {
    format!(
        "{AUTH_COOKIE_NAME}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        session_ttl_seconds()
    )
}

pub fn clear_session_cookie() -> &'static str {
    "remote_codex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
}

fn verify_token(config: &RuntimeConfig, token: &str) -> Option<AuthSessionDto> {
    let mut parts = token.split('.');
    let payload_text = parts.next()?;
    let signature = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let expected = sign(config.session_secret.as_deref()?, payload_text)?;
    if !constant_time_equal(signature.as_bytes(), expected.as_bytes()) {
        return None;
    }
    let payload: SessionPayload =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload_text).ok()?).ok()?;
    if payload.username.is_empty()
        || payload.nonce.is_empty()
        || payload.expires_at <= Utc::now().timestamp_millis()
    {
        return None;
    }
    Some(AuthSessionDto {
        authenticated: true,
        username: Some(payload.username),
        expires_at: timestamp_string(payload.expires_at),
        mode: config.mode,
        auth_required: true,
    })
}

fn sign(secret: &str, payload_text: &str) -> Option<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload_text.as_bytes());
    Some(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    let Ok(mut mac) = HmacSha256::new_from_slice(b"remote-codex-constant-time-compare") else {
        return false;
    };
    mac.update(left);
    let expected = mac.finalize().into_bytes();
    let Ok(mut verifier) = HmacSha256::new_from_slice(b"remote-codex-constant-time-compare") else {
        return false;
    };
    verifier.update(right);
    verifier.verify_slice(&expected).is_ok()
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.trim().is_empty())
        .then(|| token.trim().to_string())
}

fn query_token(uri: &Uri) -> Option<String> {
    url::form_urlencoded::parse(uri.query()?.as_bytes()).find_map(|(key, value)| {
        (key == "token" && !value.trim().is_empty()).then(|| value.into_owned())
    })
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|entry| {
            let (name, value) = entry.trim().split_once('=')?;
            (name == AUTH_COOKIE_NAME && !value.is_empty()).then(|| value.to_string())
        })
}

fn session_ttl_seconds() -> i64 {
    std::env::var("REMOTE_CODEX_SESSION_TTL_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_SESSION_TTL_SECONDS)
}

fn timestamp_string(timestamp_millis: i64) -> Option<String> {
    Utc.timestamp_millis_opt(timestamp_millis)
        .single()
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use remote_codex_protocol::Provider;
    use std::path::PathBuf;

    fn server_config() -> RuntimeConfig {
        RuntimeConfig {
            mode: Mode::Server,
            host: "127.0.0.1".into(),
            port: 8787,
            workspace_root: PathBuf::from("/tmp"),
            database_url: PathBuf::from("/tmp/test.sqlite"),
            app_name: "test".into(),
            app_version: "0.12.0".into(),
            environment: "test".into(),
            auth_required: true,
            admin_username: Some("admin".into()),
            admin_password: Some("secret123".into()),
            session_secret: Some("0123456789abcdef".into()),
            relay_server_url: None,
            relay_agent_token: None,
            enabled_providers: vec![Provider::Codex],
            acp_command: None,
            acp_startup_timeout_ms: 1000,
            fake_runtime: true,
        }
    }

    #[test]
    fn verifies_node_0_11_hmac_session_token() {
        let token = "eyJ1c2VybmFtZSI6ImFkbWluIiwiZXhwaXJlc0F0Ijo0MTAyNDQ0ODAwMDAwLCJub25jZSI6ImxlZ2FjeS1ub2RlIn0.bosISUS4ohy_K_Ygr6Oj9zpuOaRokEQkzosjQwrgAgI";
        let session = verify_token(&server_config(), token).expect("legacy Node token");
        assert!(session.authenticated);
        assert_eq!(session.username.as_deref(), Some("admin"));
    }

    #[test]
    fn rejects_missing_server_credentials() {
        let mut config = server_config();
        config.session_secret = None;
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn signed_session_round_trips() {
        let config = server_config();
        let (token, login_session) = login(&config, "admin", "secret123").expect("login");
        assert!(login_session.authenticated);
        assert!(verify_token(&config, &token).is_some());
        assert!(login(&config, "admin", "wrong").is_none());
    }
}
