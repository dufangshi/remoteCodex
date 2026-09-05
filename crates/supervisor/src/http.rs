use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::body::Bytes;
use axum::extract::multipart::Multipart;
use axum::extract::{DefaultBodyLimit, FromRequest, Path, Query, Request, State, WebSocketUpgrade};
use axum::http::{header, Method, StatusCode};
use axum::http::{HeaderMap, HeaderValue, Uri};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use remote_codex_protocol::{
    now_rfc3339, ApiError, AuthSessionDto, CreateThreadInput, CreateWorkspaceInput,
    ForkThreadInput, HealthDto, ImportThreadInput, PlatformCapabilitiesDto, Provider,
    RuntimeConfigDto, SendThreadPromptInput, ThreadWorkspaceTreeNodeDto,
    UpdateWorkspaceSettingsInput, VersionDto, APP_NAME, APP_VERSION,
};
use remote_codex_runtime::files::WorkspaceDownload;
use remote_codex_runtime::{Supervisor, UploadedPromptAttachment};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub type AppState = Arc<Supervisor>;

const MAX_PROMPT_ATTACHMENTS: usize = 10;
const MAX_PROMPT_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
const MAX_WORKSPACE_UPLOAD_BYTES: usize = 50 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptAttachmentManifestEntry {
    kind: String,
    original_name: String,
    placeholder: String,
}

#[derive(Deserialize)]
struct UpdatePluginInput {
    enabled: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTranscriptQuery {
    format: Option<String>,
    mode: Option<String>,
    limit: Option<usize>,
    turn_ids: Option<String>,
    profile: Option<String>,
    include_token_and_price: Option<bool>,
    include_command_output: Option<bool>,
    include_absolute_paths: Option<bool>,
}

pub fn router(state: AppState) -> Router {
    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(healthz))
        .route("/api/version", get(version))
        .route("/api/config/runtime", get(runtime_config))
        .route(
            "/api/agent-runtimes/{provider}/subscription-usage",
            get(subscription_usage),
        )
        .route(
            "/api/config/model-pricing",
            get(model_pricing).patch(patch_model_pricing),
        )
        .route(
            "/api/config/workspace-settings",
            get(workspace_settings).patch(patch_workspace_settings),
        )
        .route("/api/auth/session", get(auth_session))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/logout", post(auth_logout))
        .route("/api/agent-runtimes", get(agent_runtimes))
        .route("/api/agent-runtimes/{provider}/status", get(agent_status))
        .route("/api/agent-runtimes/{provider}/models", get(agent_models))
        .route("/api/agent-runtimes/{provider}/agents", get(agent_agents))
        .route(
            "/api/agent-runtimes/{provider}/capabilities",
            get(agent_caps),
        )
        .route(
            "/api/agent-runtimes/{provider}/install",
            post(agent_install),
        )
        .route(
            "/api/agent-runtimes/{provider}/restart",
            post(agent_restart),
        )
        .route(
            "/api/workspaces",
            get(list_workspaces).post(create_workspace),
        )
        .route(
            "/api/workspaces/{id}",
            get(get_workspace)
                .patch(patch_workspace)
                .delete(delete_workspace),
        )
        .route("/api/workspaces/{id}/favorite", post(favorite_workspace))
        .route("/api/workspaces/{id}/open", post(open_workspace))
        .route("/api/workspaces/{id}/files/tree", get(workspace_tree))
        .route("/api/workspaces/{id}/files/preview", get(workspace_preview))
        .route("/api/workspaces/{id}/files/raw", get(workspace_raw))
        .route(
            "/api/workspaces/{id}/files",
            axum::routing::put(workspace_write).delete(workspace_delete_file),
        )
        .route("/api/threads", get(list_threads))
        .route("/api/threads/start", post(start_thread))
        .route("/api/threads/import", post(import_thread))
        .route("/api/threads/import-candidates", get(import_candidates))
        .route(
            "/api/threads/{id}",
            get(get_thread).patch(rename_thread).delete(delete_thread),
        )
        .route(
            "/api/threads/{id}/turns/{turnId}/detail",
            get(thread_turn_detail),
        )
        .route(
            "/api/threads/{id}/items/{itemId}/detail",
            get(thread_item_detail),
        )
        .route("/api/threads/{id}/assets/image", get(thread_image))
        .route("/api/threads/{id}/settings", patch(thread_settings))
        .route("/api/threads/{id}/prompt", post(thread_prompt))
        .route("/api/threads/{id}/interrupt", post(thread_interrupt))
        .route("/api/threads/{id}/resume", post(thread_resume))
        .route("/api/threads/{id}/disconnect", post(thread_disconnect))
        .route("/api/threads/{id}/fork-turns", get(thread_fork_turns))
        .route("/api/threads/{id}/fork", post(thread_fork))
        .route("/api/threads/{id}/compact", post(thread_compact))
        .route(
            "/api/threads/{id}/goal",
            get(thread_goal)
                .patch(thread_goal)
                .delete(thread_goal_clear),
        )
        .route("/api/threads/{id}/skills", get(thread_skills))
        .route("/api/threads/{id}/mcp-servers", get(thread_mcp))
        .route("/api/threads/{id}/hooks", get(thread_hooks))
        .route(
            "/api/threads/{id}/requests/{requestId}/respond",
            post(thread_respond),
        )
        .route(
            "/api/threads/{id}/pending-steers/{pendingSteerId}",
            delete(cancel_pending_steer),
        )
        .route(
            "/api/threads/{id}/pending-steers/{pendingSteerId}/steer",
            post(steer_pending_prompt),
        )
        .route("/api/threads/{id}/export-turns", get(export_turns))
        .route("/api/threads/{id}/exports/pdf", get(export_pdf))
        .route("/api/threads/{id}/exports/html", get(export_html))
        .route(
            "/api/threads/{id}/shell",
            get(thread_shell).post(create_shell),
        )
        .route("/api/shells/{id}", patch(update_shell))
        .route("/api/shells/{id}/terminate", post(terminate_shell))
        .route(
            "/api/workspaces/{id}/files/download",
            get(workspace_download),
        )
        .route("/api/workspaces/{id}/files/upload", post(workspace_upload))
        .route("/api/workspaces/{id}/files/move", patch(workspace_move))
        .route("/api/plugins", get(list_plugins))
        .route("/api/plugins/import", post(import_plugin_unsupported))
        .route(
            "/api/plugins/{id}",
            get(get_plugin).patch(update_plugin).delete(delete_plugin),
        )
        .route("/ws", get(ws_upgrade))
        .fallback(spa_fallback)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth::require_auth,
        ))
        .with_state(state);
    match webview_cors_layer() {
        Some(layer) => router.layer(layer),
        None => router,
    }
}

