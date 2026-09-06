//! Recoverable, encrypted setup credentials. The original device hash remains valid
//! when a hash-only legacy record needs an additional setup credential.
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::Sha256;

pub(crate) fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS relay_device_setup_tokens (
        device_id TEXT PRIMARY KEY REFERENCES relay_devices(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, encrypted_token TEXT NOT NULL
    );",
    )?;
    Ok(())
}
fn cipher(master: &str) -> Result<Aes256Gcm> {
    let mut key = [0u8; 32];
    hkdf::Hkdf::<Sha256>::new(None, master.as_bytes())
        .expand(b"remote-codex/device-setup-storage/v1", &mut key)
        .map_err(|_| anyhow!("key derivation failed"))?;
    Aes256Gcm::new_from_slice(&key).map_err(|_| anyhow!("invalid storage key"))
}
pub(crate) fn save(conn: &Connection, master: &str, id: &str, token: &str) -> Result<()> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher(master)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: token.as_bytes(),
                aad: id.as_bytes(),
            },
        )
        .map_err(|_| anyhow!("device token encryption failed"))?;
    conn.execute(
        "INSERT INTO relay_device_setup_tokens(device_id,token_hash,encrypted_token)
        VALUES (?1,?2,?3) ON CONFLICT(device_id) DO UPDATE SET
        token_hash=excluded.token_hash,encrypted_token=excluded.encrypted_token",
        params![
            id,
            super::hash_device_token(token),
            format!(
                "{}.{}",
                URL_SAFE_NO_PAD.encode(nonce),
                URL_SAFE_NO_PAD.encode(encrypted)
            )
        ],
    )?;
    conn.execute(
        "UPDATE relay_devices SET token=NULL WHERE id=?1",
        params![id],
    )?;
    Ok(())
}
pub(crate) fn get_or_create(conn: &Connection, master: &str, id: &str) -> Result<String> {
    let legacy: Option<Option<String>> = conn
        .query_row(
            "SELECT token FROM relay_devices WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(legacy) = legacy else {
        bail!("device not found");
    };
    let stored: Option<String> = conn
        .query_row(
            "SELECT encrypted_token FROM relay_device_setup_tokens WHERE device_id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(stored) = stored {
        let (nonce, data) = stored
            .split_once('.')
            .ok_or_else(|| anyhow!("invalid stored credential"))?;
        let nonce = URL_SAFE_NO_PAD.decode(nonce)?;
        if nonce.len() != 12 {
            bail!("invalid credential nonce");
        }
        let plain = cipher(master)?
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &URL_SAFE_NO_PAD.decode(data)?,
                    aad: id.as_bytes(),
                },
            )
            .map_err(|_| anyhow!("device token decryption failed"))?;
        return Ok(String::from_utf8(plain)?);
    }
    // A deleted secret cannot be reversed from its hash. Issue a stable additional
    // credential for this device without revoking its installed credential.
    let token = legacy
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| format!("rcd_{}", super::security::random_token()));
    save(conn, master, id, &token)?;
    Ok(token)
}
pub(crate) fn migrate(conn: &Connection, master: &str) -> Result<()> {
    ensure_schema(conn)?;
    let rows = conn
        .prepare("SELECT id,token FROM relay_devices WHERE token IS NOT NULL AND token<>''")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let tx = conn.unchecked_transaction()?;
    for (id, token) in rows {
        save(&tx, master, &id, &token)?;
    }
    // Some installations retain the pre-Rust table. Recover only credentials
    // whose hash still matches, never resurrecting a token revoked since then.
    if let Ok(mut old) = tx.prepare("SELECT id,token FROM devices WHERE token IS NOT NULL") {
        let rows = old
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, token) in rows {
            remember_authenticated(&tx, master, &id, &token)?;
        }
    }
    tx.commit()?;
    Ok(())
}
pub(crate) fn remember_authenticated(
    conn: &Connection,
    master: &str,
    id: &str,
    token: &str,
) -> Result<()> {
    let missing: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM relay_devices d WHERE d.id=?1 AND d.token_hash=?2 AND NOT EXISTS(SELECT 1 FROM relay_device_setup_tokens s WHERE s.device_id=d.id))", params![id, super::hash_device_token(token)], |r| r.get(0))?;
    if missing {
        save(conn, master, id, token)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE relay_devices(id TEXT PRIMARY KEY,token TEXT,token_hash TEXT);").unwrap();
        ensure_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO relay_devices VALUES ('device',NULL,?1)",
            params![crate::hash_device_token("original")],
        )
        .unwrap();
        conn
    }
    #[test]
    fn hash_only_device_gets_repeatable_setup_without_revoking_installed_token() {
        let conn = database();
        let token = get_or_create(&conn, "master", "device").unwrap();
        assert_eq!(get_or_create(&conn, "master", "device").unwrap(), token);
        for accepted in [&token, "original"] {
            assert_eq!(
                crate::device_id_for_supervisor_token(&conn, accepted, None).as_deref(),
                Some("device")
            );
        }
        let encrypted: String = conn
            .query_row(
                "SELECT encrypted_token FROM relay_device_setup_tokens",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!encrypted.contains(&token));
        assert!(get_or_create(&conn, "wrong-master", "device").is_err());
        conn.execute(
            "UPDATE relay_devices SET token_hash=?1",
            params![crate::hash_device_token("rotated")],
        )
        .unwrap();
        save(&conn, "master", "device", "rotated").unwrap();
        assert!(crate::device_id_for_supervisor_token(&conn, &token, None).is_none());
        assert!(crate::device_id_for_supervisor_token(&conn, "original", None).is_none());
        conn.execute("DELETE FROM relay_devices", []).unwrap();
        assert!(crate::device_id_for_supervisor_token(&conn, "rotated", None).is_none());
    }
    #[test]
    fn migration_and_authenticated_reconnect_preserve_original_value() {
        let conn = database();
        conn.execute("UPDATE relay_devices SET token='original'", [])
            .unwrap();
        migrate(&conn, "master").unwrap();
        migrate(&conn, "master").unwrap();
        assert_eq!(
            get_or_create(&conn, "master", "device").unwrap(),
            "original"
        );
        assert!(conn
            .query_row("SELECT token IS NULL FROM relay_devices", [], |r| r
                .get::<_, bool>(0))
            .unwrap());
        conn.execute("DELETE FROM relay_device_setup_tokens", [])
            .unwrap();
        conn.execute_batch("CREATE TABLE devices(id TEXT, token TEXT); INSERT INTO devices VALUES ('device','revoked');").unwrap();
        migrate(&conn, "master").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM relay_device_setup_tokens", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        conn.execute("UPDATE devices SET token='original'", [])
            .unwrap();
        migrate(&conn, "master").unwrap();
        assert_eq!(
            get_or_create(&conn, "master", "device").unwrap(),
            "original"
        );
        conn.execute("DELETE FROM relay_device_setup_tokens", [])
            .unwrap();
        remember_authenticated(&conn, "master", "device", "wrong").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM relay_device_setup_tokens", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        remember_authenticated(&conn, "master", "device", "original").unwrap();
        assert_eq!(
            get_or_create(&conn, "master", "device").unwrap(),
            "original"
        );
    }
}
