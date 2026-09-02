use std::sync::Arc;

use axum::extract::multipart::Multipart;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{DefaultBodyLimit, FromRequest, Path, Query, Request, State, WebSocketUpgrade};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use remote_codex_protocol::{
    now_rfc3339, ApiError, AuthSessionDto, CreateThreadInput, CreateWorkspaceInput, HealthDto,
    PlatformCapabilitiesDto, Provider, RuntimeConfigDto, SendThreadPromptInput,
    SupervisorConnectedEnvelope, ThreadWorkspaceTreeNodeDto, UpdateWorkspaceSettingsInput,
    VersionDto, APP_NAME, APP_VERSION,
};
use remote_codex_runtime::Supervisor;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::{Any, CorsLayer};

pub type AppState = Arc<Supervisor>;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(healthz))
        .route("/api/version", get(version))
        .route("/api/config/runtime", get(runtime_config))
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
        .route("/api/threads/{id}/settings", patch(thread_settings))
        .route("/api/threads/{id}/prompt", post(thread_prompt))
        .route("/api/threads/{id}/interrupt", post(thread_interrupt))
        .route("/api/threads/{id}/resume", post(thread_resume))
        .route("/api/threads/{id}/disconnect", post(thread_disconnect))
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
        .route("/api/threads/{id}/export-turns", get(export_turns))
        .route("/api/threads/{id}/exports/pdf", get(export_pdf))
        .route("/api/threads/{id}/exports/html", get(export_html))
        .route(
            "/api/threads/{id}/shell",
            get(thread_shell).post(create_shell),
        )
        .route(
            "/api/workspaces/{id}/files/download",
            get(workspace_download),
        )
        .route("/api/workspaces/{id}/files/move", patch(workspace_move))
        .route("/api/plugins", get(list_plugins))
        .route("/ws", get(ws_upgrade))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
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

async fn auth_session(State(state): State<AppState>) -> Json<AuthSessionDto> {
    Json(AuthSessionDto {
        authenticated: !state.config.auth_required,
        username: if state.config.auth_required {
            None
        } else {
            Some("local".into())
        },
        expires_at: None,
        mode: state.config.mode,
        auth_required: state.config.auth_required,
    })
}

#[derive(Deserialize)]
struct LoginInput {
    username: Option<String>,
    password: Option<String>,
}

async fn auth_login(
    State(state): State<AppState>,
    Json(body): Json<LoginInput>,
) -> Result<Json<Value>, ApiErr> {
    if !state.config.auth_required {
        return Ok(Json(json!({ "ok": true, "token": "local" })));
    }
    let user = state.config.admin_username.as_deref().unwrap_or("admin");
    let pass = state.config.admin_password.as_deref().unwrap_or("");
    if body.username.as_deref() != Some(user) || body.password.as_deref() != Some(pass) {
        return Err(err(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Invalid credentials",
        ));
    }
    Ok(Json(json!({ "ok": true, "token": "session" })))
}

async fn auth_logout() -> Json<Value> {
    Json(json!({ "ok": true }))
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
}

