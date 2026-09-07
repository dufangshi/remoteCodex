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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn shared_resources_follow_their_own_live_device_and_current_name() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE relay_devices(id TEXT, name TEXT); INSERT INTO relay_devices VALUES ('a','Renamed Mac'),('b','Linux');").unwrap();
        let mut shares = vec![
            json!({"deviceId":"a","deviceName":"Old name"}),
            json!({"deviceId":"b"}),
            json!({"deviceId":"deleted"}),
        ];
        enrich(&conn, &HashSet::from(["a".into()]), &mut shares);
        assert_eq!(shares[0]["deviceName"], "Renamed Mac");
        assert_eq!(shares[0]["deviceConnected"], true);
        assert_eq!(shares[1]["deviceConnected"], false);
        assert_eq!(shares[2]["deviceConnected"], false);
        enrich(&conn, &HashSet::from(["b".into()]), &mut shares);
        assert_eq!(shares[0]["deviceConnected"], false);
        assert_eq!(shares[1]["deviceConnected"], true);
    }
}