fn webview_cors_layer() -> Option<CorsLayer> {
    if std::env::var("REMOTE_CODEX_ENABLE_WEBVIEW_CORS").as_deref() != Ok("true") {
        return None;
    }
    let configured = std::env::var("REMOTE_CODEX_WEBVIEW_CORS_ORIGINS")
        .ok()
        .map(|raw| {
            raw.split(',')
                .filter_map(|value| value.trim().parse::<HeaderValue>().ok())
                .collect::<Vec<_>>()
        })
        .filter(|origins| !origins.is_empty());
    let origins = configured.unwrap_or_else(|| {
        [
            "null",
            "capacitor://localhost",
            "ionic://localhost",
            "http://localhost",
            "https://localhost",
            "https://appassets.androidplatform.net",
        ]
        .into_iter()
        .map(HeaderValue::from_static)
        .collect()
    });
    Some(
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PATCH,
                Method::PUT,
                Method::DELETE,
            ])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
            .max_age(std::time::Duration::from_secs(600)),
    )
}

fn configured_web_dist() -> Option<PathBuf> {
    std::env::var("REMOTE_CODEX_WEB_DIST_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            let candidate = PathBuf::from("apps/supervisor-web/dist");
            candidate.join("index.html").is_file().then_some(candidate)
        })
}

fn safe_static_path(dist: &FsPath, uri_path: &str) -> Option<PathBuf> {
    let relative = uri_path.trim_start_matches('/');
    let requested = FsPath::new(relative);
    if requested
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    Some(dist.join(requested))
}

fn static_content_type(path: &FsPath) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "ico" => "image/x-icon",
        "jpeg" | "jpg" => "image/jpeg",
        "js" => "text/javascript; charset=utf-8",
        "json" | "webmanifest" => "application/json; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

async fn spa_fallback(State(state): State<AppState>, request: Request) -> Response {
    if request.uri().path() == "/api"
        || request.uri().path().starts_with("/api/")
        || request.uri().path() == "/ws"
    {
        return err(StatusCode::NOT_FOUND, "not_found", "Route not found").into_response();
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if state.config.mode == remote_codex_protocol::Mode::Relay {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            "Web UI is served by the Relay, not by the device supervisor",
        )
        .into_response();
    }
    let Some(dist) = configured_web_dist() else {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            "Web UI is not installed",
        )
        .into_response();
    };
    let Some(candidate) = safe_static_path(&dist, request.uri().path()) else {
        return err(StatusCode::BAD_REQUEST, "bad_request", "Invalid asset path").into_response();
    };
    let path = if candidate.is_file() {
        candidate
    } else {
        dist.join("index.html")
    };
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            "Web UI is not installed",
        )
        .into_response();
    };
    let cache_control = if path.file_name().and_then(|value| value.to_str()) == Some("index.html") {
        "no-cache"
    } else {
        "public, max-age=31536000, immutable"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, static_content_type(&path))
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(if request.method() == Method::HEAD {
            Body::empty()
        } else {
            Body::from(bytes)
        })
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

struct ApiErr(StatusCode, ApiError);

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

fn err(status: StatusCode, code: &str, message: impl Into<String>) -> ApiErr {
    ApiErr(status, ApiError::new(code, message))
}

fn map_err(e: anyhow::Error) -> ApiErr {
    let message = e.to_string();
    if message.contains("not found") {
        err(StatusCode::NOT_FOUND, "not_found", message)
    } else if message.contains("Resume / Connect") || message.starts_with("conflict: ") {
        err(
            StatusCode::CONFLICT,
            "conflict",
            message.strip_prefix("conflict: ").unwrap_or(&message),
        )
    } else if message.contains("not installed") || message.contains("not enabled") {
        err(StatusCode::BAD_REQUEST, "harness_unavailable", message)
    } else {
        err(StatusCode::BAD_REQUEST, "bad_request", message)
    }
}

async fn healthz(State(state): State<AppState>) -> Json<HealthDto> {
    Json(HealthDto {
        status: "ok".into(),
        timestamp: now_rfc3339(),
        active_turn_count: state.active_turn_count(),
    })
}

async fn version() -> Json<VersionDto> {
    Json(VersionDto {
        name: APP_NAME.into(),
        version: APP_VERSION.into(),
    })
}

async fn runtime_config(State(state): State<AppState>) -> Json<RuntimeConfigDto> {
    Json(RuntimeConfigDto {
        app_name: state.config.app_name.clone(),
        app_version: state.config.app_version.clone(),
        mode: state.config.mode,
        host: state.config.host.clone(),
        port: state.config.port,
        workspace_root: state.config.workspace_root.to_string_lossy().into(),
        environment: state.config.environment.clone(),
        platform: Some(std::env::consts::OS.into()),
        architecture: Some(std::env::consts::ARCH.into()),
        capabilities: Some(PlatformCapabilitiesDto {
            terminal: cfg!(unix),
            tmux: which_tmux(),
            managed_signals: cfg!(unix),
            windows_task_scheduler: cfg!(windows),
        }),
    })
}

