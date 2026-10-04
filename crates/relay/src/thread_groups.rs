//! Device-authenticated parent edges only; no conversation/model/file data.
use super::*;

pub(super) fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS relay_thread_lineage(device_id TEXT NOT NULL,thread_id TEXT NOT NULL,parent_thread_id TEXT,PRIMARY KEY(device_id,thread_id));CREATE INDEX IF NOT EXISTS relay_lineage_parent ON relay_thread_lineage(device_id,parent_thread_id);")?;
    Ok(())
}

pub(super) fn replace(conn: &Connection, device: &str, rows: &Value) -> Result<()> {
    let rows = rows
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("invalid lineage snapshot"))?;
    anyhow::ensure!(rows.len() <= 100_000, "lineage snapshot is too large");
    for row in rows {
        Uuid::parse_str(
            row["id"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("invalid thread id"))?,
        )?;
        if let Some(parent) = row["parentThreadId"].as_str() {
            Uuid::parse_str(parent)?;
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM relay_thread_lineage WHERE device_id=?1",
        [device],
    )?;
    for row in rows {
        tx.execute("INSERT INTO relay_thread_lineage(device_id,thread_id,parent_thread_id) VALUES(?1,?2,?3)",params![device,row["id"].as_str(),row["parentThreadId"].as_str()])?;
    }
    tx.commit()?;
    Ok(())
}

pub(super) fn contains(conn: &Connection, device: &str, parent: &str, target: &str) -> bool {
    if parent == target {
        return true;
    }
    conn.query_row("WITH RECURSIVE ancestors(id,depth) AS (SELECT parent_thread_id,1 FROM relay_thread_lineage WHERE device_id=?1 AND thread_id=?2 UNION ALL SELECT t.parent_thread_id,a.depth+1 FROM relay_thread_lineage t JOIN ancestors a ON t.thread_id=a.id AND t.device_id=?1 WHERE a.depth<3) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=?3)",params![device,target,parent],|r|r.get(0)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lineage_is_device_scoped_directional_and_replaced_atomically() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let root = Uuid::new_v4().to_string();
        let child = Uuid::new_v4().to_string();
        let grandchild = Uuid::new_v4().to_string();
        let other = Uuid::new_v4().to_string();
        replace(&conn,"device",&json!([{"id":root},{"id":child,"parentThreadId":root},{"id":grandchild,"parentThreadId":child},{"id":other}])).unwrap();
        assert!(contains(&conn, "device", &root, &child));
        assert!(contains(&conn, "device", &root, &grandchild));
        assert!(!contains(&conn, "device", &child, &root));
        assert!(!contains(&conn, "device", &root, &other));
        assert!(!contains(&conn, "another-device", &root, &child));
        assert!(replace(&conn, "device", &json!([{"id":"invalid"}])).is_err());
        assert!(contains(&conn, "device", &root, &child));
        replace(&conn, "device", &json!([{"id":root}])).unwrap();
        assert!(!contains(&conn, "device", &root, &child));
    }
}
