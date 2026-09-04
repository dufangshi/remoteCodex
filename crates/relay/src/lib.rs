use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path as FsPath, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::StatusCode;
use axum::http::{header, HeaderMap, Method, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, patch, post};
use axum::{Json, Router};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use remote_codex_protocol::{now_rfc3339, ApiError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

struct RelayStore {
    conn: Mutex<Connection>,
}

impl RelayStore {
    fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS devices (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              token TEXT,
              token_hash TEXT NOT NULL,
              token_preview TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS shares (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL,
              target_username TEXT NOT NULL,
              device_id TEXT NOT NULL,
              thread_id TEXT,
              workspace_id TEXT,
              thread_access TEXT NOT NULL,
              workspace_access TEXT NOT NULL,
              created_at TEXT NOT NULL,
              revoked_at TEXT
            );
            CREATE TABLE IF NOT EXISTS grants (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL,
              target_username TEXT NOT NULL,
              device_id TEXT NOT NULL,
              scope TEXT NOT NULL,
              thread_id TEXT,
              workspace_id TEXT,
              thread_access TEXT NOT NULL,
              workspace_access TEXT NOT NULL,
              can_create_threads INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              revoked_at TEXT
            );
            ",
        )?;
        let _ = conn.execute("ALTER TABLE devices ADD COLUMN token TEXT", []);
        let _ = conn.execute("ALTER TABLE devices ADD COLUMN token_preview TEXT", []);
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

struct DeviceSocket {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    connection_id: Uuid,
}

struct AppState {
    store: RelayStore,
    sockets: RwLock<HashMap<String, DeviceSocket>>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    web_dist: Option<PathBuf>,
    registration_password: Option<String>,
}

pub async fn serve() -> Result<()> {
    let data_dir =
        std::env::var("REMOTE_CODEX_RELAY_DATA_DIR").unwrap_or_else(|_| ".local/relay".into());
    let store = RelayStore::open(PathBuf::from(&data_dir).join("relay.sqlite"))?;
    let admin_username =
        std::env::var("REMOTE_CODEX_ADMIN_USERNAME").unwrap_or_else(|_| "admin".into());
    let admin_password =
        std::env::var("REMOTE_CODEX_ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
    {
        let conn = store.conn.lock().await;
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE username=?1",
                params![admin_username],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            conn.execute(
                "INSERT INTO users(id,email,username,password_hash,role,enabled,created_at) VALUES (?1,?2,?3,?4,'admin',1,?5)",
                params![
                    Uuid::new_v4().to_string(),
                    format!("{admin_username}@localhost"),
                    admin_username,
                    hash_password(&admin_password),
                    now_rfc3339()
                ],
            )?;
        }
    }
    let web_dist = std::env::var("REMOTE_CODEX_RELAY_WEB_DIST_DIR")
        .ok()
        .map(PathBuf::from);
    let registration_password = std::env::var("REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let state = Arc::new(AppState {
        store,
        sockets: RwLock::new(HashMap::new()),
        pending: Mutex::new(HashMap::new()),
        web_dist,
        registration_password,
    });
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/relay/auth/register", post(register))
        .route("/relay/auth/login", post(login))
        .route("/relay/auth/logout", post(logout))
        .route("/relay/auth/session", get(session))
        .route("/relay/portal", get(portal))
        .route("/relay/access", get(relay_access))
        .route("/relay/devices", get(list_devices).post(create_device))
        .route("/relay/devices/{device_id}", delete(delete_device))
        .route("/relay/shares", get(list_shares).post(create_share))
        .route(
            "/relay/shares/{share_id}",
            patch(update_share).delete(revoke_share),
        )
        .route("/relay/grants", get(list_grants).post(create_grant))
        .route(
            "/relay/grants/{grant_id}",
            patch(update_grant).delete(revoke_grant),
        )
        .route("/relay/devices/{device_id}/api/{*rest}", any(device_api))
        .route("/relay/devices/{device_id}/healthz", get(device_healthz))
        .route("/supervisor/tunnel", get(supervisor_tunnel))
        .route("/relay/devices/{device_id}/ws", get(client_ws))
        .route("/relay/ws", get(client_ws_compat))
        .fallback(spa_fallback)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .or_else(|| {
            std::env::var("REMOTE_CODEX_RELAY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(8788);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    tracing::info!("relay listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Deserialize, Default)]
struct TokenQuery {
    token: Option<String>,
    #[serde(rename = "deviceToken")]
    device_token: Option<String>,
    #[serde(rename = "relaySession")]
    relay_session: Option<String>,
}

impl TokenQuery {
    fn bearer(&self) -> Option<String> {
        self.token
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| self.relay_session.clone().filter(|value| !value.is_empty()))
            .or_else(|| self.device_token.clone().filter(|value| !value.is_empty()))
    }
}

#[derive(Clone)]
struct UserRow {
    id: String,
    email: String,
    username: String,
    role: String,
    enabled: i64,
    created_at: String,
}

fn user_json(user: &UserRow) -> Value {
    json!({
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "enabled": user.enabled == 1,
        "createdAt": user.created_at
    })
}

fn registration_settings() -> Value {
    json!({
        "enabled": true,
        "registrationPassword": null,
        "approvalRequired": false,
        "googleAuthEnabled": false,
        "githubAuthEnabled": false,
        "emailVerificationEnabled": false,
        "googleAuthAvailable": false,
        "githubAuthAvailable": false,
        "emailVerificationAvailable": false
    })
}

fn session_json(user: Option<&UserRow>) -> Value {
    json!({
        "authenticated": user.is_some(),
        "user": user.map(user_json),
        "registrationEnabled": true,
        "registrationSettings": registration_settings()
    })
}

fn extract_bearer(headers: &HeaderMap, query: &TokenQuery) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        let value = value.trim();
        if let Some(token) = value
            .strip_prefix("Bearer ")
            .or_else(|| value.strip_prefix("bearer "))
        {
            let token = token.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    query.bearer()
}

fn load_user_by_id(conn: &Connection, user_id: &str) -> Option<UserRow> {
    conn.query_row(
        "SELECT id, email, username, role, enabled, created_at FROM users WHERE id=?1",
        params![user_id],
        |row| {
            Ok(UserRow {
                id: row.get(0)?,
                email: row.get(1)?,
                username: row.get(2)?,
                role: row.get(3)?,
                enabled: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

fn load_user_by_session(conn: &Connection, token: &str) -> Option<UserRow> {
    conn.query_row(
        "SELECT u.id, u.email, u.username, u.role, u.enabled, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token=?1",
        params![token],
        |row| {
            Ok(UserRow {
                id: row.get(0)?,
                email: row.get(1)?,
                username: row.get(2)?,
                role: row.get(3)?,
                enabled: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
    .filter(|user| user.enabled == 1)
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "code": "unauthorized", "message": "login required" })),
    )
        .into_response()
}

fn create_session(conn: &Connection, user_id: &str) -> Result<String, rusqlite::Error> {
    let token = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO sessions(token,user_id,created_at) VALUES (?1,?2,?3)",
        params![token, user_id, now_rfc3339()],
    )?;
    Ok(token)
}

fn preview_token(token: &str) -> String {
    if token.len() <= 11 {
        return token.to_string();
    }
    format!(
        "{}...{}",
        &token[..7.min(token.len())],
        &token[token.len().saturating_sub(4)..]
    )
}

fn device_json(
    id: &str,
    owner_user_id: &str,
    name: &str,
    created_at: &str,
    connected: bool,
    token: Option<&str>,
    token_preview: Option<&str>,
) -> Value {
    json!({
        "id": id,
        "ownerUserId": owner_user_id,
        "name": name,
        "token": token,
        "tokenPreview": token_preview
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| token.map(preview_token))
            .unwrap_or_else(|| "••••".into()),
        "connected": connected,
        "connectedAt": Value::Null,
        "lastHeartbeatAt": Value::Null,
        "createdAt": created_at
    })
}

async fn healthz(State(state): State<Arc<AppState>>) -> Json<Value> {
    let connected = state.sockets.read().await.len();
    Json(json!({
        "status": "ok",
        "timestamp": now_rfc3339(),
        "connectedSupervisors": connected,
        "supervisorConnected": connected > 0,
        "supervisorCount": connected
    }))
}

#[derive(Deserialize)]
struct RegisterInput {
    email: String,
    username: String,
    password: String,
    #[serde(rename = "registrationPassword")]
    registration_password: Option<String>,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterInput>,
) -> impl IntoResponse {
    if let Some(expected) = state.registration_password.as_ref() {
        if body.registration_password.as_deref().unwrap_or_default() != expected {
            return (
                StatusCode::FORBIDDEN,
                Json(ApiError::new("forbidden", "Invalid registration password")),
            )
                .into_response();
        }
    }
    if body.username.trim().len() < 3 || body.password.len() < 8 || body.email.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("bad_request", "Invalid registration fields")),
        )
            .into_response();
    }
    let conn = state.store.conn.lock().await;
    let id = Uuid::new_v4().to_string();
    match conn.execute(
        "INSERT INTO users(id,email,username,password_hash,role,enabled,created_at) VALUES (?1,?2,?3,?4,'user',1,?5)",
        params![id, body.email.trim(), body.username.trim(), hash_password(&body.password), now_rfc3339()],
    ) {
        Ok(_) => {
            let token = match create_session(&conn, &id) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError::new("internal", "Failed to create session")),
                    )
                        .into_response();
                }
            };
            let user = load_user_by_id(&conn, &id);
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "userId": id,
                    "token": token,
                    "session": session_json(user.as_ref())
                })),
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::CONFLICT,
            Json(ApiError::new("conflict", "User already exists")),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct LoginInput {
    identifier: Option<String>,
    username: Option<String>,
    password: String,
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginInput>,
) -> impl IntoResponse {
    let ident = body.identifier.or(body.username).unwrap_or_default();
    let conn = state.store.conn.lock().await;
    let row: Option<(String, String, i64)> = conn
        .query_row(
            "SELECT id, password_hash, enabled FROM users WHERE username=?1 OR email=?1",
            params![ident],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .ok()
        .flatten();
    match row {
        Some((id, hash, enabled)) if hash == hash_password(&body.password) && enabled == 1 => {
            let token = match create_session(&conn, &id) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError::new("internal", "Failed to create session")),
                    )
                        .into_response();
                }
            };
            let user = load_user_by_id(&conn, &id);
            (
                StatusCode::OK,
                Json(json!({
                    "token": token,
                    "userId": id,
                    "session": session_json(user.as_ref())
                })),
            )
                .into_response()
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(ApiError::new("unauthorized", "Invalid credentials")),
        )
            .into_response(),
    }
}