fn which_tmux() -> bool {
    #[cfg(windows)]
    return false;
    #[cfg(not(windows))]
    std::process::Command::new("tmux")
        .arg("-V")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

async fn workspace_settings(State(state): State<AppState>) -> Json<Value> {
    Json(serde_json::to_value(state.workspace_settings()).unwrap_or(json!({})))
}

async fn patch_workspace_settings(
    State(state): State<AppState>,
    Json(body): Json<UpdateWorkspaceSettingsInput>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.update_workspace_settings(body).map_err(map_err)?)
            .unwrap_or(json!({})),
    ))
}

async fn auth_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    uri: Uri,
) -> Json<AuthSessionDto> {
    Json(crate::auth::verify_request(&state.config, &headers, &uri))
}

#[derive(Deserialize)]
struct LoginInput {
    username: Option<String>,
    password: Option<String>,
}

async fn auth_login(
    State(state): State<AppState>,
    Json(body): Json<LoginInput>,
) -> Result<Response, ApiErr> {
    let Some((token, session)) = crate::auth::login(
        &state.config,
        body.username.as_deref().unwrap_or_default(),
        body.password.as_deref().unwrap_or_default(),
    ) else {
        return Err(err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid username or password.",
        ));
    };
    let mut response = Json(json!({
        "token": if token.is_empty() { Value::Null } else { json!(token) },
        "session": session,
    }))
    .into_response();
    if !token.is_empty() {
        response.headers_mut().insert(
            header::SET_COOKIE,
            crate::auth::session_cookie(&token)
                .parse()
                .expect("valid session cookie"),
        );
    }
    Ok(response)
}

async fn auth_logout(State(state): State<AppState>) -> Response {
    let mut response = Json(crate::auth::unauthenticated_session(&state.config)).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        crate::auth::clear_session_cookie()
            .parse()
            .expect("valid cleared session cookie"),
    );
    response
}

async fn agent_runtimes(State(state): State<AppState>) -> Json<Vec<Value>> {
    Json(
        state
            .backends()
            .into_iter()
            .filter_map(|b| serde_json::to_value(b).ok())
            .collect(),
    )
}

fn parse_provider(raw: &str) -> Result<Provider, ApiErr> {
    match raw {
        "codex" => Ok(Provider::Codex),
        "claude" => Ok(Provider::Claude),
        "opencode" => Ok(Provider::Opencode),
        "acp" => Ok(Provider::Acp),
        _ => Err(err(StatusCode::NOT_FOUND, "not_found", "unknown provider")),
    }
}

async fn agent_status(
    Path(provider): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let backend = state
        .backends()
        .into_iter()
        .find(|b| b.provider == provider)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "not_found", "provider missing"))?;
    Ok(Json(serde_json::to_value(backend).unwrap_or(json!({}))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentQuery {
    agent_id: Option<String>,
    cwd: Option<String>,
}

async fn agent_models(
    Path(provider): Path<String>,
    Query(query): Query<AgentQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let models = state
        .list_models(provider, query.agent_id.as_deref(), query.cwd.as_deref())
        .await
        .map_err(map_err)?;
    Ok(Json(serde_json::to_value(models).unwrap_or(json!([]))))
}

async fn agent_agents(
    Path(provider): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let agents = state.list_agents(provider).await.map_err(map_err)?;
    Ok(Json(serde_json::to_value(agents).unwrap_or(json!([]))))
}

async fn agent_caps(
    Path(provider): Path<String>,
    Query(query): Query<AgentQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let caps = state
        .capabilities(provider, query.agent_id.as_deref())
        .await
        .map_err(map_err)?;
    Ok(Json(serde_json::to_value(caps).unwrap_or(json!({}))))
}

async fn agent_install(
    Path(provider): Path<String>,
    Query(query): Query<AgentQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let dto = state
        .install(provider, query.agent_id.as_deref())
        .await
        .map_err(map_err)?;
    Ok(Json(serde_json::to_value(dto).unwrap_or(json!({}))))
}

async fn agent_restart(
    Path(provider): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    state
        .runtime(provider)
        .map_err(map_err)?
        .start()
        .await
        .map_err(map_err)?;
    let backend = state
        .backends()
        .into_iter()
        .find(|b| b.provider == provider)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "not_found", "provider missing"))?;
    Ok(Json(serde_json::to_value(backend).unwrap_or(json!({}))))
}

async fn list_workspaces(State(state): State<AppState>) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.list_workspaces().map_err(map_err)?).unwrap(),
    ))
}

async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkspaceInput>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.create_workspace(body).map_err(map_err)?).unwrap(),
    ))
}

async fn get_workspace(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.get_workspace(&id).map_err(map_err)?).unwrap(),
    ))
}

#[derive(Deserialize)]
struct LabelBody {
    label: String,
}

async fn patch_workspace(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<LabelBody>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.update_workspace(&id, &body.label).map_err(map_err)?).unwrap(),
    ))
}

async fn delete_workspace(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    state.delete_workspace(&id).map_err(map_err)?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteBody {
    is_favorite: Option<bool>,
}

async fn favorite_workspace(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<FavoriteBody>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .set_favorite(&id, body.is_favorite.unwrap_or(true))
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn open_workspace(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.open_workspace(&id).map_err(map_err)?).unwrap(),
    ))
}

#[derive(Deserialize)]
struct PathQuery {
    path: Option<String>,
}

