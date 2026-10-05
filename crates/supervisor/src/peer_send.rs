//! Caller side of device-to-device messaging: local `/api/cli` operations that
//! address another device, the device directory and opt-in, and the durable outbox.
//! Contract: docs/cross-device-peer.zh.md.
use remote_codex_runtime::Supervisor;
use serde_json::Value;
use std::sync::Arc;

/// Handles an `/api/cli` operation that concerns other devices; `None` leaves it to
/// the local handler. `caller` is the thread bound to the credential, if any.
pub(crate) async fn intercept(
    _state: &Arc<Supervisor>,
    _caller: Option<&str>,
    _input: &Value,
) -> anyhow::Result<Option<Value>> {
    Ok(None)
}

/// Delivers `peer:outbox:*` records. Idempotent; called once per router.
pub(crate) fn start_outbox_worker(_state: &Arc<Supervisor>) {}