async fn logout(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    if let Some(token) = extract_bearer(&headers, &query) {
        let conn = state.store.conn.lock().await;
        let _ = conn.execute("DELETE FROM sessions WHERE token=?1", params![token]);
    }
    Json(session_json(None))
}

async fn session(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let user =
        extract_bearer(&headers, &query).and_then(|token| load_user_by_session(&conn, &token));
    Json(session_json(user.as_ref()))
}

async fn list_user_devices(state: &AppState, user_id: &str) -> Vec<Value> {
    let connected = state.sockets.read().await;
    let conn = state.store.conn.lock().await;
    let mut stmt = conn
        .prepare("SELECT id, user_id, name, created_at, token, token_preview FROM devices WHERE user_id=?1 ORDER BY created_at ASC")
        .expect("stmt");
    stmt.query_map(params![user_id], |row| {
        let id: String = row.get(0)?;
        let owner: String = row.get(1)?;
        let name: String = row.get(2)?;
        let created_at: String = row.get(3)?;
        let token: Option<String> = row.get(4)?;
        let token_preview: Option<String> = row.get(5)?;
        Ok(device_json(
            &id,
            &owner,
            &name,
            &created_at,
            connected.contains_key(&id),
            token.as_deref(),
            token_preview.as_deref(),
        ))
    })
    .ok()
    .map(|rows| rows.filter_map(|row| row.ok()).collect())
    .unwrap_or_default()
}

