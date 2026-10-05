//! Requests from this device to other devices of the same relay owner. Each one
//! travels through this device's relay tunnel and, except for the key handshake,
//! is end-to-end encrypted to the target. Contract: docs/cross-device-peer.zh.md.
use anyhow::Result;
use remote_codex_runtime::Supervisor;
use serde_json::{Map, Value};

/// This device as the relay knows it, learned from `relay.connected`.
#[derive(Clone, Debug)]
pub(crate) struct RelayIdentity {
    pub device_id: String,
    pub device_name: String,
}

/// A decrypted reply from another device's `/api/peer/...` handler.
#[derive(Debug)]
pub(crate) struct PeerResponse {
    pub status: u16,
    pub headers: Map<String, Value>,
    pub body: Vec<u8>,
}

/// Failures before the target's handler answered. Only `retryable()` ones may be
/// kept in the outbox; everything else is reported to the caller.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PeerError {
    #[error("relay tunnel is not connected")]
    RelayUnavailable,
    #[error("device {0} is offline")]
    Offline(String),
    #[error("device {0} did not respond in time")]
    Timeout(String),
    #[error("device identity changed for {0}; check `remote-codex relay-fingerprint` on that device, then run `remote-codex device trust {0} --reset`")]
    IdentityChanged(String),
    #[error("{code}: {message}")]
    Remote {
        status: u16,
        code: String,
        message: String,
    },
}

impl PeerError {
    pub(crate) fn retryable(&self) -> bool {
        matches!(
            self,
            Self::RelayUnavailable | Self::Offline(_) | Self::Timeout(_)
        )
    }
}

/// None until the tunnel has connected once in this process.
pub(crate) fn relay_identity(_state: &Supervisor) -> Option<RelayIdentity> {
    None
}

/// Devices owned by this device's relay owner, including this one (`self: true`):
/// `[{deviceId, name, online, self}]`.
pub(crate) async fn directory(_state: &Supervisor) -> Result<Vec<Value>> {
    Err(PeerError::RelayUnavailable.into())
}

/// One encrypted request to `/api/peer/...` on `device_id`. Ok carries any status
/// the target's handler returned; Err is a `PeerError` (or a local failure).
pub(crate) async fn request(
    _state: &Supervisor,
    _device_id: &str,
    _method: &str,
    _path_and_query: &str,
    _content_type: Option<&str>,
    _body: Vec<u8>,
) -> Result<PeerResponse> {
    Err(PeerError::RelayUnavailable.into())
}

/// POST JSON and decode the JSON reply. A non-2xx reply becomes `PeerError::Remote`
/// with the target's `{code, message}`.
pub(crate) async fn request_json(
    state: &Supervisor,
    device_id: &str,
    path: &str,
    body: &Value,
) -> Result<Value> {
    let response = request(
        state,
        device_id,
        "POST",
        path,
        Some("application/json"),
        serde_json::to_vec(body)?,
    )
    .await?;
    let value: Value = serde_json::from_slice(&response.body).unwrap_or(Value::Null);
    if !(200..300).contains(&response.status) {
        return Err(PeerError::Remote {
            status: response.status,
            code: value["code"].as_str().unwrap_or("peer_error").into(),
            message: value["message"].as_str().unwrap_or("request failed").into(),
        }
        .into());
    }
    Ok(value)
}

/// Forget a device's pinned identity after the user verified its new fingerprint.
pub(crate) fn reset_pin(_state: &Supervisor, _device_id: &str) -> Result<()> {
    anyhow::bail!("not implemented")
}
