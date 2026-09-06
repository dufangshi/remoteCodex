//! Authenticator secrets and recovery material never leave this module after
//! enrollment. All verification/replay updates happen under the store lock.
use super::security::{random_token, token_hash};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, bail, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use totp_rs::{Algorithm, Secret, TOTP};

pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS relay_totp (
        user_id TEXT PRIMARY KEY REFERENCES relay_users(id) ON DELETE CASCADE,
        secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL, last_step INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS relay_recovery_codes (
        user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL, PRIMARY KEY(user_id,code_hash)
    );
    CREATE TABLE IF NOT EXISTS relay_trusted_browsers (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE, environment TEXT NOT NULL, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_factor_challenges (
        id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL, environment TEXT NOT NULL, session_hash TEXT,
        expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS relay_passkeys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
        credential TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER
    );
    CREATE TRIGGER IF NOT EXISTS relay_password_revoke_trust AFTER UPDATE OF password_hash ON relay_users
    BEGIN DELETE FROM relay_trusted_browsers WHERE user_id=NEW.id;
          DELETE FROM relay_factor_challenges WHERE user_id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS relay_disabled_revoke_trust AFTER UPDATE OF enabled ON relay_users WHEN NEW.enabled=0
    BEGIN DELETE FROM relay_trusted_browsers WHERE user_id=NEW.id;
          DELETE FROM relay_factor_challenges WHERE user_id=NEW.id; END;")?;
    Ok(())
}

fn cipher(master: &str) -> Result<Aes256Gcm> {
    let mut key = [0u8; 32];
    hkdf::Hkdf::<Sha256>::new(None, master.as_bytes())
        .expand(b"remote-codex/totp-storage/v1", &mut key)
        .map_err(|_| anyhow!("key derivation failed"))?;
    Aes256Gcm::new_from_slice(&key).map_err(|_| anyhow!("invalid storage key"))
}
fn seal(master: &str, user: &str, secret: &[u8]) -> Result<String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher(master)?
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: secret,
                aad: user.as_bytes(),
            },
        )
        .map_err(|_| anyhow!("secret encryption failed"))?;
    Ok(format!(
        "v1.{}.{}",
        URL_SAFE_NO_PAD.encode(nonce),
        URL_SAFE_NO_PAD.encode(encrypted)
    ))
}
fn unseal(master: &str, user: &str, data: &str) -> Result<Vec<u8>> {
    let parts: Vec<_> = data.split('.').collect();
    if parts.len() != 3 || parts[0] != "v1" {
        bail!("invalid encrypted secret");
    }
    let nonce = URL_SAFE_NO_PAD.decode(parts[1])?;
    if nonce.len() != 12 {
        bail!("invalid nonce");
    }
    cipher(master)?
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &URL_SAFE_NO_PAD.decode(parts[2])?,
                aad: user.as_bytes(),
            },
        )
        .map_err(|_| anyhow!("secret decryption failed"))
}
fn totp(secret: Vec<u8>, email: &str) -> Result<TOTP> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("Remote Codex".into()),
        email.replace(':', ""),
    )
    .map_err(Into::into)
}
pub(crate) fn has_totp(conn: &Connection, user: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM relay_totp WHERE user_id=?1 AND enabled=1)",
        params![user],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
pub(crate) fn has_factors(conn: &Connection, user: &str) -> bool {
    has_totp(conn, user)
        || conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM relay_passkeys WHERE user_id=?1)",
                params![user],
                |r| r.get(0),
            )
            .unwrap_or(false)
}