async fn agent_models(
    Path(provider): Path<String>,
    Query(query): Query<AgentQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let provider = parse_provider(&provider)?;
    let models = state
        .list_models(provider, query.agent_id.as_deref())
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
) -> Result<StatusCode, ApiErr> {
    state.delete_workspace(&id).map_err(map_err)?;
    Ok(StatusCode::NO_CONTENT)
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
        name: std::path::Path::new(&ws.abs_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".into()),
        path: rel.replace('\\', "/"),
        kind: "directory".into(),
        size: None,
        has_children: Some(true),
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
    let preview = state.workspace_preview(&id, &path).map_err(map_err)?;
    Ok((StatusCode::OK, preview.content).into_response())
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

async fn import_thread() -> Result<Json<Value>, ApiErr> {
    Err(err(
        StatusCode::BAD_REQUEST,
        "bad_request",
        "import is not available for ACP-only sessions",
    ))
}

async fn import_candidates() -> Json<Value> {
    Json(json!([]))
}

#[derive(Deserialize)]
struct DetailQuery {
    limit: Option<u32>,
}

async fn get_thread(
    Path(id): Path<String>,
    Query(query): Query<DetailQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    Ok(Json(
        serde_json::to_value(
            state
                .get_thread_detail(&id, query.limit)
                .await
                .map_err(map_err)?,
        )
        .unwrap(),
    ))
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
        let mut model = None;
        let mut reasoning_effort = None;
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
                "model" => model = Some(String::from_utf8_lossy(&bytes).into_owned()),
                "reasoningEffort" | "reasoning_effort" => {
                    reasoning_effort = Some(String::from_utf8_lossy(&bytes).into_owned())
                }
                _ if file_name.is_some() => {
                    files.push((
                        file_name.unwrap_or_else(|| name.clone()),
                        mime,
                        bytes.to_vec(),
                    ));
                }
                _ => {}
            }
        }
        let (prompt, images) = state
            .prepare_prompt_attachments(&id, &prompt, files)
            .map_err(map_err)?;
        SendThreadPromptInput {
            prompt,
            client_request_id: None,
            model,
            reasoning_effort,
            collaboration_mode: None,
            images: images
                .into_iter()
                .map(|image| remote_codex_protocol::PromptImageDto {
                    mime_type: image.mime_type,
                    data: image.data,
                })
                .collect(),
        }
    } else {
        let bytes = axum::body::to_bytes(request.into_body(), 32 * 1024 * 1024)
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?;
        serde_json::from_slice::<SendThreadPromptInput>(&bytes)
            .map_err(|e| err(StatusCode::BAD_REQUEST, "bad_request", e.to_string()))?
    };
    let background = state.clone();
    let background_id = id.clone();
    tokio::spawn(async move {
        if let Err(err) = background.prompt(&background_id, input).await {
            tracing::warn!(error = %err, "prompt failed");
        }
    });
    for _ in 0..100 {
        if let Ok(thread) = state.get_thread(&id) {
            if thread.status == "running"
                || thread.status == "idle"
                || thread.status == "interrupted"
                || thread.status == "failed"
            {
                if thread.status != "idle" || thread.last_turn_started_at.is_some() {
                    return Ok(Json(serde_json::to_value(thread).unwrap()));
                }
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
        serde_json::to_value(state.get_thread(&id).map_err(map_err)?).unwrap(),
    ))
}

async fn thread_fork(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let thread = state.fork_thread(&id).await.map_err(map_err)?;
    let detail = state
        .get_thread_detail(&thread.id, None)
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "thread": detail,
        "sourceThreadId": id,
        "sourceTurnId": null,
        "sourceTurnIndex": null
    })))
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
}

async fn thread_goal(
    Path(id): Path<String>,
    State(state): State<AppState>,
    body: Option<Json<GoalBody>>,
) -> Result<Json<Value>, ApiErr> {
    let (objective, status) = body
        .map(|Json(b)| (b.objective, b.status))
        .unwrap_or((None, None));
    Ok(Json(
        state
            .thread_goal(&id, objective, status, false)
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
            .thread_goal(&id, None, None, true)
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
    #[allow(dead_code)]
    answers: Option<Value>,
}

async fn thread_respond(
    Path((id, request_id)): Path<(String, String)>,
    State(state): State<AppState>,
    body: Option<Json<RespondBody>>,
) -> Result<Json<Value>, ApiErr> {
    let allow = body.map(|Json(b)| b.allow.unwrap_or(true)).unwrap_or(true);
    state
        .respond_request(&id, &request_id, allow)
        .await
        .map_err(map_err)?;
    Ok(Json(json!({ "ok": true, "requestId": request_id })))
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
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let detail = state.get_thread_detail(&id, None).await.map_err(map_err)?;
    let bytes = crate::export::pdf_transcript(&detail).map_err(map_err)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/pdf")],
        bytes,
    )
        .into_response())
}