async fn list_devices(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        extract_bearer(&headers, &query).and_then(|token| load_user_by_session(&conn, &token))
    };
    let Some(user) = user else {
        return unauthorized();
    };
    Json(json!({ "devices": list_user_devices(&state, &user.id).await })).into_response()
}

#[derive(Deserialize, Default)]
#[allow(dead_code)]
struct AccessQuery {
    token: Option<String>,
    #[serde(rename = "deviceToken")]
    device_token: Option<String>,
    #[serde(rename = "deviceId")]
    device_id: Option<String>,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    #[serde(rename = "workspaceId")]
    workspace_id: Option<String>,
}

impl AccessQuery {
    fn token_query(&self) -> TokenQuery {
        TokenQuery {
            token: self.token.clone(),
            device_token: self.device_token.clone(),
            relay_session: None,
        }
    }
}

fn owner_access() -> Value {
    json!({
        "kind": "owner",
        "grantId": Value::Null,
        "shareId": Value::Null,
        "scope": "owner",
        "threadAccess": "control",
        "workspaceAccess": "write",
        "workspaceId": Value::Null,
        "workspaceScope": Value::Null,
        "canCreateThreads": true
    })
}

async fn relay_access(
    headers: HeaderMap,
    Query(query): Query<AccessQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        extract_bearer(&headers, &query.token_query())
            .and_then(|token| load_user_by_session(&conn, &token))
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let Some(device_id) = query.device_id.filter(|value| !value.is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": "bad_request", "message": "deviceId is required" })),
        )
            .into_response();
    };
    let conn = state.store.conn.lock().await;
    let owned: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM devices WHERE id=?1 AND user_id=?2",
            params![device_id, user.id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if owned.is_some() {
        return Json(owner_access()).into_response();
    }
    let share: Option<(String, String, String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT id, thread_access, workspace_access, thread_id, workspace_id
             FROM shares
             WHERE target_username=?1 AND device_id=?2 AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1",
            params![user.username, device_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten();
    if let Some((id, thread_access, workspace_access, _thread_id, workspace_id)) = share {
        return Json(json!({
            "kind": "shared",
            "grantId": Value::Null,
            "shareId": id,
            "scope": "thread",
            "threadAccess": thread_access,
            "workspaceAccess": workspace_access,
            "workspaceId": workspace_id,
            "workspaceScope": Value::Null,
            "canCreateThreads": false
        }))
        .into_response();
    }
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "code": "forbidden", "message": "Device access is not allowed." })),
    )
        .into_response()
}

