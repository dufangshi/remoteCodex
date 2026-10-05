//! Target side of device-to-device messaging: `/api/peer/cli` for other devices of
//! the same owner, and this device's opt-in. Contract: docs/cross-device-peer.zh.md.
use crate::http::{map_err, ApiErr};
use axum::{extract::State, http::StatusCode, Json};
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use std::sync::Arc;

pub(crate) async fn cli(
    State(_state): State<Arc<Supervisor>>,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    Err(crate::http::err(
        StatusCode::NOT_IMPLEMENTED,
        "not_implemented",
        "peer messaging is not implemented yet",
    ))
}

pub(crate) async fn access(State(state): State<Arc<Supervisor>>) -> Json<Value> {
    Json(json!({"enabled": state.peer_access_enabled()}))
}

pub(crate) async fn set_access(
    State(state): State<Arc<Supervisor>>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    let enabled = input["enabled"]
        .as_bool()
        .ok_or_else(|| map_err(anyhow::anyhow!("enabled must be true or false")))?;
    Ok(Json(state.set_peer_access(enabled).map_err(map_err)?))
}