async fn workspace_tree(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let rel = query.path.as_deref().unwrap_or(".");
    let nodes = state.workspace_tree(&id, rel).map_err(map_err)?;
    let ws = state.get_workspace(&id).map_err(map_err)?;
    let root = ThreadWorkspaceTreeNodeDto {
        name: std::path::Path::new(rel)
            .file_name()
            .or_else(|| std::path::Path::new(&ws.abs_path).file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".into()),
        path: rel.replace('\\', "/"),
        kind: "directory".into(),
        size: None,
        has_children: Some(!nodes.is_empty()),
        children_loaded: Some(true),
        children: Some(nodes),
    };
    Ok(Json(serde_json::to_value(root).unwrap()))
}

async fn workspace_preview(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let path = query
        .path
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "bad_request", "path is required"))?;
    Ok(Json(
        serde_json::to_value(state.workspace_preview(&id, &path).map_err(map_err)?).unwrap(),
    ))
}

async fn workspace_raw(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let path = query
        .path
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "bad_request", "path is required"))?;
    let (path, bytes) = state.workspace_read_bytes(&id, &path).map_err(map_err)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, static_content_type(&path))
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(bytes))
        .map_err(|error| map_err(error.into()))
}

#[derive(Deserialize)]
struct WriteFileBody {
    path: String,
    content: String,
}