pub(crate) fn enroll(conn: &Connection, master: &str, user: &str, email: &str) -> Result<Value> {
    if has_totp(conn, user) {
        bail!("Authenticator is already enabled");
    }
    let secret = Secret::generate_secret();
    let bytes = secret.to_bytes()?;
    let otp = totp(bytes.clone(), email)?;
    conn.execute("INSERT INTO relay_totp(user_id,secret,expires_at) VALUES (?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,expires_at=excluded.expires_at,last_step=-1", params![user, seal(master,user,&bytes)?, now()+600_000])?;
    let url = otp.get_url();
    let qr = qrcodegen::QrCode::encode_text(&url, qrcodegen::QrCodeEcc::Medium)
        .map_err(|_| anyhow!("QR generation failed"))?;
    let mut path = String::new();
    for y in 0..qr.size() {
        for x in 0..qr.size() {
            if qr.get_module(x, y) {
                path.push_str(&format!("M{},{}h1v1h-1z", x + 4, y + 4));
            }
        }
    }
    let svg = format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {0} {0}'><path fill='white' d='M0 0h{0}v{0}H0z'/><path fill='black' d='{path}'/></svg>", qr.size()+8);
    Ok(json!({"secret": secret.to_encoded().to_string(), "uri": url, "qrSvg": svg}))
}

/// Return whether a recovery code was used, so it cannot silently trust a browser.
pub(crate) fn verify_code(
    conn: &Connection,
    master: &str,
    user: &str,
    code: &str,
    enrollment: bool,
) -> Result<bool> {
    let code = code.replace([' ', '-'], "");
    if code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()) {
        let row: Option<(String, i64, i64, i64)> = conn
            .query_row(
                "SELECT secret,enabled,expires_at,last_step FROM relay_totp WHERE user_id=?1",
                params![user],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        if let Some((secret, enabled, expires, last)) = row {
            if (enrollment && enabled == 0 && expires > now()) || (!enrollment && enabled == 1) {
                let otp = totp(unseal(master, user, &secret)?, "account")?;
                let step = now() / 30_000;
                for candidate in [step - 1, step, step + 1] {
                    if candidate > last
                        && bool::from(
                            otp.generate((candidate * 30) as u64)
                                .as_bytes()
                                .ct_eq(code.as_bytes()),
                        )
                    {
                        conn.execute(
                            "UPDATE relay_totp SET last_step=?2,enabled=1 WHERE user_id=?1",
                            params![user, candidate],
                        )?;
                        return Ok(false);
                    }
                }
            }
        }
    } else if !enrollment && code.len() == 20 {
        if conn.execute(
            "DELETE FROM relay_recovery_codes WHERE user_id=?1 AND code_hash=?2",
            params![
                user,
                token_hash(&format!("{user}:{}", code.to_ascii_lowercase()))
            ],
        )? == 1
        {
            return Ok(true);
        }
    }
    bail!("Code is invalid, expired, or already used")
}
pub(crate) fn recovery_codes(conn: &Connection, user: &str) -> Result<Vec<String>> {
    let transaction = conn.unchecked_transaction()?;
    let conn = &transaction;
    conn.execute(
        "DELETE FROM relay_recovery_codes WHERE user_id=?1",
        params![user],
    )?;
    let mut codes = Vec::new();
    for _ in 0..10 {
        let mut bytes = [0u8; 10];
        OsRng.fill_bytes(&mut bytes);
        let code = hex::encode(bytes);
        conn.execute(
            "INSERT INTO relay_recovery_codes(user_id,code_hash) VALUES (?1,?2)",
            params![user, token_hash(&format!("{user}:{code}"))],
        )?;
        codes.push(format!(
            "{}-{}-{}-{}",
            &code[..5],
            &code[5..10],
            &code[10..15],
            &code[15..]
        ));
    }
    transaction.commit()?;
    Ok(codes)
}

