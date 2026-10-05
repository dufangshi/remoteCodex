//! Opt-in for requests to and from other devices of the same relay owner. Off by
//! default; see docs/cross-device-peer.zh.md.
use crate::Supervisor;
use anyhow::Result;
use remote_codex_protocol::now_rfc3339;
use serde_json::{json, Value};

const SETTINGS: &str = "peer:settings";

impl Supervisor {
    pub fn peer_access_enabled(&self) -> bool {
        self.db
            .get_kv(SETTINGS)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .is_some_and(|settings| settings["enabled"] == true)
    }

    pub fn set_peer_access(&self, enabled: bool) -> Result<Value> {
        let settings = json!({"enabled": enabled, "updatedAt": now_rfc3339()});
        self.db.set_kv(SETTINGS, &settings.to_string())?;
        Ok(settings)
    }
}