async fn portal(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        extract_bearer(&headers, &query).and_then(|token| load_user_by_session(&conn, &token))
    };
    let Some(user) = user else {
        return unauthorized();
    };
    Json(json!({
        "user": user_json(&user),
        "devices": list_user_devices(&state, &user.id).await,
        "sharedWithMe": [],
        "sharedByMe": [],
        "sharedDevicesWithMe": [],
        "sharedThreadsWithMe": [],
        "grantsByMe": []
    }))
    .into_response()
}

#[derive(Deserialize)]
struct CreateDeviceInput {
    name: String,
}

async fn create_device(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateDeviceInput>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        extract_bearer(&headers, &query).and_then(|token| load_user_by_session(&conn, &token))
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let name = body.name.trim();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("bad_request", "Device name is required")),
        )
            .into_response();
    }
    let id = Uuid::new_v4().to_string();
    let token = format!("rcd_{}", Uuid::new_v4().simple());
    let created_at = now_rfc3339();
    let token_preview = preview_token(&token);
    let token_hash = hash_password(&token);
    {
        let conn = state.store.conn.lock().await;
        if conn
            .execute(
                "INSERT INTO devices(id,user_id,name,token,token_hash,token_preview,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id, user.id, name, token.clone(), token_hash, token_preview.clone(), created_at],
            )
            .is_err()
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("internal", "Failed to create device")),
            )
                .into_response();
        }
    }
    Json(json!({
        "device": device_json(&id, &user.id, name, &created_at, false, Some(&token), Some(&token_preview)),
        "token": token
    }))
    .into_response()
}

