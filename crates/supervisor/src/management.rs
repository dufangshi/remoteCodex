use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use remote_codex_runtime::{management, Supervisor};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub async fn harnesses(State(state): State<Arc<Supervisor>>) -> Json<Value> {
    Json(management::inventory(&state).await)
}
pub async fn jobs(State(state): State<Arc<Supervisor>>) -> Json<Value> {
    Json(json!(*state.management_jobs.lock().unwrap()))
}

#[derive(Deserialize)]
pub struct HarnessAction {
    action: String,
    #[serde(default = "base")]
    component: String,
}
fn base() -> String {
    "base".into()
}

pub async fn harness_action(
    State(state): State<Arc<Supervisor>>,
    Path(id): Path<String>,
    Json(body): Json<HarnessAction>,
) -> Response {
    if !matches!(body.action.as_str(), "restart" | "update")
        || !remote_codex_runtime::acp::builtin_agents(state.config.acp_command.as_deref())
            .iter()
            .any(|d| d.id == id)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"code":"bad_request","message":"Unknown harness action"})),
        )
            .into_response();
    }
    let Ok(maintenance) = state.maintenance_gate.clone().try_read_owned() else {
        return (
            StatusCode::CONFLICT,
            Json(json!({"code":"conflict","message":"Supervisor update in progress"})),
        )
            .into_response();
    };
    let Ok(guard) = state.harness_gate(&id).try_write_owned() else {
        return (StatusCode::CONFLICT, Json(json!({"code":"conflict","message":"This harness is busy. Wait for its turns to finish or stop them before maintenance."}))).into_response();
    };
    state
        .management_jobs
        .lock()
        .unwrap()
        .insert(id.clone(), json!({"state":"running","action":body.action}));
    tokio::spawn(async move {
        let _guard = guard;
        let _maintenance = maintenance;
        let result = if body.action == "restart" {
            state.restart_harness(&id).await.map(|_| ())
        } else {
            management::update_harness(&state, &id, &body.component).await
        };
        let value = match result {
            Ok(()) => json!({"state":"completed","action":body.action}),
            Err(error) => json!({"state":"failed","action":body.action,"error":error.to_string()}),
        };
        state.management_jobs.lock().unwrap().insert(id, value);
    });
    (StatusCode::ACCEPTED, Json(json!({"state":"running"}))).into_response()
}

async fn updater(state: &Supervisor, action: &str) -> anyhow::Result<Value> {
    let node = std::env::var_os("REMOTE_CODEX_LAUNCHER_NODE").ok_or_else(|| {
        anyhow::anyhow!("This Supervisor was not started by an updatable npm launcher")
    })?;
    let launcher = std::path::PathBuf::from(
        std::env::var_os("REMOTE_CODEX_LAUNCHER_PATH")
            .ok_or_else(|| anyhow::anyhow!("Launcher path unavailable"))?,
    );
    let helper = launcher.with_file_name("supervisor-update.mjs");
    let mut cmd = tokio::process::Command::new(node);
    cmd.args([helper.as_os_str(), action.as_ref()])
        .env("REMOTE_CODEX_UPDATE_DATABASE", &state.config.database_url)
        .env(
            "REMOTE_CODEX_UPDATE_RUNNING_VERSION",
            env!("CARGO_PKG_VERSION"),
        )
        .env("REMOTE_CODEX_UPDATE_PID", std::process::id().to_string())
        .env("REMOTE_CODEX_UPDATE_EXECUTABLE", std::env::current_exe()?)
        .env(
            "REMOTE_CODEX_UPDATE_MODE",
            if state.config.mode == remote_codex_protocol::Mode::Relay {
                "relay"
            } else {
                "local"
            },
        )
        .env("REMOTE_CODEX_UPDATE_PORT", state.config.port.to_string())
        .env("REMOTE_CODEX_UPDATE_HOST", &state.config.host)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let result = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await??;
    if !result.status.success() {
        anyhow::bail!("Update helper failed. Check the device update log.");
    }
    Ok(serde_json::from_slice(&result.stdout)?)
}
pub async fn supervisor_status(State(state): State<Arc<Supervisor>>) -> Json<Value> {
    Json(updater(&state, "status").await.unwrap_or_else(|error| json!({"runningVersion":env!("CARGO_PKG_VERSION"),"canUpdate":false,"reason":error.to_string()})))
}
pub async fn supervisor_check(State(state): State<Arc<Supervisor>>) -> Response {
    update_response(&state, "check").await
}
pub async fn supervisor_update(State(state): State<Arc<Supervisor>>) -> Response {
    let Ok(guard) = state.maintenance_gate.clone().try_write_owned() else {
        return (StatusCode::CONFLICT, Json(json!({"code":"conflict","message":"Wait for running turns to finish before updating the Supervisor."}))).into_response();
    };
    match updater(&state, "launch").await {
        Ok(value) => {
            if value["canUpdate"] == true
                && value["job"]["phase"].as_str().is_some_and(|phase| {
                    matches!(
                        phase,
                        "scheduled" | "preparing" | "installing" | "restarting"
                    )
                })
            {
                tokio::spawn(async move {
                    let _guard = guard;
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        if let Ok(status) = updater(&state, "status").await {
                            if status["job"]["phase"].as_str().is_some_and(|phase| {
                                matches!(
                                    phase,
                                    "completed" | "failed" | "rolled-back" | "rollback-failed"
                                )
                            }) {
                                break;
                            }
                        }
                    }
                });
            }
            Json(value).into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"code":"update_unavailable","message":error.to_string()})),
        )
            .into_response(),
    }
}

async fn update_response(state: &Supervisor, action: &str) -> Response {
    match updater(state, action).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({"code":"update_unavailable","message":error.to_string()})),
        )
            .into_response(),
    }
}