async fn workspace_write(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<WriteFileBody>,
) -> Result<Json<Value>, ApiErr> {
    state
        .workspace_write(&id, &body.path, &body.content)
        .map_err(map_err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn workspace_delete_file(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiErr> {
    let path = query
        .path
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "bad_request", "path is required"))?;
    let ws = state.get_workspace(&id).map_err(map_err)?;
    let abs = remote_codex_runtime::files::assert_within(
        std::path::Path::new(&ws.abs_path),
        std::path::Path::new(&path),
    )
    .map_err(map_err)?;
    if abs.is_dir() {
        std::fs::remove_dir_all(abs).map_err(|e| map_err(e.into()))?;
    } else {
        std::fs::remove_file(abs).map_err(|e| map_err(e.into()))?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadListQuery {
    workspace_id: Option<String>,
}

async fn list_threads(
    Query(query): Query<ThreadListQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .list_threads(query.workspace_id.as_deref())
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn start_thread(
    State(state): State<AppState>,
    Json(body): Json<CreateThreadInput>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.create_thread(body).await.map_err(map_err)?).unwrap(),
    ))
}

async fn import_thread(
    State(state): State<AppState>,
    Json(body): Json<ImportThreadInput>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.import_thread(body).await.map_err(map_err)?).unwrap(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportCandidatesQuery {
    provider: Option<String>,
    agent_id: Option<String>,
}

async fn import_candidates(
    Query(query): Query<ImportCandidatesQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = query.provider.as_deref().and_then(Provider::from_name);
    Ok(Json(
        serde_json::to_value(
            state
                .list_import_candidates(provider, query.agent_id.as_deref())
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

#[derive(Deserialize)]
struct DetailQuery {
    limit: Option<u32>,
    #[serde(rename = "beforeTurnId")]
    before_turn_id: Option<String>,
    view: Option<String>,
}

async fn get_thread(
    Path(id): Path<String>,
    Query(query): Query<DetailQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    if query.limit.is_some_and(|limit| limit == 0 || limit > 100) {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "limit must be between 1 and 100",
        ));
    }
    if query
        .before_turn_id
        .as_deref()
        .is_some_and(|turn_id| turn_id.trim().is_empty())
    {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "beforeTurnId must not be empty",
        ));
    }
    if query
        .view
        .as_deref()
        .is_some_and(|view| !matches!(view, "summary" | "full"))
    {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "view must be summary or full",
        ));
    }
    let summary_only = query.view.as_deref() == Some("summary");
    Ok(Json(
        serde_json::to_value(
            state
                .get_thread_detail_page(
                    &id,
                    query.limit.or(Some(10)),
                    query.before_turn_id.as_deref(),
                    summary_only,
                )
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn thread_turn_detail(
    Path((id, turn_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .get_thread_turn_detail(&id, &turn_id)
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn thread_item_detail(
    Path((id, item_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        state
            .get_history_item_detail(&id, &item_id)
            .map_err(map_err)?,
    ))
}

#[derive(Deserialize)]
struct ImageQuery {
    path: String,
}

async fn thread_image(
    Path(id): Path<String>,
    Query(query): Query<ImageQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let (bytes, mime) = state.thread_image(&id, &query.path).map_err(map_err)?;
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime),
            (header::CACHE_CONTROL, "private, max-age=60"),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct RenameBody {
    title: String,
}

async fn rename_thread(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<RenameBody>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.rename_thread(&id, &body.title).map_err(map_err)?).unwrap(),
    ))
}

async fn delete_thread(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiErr> {
    state.delete_thread(&id).map_err(map_err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsBody {
    model: Option<String>,
    reasoning_effort: Option<String>,
    fast_mode: Option<bool>,
    collaboration_mode: Option<String>,
    sandbox_mode: Option<String>,
}

async fn thread_settings(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<SettingsBody>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .update_settings(
                    &id,
                    body.model,
                    body.reasoning_effort,
                    body.fast_mode,
                    body.collaboration_mode,
                    body.sandbox_mode,
                )
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn thread_prompt(
    Path(id): Path<String>,
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<Value>, ApiErr> {
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let input = if content_type.contains("multipart") {
        let mut multipart = Multipart::from_request(request, &state)
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?;
        let mut prompt = String::new();
        let mut client_request_id = None;
        let mut model = None;
        let mut reasoning_effort = None;
        let mut collaboration_mode = None;
        let mut attachment_manifest = None;
        let mut files = Vec::new();
        while let Some(field) = multipart
            .next_field()
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?
        {
            let name = field.name().unwrap_or("").to_string();
            let file_name = field.file_name().map(str::to_string);
            let mime = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
            let bytes = field
                .bytes()
                .await
                .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?;
            match name.as_str() {
                "prompt" => prompt = String::from_utf8_lossy(&bytes).into_owned(),
                "clientRequestId" => {
                    client_request_id = Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                "model" => model = Some(String::from_utf8_lossy(&bytes).into_owned()),
                "reasoningEffort" | "reasoning_effort" => {
                    reasoning_effort = Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                "collaborationMode" => {
                    collaboration_mode = Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                "attachmentManifest" => {
                    attachment_manifest = Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                _ if file_name.is_some() => {
                    if files.len() >= MAX_PROMPT_ATTACHMENTS {
                        return Err(err(
                            StatusCode::BAD_REQUEST,
                            "bad_request",
                            format!(
                                "A prompt can include at most {MAX_PROMPT_ATTACHMENTS} attachments."
                            ),
                        ));
                    }
                    if bytes.len() > MAX_PROMPT_ATTACHMENT_BYTES {
                        return Err(err(
                            StatusCode::BAD_REQUEST,
                            "bad_request",
                            "Each attachment must be 25 MB or smaller.",
                        ));
                    }
                    files.push((
                        file_name.unwrap_or_else(|| name.clone()),
                        mime,
                        bytes.to_vec(),
                    ));
                }
                _ => {}
            }
        }
        let manifest = if files.is_empty() {
            Vec::new()
        } else {
            let raw = attachment_manifest.ok_or_else(|| {
                err(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "attachmentManifest is required when files are uploaded.",
                )
            })?;
            let parsed =
                serde_json::from_str::<Vec<PromptAttachmentManifestEntry>>(&raw).map_err(|_| {
                    err(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        "attachmentManifest must be valid JSON.",
                    )
                })?;
            if parsed.len() != files.len() {
                return Err(err(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "attachmentManifest must describe every uploaded attachment.",
                ));
            }
            parsed
        };
        let attachments = files
            .into_iter()
            .zip(manifest)
            .map(|((file_name, mime_type, bytes), manifest)| {
                let expected_prefix = match manifest.kind.as_str() {
                    "photo" if mime_type.starts_with("image/") => "[PHOTO ",
                    "file" => "[FILE ",
                    "photo" => {
                        return Err(err(
                            StatusCode::BAD_REQUEST,
                            "bad_request",
                            "Photo attachments must use an image MIME type.",
                        ))
                    }
                    _ => {
                        return Err(err(
                            StatusCode::BAD_REQUEST,
                            "bad_request",
                            "Attachment kind must be photo or file.",
                        ))
                    }
                };
                if !manifest.placeholder.starts_with(expected_prefix)
                    || !manifest.placeholder.ends_with(']')
                {
                    return Err(err(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        "Attachment placeholder does not match its kind.",
                    ));
                }
                Ok(UploadedPromptAttachment {
                    kind: manifest.kind,
                    original_name: if manifest.original_name.trim().is_empty() {
                        file_name
                    } else {
                        manifest.original_name
                    },
                    placeholder: manifest.placeholder,
                    bytes,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let prompt = state
            .prepare_prompt_attachments(&id, &prompt, attachments)
            .map_err(map_err)?;
        SendThreadPromptInput {
            prompt,
            client_request_id,
            model,
            reasoning_effort,
            collaboration_mode,
            images: Vec::new(),
        }
    } else {
        let bytes = axum::body::to_bytes(request.into_body(), 32 * 1024 * 1024)
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?;
        serde_json::from_slice::<SendThreadPromptInput>(&bytes)
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?
    };
    let thread = state.get_thread(&id).map_err(map_err)?;
    state.ensure_prompt_allowed(&thread).map_err(map_err)?;
    let background = state.clone();
    let background_id = id.clone();
    tokio::spawn(async move {
        if let Err(err) = background.prompt(&background_id, input).await {
            tracing::warn!(error = %err, "prompt failed");
        }
    });
    for _ in 0..100 {
        if let Ok(thread) = state.get_thread(&id) {
            if matches!(
                thread.status.as_str(),
                "running" | "idle" | "interrupted" | "failed"
            ) && (thread.status != "idle" || thread.last_turn_started_at.is_some())
            {
                return Ok(Json(serde_json::to_value(thread).unwrap()));
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    Ok(Json(
        serde_json::to_value(state.get_thread(&id).map_err(map_err)?).unwrap(),
    ))
}

async fn thread_interrupt(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    state.interrupt(&id).await.map_err(map_err)?;
    Ok(Json(
        serde_json::to_value(state.get_thread(&id).map_err(map_err)?).unwrap(),
    ))
}

async fn thread_resume(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.resume_thread(&id).await.map_err(map_err)?).unwrap(),
    ))
}

async fn thread_disconnect(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.get_thread_detail(&id, None).await.map_err(map_err)?).unwrap(),
    ))
}

async fn thread_fork(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<ForkThreadInput>,
) -> Result<Json<Value>, ApiErr> {
    let (thread, source_turn_id, source_turn_index) = state
        .fork_thread_at(&id, &body.mode, body.turn_id.as_deref())
        .await
        .map_err(map_err)?;
    let detail = state
        .get_thread_detail(&thread.id, None)
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "thread": detail,
        "sourceThreadId": id,
        "sourceTurnId": source_turn_id,
        "sourceTurnIndex": source_turn_index
    })))
}

async fn thread_fork_turns(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.list_fork_turn_options(&id).map_err(map_err)?).unwrap(),
    ))
}

async fn thread_compact(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(state.compact_thread(&id).await.map_err(map_err)?).unwrap(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalBody {
    objective: Option<String>,
    status: Option<String>,
    #[serde(default = "missing_goal_token_budget")]
    token_budget: Value,
}

fn missing_goal_token_budget() -> Value {
    json!({ "missing": true })
}

fn parse_goal_token_budget(value: Value) -> Result<Option<Option<u64>>, ApiErr> {
    match value {
        Value::Object(object) if object.get("missing") == Some(&Value::Bool(true)) => Ok(None),
        Value::Null => Ok(Some(None)),
        Value::Number(number) => number
            .as_u64()
            .filter(|budget| *budget > 0)
            .map(|budget| Some(Some(budget)))
            .ok_or_else(|| {
                err(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    "tokenBudget must be a positive integer or null.",
                )
            }),
        _ => Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "tokenBudget must be a positive integer or null.",
        )),
    }
}

async fn thread_goal(
    Path(id): Path<String>,
    State(state): State<AppState>,
    body: Option<Json<GoalBody>>,
) -> Result<Json<Value>, ApiErr> {
    let (objective, status, token_budget) = body
        .map(|Json(body)| {
            Ok((
                body.objective,
                body.status,
                parse_goal_token_budget(body.token_budget)?,
            ))
        })
        .transpose()?
        .unwrap_or((None, None, None));
    Ok(Json(
        state
            .thread_goal(&id, objective, status, token_budget, false)
            .await
            .map_err(map_err)?,
    ))
}

async fn thread_goal_clear(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        state
            .thread_goal(&id, None, None, None, true)
            .await
            .map_err(map_err)?,
    ))
}

async fn thread_skills() -> Json<Value> {
    Json(json!({ "cwd": ".", "skills": [], "errors": [] }))
}

async fn thread_mcp() -> Json<Value> {
    Json(json!({ "servers": [] }))
}

async fn thread_hooks() -> Json<Value> {
    Json(
        json!({ "cwd": ".", "hooks": [], "warnings": [], "errors": [], "globalHooksPath": "", "projectHooksPath": "" }),
    )
}

#[derive(Deserialize)]
struct RespondBody {
    #[serde(default)]
    allow: Option<bool>,
    #[serde(default)]
    answers: Option<Value>,
}

async fn thread_respond(
    Path((id, request_id)): Path<(String, String)>,
    State(state): State<AppState>,
    body: Option<Json<RespondBody>>,
) -> Result<Json<Value>, ApiErr> {
    let (allow, answer) = match body {
        Some(Json(body)) => (
            body.allow.unwrap_or(true),
            body.answers.map(|answers| answers.to_string()),
        ),
        None => (true, None),
    };
    Ok(Json(
        serde_json::to_value(
            state
                .respond_request(&id, &request_id, allow, answer.as_deref())
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn cancel_pending_steer(
    Path((id, pending_steer_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .cancel_pending_steer(&id, &pending_steer_id)
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn steer_pending_prompt(
    Path((id, pending_steer_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .steer_pending_prompt(&id, &pending_steer_id)
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
}

async fn export_turns(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let detail = state.get_thread_detail(&id, None).await.map_err(map_err)?;
    let turns: Vec<Value> = detail
        .turns
        .iter()
        .enumerate()
        .map(|(idx, turn)| {
            json!({
                "turnId": turn.id,
                "turnNumber": idx + 1,
                "startedAt": turn.started_at,
                "status": turn.status,
                "userPromptPreview": turn.items.iter().find(|i| i.kind == "userMessage").map(|i| i.text.clone()).unwrap_or_default()
            })
        })
        .collect();
    Ok(Json(
        json!({ "turns": turns, "totalTurnCount": detail.total_turn_count }),
    ))
}

async fn export_pdf(
    Path(id): Path<String>,
    Query(query): Query<ExportTranscriptQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let detail = state.get_thread_detail(&id, None).await.map_err(map_err)?;
    render_transcript_export(&detail, &query, query.format.as_deref().unwrap_or("pdf"))
}

async fn export_html(
    Path(id): Path<String>,
    Query(query): Query<ExportTranscriptQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let detail = state.get_thread_detail(&id, None).await.map_err(map_err)?;
    render_transcript_export(&detail, &query, "html")
}

fn render_transcript_export(
    detail: &remote_codex_protocol::ThreadDetailDto,
    query: &ExportTranscriptQuery,
    format: &str,
) -> Result<Response, ApiErr> {
    if !matches!(format, "pdf" | "html") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Export format must be pdf or html.",
        ));
    }
    let mode = query.mode.as_deref().unwrap_or("latest");
    if !matches!(mode, "latest" | "selected") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Export mode must be latest or selected.",
        ));
    }
    let profile = query.profile.as_deref().unwrap_or("review");
    if !matches!(profile, "review" | "technical") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Export profile must be review or technical.",
        ));
    }
    let turn_ids = query
        .turn_ids
        .as_deref()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let turns = crate::export::select_turns(&detail.turns, mode, query.limit, &turn_ids)
        .map_err(|error| err(StatusCode::BAD_REQUEST, "bad_request", error.to_string()))?;
    let options = crate::export::TranscriptExportOptions {
        profile: profile.into(),
        include_token_and_price: query.include_token_and_price.unwrap_or(true),
        include_command_output: query.include_command_output.unwrap_or(false),
        include_absolute_paths: query.include_absolute_paths.unwrap_or(false),
    };
    let (bytes, content_type, extension) = if format == "html" {
        (
            crate::export::html_transcript(detail, &turns, &options)
                .map_err(map_err)?
                .into_bytes(),
            "text/html; charset=utf-8",
            "html",
        )
    } else {
        (
            crate::export::pdf_transcript(detail, &turns, &options).map_err(map_err)?,
            "application/pdf",
            "pdf",
        )
    };
    let stem = safe_export_stem(&detail.thread.title);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"remote-codex-{stem}.{extension}\""),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::from(bytes))
        .map_err(|error| map_err(error.into()))
}

fn safe_export_stem(title: &str) -> String {
    let stem = title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if stem.is_empty() {
        "thread".into()
    } else {
        stem.chars().take(72).collect()
    }
}

async fn create_shell(
    Path(id): Path<String>,
    State(state): State<AppState>,
    body: Option<Json<ShellCreateBody>>,
) -> Result<Json<Value>, ApiErr> {
    let thread = state.get_thread(&id).map_err(map_err)?;
    let workspace = state.get_workspace(&thread.workspace_id).map_err(map_err)?;
    let body = body.map(|Json(body)| body).unwrap_or_default();
    let cols = body.cols.unwrap_or(80);
    let rows = body.rows.unwrap_or(24);
    if cols == 0 || rows == 0 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "Shell rows and columns must be positive.",
        ));
    }
    let (shell_id, shell) = crate::shells::hub()
        .create(
            &thread.id,
            &workspace.id,
            &workspace.abs_path,
            cols,
            rows,
            body.label,
        )
        .map_err(map_err)?;
    Ok(Json(json!({
        "threadId": thread.id,
        "workspaceId": workspace.id,
        "workspacePathStatus": "present",
        "state": "running",
        "shell": shell,
        "shells": [shell],
        "activeShellId": shell_id
    })))
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellCreateBody {
    cols: Option<u16>,
    rows: Option<u16>,
    label: Option<String>,
}

#[derive(Deserialize)]
struct ShellUpdateBody {
    label: Option<String>,
}

async fn update_shell(
    Path(id): Path<String>,
    Json(body): Json<ShellUpdateBody>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        crate::shells::hub()
            .update_label(&id, body.label)
            .map_err(map_err)?,
    ))
}