async fn delete_device(
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        extract_bearer(&headers, &query).and_then(|token| load_user_by_session(&conn, &token))
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let conn = state.store.conn.lock().await;
    let deleted = conn
        .execute(
            "DELETE FROM devices WHERE id=?1 AND user_id=?2",
            params![device_id, user.id],
        )
        .unwrap_or(0);
    if deleted == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Device not found")),
        )
            .into_response();
    }
    drop(conn);
    state.sockets.write().await.remove(&device_id);
    Json(json!({ "id": device_id })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateShareInput {
    target_username: Option<String>,
    device_id: Option<String>,
    thread_id: Option<String>,
    thread_access: Option<String>,
}

async fn create_share(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateShareInput>,
) -> Json<Value> {
    let id = Uuid::new_v4().to_string();
    let conn = state.store.conn.lock().await;
    let owner: String = conn
        .query_row("SELECT id FROM users LIMIT 1", [], |row| row.get(0))
        .unwrap_or_else(|_| "owner".into());
    let _ = conn.execute(
        "INSERT INTO shares(id,owner_user_id,target_username,device_id,thread_id,workspace_id,thread_access,workspace_access,created_at)
         VALUES (?1,?2,?3,?4,?5,NULL,?6,'none',?7)",
        params![
            id,
            owner,
            body.target_username.unwrap_or_default(),
            body.device_id.unwrap_or_default(),
            body.thread_id,
            body.thread_access.unwrap_or_else(|| "read".into()),
            now_rfc3339()
        ],
    );
    Json(json!({ "id": id }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateShareInput {
    thread_access: Option<String>,
    workspace_access: Option<String>,
    target_username: Option<String>,
}

async fn update_share(
    Path(share_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateShareInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if let Some(access) = body.thread_access {
        let _ = conn.execute(
            "UPDATE shares SET thread_access=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![access, share_id],
        );
    }
    if let Some(access) = body.workspace_access {
        let _ = conn.execute(
            "UPDATE shares SET workspace_access=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![access, share_id],
        );
    }
    if let Some(target) = body.target_username {
        let _ = conn.execute(
            "UPDATE shares SET target_username=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![target, share_id],
        );
    }
    Json(json!({ "id": share_id, "ok": true }))
}

async fn revoke_share(
    Path(share_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let _ = conn.execute(
        "UPDATE shares SET revoked_at=?1 WHERE id=?2",
        params![now_rfc3339(), share_id],
    );
    Json(json!({ "id": share_id, "revokedAt": now_rfc3339() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGrantInput {
    target_username: Option<String>,
    device_id: Option<String>,
    scope: Option<String>,
    thread_id: Option<String>,
    workspace_id: Option<String>,
    thread_access: Option<String>,
    workspace_access: Option<String>,
    can_create_threads: Option<bool>,
}

async fn create_grant(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateGrantInput>,
) -> Json<Value> {
    let id = Uuid::new_v4().to_string();
    let conn = state.store.conn.lock().await;
    let owner: String = conn
        .query_row("SELECT id FROM users LIMIT 1", [], |row| row.get(0))
        .unwrap_or_else(|_| "owner".into());
    let _ = conn.execute(
        "INSERT INTO grants(id,owner_user_id,target_username,device_id,scope,thread_id,workspace_id,thread_access,workspace_access,can_create_threads,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            id,
            owner,
            body.target_username.unwrap_or_default(),
            body.device_id.unwrap_or_default(),
            body.scope.unwrap_or_else(|| "thread".into()),
            body.thread_id,
            body.workspace_id,
            body.thread_access.unwrap_or_else(|| "read".into()),
            body.workspace_access.unwrap_or_else(|| "none".into()),
            body.can_create_threads.unwrap_or(false) as i64,
            now_rfc3339()
        ],
    );
    Json(json!({ "id": id }))
}

async fn list_grants(State(state): State<Arc<AppState>>) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let mut stmt = conn
        .prepare("SELECT id, target_username, device_id, scope, thread_id, thread_access, created_at FROM grants WHERE revoked_at IS NULL")
        .expect("stmt");
    let grants: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "targetUsername": row.get::<_, String>(1)?,
                "deviceId": row.get::<_, String>(2)?,
                "scope": row.get::<_, String>(3)?,
                "threadId": row.get::<_, Option<String>>(4)?,
                "threadAccess": row.get::<_, String>(5)?,
                "createdAt": row.get::<_, String>(6)?
            }))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    Json(json!({ "grants": grants }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateGrantInput {
    thread_access: Option<String>,
    workspace_access: Option<String>,
    can_create_threads: Option<bool>,
}

async fn update_grant(
    Path(grant_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateGrantInput>,
) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    if let Some(access) = body.thread_access {
        let _ = conn.execute(
            "UPDATE grants SET thread_access=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![access, grant_id],
        );
    }
    if let Some(access) = body.workspace_access {
        let _ = conn.execute(
            "UPDATE grants SET workspace_access=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![access, grant_id],
        );
    }
    if let Some(can) = body.can_create_threads {
        let _ = conn.execute(
            "UPDATE grants SET can_create_threads=?1 WHERE id=?2 AND revoked_at IS NULL",
            params![can as i64, grant_id],
        );
    }
    Json(json!({ "id": grant_id, "ok": true }))
}

async fn revoke_grant(
    Path(grant_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let _ = conn.execute(
        "UPDATE grants SET revoked_at=?1 WHERE id=?2",
        params![now_rfc3339(), grant_id],
    );
    Json(json!({ "id": grant_id, "revokedAt": now_rfc3339() }))
}

async fn device_healthz(
    Path(device_id): Path<String>,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    forward_device(
        state,
        device_id,
        "GET".into(),
        "/healthz".into(),
        String::new(),
        query.bearer(),
    )
    .await
}

async fn device_api(
    Path((device_id, rest)): Path<(String, String)>,
    method: Method,
    uri: Uri,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let _ = headers;
    let mut path = format!("/api/{rest}");
    if let Some(raw) = uri.query() {
        let filtered: Vec<&str> = raw
            .split('&')
            .filter(|part| {
                let key = part.split('=').next().unwrap_or("");
                key != "token" && key != "deviceToken" && key != "relaySession"
            })
            .collect();
        if !filtered.is_empty() {
            path.push('?');
            path.push_str(&filtered.join("&"));
        }
    }
    forward_device(
        state,
        device_id,
        method.as_str().to_string(),
        path,
        String::from_utf8_lossy(&body).into_owned(),
        query.bearer(),
    )
    .await
}

async fn forward_device(
    state: Arc<AppState>,
    device_id: String,
    method: String,
    path: String,
    body: String,
    _token: Option<String>,
) -> axum::response::Response {
    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.pending.lock().await.insert(request_id.clone(), tx);
    let payload = json!({
        "type": "relay.request",
        "timestamp": now_rfc3339(),
        "requestId": request_id,
        "payload": { "method": method, "path": path, "body": body }
    })
    .to_string();
    let sent = {
        let sockets = state.sockets.read().await;
        if let Some(socket) = sockets.get(&device_id) {
            socket.tx.send(payload).is_ok()
        } else {
            false
        }
    };
    if !sent {
        state.pending.lock().await.remove(&request_id);
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "code": "service_unavailable", "message": "device is offline" })),
        )
            .into_response();
    }
    match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(value)) => forwarded_device_response(value),
        _ => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({ "code": "timeout", "message": "device did not respond" })),
        )
            .into_response(),
    }
}

fn forwarded_device_response(value: Value) -> Response {
    let status = value
        .get("statusCode")
        .and_then(Value::as_u64)
        .and_then(|status| StatusCode::from_u16(status as u16).ok())
        .unwrap_or(StatusCode::OK);
    let bytes = if let Some(encoded) = value.get("bodyBase64").and_then(Value::as_str) {
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(bytes) => bytes,
            Err(_) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "code": "invalid_supervisor_response",
                        "message": "Supervisor returned an invalid binary response."
                    })),
                )
                    .into_response();
            }
        }
    } else {
        match value.get("body").cloned().unwrap_or(Value::Null) {
            Value::String(raw) => raw.into_bytes(),
            Value::Null => Vec::new(),
            other => serde_json::to_vec(&other).unwrap_or_default(),
        }
    };

    let mut response = Response::builder().status(status);
    if let Some(headers) = value.get("headers").and_then(Value::as_object) {
        for name in [
            "content-type",
            "content-disposition",
            "cache-control",
            "x-content-type-options",
        ] {
            if let Some(header_value) = headers.get(name).and_then(Value::as_str) {
                response = response.header(name, header_value);
            }
        }
    }
    response
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn list_shares(State(state): State<Arc<AppState>>) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let mut stmt = conn
        .prepare("SELECT id, target_username, device_id, thread_id, thread_access, created_at FROM shares WHERE revoked_at IS NULL")
        .expect("stmt");
    let shares: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "targetUsername": row.get::<_, String>(1)?,
                "deviceId": row.get::<_, String>(2)?,
                "threadId": row.get::<_, Option<String>>(3)?,
                "threadAccess": row.get::<_, String>(4)?,
                "createdAt": row.get::<_, String>(5)?
            }))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    Json(json!({ "shares": shares }))
}