async fn export_html(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let detail = state.get_thread_detail(&id, None).await.map_err(map_err)?;
    let html = crate::export::html_transcript(&detail).map_err(map_err)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response())
}

async fn create_shell(
    Path(id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiErr> {
    let thread = state.get_thread(&id).map_err(map_err)?;
    let workspace = state.get_workspace(&thread.workspace_id).map_err(map_err)?;
    let (shell_id, shell) = crate::shells::hub()
        .create(&thread.id, &workspace.abs_path)
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

async fn workspace_download(
    Path(id): Path<String>,
    Query(query): Query<PathQuery>,
    State(state): State<AppState>,
) -> Result<Response, ApiErr> {
    let path = query
        .path
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "bad_request", "path is required"))?;
    let preview = state.workspace_preview(&id, &path).map_err(map_err)?;
    Ok((StatusCode::OK, preview.content).into_response())
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

async fn list_plugins() -> Json<Value> {
    Json(json!([
        {
            "id": "remote-codex.terminal",
            "name": "Terminal",
            "version": "0.12.0",
            "description": "Per-thread PTY terminal.",
            "remoteCodex": ">=0.12.0",
            "capabilities": { "artifactTypes": [], "timelineRenderers": [], "threadPanels": [{ "id": "terminal", "label": "Terminal", "kind": "terminal", "artifactTypes": [] }] },
            "enabled": cfg!(unix),
            "source": "builtin",
            "available": cfg!(unix)
        },
        {
            "id": "remote-codex.xyz-viewer",
            "name": "XYZ Molecule Viewer",
            "version": "0.12.0",
            "description": "3D molecule artifacts.",
            "remoteCodex": ">=0.12.0",
            "capabilities": { "artifactTypes": [{ "type": "molecule", "title": "Molecule", "fileExtensions": [".xyz", ".pdb", ".cif"] }], "timelineRenderers": ["molecule"], "threadPanels": [] },
            "enabled": true,
            "source": "builtin",
            "available": true
        }
    ]))
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| socket_loop(socket, state))
}

async fn socket_loop(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();
    let _ = sink
        .send(Message::Text(
            serde_json::to_string(&SupervisorConnectedEnvelope {
                event_type: "supervisor.connected".into(),
                timestamp: now_rfc3339(),
            })
            .unwrap_or_else(|_| "{}".into())
            .into(),
        ))
        .await;
    let mut events = state.bus.subscribe();
    let mut shells = crate::shells::hub().subscribe_all();
    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if text.contains("supervisor.ping") {
                            let pong = json!({
                                "type": "supervisor.pong",
                                "timestamp": now_rfc3339(),
                                "payload": { "requestTimestamp": now_rfc3339() }
                            });
                            if sink.send(Message::Text(pong.to_string().into())).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                            match msg.get("type").and_then(Value::as_str) {
                                Some("shell.input") => {
                                    if let (Some(id), Some(data)) = (
                                        msg.get("shellId").and_then(Value::as_str),
                                        msg.get("data").and_then(Value::as_str),
                                    ) {
                                        let _ = crate::shells::hub().write(id, data);
                                    }
                                }
                                Some("shell.resize") => {
                                    if let (Some(id), Some(cols), Some(rows)) = (
                                        msg.get("shellId").and_then(Value::as_str),
                                        msg.get("cols").and_then(Value::as_u64),
                                        msg.get("rows").and_then(Value::as_u64),
                                    ) {
                                        let _ = crate::shells::hub().resize(id, cols as u16, rows as u16);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if sink.send(Message::Text(serde_json::to_string(&event).unwrap_or_else(|_| "{}".into()).into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => continue,
                }
            }
            output = shells.recv() => {
                match output {
                    Ok(output) => {
                        let msg = json!({
                            "type": "shell.output",
                            "shellId": output.shell_id,
                            "timestamp": now_rfc3339(),
                            "payload": { "data": output.data }
                        });
                        if sink.send(Message::Text(msg.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => continue,
                }
            }
        }
    }
}