pub(crate) fn environment(headers: &axum::http::HeaderMap) -> String {
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("native");
    // Version updates should not invalidate trust. The random HttpOnly credential
    // is the security factor; this coarse environment only adds change detection.
    token_hash(
        &ua.chars()
            .filter(|c| !c.is_ascii_digit())
            .take(512)
            .collect::<String>(),
    )
}
pub(crate) fn browser_name(headers: &axum::http::HeaderMap) -> String {
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let browser = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Browser"
    };
    let os = if ua.contains("Android") {
        "Android"
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        "iOS"
    } else if ua.contains("Windows") {
        "Windows"
    } else if ua.contains("Mac") {
        "macOS"
    } else {
        "Linux / other"
    };
    format!("{browser} · {os}")
}
pub(crate) fn trusted(conn: &Connection, user: &str, headers: &axum::http::HeaderMap) -> bool {
    let Some(token) = super::security::cookie(headers, "remote_codex_trusted_browser") else {
        return false;
    };
    conn.execute("UPDATE relay_trusted_browsers SET last_used_at=?4 WHERE user_id=?1 AND token_hash=?2 AND environment=?3 AND expires_at>?4", params![user,token_hash(&token),environment(headers),now()]).ok() == Some(1)
}
pub(crate) fn trust(
    conn: &Connection,
    user: &str,
    headers: &axum::http::HeaderMap,
) -> Result<String> {
    let token = random_token();
    conn.execute(
        "DELETE FROM relay_trusted_browsers WHERE expires_at<=?1",
        params![now()],
    )?;
    conn.execute(
        "INSERT INTO relay_trusted_browsers VALUES (?1,?2,?3,?4,?5,?6,?7,?6)",
        params![
            uuid::Uuid::new_v4().to_string(),
            user,
            token_hash(&token),
            environment(headers),
            browser_name(headers),
            now(),
            now() + 30 * 24 * 60 * 60 * 1000
        ],
    )?;
    Ok(token)
}

pub(crate) fn challenge(
    conn: &Connection,
    user: &str,
    purpose: &str,
    headers: &axum::http::HeaderMap,
    session: Option<&str>,
    data: Value,
) -> Result<String> {
    conn.execute(
        "DELETE FROM relay_factor_challenges WHERE expires_at<=?1",
        params![now()],
    )?;
    conn.execute(
        "DELETE FROM relay_factor_challenges WHERE user_id=?1 AND purpose=?2",
        params![user, purpose],
    )?;
    let id = random_token();
    conn.execute("INSERT INTO relay_factor_challenges(id_hash,user_id,purpose,environment,session_hash,expires_at,data) VALUES (?1,?2,?3,?4,?5,?6,?7)", params![token_hash(&id),user,purpose,environment(headers),session.map(token_hash),now()+600_000,data.to_string()])?;
    Ok(id)
}

pub(crate) fn mark_strong(conn: &Connection, token: &str) -> Result<()> {
    conn.execute(
        "UPDATE relay_auth_sessions SET strong_auth_at=?2 WHERE token_hash=?1",
        params![token_hash(token), now()],
    )?;
    Ok(())
}
// Password changes require an explicit, single-use step-up, even after a recent login.
pub(crate) fn password_grant(
    conn: &Connection,
    user: &str,
    token: &str,
    headers: &axum::http::HeaderMap,
) -> Result<String> {
    conn.execute(
        "DELETE FROM relay_factor_challenges WHERE purpose='password-change' AND session_hash=?1",
        params![token_hash(token)],
    )?;
    challenge(
        conn,
        user,
        "password-change",
        headers,
        Some(token),
        serde_json::json!({}),
    )
}
pub(crate) fn consume_password_grant(
    conn: &Connection,
    user: &str,
    session: &str,
    proof: &str,
) -> bool {
    conn.execute("DELETE FROM relay_factor_challenges WHERE id_hash=?1 AND user_id=?2 AND session_hash=?3 AND purpose='password-change' AND expires_at>?4", params![token_hash(proof), user, token_hash(session), now()]).is_ok_and(|count| count == 1)
}