async fn supervisor_tunnel(
    ws: WebSocketUpgrade,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let token = query.bearer().unwrap_or_default();
    if token.is_empty() {
        return unauthorized();
    }
    let device_id = {
        let conn = state.store.conn.lock().await;
        conn.query_row(
            "SELECT id FROM devices WHERE token_hash=?1",
            params![hash_password(&token)],
            |row| row.get::<_, String>(0),
        )
        .ok()
    };
    let Some(device_id) = device_id else {
        return unauthorized();
    };
    ws.on_upgrade(move |socket| handle_supervisor(socket, state, device_id))
        .into_response()
}

async fn handle_supervisor(socket: WebSocket, state: Arc<AppState>, device_id: String) {
    let connection_id = Uuid::new_v4();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    state
        .sockets
        .write()
        .await
        .insert(device_id.clone(), DeviceSocket { tx, connection_id });
    let (mut sink, mut stream) = socket.split();
    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                            if msg.get("type").and_then(Value::as_str) == Some("relay.response") {
                                if let Some(request_id) = msg.get("requestId").and_then(Value::as_str) {
                                    if let Some(pending) = state.pending.lock().await.remove(request_id) {
                                        let payload = msg.get("payload").cloned().unwrap_or(json!({}));
                                        let _ = pending.send(payload);
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }
    let mut sockets = state.sockets.write().await;
    if sockets
        .get(&device_id)
        .is_some_and(|socket| socket.connection_id == connection_id)
    {
        sockets.remove(&device_id);
    }
}

async fn client_ws(
    ws: WebSocketUpgrade,
    Path(_device_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| echo_socket(socket, state))
}

async fn client_ws_compat(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| echo_socket(socket, state))
}

async fn echo_socket(mut socket: WebSocket, _state: Arc<AppState>) {
    let _ = socket
        .send(Message::Text(
            json!({ "type": "supervisor.connected", "timestamp": now_rfc3339() })
                .to_string()
                .into(),
        ))
        .await;
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        if text.contains("ping") {
            let _ = socket
                .send(Message::Text(
                    json!({ "type": "supervisor.pong", "timestamp": now_rfc3339(), "payload": { "requestTimestamp": now_rfc3339() } })
                        .to_string()
                        .into(),
                ))
                .await;
        }
    }
}