async fn terminate_shell(Path(id): Path<String>) -> Result<Json<Value>, ApiErr> {
    Ok(Json(crate::shells::hub().terminate(&id).map_err(map_err)?))
}

async fn workspace_download(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let requested_path = query
        .path
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "bad_request", "path is required"))?;
    let download =
        tokio::task::spawn_blocking(move || state.workspace_download(&id, &requested_path))
            .await
            .map_err(|error| map_err(error.into()))?
            .map_err(map_err)?;
    match download {
        WorkspaceDownload::File { path, bytes } => {
            let filename = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("workspace-file");
            download_response(
                filename,
                static_content_type(&path),
                bytes.len() as u64,
                Body::from(bytes),
            )
        }
        WorkspaceDownload::DirectoryArchive { filename, archive } => {
            let content_length = archive
                .as_file()
                .metadata()
                .map_err(|error| map_err(error.into()))?
                .len();
            let file =
                tokio::fs::File::from_std(archive.reopen().map_err(|error| map_err(error.into()))?);
            let stream = futures_util::stream::try_unfold(
                (file, archive),
                |(mut file, archive)| async move {
                    let mut buffer = vec![0u8; 64 * 1024];
                    let read = file.read(&mut buffer).await?;
                    if read == 0 {
                        Ok::<_, std::io::Error>(None)
                    } else {
                        buffer.truncate(read);
                        Ok::<_, std::io::Error>(Some((Bytes::from(buffer), (file, archive))))
                    }
                },
            );
            download_response(
                &filename,
                "application/zip",
                content_length,
                Body::from_stream(stream),
            )
        }
    }
}

