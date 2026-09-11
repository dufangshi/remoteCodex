use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

// Presence comes from authenticated live supervisor sockets, never a share's
// creation-time snapshot or another device selected by the browser.
pub(super) fn enrich(conn: &Connection, connected: &HashSet<String>, shares: &mut [Value]) {
    let mut names = HashMap::new();
    for share in shares {
        let Some(id) = share["deviceId"].as_str().map(str::to_owned) else {
            continue;
        };
        let name = names.entry(id.clone()).or_insert_with(|| {
            conn.query_row("SELECT name FROM relay_devices WHERE id=?1", [&id], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .ok()
            .flatten()
        });
        if let Some(name) = name {
            share["deviceName"] = Value::String(name.clone());
        }
        share["deviceConnected"] = Value::Bool(connected.contains(&id));
    }
}