const RELAY_BOOTSTRAP: &str = r#"<script>window.__REMOTE_CODEX_BOOTSTRAP__={"mode":"relay","relayApiBase":"/relay"};</script>"#;

fn inject_bootstrap(html: &str) -> String {
    if html.contains("</head>") {
        html.replacen("</head>", &format!("{RELAY_BOOTSTRAP}</head>"), 1)
    } else {
        format!("{RELAY_BOOTSTRAP}{html}")
    }
}

fn mime_for(path: &FsPath) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forwarded_device_response_preserves_binary_body_and_headers() {
        let expected = b"%PDF-1.7\n\0binary";
        let response = forwarded_device_response(json!({
            "statusCode": 200,
            "headers": {
                "content-type": "application/pdf",
                "content-disposition": "attachment; filename=\"thread.pdf\""
            },
            "bodyBase64": base64::engine::general_purpose::STANDARD.encode(expected)
        }));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            response.headers()[header::CONTENT_DISPOSITION],
            "attachment; filename=\"thread.pdf\""
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), expected);
    }
}

fn safe_dist_path(dist: &FsPath, url_path: &str) -> Option<PathBuf> {
    let rel = url_path.trim_start_matches('/');
    if rel.is_empty() {
        return Some(dist.join("index.html"));
    }
    if rel.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(dist.join(rel))
}

async fn spa_fallback(State(state): State<Arc<AppState>>, req: Request) -> Response {
    let Some(dist) = state.web_dist.as_ref() else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    };
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    }
    let path = req.uri().path();
    if path.starts_with("/relay/") || path == "/healthz" || path == "/supervisor/tunnel" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    }
    let Some(candidate) = safe_dist_path(dist, path) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let has_ext = FsPath::new(path).extension().is_some();
    let file_path = if tokio::fs::metadata(&candidate)
        .await
        .map(|meta| meta.is_file())
        .unwrap_or(false)
    {
        candidate
    } else if has_ext {
        return StatusCode::NOT_FOUND.into_response();
    } else {
        dist.join("index.html")
    };
    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let is_html = file_path.extension().and_then(|ext| ext.to_str()) == Some("html");
            let (body, content_type) = if is_html {
                let html = String::from_utf8_lossy(&bytes);
                (
                    Body::from(inject_bootstrap(&html)),
                    "text/html; charset=utf-8",
                )
            } else {
                (Body::from(bytes), mime_for(&file_path))
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CACHE_CONTROL,
                    if is_html {
                        "no-cache"
                    } else {
                        "public, max-age=31536000, immutable"
                    },
                )
                .body(body)
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "code": "not_found",
                "message": "Relay web frontend is not built."
            })),
        )
            .into_response(),
    }
}
