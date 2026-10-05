//! Files between devices of the same owner. Target side: chunked uploads into a
//! thread's incoming folder and read-only workspace listing/reads under
//! `/api/peer/files/*`. Caller side: the functions below, used by `peer_send`.
//! Contract: docs/cross-device-peer.zh.md.
use crate::http::ApiErr;
use anyhow::Result;
use axum::{
    extract::{Path as UrlPath, State},
    http::StatusCode,
    Json,
};
use remote_codex_runtime::Supervisor;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

fn not_implemented() -> ApiErr {
    crate::http::err(
        StatusCode::NOT_IMPLEMENTED,
        "not_implemented",
        "peer files are not implemented yet",
    )
}

pub(crate) async fn upload_begin(
    State(_state): State<Arc<Supervisor>>,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

pub(crate) async fn upload_chunk(
    State(_state): State<Arc<Supervisor>>,
    UrlPath(_id): UrlPath<String>,
) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

pub(crate) async fn upload_commit(
    State(_state): State<Arc<Supervisor>>,
    UrlPath(_id): UrlPath<String>,
) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

pub(crate) async fn list(
    State(_state): State<Arc<Supervisor>>,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

pub(crate) async fn stat(
    State(_state): State<Arc<Supervisor>>,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

pub(crate) async fn read(State(_state): State<Arc<Supervisor>>) -> Result<Json<Value>, ApiErr> {
    Err(not_implemented())
}

/// Copy files, and zip directories, into `dir` so later edits cannot change what is
/// sent. Returns the staged regular files in input order.
pub(crate) fn stage(_paths: &[PathBuf], _dir: &Path) -> Result<Vec<PathBuf>> {
    anyhow::bail!("not implemented")
}

/// Upload staged regular files into `thread_id`'s incoming folder on `device_id`.
/// Returns `[{name, size, sha256, path, relativePath}]` as committed on the target.
pub(crate) async fn upload(
    _state: &Supervisor,
    _device_id: &str,
    _thread_id: &str,
    _files: &[PathBuf],
) -> Result<Vec<Value>> {
    anyhow::bail!("not implemented")
}

/// One directory level of a workspace on `device_id`.
pub(crate) async fn fs_list(
    _state: &Supervisor,
    _device_id: &str,
    _workspace_id: &str,
    _path: &str,
) -> Result<Value> {
    anyhow::bail!("not implemented")
}

/// Download one workspace file from `device_id`, verify it, and return
/// `{path, size, sha256}` of the local copy.
pub(crate) async fn fs_get(
    _state: &Supervisor,
    _device_id: &str,
    _workspace_id: &str,
    _path: &str,
    _out: Option<PathBuf>,
    _caller_thread: Option<&str>,
) -> Result<Value> {
    anyhow::bail!("not implemented")
}