fn download_response(
    filename: &str,
    content_type: &str,
    content_length: u64,
    body: Body,
) -> Result<Response, ApiErr> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, content_length)
        .header(
            header::CONTENT_DISPOSITION,
            attachment_content_disposition(filename),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(body)
        .map_err(|error| map_err(error.into()))
}

fn attachment_content_disposition(filename: &str) -> String {
    let fallback = filename
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let fallback = if fallback.is_empty() {
        "workspace-file".to_string()
    } else {
        fallback
    };
    let encoded = url::form_urlencoded::byte_serialize(filename.as_bytes()).collect::<String>();
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}

fn upload_file_name(filename: Option<&str>) -> String {
    filename
        .and_then(|name| FsPath::new(name).file_name())
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .unwrap_or("upload.bin")
        .to_string()
}

async fn workspace_upload(
    Path(id): Path<String>,
    State(state): State<AppState>,
    request: Request,
) -> Result<Json<Value>, ApiErr> {
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.contains("multipart/form-data") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "File upload must use multipart/form-data.",
        ));
    }
    let mut multipart = Multipart::from_request(request, &state)
        .await
        .map_err(|error| err(StatusCode::BAD_REQUEST, "bad_request", error.to_string()))?;
    let mut requested_path = None;
    let mut uploaded_file: Option<(String, Vec<u8>)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| err(StatusCode::BAD_REQUEST, "bad_request", error.to_string()))?
    {
        let field_name = field.name().unwrap_or_default().to_string();
        let filename = field.file_name().map(str::to_string);
        let bytes = field
            .bytes()
            .await
            .map_err(|error| err(StatusCode::BAD_REQUEST, "bad_request", error.to_string()))?;
        match field_name.as_str() {
            "path" if filename.is_none() => {
                requested_path = Some(String::from_utf8_lossy(&bytes).trim().to_string());
            }
            "file" => {
                if uploaded_file.is_some() {
                    return Err(err(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        "Only one file can be uploaded at a time.",
                    ));
                }
                if bytes.len() > MAX_WORKSPACE_UPLOAD_BYTES {
                    return Err(err(
                        StatusCode::BAD_REQUEST,
                        "bad_request",
                        "Workspace uploads must be 50 MB or smaller.",
                    ));
                }
                uploaded_file = Some((upload_file_name(filename.as_deref()), bytes.to_vec()));
            }
            _ if filename.is_some() => {
                return Err(err(
                    StatusCode::BAD_REQUEST,
                    "bad_request",
                    format!("Unexpected multipart file field: {field_name}."),
                ));
            }
            _ => {}
        }
    }
    let (filename, bytes) = uploaded_file.ok_or_else(|| {
        err(
            StatusCode::BAD_REQUEST,
            "bad_request",
            "A file field is required.",
        )
    })?;
    let path = requested_path
        .filter(|path| !path.is_empty())
        .unwrap_or(filename);
    let (path, size) = state
        .workspace_write_bytes(&id, &path, &bytes)
        .map_err(map_err)?;
    let name = FsPath::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("upload.bin");
    Ok(Json(json!({
        "kind": "file",
        "file": { "path": path, "name": name, "size": size }
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveBody {
    from_path: String,
    to_path: String,
}

async fn workspace_move(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<MoveBody>,
) -> Result<Json<Value>, ApiErr> {
    let ws = state.get_workspace(&id).map_err(map_err)?;
    let from = remote_codex_runtime::files::assert_within(
        std::path::Path::new(&ws.abs_path),
        std::path::Path::new(&body.from_path),
    )
    .map_err(map_err)?;
    let to = remote_codex_runtime::files::assert_within(
        std::path::Path::new(&ws.abs_path),
        std::path::Path::new(&body.to_path),
    )
    .map_err(map_err)?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| map_err(e.into()))?;
    }
    std::fs::rename(from, to).map_err(|e| map_err(e.into()))?;
    Ok(Json(json!({ "ok": true })))
}

async fn thread_shell(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let thread = state.get_thread(&id).map_err(map_err)?;
    let workspace = state.get_workspace(&thread.workspace_id).map_err(map_err)?;
    let shells = crate::shells::hub().list_for_thread(&thread.id);
    let active = shells
        .first()
        .and_then(|s| s.get("id").and_then(Value::as_str))
        .map(str::to_string);
    Ok(Json(json!({
        "threadId": thread.id,
        "workspaceId": workspace.id,
        "workspacePathStatus": if std::path::Path::new(&workspace.abs_path).exists() { "present" } else { "missing" },
        "state": if shells.is_empty() { "not_created" } else { "running" },
        "shell": shells.first().cloned(),
        "shells": shells,
        "activeShellId": active
    })))
}

const TERMINAL_PLUGIN_ID: &str = "remote-codex.terminal";

fn terminal_plugin(state: &Supervisor) -> Value {
    let available = cfg!(unix);
    json!({
        "id": TERMINAL_PLUGIN_ID,
        "name": "Terminal",
        "version": state.config.app_version.as_str(),
        "description": "Per-thread PTY terminal.",
        "remoteCodex": format!(">={}", state.config.app_version),
        "capabilities": { "artifactTypes": [], "timelineRenderers": [], "threadPanels": [{ "id": "terminal", "label": "Terminal", "kind": "terminal", "artifactTypes": [] }] },
        "enabled": available && state.plugin_enabled(TERMINAL_PLUGIN_ID, true),
        "source": "builtin",
        "available": available,
        "unavailableReasonCode": if available { Value::Null } else { json!("unsupported_platform") },
        "unavailableReason": if available { Value::Null } else { json!("Terminal is unavailable on this platform.") }
    })
}

async fn list_plugins(State(state): State<AppState>) -> Json<Value> {
    Json(json!([terminal_plugin(&state)]))
}

async fn get_plugin(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    if id != TERMINAL_PLUGIN_ID {
        return Err(err(
            StatusCode::NOT_FOUND,
            "not_found",
            "Plugin was not found.",
        ));
    }
    Ok(Json(terminal_plugin(&state)))
}

async fn import_plugin_unsupported() -> ApiErr {
    err(
        StatusCode::NOT_IMPLEMENTED,
        "unsupported",
        "Imported plugins are not supported by the Rust supervisor yet.",
    )
}

async fn delete_plugin(Path(id): Path<String>) -> Result<Json<Value>, ApiErr> {
    if id == TERMINAL_PLUGIN_ID {
        return Err(err(
            StatusCode::CONFLICT,
            "unsupported",
            "Built-in plugins cannot be uninstalled.",
        ));
    }
    Err(err(
        StatusCode::NOT_FOUND,
        "not_found",
        "Plugin was not found.",
    ))
}

async fn update_plugin(
    Path(id): Path<String>,
    State(state): State<AppState>,
    Json(input): Json<UpdatePluginInput>,
) -> Result<Json<Value>, ApiErr> {
    if id != TERMINAL_PLUGIN_ID {
        return Err(err(StatusCode::NOT_FOUND, "not_found", "plugin not found"));
    }
    state
        .set_plugin_enabled(TERMINAL_PLUGIN_ID, input.enabled)
        .map_err(map_err)?;
    Ok(Json(terminal_plugin(&state)))
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| crate::socket::websocket_loop(socket, state))
}

async fn model_pricing(State(state): State<AppState>) -> Json<Value> {
    Json(state.model_pricing())
}
async fn patch_model_pricing(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    state
        .update_model_pricing(&input)
        .map(Json)
        .map_err(map_err)
}

async fn subscription_usage(
    Path(provider): Path<String>,
    Query(query): Query<AgentQuery>,
    State(state): State<AppState>,
) -> Json<Value> {
    if state.config.fake_runtime {
        return Json(json!({"usage":null}));
    }
    let agent = query.agent_id.as_deref().unwrap_or(if provider == "acp" {
        "codex"
    } else {
        &provider
    });
    Json(json!({"usage":state.subscription_usage.read(agent).await}))
}