pub(crate) fn recent(conn: &Connection, token: &str) -> bool {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM relay_auth_sessions WHERE token_hash=?1 AND strong_auth_at>?2 AND expires_at>?3)", params![token_hash(token),now()-600_000,now()], |r|r.get(0)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
          CREATE TABLE relay_users(id TEXT PRIMARY KEY,password_hash TEXT,enabled INTEGER);
          INSERT INTO relay_users VALUES ('u','hash',1),('other','hash',1);
          CREATE TABLE relay_devices(token TEXT);",
        )
        .unwrap();
        super::super::security::ensure_schema(&conn).unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }
    #[test]
    fn password_proofs_are_single_use_session_bound_and_expire() {
        let conn = db();
        let headers = axum::http::HeaderMap::new();
        let proof = password_grant(&conn, "u", "session", &headers).unwrap();
        assert!(!consume_password_grant(&conn, "other", "session", &proof));
        assert!(!consume_password_grant(&conn, "u", "other-session", &proof));
        assert!(consume_password_grant(&conn, "u", "session", &proof));
        assert!(!consume_password_grant(&conn, "u", "session", &proof));
        let proof = password_grant(&conn, "u", "session", &headers).unwrap();
        conn.execute("UPDATE relay_factor_challenges SET expires_at=0", [])
            .unwrap();
        assert!(!consume_password_grant(&conn, "u", "session", &proof));
    }
    #[test]
    fn authenticator_enrollment_is_verified_encrypted_and_replay_resistant() {
        let conn = db();
        let data = enroll(&conn, "master secret", "u", "u@example.test").unwrap();
        assert!(!has_totp(&conn, "u"));
        let stored: String = conn
            .query_row("SELECT secret FROM relay_totp", [], |r| r.get(0))
            .unwrap();
        assert!(!stored.contains(data["secret"].as_str().unwrap()));
        assert!(unseal("wrong key", "u", &stored).is_err());
        assert!(unseal("master secret", "other", &stored).is_err());
        let otp = TOTP::from_url(data["uri"].as_str().unwrap()).unwrap();
        let code = otp.generate_current().unwrap();
        assert!(verify_code(&conn, "master secret", "u", &code, false).is_err());
        assert!(!verify_code(&conn, "master secret", "u", &code, true).unwrap());
        assert!(has_totp(&conn, "u"));
        assert!(verify_code(&conn, "master secret", "u", &code, false).is_err());
        assert!(enroll(&conn, "master secret", "u", "u@example.test").is_err());
    }
    #[test]
    fn recovery_codes_are_one_use_account_bound_and_replaceable() {
        let conn = db();
        let old = recovery_codes(&conn, "u").unwrap();
        assert!(verify_code(&conn, "secret", "other", &old[0], false).is_err());
        assert!(verify_code(&conn, "secret", "u", &old[0], false).unwrap());
        assert!(verify_code(&conn, "secret", "u", &old[0], false).is_err());
        let new = recovery_codes(&conn, "u").unwrap();
        assert!(verify_code(&conn, "secret", "u", &old[1], false).is_err());
        assert!(verify_code(&conn, "secret", "u", &new[0], false).unwrap());
    }
    #[test]
    fn trusted_browsers_expire_and_password_changes_revoke_them() {
        let conn = db();
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("user-agent", "Chrome/127.0 Linux".parse().unwrap());
        assert!(!trusted(&conn, "u", &headers));
        let token = trust(&conn, "u", &headers).unwrap();
        headers.insert(
            "cookie",
            format!("remote_codex_trusted_browser={token}")
                .parse()
                .unwrap(),
        );
        assert!(trusted(&conn, "u", &headers));
        assert!(!trusted(&conn, "other", &headers));
        headers.insert("user-agent", "Chrome/130.0 Linux".parse().unwrap());
        assert!(trusted(&conn, "u", &headers));
        headers.insert("user-agent", "Firefox/130.0 Windows".parse().unwrap());
        assert!(!trusted(&conn, "u", &headers));
        headers.insert("user-agent", "Chrome/127.0 Linux".parse().unwrap());
        conn.execute(
            "UPDATE relay_users SET password_hash='changed' WHERE id='u'",
            [],
        )
        .unwrap();
        assert!(!trusted(&conn, "u", &headers));
        let token = trust(&conn, "u", &headers).unwrap();
        headers.insert(
            "cookie",
            format!("remote_codex_trusted_browser={token}")
                .parse()
                .unwrap(),
        );
        conn.execute("UPDATE relay_trusted_browsers SET expires_at=0", [])
            .unwrap();
        assert!(!trusted(&conn, "u", &headers));
    }
}
