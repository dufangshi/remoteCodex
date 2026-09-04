use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Result};
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::StatusCode;
use axum::http::{header, HeaderMap, Method, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, patch, post};
use axum::{Json, Router};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use rand::{rngs::OsRng, RngCore};
use remote_codex_protocol::{now_rfc3339, ApiError};
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use scrypt::{scrypt, Params as ScryptParams};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

struct RelayStore {
    conn: Mutex<Connection>,
    session_secret: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayMigrationReport {
    pub source_kind: String,
    pub source_path: Option<PathBuf>,
    pub destination_path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub action: String,
    pub applied: bool,
    pub ready_for_rust: bool,
    pub user_count: i64,
    pub device_count: i64,
    pub share_count: i64,
    pub grant_count: i64,
    pub hosted_sandbox_count: i64,
    pub oauth_identity_count: i64,
    pub pending_registration_count: i64,
    pub active_unsupported_settings: Vec<String>,
    pub unsupported_data_allowed: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RelayMigrationOptions {
    pub allow_unsupported_data: bool,
}

pub fn inspect_relay_migration(data_dir: impl AsRef<FsPath>) -> Result<RelayMigrationReport> {
    let data_dir = data_dir.as_ref();
    let canonical_path = data_dir.join("relay-store.sqlite");
    let legacy_rust_path = data_dir.join("relay.sqlite");
    if canonical_path.exists() {
        let counts = relay_database_counts(&canonical_path, true)?;
        let unsupported = unsupported_relay_data(&canonical_path)?;
        let ready_for_rust = rust_schema_ready(&canonical_path)?;
        return Ok(RelayMigrationReport {
            source_kind: "node".to_string(),
            source_path: Some(canonical_path.clone()),
            destination_path: canonical_path,
            backup_path: Some(data_dir.join("relay-store.pre-rust-0.12.sqlite")),
            action: if ready_for_rust {
                "already-ready".to_string()
            } else {
                "backup-and-validate-canonical".to_string()
            },
            applied: false,
            ready_for_rust,
            user_count: counts.0,
            device_count: counts.1,
            share_count: counts.2,
            grant_count: counts.3,
            hosted_sandbox_count: unsupported.0,
            oauth_identity_count: unsupported.1,
            pending_registration_count: unsupported.2,
            active_unsupported_settings: unsupported.3,
            unsupported_data_allowed: false,
        });
    }
    if legacy_rust_path.exists() {
        let counts = relay_database_counts(&legacy_rust_path, false)?;
        return Ok(RelayMigrationReport {
            source_kind: "legacy-rust".to_string(),
            source_path: Some(legacy_rust_path),
            destination_path: canonical_path,
            backup_path: None,
            action: "copy-and-import-legacy-rust".to_string(),
            applied: false,
            ready_for_rust: false,
            user_count: counts.0,
            device_count: counts.1,
            share_count: counts.2,
            grant_count: counts.3,
            hosted_sandbox_count: 0,
            oauth_identity_count: 0,
            pending_registration_count: 0,
            active_unsupported_settings: Vec::new(),
            unsupported_data_allowed: false,
        });
    }
    Ok(RelayMigrationReport {
        source_kind: "none".to_string(),
        source_path: None,
        destination_path: canonical_path,
        backup_path: None,
        action: "initialize-new-database".to_string(),
        applied: false,
        ready_for_rust: false,
        user_count: 0,
        device_count: 0,
        share_count: 0,
        grant_count: 0,
        hosted_sandbox_count: 0,
        oauth_identity_count: 0,
        pending_registration_count: 0,
        active_unsupported_settings: Vec::new(),
        unsupported_data_allowed: false,
    })
}

pub fn migrate_relay_data_dir(data_dir: impl AsRef<FsPath>) -> Result<RelayMigrationReport> {
    migrate_relay_data_dir_with_options(data_dir, RelayMigrationOptions::default())
}

pub fn migrate_relay_data_dir_with_options(
    data_dir: impl AsRef<FsPath>,
    options: RelayMigrationOptions,
) -> Result<RelayMigrationReport> {
    let data_dir = data_dir.as_ref();
    std::fs::create_dir_all(data_dir)?;
    let plan = inspect_relay_migration(data_dir)?;
    let unsupported_count =
        plan.hosted_sandbox_count + plan.oauth_identity_count + plan.pending_registration_count;
    if !options.allow_unsupported_data
        && (unsupported_count > 0 || !plan.active_unsupported_settings.is_empty())
    {
        bail!(
            "relay migration blocked by unsupported active data: hostedSandboxes={}, oauthIdentities={}, pendingRegistrations={}, settings={:?}; rerun only after resolving them or explicitly pass --allow-unsupported-data",
            plan.hosted_sandbox_count,
            plan.oauth_identity_count,
            plan.pending_registration_count,
            plan.active_unsupported_settings
        );
    }
    let created_destination = plan.source_kind == "legacy-rust";
    match plan.source_kind.as_str() {
        "node" => {
            if let Some(backup_path) = plan.backup_path.as_ref() {
                if !backup_path.exists() {
                    backup_database(&plan.destination_path, backup_path)?;
                }
            }
        }
        "legacy-rust" => {
            let source = plan
                .source_path
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("legacy relay migration source is missing"))?;
            if plan.destination_path.exists() {
                bail!(
                    "refusing to overwrite existing {}",
                    plan.destination_path.display()
                );
            }
            backup_database(source, &plan.destination_path)?;
        }
        "none" => bail!("no relay database exists under {}", data_dir.display()),
        other => bail!("unsupported relay migration source: {other}"),
    }

    let migration_result = (|| -> Result<(i64, i64, i64, i64)> {
        let store = RelayStore::open(
            plan.destination_path.clone(),
            "relay-migration-validation-only".to_string(),
        )?;
        drop(store);
        let counts = relay_database_counts(&plan.destination_path, true)?;
        let expected = (
            plan.user_count,
            plan.device_count,
            plan.share_count,
            plan.grant_count,
        );
        if counts != expected {
            bail!(
                "relay migration count mismatch: expected users/devices/shares/grants={expected:?}, got {counts:?}; source database was preserved"
            );
        }
        validate_relay_database(&plan.destination_path)?;
        let conn = Connection::open(&plan.destination_path)?;
        set_relay_setting(&conn, "rustSchemaVersion", "1")?;
        Ok(counts)
    })();
    let counts = match migration_result {
        Ok(counts) => counts,
        Err(error) => {
            if created_destination {
                remove_failed_migration_destination(&plan.destination_path);
            }
            return Err(error);
        }
    };
    Ok(RelayMigrationReport {
        applied: true,
        ready_for_rust: true,
        user_count: counts.0,
        device_count: counts.1,
        share_count: counts.2,
        grant_count: counts.3,
        unsupported_data_allowed: options.allow_unsupported_data,
        ..plan
    })
}

fn unsupported_relay_data(path: &FsPath) -> Result<(i64, i64, i64, Vec<String>)> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let count = |table: &str, condition: &str| -> Result<i64> {
        if !table_exists(&conn, table) {
            return Ok(0);
        }
        Ok(conn.query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE {condition}"),
            [],
            |row| row.get(0),
        )?)
    };
    let mut active_settings = Vec::new();
    if table_exists(&conn, "relay_settings") {
        for key in [
            "registrationApprovalRequired",
            "googleAuthEnabled",
            "githubAuthEnabled",
            "emailVerificationEnabled",
        ] {
            let enabled: Option<String> = conn
                .query_row(
                    "SELECT value FROM relay_settings WHERE key=?1",
                    params![key],
                    |row| row.get(0),
                )
                .optional()?;
            if enabled.as_deref() == Some("true") {
                active_settings.push(key.to_string());
            }
        }
    }
    Ok((
        count("relay_hosted_sandboxes", "1=1")?,
        count("relay_user_identities", "1=1")?,
        count("relay_pending_registrations", "status='pending'")?,
        active_settings,
    ))
}

fn rust_schema_ready(path: &FsPath) -> Result<bool> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    if !table_exists(&conn, "relay_settings") {
        return Ok(false);
    }
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM relay_settings WHERE key='rustSchemaVersion'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(version.as_deref() == Some("1"))
}

fn validate_relay_database(path: &FsPath) -> Result<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let quick_check: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if quick_check != "ok" {
        bail!("relay database quick_check failed: {quick_check}");
    }
    let foreign_key_errors: i64 =
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if foreign_key_errors != 0 {
        bail!("relay database has {foreign_key_errors} foreign key violations");
    }
    Ok(())
}

fn remove_failed_migration_destination(path: &FsPath) {
    let _ = std::fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(sidecar));
    }
}

fn relay_database_counts(path: &FsPath, canonical: bool) -> Result<(i64, i64, i64, i64)> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let names = if canonical {
        [
            "relay_users",
            "relay_devices",
            "relay_shares",
            "relay_access_grants",
        ]
    } else {
        ["users", "devices", "shares", "grants"]
    };
    let mut counts = [0_i64; 4];
    for (index, table) in names.into_iter().enumerate() {
        if table_exists(&conn, table) {
            counts[index] =
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?;
        }
    }
    Ok((counts[0], counts[1], counts[2], counts[3]))
}

impl RelayStore {
    fn open_data_dir(
        data_dir: &FsPath,
        session_secret: String,
        allow_legacy_migration: bool,
    ) -> Result<Self> {
        std::fs::create_dir_all(data_dir)?;
        let canonical_path = data_dir.join("relay-store.sqlite");
        let legacy_rust_path = data_dir.join("relay.sqlite");
        let creating_new = !canonical_path.exists() && !legacy_rust_path.exists();

        if canonical_path.exists() {
            if !rust_schema_ready(&canonical_path)? {
                if !allow_legacy_migration {
                    bail!(
                        "relay-store.sqlite has not been approved for Rust; run `remote-codex relay-migrate --data-dir {}` first, or explicitly set REMOTE_CODEX_RELAY_AUTO_MIGRATE=1",
                        data_dir.display()
                    );
                }
                migrate_relay_data_dir(data_dir)?;
            }
        } else if legacy_rust_path.exists() {
            if !allow_legacy_migration {
                bail!(
                    "legacy relay database found at {}; run `remote-codex relay-migrate --data-dir {}` first, or explicitly set REMOTE_CODEX_RELAY_AUTO_MIGRATE=1",
                    legacy_rust_path.display(),
                    data_dir.display()
                );
            }
            migrate_relay_data_dir(data_dir)?;
        }

        let store = Self::open(canonical_path.clone(), session_secret)?;
        if creating_new {
            let conn = store
                .conn
                .try_lock()
                .map_err(|_| anyhow::anyhow!("new relay database is unexpectedly busy"))?;
            set_relay_setting(&conn, "rustSchemaVersion", "1")?;
        }
        Ok(store)
    }

    fn open(path: PathBuf, session_secret: String) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS relay_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS relay_users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              username TEXT NOT NULL UNIQUE,
              role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
              enabled INTEGER NOT NULL DEFAULT 1,
              last_seen_at TEXT,
              created_at TEXT NOT NULL,
              password_salt TEXT NOT NULL,
              password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS relay_devices (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              token TEXT,
              token_hash TEXT NOT NULL UNIQUE,
              token_preview TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS relay_devices_owner_idx
              ON relay_devices(owner_user_id);
            CREATE TABLE IF NOT EXISTS relay_shares (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
              owner_username TEXT,
              target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
              target_username TEXT,
              device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
              device_name TEXT,
              thread_id TEXT NOT NULL,
              thread_title TEXT,
              workspace_id TEXT,
              workspace_label TEXT,
              label TEXT,
              thread_access TEXT NOT NULL DEFAULT 'control',
              workspace_access TEXT NOT NULL DEFAULT 'none',
              created_at TEXT NOT NULL,
              revoked_at TEXT,
              expires_at TEXT
            );
            CREATE INDEX IF NOT EXISTS relay_shares_owner_idx ON relay_shares(owner_user_id);
            CREATE INDEX IF NOT EXISTS relay_shares_target_idx ON relay_shares(target_user_id);
            CREATE INDEX IF NOT EXISTS relay_shares_device_thread_idx ON relay_shares(device_id, thread_id);
            CREATE TABLE IF NOT EXISTS relay_access_grants (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
              owner_username TEXT,
              target_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
              target_username TEXT,
              device_id TEXT NOT NULL REFERENCES relay_devices(id) ON DELETE CASCADE,
              device_name TEXT,
              scope TEXT NOT NULL CHECK (scope IN ('thread', 'workspace', 'device')),
              thread_id TEXT,
              thread_title TEXT,
              workspace_id TEXT,
              workspace_label TEXT,
              workspace_scope TEXT NOT NULL DEFAULT 'all',
              workspace_ids TEXT NOT NULL DEFAULT '[]',
              label TEXT,
              thread_access TEXT NOT NULL DEFAULT 'control',
              workspace_access TEXT NOT NULL DEFAULT 'none',
              can_create_threads INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              revoked_at TEXT,
              expires_at TEXT
            );
            CREATE INDEX IF NOT EXISTS relay_access_grants_owner_idx ON relay_access_grants(owner_user_id);
            CREATE INDEX IF NOT EXISTS relay_access_grants_target_idx ON relay_access_grants(target_user_id);
            CREATE INDEX IF NOT EXISTS relay_access_grants_device_scope_idx ON relay_access_grants(device_id, scope);
            ",
        )?;
        migrate_legacy_rust_tables(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            session_secret,
        })
    }
}

fn backup_database(source_path: &FsPath, destination_path: &FsPath) -> Result<()> {
    let temporary_path =
        destination_path.with_extension(format!("sqlite.tmp-{}", Uuid::new_v4().simple()));
    let backup_result = (|| -> Result<()> {
        let source = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut destination = Connection::open(&temporary_path)?;
        {
            let backup = Backup::new(&source, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(10), None)?;
        }
        destination.close().map_err(|(_, error)| error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&temporary_path, std::fs::Permissions::from_mode(0o600))?;
        }
        if destination_path.exists() {
            bail!(
                "refusing to overwrite existing database backup {}",
                destination_path.display()
            );
        }
        std::fs::rename(&temporary_path, destination_path)?;
        Ok(())
    })();
    if backup_result.is_err() {
        let _ = std::fs::remove_file(&temporary_path);
    }
    backup_result
}

fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        params![table],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

const LEGACY_SHA256_SALT: &str = "__remote_codex_legacy_sha256__";

fn migrate_legacy_rust_tables(conn: &mut Connection) -> Result<()> {
    if !table_exists(conn, "users") {
        return Ok(());
    }
    let already_migrated: Option<String> = conn
        .query_row(
            "SELECT value FROM relay_settings WHERE key='rustLegacyTablesImported'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if already_migrated.as_deref() == Some("true") {
        return Ok(());
    }

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO relay_users
         (id,email,username,role,enabled,last_seen_at,created_at,password_salt,password_hash)
         SELECT id,lower(email),lower(username),role,enabled,NULL,created_at,?1,password_hash FROM users",
        params![LEGACY_SHA256_SALT],
    )?;

    if table_exists(&tx, "devices") {
        let devices = {
            let mut stmt = tx.prepare(
                "SELECT id,user_id,name,token,token_hash,token_preview,created_at FROM devices",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for (id, owner, name, token, legacy_hash, preview, created_at) in devices {
            let token_hash = token
                .as_deref()
                .map(hash_device_token)
                .unwrap_or(legacy_hash);
            let token_preview = preview
                .filter(|value| !value.is_empty())
                .or_else(|| token.as_deref().map(preview_token))
                .unwrap_or_else(|| "unknown".to_string());
            tx.execute(
                "INSERT OR IGNORE INTO relay_devices
                 (id,owner_user_id,name,token,token_hash,token_preview,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    id,
                    owner,
                    name,
                    token,
                    token_hash,
                    token_preview,
                    created_at
                ],
            )?;
        }
    }

    if table_exists(&tx, "shares") {
        tx.execute(
            "INSERT OR IGNORE INTO relay_shares
             (id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
              thread_id,workspace_id,thread_access,workspace_access,created_at,revoked_at)
             SELECT s.id,s.owner_user_id,owner.username,target.id,target.username,s.device_id,d.name,
                    s.thread_id,s.workspace_id,s.thread_access,s.workspace_access,s.created_at,s.revoked_at
             FROM shares s
             JOIN relay_users owner ON owner.id=s.owner_user_id
             JOIN relay_users target ON target.username=lower(s.target_username)
             JOIN relay_devices d ON d.id=s.device_id
             WHERE s.thread_id IS NOT NULL",
            [],
        )?;
    }

    if table_exists(&tx, "grants") {
        tx.execute(
            "INSERT OR IGNORE INTO relay_access_grants
             (id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
              scope,thread_id,workspace_id,thread_access,workspace_access,can_create_threads,created_at,revoked_at)
             SELECT g.id,g.owner_user_id,owner.username,target.id,target.username,g.device_id,d.name,
                    g.scope,g.thread_id,g.workspace_id,g.thread_access,g.workspace_access,
                    g.can_create_threads,g.created_at,g.revoked_at
             FROM grants g
             JOIN relay_users owner ON owner.id=g.owner_user_id
             JOIN relay_users target ON target.username=lower(g.target_username)
             JOIN relay_devices d ON d.id=g.device_id",
            [],
        )?;
    }

    tx.execute(
        "INSERT INTO relay_settings(key,value) VALUES ('rustLegacyTablesImported','true')
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [],
    )?;
    tx.commit()?;
    Ok(())
}

struct DeviceSocket {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    connection_id: Uuid,
    connected_at: String,
    last_heartbeat_at: String,
}

struct ClientSocket {
    tx: tokio::sync::mpsc::UnboundedSender<String>,
    device_id: String,
    supervisor_connection_id: Uuid,
    user_id: String,
    thread_id: Option<String>,
    attached_shell_id: Option<String>,
}

struct AppState {
    store: RelayStore,
    sockets: RwLock<HashMap<String, DeviceSocket>>,
    clients: RwLock<HashMap<String, ClientSocket>>,
    pending: StdMutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    web_dist: Option<PathBuf>,
    legacy_supervisor_token: Option<String>,
}

pub async fn serve() -> Result<()> {
    let data_dir = std::env::var("REMOTE_CODEX_RELAY_DATA_DIR")
        .unwrap_or_else(|_| ".local/relay-server".into());
    let admin_username = std::env::var("REMOTE_CODEX_ADMIN_USERNAME")
        .map_err(|_| anyhow::anyhow!("REMOTE_CODEX_ADMIN_USERNAME is required"))?;
    let admin_username = normalize_username(&admin_username);
    let admin_password = std::env::var("REMOTE_CODEX_ADMIN_PASSWORD")
        .map_err(|_| anyhow::anyhow!("REMOTE_CODEX_ADMIN_PASSWORD is required"))?;
    let admin_email = std::env::var("REMOTE_CODEX_ADMIN_EMAIL")
        .unwrap_or_else(|_| format!("{admin_username}@relay.local"))
        .trim()
        .to_ascii_lowercase();
    if admin_username.len() < 3 {
        bail!("REMOTE_CODEX_ADMIN_USERNAME must contain at least 3 supported characters");
    }
    if admin_password.len() < 8 || (admin_username == "admin" && admin_password == "admin") {
        bail!("REMOTE_CODEX_ADMIN_PASSWORD must be at least 8 characters and cannot use the default admin credential");
    }
    if !admin_email.contains('@') {
        bail!("REMOTE_CODEX_ADMIN_EMAIL must be a valid email address");
    }
    let session_secret = std::env::var("REMOTE_CODEX_RELAY_SESSION_SECRET")
        .unwrap_or_else(|_| admin_password.clone());
    let auto_migrate = std::env::var("REMOTE_CODEX_RELAY_AUTO_MIGRATE")
        .ok()
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true"));
    let store = RelayStore::open_data_dir(FsPath::new(&data_dir), session_secret, auto_migrate)?;
    {
        let conn = store.conn.lock().await;
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM relay_users WHERE username=?1",
                params![admin_username],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            let (password_salt, password_hash) = hash_password(&admin_password)?;
            conn.execute(
                "INSERT INTO relay_users
                 (id,email,username,password_hash,password_salt,role,enabled,last_seen_at,created_at)
                 VALUES (?1,?2,?3,?4,?5,'admin',1,NULL,?6)",
                params![
                    Uuid::new_v4().to_string(),
                    admin_email,
                    admin_username,
                    password_hash,
                    password_salt,
                    now_rfc3339()
                ],
            )?;
        }
    }
    let web_dist = std::env::var("REMOTE_CODEX_RELAY_WEB_DIST_DIR")
        .ok()
        .map(PathBuf::from);
    let legacy_supervisor_token = std::env::var("REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let registration_password = std::env::var("REMOTE_CODEX_RELAY_REGISTRATION_PASSWORD")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let registration_enabled = std::env::var("REMOTE_CODEX_RELAY_REGISTRATION_ENABLED")
        .ok()
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(true);
    {
        let conn = store.conn.lock().await;
        conn.execute(
            "INSERT OR IGNORE INTO relay_settings(key,value) VALUES ('registrationEnabled',?1)",
            params![if registration_enabled {
                "true"
            } else {
                "false"
            }],
        )?;
        if let Some(password) = registration_password.as_ref() {
            conn.execute(
                "INSERT OR IGNORE INTO relay_settings(key,value) VALUES ('registrationPassword',?1)",
                params![password],
            )?;
        }
    }
    let state = Arc::new(AppState {
        store,
        sockets: RwLock::new(HashMap::new()),
        clients: RwLock::new(HashMap::new()),
        pending: StdMutex::new(HashMap::new()),
        web_dist,
        legacy_supervisor_token,
    });
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/relay/auth/register", post(register))
        .route("/relay/auth/login", post(login))
        .route("/relay/auth/logout", post(logout))
        .route("/relay/auth/session", get(session))
        .route("/relay/account", patch(update_account))
        .route("/relay/account/password", patch(update_account_password))
        .route("/relay/portal", get(portal))
        .route("/relay/access", get(relay_access))
        .route("/relay/devices", get(list_devices).post(create_device))
        .route("/relay/devices/{device_id}", delete(delete_device))
        .route("/relay/shares", get(list_shares).post(create_share))
        .route(
            "/relay/shares/{share_id}",
            patch(update_share).delete(revoke_share),
        )
        .route("/relay/grants", get(list_grants).post(create_grant))
        .route(
            "/relay/grants/{grant_id}",
            patch(update_grant).delete(revoke_grant),
        )
        .route("/relay/admin", get(relay_admin))
        .route(
            "/relay/admin/hosted-sandboxes/capability",
            get(hosted_sandbox_capability),
        )
        .route(
            "/relay/admin/settings/registration",
            patch(update_registration_settings),
        )
        .route(
            "/relay/admin/users/{user_id}",
            patch(set_user_enabled).delete(admin_delete_user),
        )
        .route(
            "/relay/admin/users/{user_id}/reset-password",
            post(admin_reset_password),
        )
        .route("/relay/devices/{device_id}/api/{*rest}", any(device_api))
        .route("/relay/api/{*rest}", any(relay_api_compat))
        .route("/relay/devices/{device_id}/healthz", get(device_healthz))
        .route("/supervisor/tunnel", get(supervisor_tunnel))
        .route("/relay/devices/{device_id}/ws", get(client_ws))
        .route("/relay/ws", get(client_ws_compat))
        .fallback(spa_fallback)
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(state);
    let host = std::env::var("REMOTE_CODEX_RELAY_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("HOST")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| "0.0.0.0".into());
    let port: u16 = std::env::var("REMOTE_CODEX_RELAY_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .or_else(|| std::env::var("PORT").ok().and_then(|v| v.parse().ok()))
        .unwrap_or(8788);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    tracing::info!("relay listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn legacy_sha256(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

fn normalize_username(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
        .collect()
}

fn hash_password(password: &str) -> Result<(String, String)> {
    let mut salt = [0_u8; 16];
    OsRng.fill_bytes(&mut salt);
    let salt = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(salt);
    Ok((salt.clone(), node_scrypt_hash(password, &salt)?))
}

fn node_scrypt_hash(password: &str, salt: &str) -> Result<String> {
    let params = ScryptParams::new(14, 8, 1, 32)?;
    let mut output = [0_u8; 32];
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(output))
}

fn verify_password(password: &str, salt: &str, expected: &str) -> bool {
    let actual = if salt == LEGACY_SHA256_SALT {
        legacy_sha256(password)
    } else {
        match node_scrypt_hash(password, salt) {
            Ok(hash) => hash,
            Err(_) => return false,
        }
    };
    actual.as_bytes().ct_eq(expected.as_bytes()).into()
}

fn hash_device_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPayload {
    user_id: String,
    expires_at: u64,
    nonce: String,
}

fn create_session(session_secret: &str, user_id: &str) -> Result<String> {
    let mut nonce = [0_u8; 16];
    OsRng.fill_bytes(&mut nonce);
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let payload = SessionPayload {
        user_id: user_id.to_string(),
        expires_at: now + 14 * 24 * 60 * 60 * 1000,
        nonce: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(nonce),
    };
    let payload =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
    let mut mac = Hmac::<Sha256>::new_from_slice(session_secret.as_bytes())?;
    mac.update(payload.as_bytes());
    let signature =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    Ok(format!("{payload}.{signature}"))
}

fn verify_session(session_secret: &str, token: &str) -> Option<SessionPayload> {
    let mut parts = token.split('.');
    let payload = parts.next()?;
    let signature = parts.next()?;
    if parts.next().is_some() || payload.is_empty() || signature.is_empty() {
        return None;
    }
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature)
        .ok()?;
    let mut mac = Hmac::<Sha256>::new_from_slice(session_secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&signature).ok()?;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    let payload: SessionPayload = serde_json::from_slice(&payload_bytes).ok()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    (payload.expires_at > now && !payload.user_id.is_empty() && !payload.nonce.is_empty())
        .then_some(payload)
}

#[derive(Deserialize, Default)]
struct TokenQuery {
    token: Option<String>,
    #[serde(rename = "deviceToken")]
    device_token: Option<String>,
    #[serde(rename = "relaySession")]
    relay_session: Option<String>,
}

impl TokenQuery {
    fn session_token(&self) -> Option<String> {
        self.relay_session
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| self.token.clone().filter(|value| !value.is_empty()))
    }

    fn device_token(&self) -> Option<String> {
        self.device_token
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| self.token.clone().filter(|value| !value.is_empty()))
    }
}

#[derive(Clone)]
struct UserRow {
    id: String,
    email: String,
    username: String,
    role: String,
    enabled: i64,
    created_at: String,
}

fn user_json(user: &UserRow) -> Value {
    json!({
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "enabled": user.enabled == 1,
        "createdAt": user.created_at
    })
}

fn relay_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM relay_settings WHERE key=?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn registration_settings(conn: &Connection) -> Value {
    let enabled = relay_setting(conn, "registrationEnabled").as_deref() != Some("false");
    let registration_password_configured = relay_setting(conn, "registrationPassword").is_some();
    json!({
        "enabled": enabled,
        "registrationPassword": Value::Null,
        "registrationPasswordConfigured": registration_password_configured,
        "approvalRequired": relay_setting(conn, "registrationApprovalRequired").as_deref() == Some("true"),
        "googleAuthEnabled": relay_setting(conn, "googleAuthEnabled").as_deref() == Some("true"),
        "githubAuthEnabled": relay_setting(conn, "githubAuthEnabled").as_deref() == Some("true"),
        "emailVerificationEnabled": relay_setting(conn, "emailVerificationEnabled").as_deref() == Some("true"),
        "googleAuthAvailable": false,
        "githubAuthAvailable": false,
        "emailVerificationAvailable": false
    })
}

fn session_json(conn: &Connection, user: Option<&UserRow>) -> Value {
    let settings = registration_settings(conn);
    json!({
        "authenticated": user.is_some(),
        "user": user.map(user_json),
        "registrationEnabled": settings.get("enabled").cloned().unwrap_or(Value::Bool(true)),
        "registrationSettings": settings
    })
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        let value = value.trim();
        if let Some(token) = value
            .strip_prefix("Bearer ")
            .or_else(|| value.strip_prefix("bearer "))
        {
            let token = token.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn relay_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == "remote_codex_relay_session" && !value.is_empty())
                    .then(|| value.to_string())
            })
        })
}

fn extract_session_token(headers: &HeaderMap, query: &TokenQuery) -> Option<String> {
    bearer_token(headers)
        .or_else(|| query.session_token())
        .or_else(|| relay_cookie(headers))
}

fn load_user_by_id(conn: &Connection, user_id: &str) -> Option<UserRow> {
    conn.query_row(
        "SELECT id, email, username, role, enabled, created_at FROM relay_users WHERE id=?1",
        params![user_id],
        |row| {
            Ok(UserRow {
                id: row.get(0)?,
                email: row.get(1)?,
                username: row.get(2)?,
                role: row.get(3)?,
                enabled: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

fn load_user_by_session(conn: &Connection, session_secret: &str, token: &str) -> Option<UserRow> {
    if let Some(payload) = verify_session(session_secret, token) {
        return load_user_by_id(conn, &payload.user_id).filter(|user| user.enabled == 1);
    }

    // Old Rust builds persisted opaque session UUIDs. Keep them usable while
    // migrating, but all newly issued sessions use Node's signed token format.
    if !table_exists(conn, "sessions") {
        return None;
    }
    conn.query_row(
        "SELECT user_id FROM sessions WHERE token=?1",
        params![token],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .and_then(|user_id| load_user_by_id(conn, &user_id))
    .filter(|user| user.enabled == 1)
}

fn authenticated_user(
    conn: &Connection,
    session_secret: &str,
    headers: &HeaderMap,
    query: &TokenQuery,
) -> Option<UserRow> {
    let user = extract_session_token(headers, query)
        .and_then(|token| load_user_by_session(conn, session_secret, &token))
        .filter(|user| user.role != "admin");
    if let Some(user) = user.as_ref() {
        let _ = conn.execute(
            "UPDATE relay_users SET last_seen_at=?1 WHERE id=?2",
            params![now_rfc3339(), user.id],
        );
    }
    user
}

fn authenticated_admin_user(
    conn: &Connection,
    session_secret: &str,
    headers: &HeaderMap,
    query: &TokenQuery,
) -> Option<UserRow> {
    let user = extract_session_token(headers, query)
        .and_then(|token| load_user_by_session(conn, session_secret, &token))
        .filter(|user| user.role == "admin");
    if let Some(user) = user.as_ref() {
        let _ = conn.execute(
            "UPDATE relay_users SET last_seen_at=?1 WHERE id=?2",
            params![now_rfc3339(), user.id],
        );
    }
    user
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "code": "unauthorized", "message": "login required" })),
    )
        .into_response()
}

fn with_session_cookie(mut response: Response, token: &str) -> Response {
    let value = format!(
        "remote_codex_relay_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        14 * 24 * 60 * 60
    );
    if let Ok(value) = value.parse() {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

fn with_cleared_session_cookie(mut response: Response) -> Response {
    if let Ok(value) =
        "remote_codex_relay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0".parse()
    {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

fn preview_token(token: &str) -> String {
    if token.len() <= 11 {
        return token.to_string();
    }
    format!(
        "{}...{}",
        &token[..7.min(token.len())],
        &token[token.len().saturating_sub(4)..]
    )
}

struct DeviceJsonInput<'a> {
    id: &'a str,
    owner_user_id: &'a str,
    name: &'a str,
    created_at: &'a str,
    connected: bool,
    connected_at: Option<&'a str>,
    last_heartbeat_at: Option<&'a str>,
    token: Option<&'a str>,
    token_preview: Option<&'a str>,
}

fn device_json(input: DeviceJsonInput<'_>) -> Value {
    json!({
        "id": input.id,
        "ownerUserId": input.owner_user_id,
        "name": input.name,
        "token": input.token,
        "tokenPreview": input.token_preview
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| input.token.map(preview_token))
            .unwrap_or_else(|| "••••".into()),
        "connected": input.connected,
        "connectedAt": input.connected_at,
        "lastHeartbeatAt": input.last_heartbeat_at,
        "createdAt": input.created_at
    })
}

async fn healthz(State(state): State<Arc<AppState>>) -> Json<Value> {
    let sockets = state.sockets.read().await;
    let connected = sockets.len();
    let primary = sockets.values().next();
    Json(json!({
        "status": "ok",
        "timestamp": now_rfc3339(),
        "connectedSupervisors": connected,
        "supervisorConnected": connected > 0,
        "supervisorConnectedAt": primary.map(|socket| socket.connected_at.as_str()),
        "lastSupervisorHeartbeatAt": primary.map(|socket| socket.last_heartbeat_at.as_str()),
        "supervisorCount": connected
    }))
}

#[derive(Deserialize)]
struct RegisterInput {
    email: String,
    username: String,
    password: String,
    #[serde(rename = "registrationPassword")]
    registration_password: Option<String>,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterInput>,
) -> impl IntoResponse {
    let username = normalize_username(&body.username);
    if username.len() < 3 || body.password.len() < 8 || !body.email.trim().contains('@') {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("bad_request", "Invalid registration fields")),
        )
            .into_response();
    }
    let conn = state.store.conn.lock().await;
    if relay_setting(&conn, "registrationEnabled").as_deref() == Some("false") {
        return (
            StatusCode::FORBIDDEN,
            Json(ApiError::new(
                "forbidden",
                "Registration is currently disabled",
            )),
        )
            .into_response();
    }
    if relay_setting(&conn, "registrationApprovalRequired").as_deref() == Some("true") {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(ApiError::new(
                "not_implemented",
                "Registration approval is not available in the Rust relay yet",
            )),
        )
            .into_response();
    }
    if let Some(expected) = relay_setting(&conn, "registrationPassword") {
        if body.registration_password.as_deref().unwrap_or_default() != expected {
            return (
                StatusCode::FORBIDDEN,
                Json(ApiError::new("forbidden", "Invalid registration password")),
            )
                .into_response();
        }
    }
    let id = Uuid::new_v4().to_string();
    let (password_salt, password_hash) = match hash_password(&body.password) {
        Ok(hash) => hash,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("internal", "Failed to hash password")),
            )
                .into_response();
        }
    };
    match conn.execute(
        "INSERT INTO relay_users
         (id,email,username,password_hash,password_salt,role,enabled,last_seen_at,created_at)
         VALUES (?1,?2,?3,?4,?5,'user',1,NULL,?6)",
        params![
            id,
            body.email.trim().to_ascii_lowercase(),
            username,
            password_hash,
            password_salt,
            now_rfc3339()
        ],
    ) {
        Ok(_) => {
            let token = match create_session(&state.store.session_secret, &id) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError::new("internal", "Failed to create session")),
                    )
                        .into_response();
                }
            };
            let user = load_user_by_id(&conn, &id);
            let response = (
                StatusCode::OK,
                Json(json!({
                    "token": &token,
                    "session": session_json(&conn, user.as_ref())
                })),
            )
                .into_response();
            with_session_cookie(response, &token)
        }
        Err(_) => (
            StatusCode::CONFLICT,
            Json(ApiError::new("conflict", "User already exists")),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct LoginInput {
    identifier: Option<String>,
    username: Option<String>,
    password: String,
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginInput>,
) -> impl IntoResponse {
    let ident = body.identifier.or(body.username).unwrap_or_default();
    let conn = state.store.conn.lock().await;
    let row: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT id, password_salt, password_hash, enabled
             FROM relay_users WHERE username=?1 OR email=?1",
            params![ident.trim().to_ascii_lowercase()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .ok()
        .flatten();
    match row {
        Some((id, salt, hash, enabled))
            if verify_password(&body.password, &salt, &hash) && enabled == 1 =>
        {
            if salt == LEGACY_SHA256_SALT {
                if let Ok((new_salt, new_hash)) = hash_password(&body.password) {
                    let _ = conn.execute(
                        "UPDATE relay_users SET password_salt=?1,password_hash=?2 WHERE id=?3",
                        params![new_salt, new_hash, id],
                    );
                }
            }
            let token = match create_session(&state.store.session_secret, &id) {
                Ok(token) => token,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError::new("internal", "Failed to create session")),
                    )
                        .into_response();
                }
            };
            let user = load_user_by_id(&conn, &id);
            let response = (
                StatusCode::OK,
                Json(json!({
                    "token": &token,
                    "session": session_json(&conn, user.as_ref())
                })),
            )
                .into_response();
            with_session_cookie(response, &token)
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(ApiError::new("unauthorized", "Invalid credentials")),
        )
            .into_response(),
    }
}

async fn logout(State(state): State<Arc<AppState>>) -> Response {
    let conn = state.store.conn.lock().await;
    with_cleared_session_cookie(Json(session_json(&conn, None)).into_response())
}

async fn session(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    let conn = state.store.conn.lock().await;
    let user = extract_session_token(&headers, &query)
        .and_then(|token| load_user_by_session(&conn, &state.store.session_secret, &token));
    Json(session_json(&conn, user.as_ref()))
}

#[derive(Deserialize)]
struct UpdateAccountInput {
    username: Option<String>,
}

async fn update_account(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateAccountInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let Some(username) = body.username else {
        return Json(user_json(&user)).into_response();
    };
    let username = normalize_username(&username);
    if username.len() < 3 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Username must be at least 3 characters",
            )),
        )
            .into_response();
    }
    if conn
        .execute(
            "UPDATE relay_users SET username=?1 WHERE id=?2",
            params![username, user.id],
        )
        .is_err()
    {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new("conflict", "Username is already in use")),
        )
            .into_response();
    }
    let updated = load_user_by_id(&conn, &user.id).unwrap_or(user);
    Json(user_json(&updated)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePasswordInput {
    current_password: String,
    new_password: String,
}

async fn update_account_password(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdatePasswordInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    if body.new_password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Password must be at least 8 characters",
            )),
        )
            .into_response();
    }
    let password: Option<(String, String)> = conn
        .query_row(
            "SELECT password_salt,password_hash FROM relay_users WHERE id=?1",
            params![user.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((salt, hash)) = password else {
        return unauthorized();
    };
    if !verify_password(&body.current_password, &salt, &hash) {
        return (
            StatusCode::FORBIDDEN,
            Json(ApiError::new("forbidden", "Current password is incorrect")),
        )
            .into_response();
    }
    let Ok((salt, hash)) = hash_password(&body.new_password) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    if conn
        .execute(
            "UPDATE relay_users SET password_salt=?1,password_hash=?2 WHERE id=?3",
            params![salt, hash, user.id],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Json(user_json(&user)).into_response()
}

async fn list_user_devices(state: &AppState, user_id: &str) -> Vec<Value> {
    let connected = state.sockets.read().await;
    let conn = state.store.conn.lock().await;
    let mut stmt = conn
        .prepare(
            "SELECT id, owner_user_id, name, created_at, token, token_preview
                  FROM relay_devices WHERE owner_user_id=?1 ORDER BY created_at ASC",
        )
        .expect("stmt");
    stmt.query_map(params![user_id], |row| {
        let id: String = row.get(0)?;
        let owner: String = row.get(1)?;
        let name: String = row.get(2)?;
        let created_at: String = row.get(3)?;
        let token: Option<String> = row.get(4)?;
        let token_preview: Option<String> = row.get(5)?;
        Ok(device_json(DeviceJsonInput {
            id: &id,
            owner_user_id: &owner,
            name: &name,
            created_at: &created_at,
            connected: connected.contains_key(&id),
            connected_at: connected
                .get(&id)
                .map(|socket| socket.connected_at.as_str()),
            last_heartbeat_at: connected
                .get(&id)
                .map(|socket| socket.last_heartbeat_at.as_str()),
            token: token.as_deref(),
            token_preview: token_preview.as_deref(),
        }))
    })
    .ok()
    .map(|rows| rows.filter_map(|row| row.ok()).collect())
    .unwrap_or_default()
}

async fn list_devices(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    };
    let Some(user) = user else {
        return unauthorized();
    };
    Json(json!({ "devices": list_user_devices(&state, &user.id).await })).into_response()
}

#[derive(Deserialize, Default)]
#[allow(dead_code)]
struct AccessQuery {
    token: Option<String>,
    #[serde(rename = "deviceToken")]
    device_token: Option<String>,
    #[serde(rename = "deviceId")]
    device_id: Option<String>,
    #[serde(rename = "threadId")]
    thread_id: Option<String>,
    #[serde(rename = "workspaceId")]
    workspace_id: Option<String>,
}

impl AccessQuery {
    fn token_query(&self) -> TokenQuery {
        TokenQuery {
            token: self.token.clone(),
            device_token: None,
            relay_session: None,
        }
    }
}

#[derive(Clone, Debug)]
struct EffectiveAccess {
    kind: &'static str,
    grant_id: Option<String>,
    share_id: Option<String>,
    scope: String,
    thread_id: Option<String>,
    thread_access: String,
    workspace_access: String,
    workspace_id: Option<String>,
    workspace_scope: Option<String>,
    workspace_ids: Vec<String>,
    can_create_threads: bool,
}

fn owner_access() -> EffectiveAccess {
    EffectiveAccess {
        kind: "owner",
        grant_id: None,
        share_id: None,
        scope: "owner".to_string(),
        thread_id: None,
        thread_access: "control".to_string(),
        workspace_access: "write".to_string(),
        workspace_id: None,
        workspace_scope: None,
        workspace_ids: Vec::new(),
        can_create_threads: true,
    }
}

fn access_json(access: &EffectiveAccess) -> Value {
    json!({
        "kind": access.kind,
        "grantId": access.grant_id,
        "shareId": access.share_id,
        "scope": access.scope,
        "threadAccess": access.thread_access,
        "workspaceAccess": access.workspace_access,
        "workspaceId": access.workspace_id,
        "workspaceScope": access.workspace_scope,
        "canCreateThreads": access.can_create_threads
    })
}

fn effective_access(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    thread_id: Option<&str>,
    workspace_id: Option<&str>,
) -> Option<EffectiveAccess> {
    let owned = conn
        .query_row(
            "SELECT 1 FROM relay_devices WHERE id=?1 AND owner_user_id=?2",
            params![device_id, user_id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if owned {
        return Some(owner_access());
    }

    if table_exists(conn, "relay_hosted_sandbox_members")
        && table_exists(conn, "relay_hosted_sandboxes")
    {
        let hosted_member = conn
            .query_row(
                "SELECT 1 FROM relay_hosted_sandbox_members m
                 JOIN relay_hosted_sandboxes s ON s.id=m.sandbox_id
                 WHERE m.user_id=?1 AND s.device_id=?2",
                params![user_id, device_id],
                |_| Ok(()),
            )
            .optional()
            .ok()
            .flatten()
            .is_some();
        if hosted_member {
            return Some(owner_access());
        }
    }

    let now = now_rfc3339();
    let share = if let Some(thread_id) = thread_id {
        conn.query_row(
            "SELECT id,thread_id,thread_access,workspace_access,workspace_id
             FROM relay_shares
             WHERE target_user_id=?1 AND device_id=?2 AND thread_id=?3
               AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?4)
             ORDER BY created_at DESC LIMIT 1",
            params![user_id, device_id, thread_id, now],
            |row| {
                Ok(EffectiveAccess {
                    kind: "shared",
                    grant_id: None,
                    share_id: Some(row.get(0)?),
                    scope: "thread".to_string(),
                    thread_id: Some(row.get(1)?),
                    thread_access: row.get(2)?,
                    workspace_access: row.get(3)?,
                    workspace_id: row.get(4)?,
                    workspace_scope: Some("selected".to_string()),
                    workspace_ids: Vec::new(),
                    can_create_threads: false,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    } else if let Some(workspace_id) = workspace_id {
        conn.query_row(
            "SELECT id,thread_id,thread_access,workspace_access,workspace_id
             FROM relay_shares
             WHERE target_user_id=?1 AND device_id=?2 AND workspace_id=?3
               AND workspace_access<>'none' AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at>?4)
             ORDER BY created_at DESC LIMIT 1",
            params![user_id, device_id, workspace_id, now],
            |row| {
                Ok(EffectiveAccess {
                    kind: "shared",
                    grant_id: None,
                    share_id: Some(row.get(0)?),
                    scope: "thread".to_string(),
                    thread_id: Some(row.get(1)?),
                    thread_access: row.get(2)?,
                    workspace_access: row.get(3)?,
                    workspace_id: row.get(4)?,
                    workspace_scope: Some("selected".to_string()),
                    workspace_ids: Vec::new(),
                    can_create_threads: false,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    } else {
        None
    };
    if let Some(share) = share {
        let workspace_matches = workspace_id.is_none_or(|workspace_id| {
            share.workspace_id.as_deref() == Some(workspace_id) && share.workspace_access != "none"
        });
        if workspace_matches {
            return Some(share);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT id,scope,thread_id,workspace_id,workspace_scope,workspace_ids,
                    thread_access,workspace_access,can_create_threads
             FROM relay_access_grants
             WHERE target_user_id=?1 AND device_id=?2 AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at>?3)
             ORDER BY CASE scope WHEN 'device' THEN 3 WHEN 'workspace' THEN 2 ELSE 1 END DESC,
                      created_at DESC",
        )
        .ok()?;
    let rows = stmt
        .query_map(params![user_id, device_id, now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .ok()?;
    let mut matching = Vec::new();
    for row in rows.flatten() {
        let (
            id,
            scope,
            grant_thread,
            grant_workspace,
            workspace_scope,
            workspace_ids,
            thread_access,
            workspace_access,
            can_create_threads,
        ) = row;
        let selected: Vec<String> = serde_json::from_str(&workspace_ids).unwrap_or_default();
        let matches = match scope.as_str() {
            "device" => workspace_id.is_none() || workspace_access != "none",
            "thread" => thread_id.is_some_and(|value| Some(value) == grant_thread.as_deref()),
            "workspace" => {
                workspace_access != "none"
                    && workspace_id.is_some_and(|value| Some(value) == grant_workspace.as_deref())
            }
            _ => false,
        };
        if matches {
            matching.push(EffectiveAccess {
                kind: "shared",
                grant_id: Some(id),
                share_id: None,
                scope,
                thread_id: grant_thread,
                thread_access,
                workspace_access,
                workspace_id: grant_workspace,
                workspace_scope: Some(workspace_scope),
                workspace_ids: selected,
                can_create_threads: can_create_threads == 1,
            });
        }
    }
    let representative = matching.first()?.clone();
    let merged_scope = if matching.iter().any(|grant| grant.scope == "device") {
        "device"
    } else if matching.iter().any(|grant| grant.scope == "workspace") {
        "workspace"
    } else {
        "thread"
    };
    let thread_access = if matching
        .iter()
        .any(|grant| grant.thread_access == "control")
    {
        "control"
    } else {
        "read"
    };
    let workspace_access = if matching
        .iter()
        .any(|grant| grant.workspace_access == "write")
    {
        "write"
    } else if matching
        .iter()
        .any(|grant| grant.workspace_access == "read")
    {
        "read"
    } else {
        "none"
    };
    let mut merged = representative;
    merged.scope = merged_scope.to_string();
    merged.thread_id = if merged_scope == "thread" {
        thread_id.map(str::to_string).or(merged.thread_id)
    } else {
        None
    };
    merged.thread_access = thread_access.to_string();
    merged.workspace_access = workspace_access.to_string();
    merged.workspace_id = if merged_scope == "workspace" {
        workspace_id.map(str::to_string).or(merged.workspace_id)
    } else {
        None
    };
    merged.can_create_threads = matching.iter().any(|grant| grant.can_create_threads);
    Some(merged)
}

async fn relay_access(
    headers: HeaderMap,
    Query(query): Query<AccessQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        authenticated_user(
            &conn,
            &state.store.session_secret,
            &headers,
            &query.token_query(),
        )
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let Some(device_id) = query.device_id.filter(|value| !value.is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": "bad_request", "message": "deviceId is required" })),
        )
            .into_response();
    };
    let conn = state.store.conn.lock().await;
    if let Some(access) = effective_access(
        &conn,
        &user.id,
        &device_id,
        query.thread_id.as_deref(),
        query.workspace_id.as_deref(),
    ) {
        return Json(access_json(&access)).into_response();
    }
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "code": "forbidden", "message": "Device access is not allowed." })),
    )
        .into_response()
}

fn relay_shares_for(conn: &Connection, column: &str, user_id: &str) -> Vec<Value> {
    let sql = format!(
        "SELECT id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
                thread_id,thread_title,workspace_id,workspace_label,label,thread_access,workspace_access,
                created_at,revoked_at,expires_at
         FROM relay_shares WHERE {column}=?1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at>?2) ORDER BY created_at DESC"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return Vec::new();
    };
    stmt.query_map(params![user_id, now_rfc3339()], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "ownerUserId": row.get::<_, String>(1)?,
            "ownerUsername": row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "unknown".to_string()),
            "targetUserId": row.get::<_, String>(3)?,
            "targetUsername": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "unknown".to_string()),
            "deviceId": row.get::<_, String>(5)?,
            "deviceName": row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "Remote Codex device".to_string()),
            "threadId": row.get::<_, String>(7)?,
            "threadTitle": row.get::<_, Option<String>>(8)?,
            "workspaceId": row.get::<_, Option<String>>(9)?,
            "workspaceLabel": row.get::<_, Option<String>>(10)?,
            "label": row.get::<_, Option<String>>(11)?,
            "threadAccess": row.get::<_, String>(12)?,
            "workspaceAccess": row.get::<_, String>(13)?,
            "createdAt": row.get::<_, String>(14)?,
            "revokedAt": row.get::<_, Option<String>>(15)?,
            "expiresAt": row.get::<_, Option<String>>(16)?,
            "lastAccessedAt": Value::Null,
            "lastAccessedByUsername": Value::Null,
            "accessEvents": []
        }))
    })
    .ok()
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn relay_grants_for(conn: &Connection, column: &str, user_id: &str) -> Vec<Value> {
    let sql = format!(
        "SELECT id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
                scope,thread_id,thread_title,workspace_id,workspace_label,workspace_scope,workspace_ids,
                label,thread_access,workspace_access,can_create_threads,created_at,revoked_at,expires_at
         FROM relay_access_grants WHERE {column}=?1 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at>?2) ORDER BY created_at DESC"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return Vec::new();
    };
    stmt.query_map(params![user_id, now_rfc3339()], |row| {
        let workspace_ids: String = row.get(13)?;
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "ownerUserId": row.get::<_, String>(1)?,
            "ownerUsername": row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "unknown".to_string()),
            "targetUserId": row.get::<_, String>(3)?,
            "targetUsername": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "unknown".to_string()),
            "deviceId": row.get::<_, String>(5)?,
            "deviceName": row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "Remote Codex device".to_string()),
            "scope": row.get::<_, String>(7)?,
            "threadId": row.get::<_, Option<String>>(8)?,
            "threadTitle": row.get::<_, Option<String>>(9)?,
            "workspaceId": row.get::<_, Option<String>>(10)?,
            "workspaceLabel": row.get::<_, Option<String>>(11)?,
            "workspaceScope": row.get::<_, String>(12)?,
            "workspaceIds": serde_json::from_str::<Vec<String>>(&workspace_ids).unwrap_or_default(),
            "label": row.get::<_, Option<String>>(14)?,
            "threadAccess": row.get::<_, String>(15)?,
            "workspaceAccess": row.get::<_, String>(16)?,
            "canCreateThreads": row.get::<_, i64>(17)? == 1,
            "createdAt": row.get::<_, String>(18)?,
            "revokedAt": row.get::<_, Option<String>>(19)?,
            "expiresAt": row.get::<_, Option<String>>(20)?,
            "lastAccessedAt": Value::Null,
            "lastAccessedByUsername": Value::Null,
            "accessEvents": []
        }))
    })
    .ok()
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

async fn portal(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let (shared_with_me, shared_by_me, grants_with_me, grants_by_me) = {
        let conn = state.store.conn.lock().await;
        (
            relay_shares_for(&conn, "target_user_id", &user.id),
            relay_shares_for(&conn, "owner_user_id", &user.id),
            relay_grants_for(&conn, "target_user_id", &user.id),
            relay_grants_for(&conn, "owner_user_id", &user.id),
        )
    };
    let shared_devices_with_me: Vec<Value> = grants_with_me
        .iter()
        .filter(|grant| grant.get("scope").and_then(Value::as_str) == Some("device"))
        .cloned()
        .collect();
    let mut shared_threads_with_me = shared_with_me.clone();
    shared_threads_with_me.extend(
        grants_with_me
            .iter()
            .filter(|grant| grant.get("scope").and_then(Value::as_str) != Some("device"))
            .cloned(),
    );
    Json(json!({
        "user": user_json(&user),
        "devices": list_user_devices(&state, &user.id).await,
        "sharedWithMe": shared_with_me,
        "sharedByMe": shared_by_me,
        "sharedDevicesWithMe": shared_devices_with_me,
        "sharedThreadsWithMe": shared_threads_with_me,
        "grantsByMe": grants_by_me
    }))
    .into_response()
}

#[derive(Deserialize)]
struct CreateDeviceInput {
    name: String,
}

async fn create_device(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateDeviceInput>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let name = body.name.trim();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("bad_request", "Device name is required")),
        )
            .into_response();
    }
    let id = Uuid::new_v4().to_string();
    let mut token_bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut token_bytes);
    let token = format!(
        "rcd_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_bytes)
    );
    let created_at = now_rfc3339();
    let token_preview = preview_token(&token);
    let token_hash = hash_device_token(&token);
    {
        let conn = state.store.conn.lock().await;
        if conn
            .execute(
                "INSERT INTO relay_devices
                 (id,owner_user_id,name,token,token_hash,token_preview,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    id,
                    user.id,
                    name,
                    token.clone(),
                    token_hash,
                    token_preview.clone(),
                    created_at
                ],
            )
            .is_err()
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("internal", "Failed to create device")),
            )
                .into_response();
        }
    }
    Json(json!({
        "device": device_json(DeviceJsonInput {
            id: &id,
            owner_user_id: &user.id,
            name,
            created_at: &created_at,
            connected: false,
            connected_at: None,
            last_heartbeat_at: None,
            token: Some(&token),
            token_preview: Some(&token_preview),
        }),
        "token": token
    }))
    .into_response()
}

async fn delete_device(
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    };
    let Some(user) = user else {
        return unauthorized();
    };
    let conn = state.store.conn.lock().await;
    let deleted = conn
        .execute(
            "DELETE FROM relay_devices WHERE id=?1 AND owner_user_id=?2",
            params![device_id, user.id],
        )
        .unwrap_or(0);
    if deleted == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Device not found")),
        )
            .into_response();
    }
    drop(conn);
    state.sockets.write().await.remove(&device_id);
    Json(json!({ "id": device_id })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateShareInput {
    #[serde(alias = "targetUsername")]
    target_identifier: Option<String>,
    device_id: Option<String>,
    thread_id: Option<String>,
    workspace_id: Option<String>,
    label: Option<String>,
    thread_access: Option<String>,
    workspace_access: Option<String>,
    expires_at: Option<String>,
}

async fn create_share(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateShareInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let target_identifier = body
        .target_identifier
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let device_id = body.device_id.unwrap_or_default();
    let thread_id = body.thread_id.unwrap_or_default();
    if target_identifier.is_empty() || device_id.is_empty() || thread_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "targetIdentifier, deviceId and threadId are required",
            )),
        )
            .into_response();
    }
    let device_name: Option<String> = conn
        .query_row(
            "SELECT name FROM relay_devices WHERE id=?1 AND owner_user_id=?2",
            params![device_id, owner.id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(device_name) = device_name else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Device not found")),
        )
            .into_response();
    };
    let target: Option<(String, String)> = conn
        .query_row(
            "SELECT id,username FROM relay_users
             WHERE enabled=1 AND (username=?1 OR email=?1)",
            params![target_identifier],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((target_id, target_username)) = target else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Target user not found")),
        )
            .into_response();
    };
    if target_id == owner.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "You cannot share a session with yourself",
            )),
        )
            .into_response();
    }
    let thread_access = normalize_thread_access(body.thread_access.as_deref());
    let workspace_access = normalize_workspace_access(body.workspace_access.as_deref());
    let id = Uuid::new_v4().to_string();
    let created_at = now_rfc3339();
    if conn
        .execute(
            "INSERT INTO relay_shares
         (id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
          thread_id,thread_title,workspace_id,workspace_label,label,thread_access,workspace_access,
          created_at,revoked_at,expires_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9,NULL,?10,?11,?12,?13,NULL,?14)",
            params![
                id,
                owner.id,
                owner.username,
                target_id,
                target_username,
                device_id,
                device_name,
                thread_id,
                body.workspace_id,
                body.label,
                thread_access,
                workspace_access,
                created_at,
                body.expires_at,
            ],
        )
        .is_err()
    {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new("conflict", "Share could not be created")),
        )
            .into_response();
    }
    Json(json!({
        "id": id,
        "ownerUserId": owner.id,
        "ownerUsername": owner.username,
        "targetUserId": target_id,
        "targetUsername": target_username,
        "deviceId": device_id,
        "deviceName": device_name,
        "threadId": thread_id,
        "workspaceId": body.workspace_id,
        "label": body.label,
        "threadAccess": thread_access,
        "workspaceAccess": workspace_access,
        "createdAt": created_at,
        "revokedAt": Value::Null,
        "expiresAt": body.expires_at
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateShareInput {
    thread_access: Option<String>,
    workspace_access: Option<String>,
    workspace_id: Option<String>,
    label: Option<String>,
    expires_at: Option<String>,
}

async fn update_share(
    Path(share_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateShareInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let owned = conn
        .query_row(
            "SELECT 1 FROM relay_shares WHERE id=?1 AND owner_user_id=?2 AND revoked_at IS NULL",
            params![share_id, owner.id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if !owned {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Share not found")),
        )
            .into_response();
    }
    if let Some(access) = body.thread_access {
        let access = normalize_thread_access(Some(&access));
        let _ = conn.execute(
            "UPDATE relay_shares SET thread_access=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![access, share_id, owner.id],
        );
    }
    if let Some(access) = body.workspace_access {
        let access = normalize_workspace_access(Some(&access));
        let _ = conn.execute(
            "UPDATE relay_shares SET workspace_access=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![access, share_id, owner.id],
        );
    }
    if let Some(workspace_id) = body.workspace_id {
        let _ = conn.execute(
            "UPDATE relay_shares SET workspace_id=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![workspace_id, share_id, owner.id],
        );
    }
    if let Some(label) = body.label {
        let _ = conn.execute(
            "UPDATE relay_shares SET label=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![label, share_id, owner.id],
        );
    }
    if let Some(expires_at) = body.expires_at {
        let _ = conn.execute(
            "UPDATE relay_shares SET expires_at=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![expires_at, share_id, owner.id],
        );
    }
    Json(json!({ "id": share_id, "ok": true })).into_response()
}

async fn revoke_share(
    Path(share_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let revoked_at = now_rfc3339();
    let changed = conn
        .execute(
            "UPDATE relay_shares SET revoked_at=?1 WHERE id=?2 AND owner_user_id=?3",
            params![revoked_at, share_id, owner.id],
        )
        .unwrap_or(0);
    if changed == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Share not found")),
        )
            .into_response();
    }
    Json(json!({ "id": share_id, "revokedAt": revoked_at })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGrantInput {
    #[serde(alias = "targetUsername")]
    target_identifier: Option<String>,
    device_id: Option<String>,
    scope: Option<String>,
    thread_id: Option<String>,
    workspace_id: Option<String>,
    workspace_scope: Option<String>,
    workspace_ids: Option<Vec<String>>,
    label: Option<String>,
    thread_access: Option<String>,
    workspace_access: Option<String>,
    can_create_threads: Option<bool>,
    expires_at: Option<String>,
}

async fn create_grant(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateGrantInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let target_identifier = body
        .target_identifier
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let device_id = body.device_id.unwrap_or_default();
    let scope = normalize_scope(body.scope.as_deref());
    if target_identifier.is_empty() || device_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "targetIdentifier and deviceId are required",
            )),
        )
            .into_response();
    }
    if (scope == "thread" && body.thread_id.as_deref().unwrap_or_default().is_empty())
        || (scope == "workspace" && body.workspace_id.as_deref().unwrap_or_default().is_empty())
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "The selected grant scope requires its resource id",
            )),
        )
            .into_response();
    }
    let device_name: Option<String> = conn
        .query_row(
            "SELECT name FROM relay_devices WHERE id=?1 AND owner_user_id=?2",
            params![device_id, owner.id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    let Some(device_name) = device_name else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Device not found")),
        )
            .into_response();
    };
    let target: Option<(String, String)> = conn
        .query_row(
            "SELECT id,username FROM relay_users WHERE enabled=1 AND (username=?1 OR email=?1)",
            params![target_identifier],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((target_id, target_username)) = target else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Target user not found")),
        )
            .into_response();
    };
    if target_id == owner.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "You cannot grant access to yourself",
            )),
        )
            .into_response();
    }
    let id = Uuid::new_v4().to_string();
    let created_at = now_rfc3339();
    let thread_access = normalize_thread_access(body.thread_access.as_deref());
    let workspace_access = normalize_workspace_access(body.workspace_access.as_deref());
    let workspace_scope = match body.workspace_scope.as_deref() {
        Some("selected") => "selected",
        _ => "all",
    };
    let workspace_ids = serde_json::to_string(&body.workspace_ids.clone().unwrap_or_default())
        .unwrap_or_else(|_| "[]".to_string());
    if conn.execute(
        "INSERT INTO relay_access_grants
         (id,owner_user_id,owner_username,target_user_id,target_username,device_id,device_name,
          scope,thread_id,thread_title,workspace_id,workspace_label,workspace_scope,workspace_ids,label,
          thread_access,workspace_access,can_create_threads,created_at,revoked_at,expires_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,?10,NULL,?11,?12,?13,?14,?15,?16,?17,NULL,?18)",
        params![
            id,
            owner.id,
            owner.username,
            target_id,
            target_username,
            device_id,
            device_name,
            scope,
            body.thread_id,
            body.workspace_id,
            workspace_scope,
            workspace_ids,
            body.label,
            thread_access,
            workspace_access,
            body.can_create_threads.unwrap_or(false) as i64,
            created_at,
            body.expires_at,
        ],
    ).is_err() {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new("conflict", "Grant could not be created")),
        )
            .into_response();
    }
    Json(json!({ "id": id })).into_response()
}

async fn list_grants(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let mut stmt = conn
        .prepare(
            "SELECT id,target_username,device_id,scope,thread_id,thread_access,created_at
                  FROM relay_access_grants WHERE owner_user_id=?1 AND revoked_at IS NULL",
        )
        .expect("stmt");
    let grants: Vec<Value> = stmt
        .query_map(params![owner.id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "targetUsername": row.get::<_, String>(1)?,
                "deviceId": row.get::<_, String>(2)?,
                "scope": row.get::<_, String>(3)?,
                "threadId": row.get::<_, Option<String>>(4)?,
                "threadAccess": row.get::<_, String>(5)?,
                "createdAt": row.get::<_, String>(6)?
            }))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    Json(json!({ "grants": grants })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateGrantInput {
    thread_access: Option<String>,
    workspace_access: Option<String>,
    can_create_threads: Option<bool>,
    workspace_scope: Option<String>,
    workspace_ids: Option<Vec<String>>,
    label: Option<String>,
    expires_at: Option<String>,
}

async fn update_grant(
    Path(grant_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateGrantInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let owned = conn
        .query_row(
            "SELECT 1 FROM relay_access_grants WHERE id=?1 AND owner_user_id=?2 AND revoked_at IS NULL",
            params![grant_id, owner.id],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if !owned {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Grant not found")),
        )
            .into_response();
    }
    if let Some(access) = body.thread_access {
        let access = normalize_thread_access(Some(&access));
        let _ = conn.execute(
            "UPDATE relay_access_grants SET thread_access=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![access, grant_id, owner.id],
        );
    }
    if let Some(access) = body.workspace_access {
        let access = normalize_workspace_access(Some(&access));
        let _ = conn.execute(
            "UPDATE relay_access_grants SET workspace_access=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![access, grant_id, owner.id],
        );
    }
    if let Some(can) = body.can_create_threads {
        let _ = conn.execute(
            "UPDATE relay_access_grants SET can_create_threads=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![can as i64, grant_id, owner.id],
        );
    }
    if let Some(scope) = body.workspace_scope {
        let scope = if scope == "selected" {
            "selected"
        } else {
            "all"
        };
        let _ = conn.execute(
            "UPDATE relay_access_grants SET workspace_scope=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![scope, grant_id, owner.id],
        );
    }
    if let Some(ids) = body.workspace_ids {
        let ids = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
        let _ = conn.execute(
            "UPDATE relay_access_grants SET workspace_ids=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![ids, grant_id, owner.id],
        );
    }
    if let Some(label) = body.label {
        let _ = conn.execute(
            "UPDATE relay_access_grants SET label=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![label, grant_id, owner.id],
        );
    }
    if let Some(expires_at) = body.expires_at {
        let _ = conn.execute(
            "UPDATE relay_access_grants SET expires_at=?1 WHERE id=?2 AND owner_user_id=?3 AND revoked_at IS NULL",
            params![expires_at, grant_id, owner.id],
        );
    }
    Json(json!({ "id": grant_id, "ok": true })).into_response()
}

async fn revoke_grant(
    Path(grant_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let revoked_at = now_rfc3339();
    let changed = conn
        .execute(
            "UPDATE relay_access_grants SET revoked_at=?1 WHERE id=?2 AND owner_user_id=?3",
            params![revoked_at, grant_id, owner.id],
        )
        .unwrap_or(0);
    if changed == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "Grant not found")),
        )
            .into_response();
    }
    Json(json!({ "id": grant_id, "revokedAt": revoked_at })).into_response()
}

fn normalize_thread_access(value: Option<&str>) -> String {
    if value == Some("read") {
        "read".to_string()
    } else {
        "control".to_string()
    }
}

fn normalize_workspace_access(value: Option<&str>) -> String {
    match value {
        Some("read") => "read".to_string(),
        Some("write") => "write".to_string(),
        _ => "none".to_string(),
    }
}

fn normalize_scope(value: Option<&str>) -> String {
    match value {
        Some("workspace") => "workspace".to_string(),
        Some("device") => "device".to_string(),
        _ => "thread".to_string(),
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdminQuery {
    token: Option<String>,
    relay_session: Option<String>,
    days: Option<u32>,
}

impl AdminQuery {
    fn token_query(&self) -> TokenQuery {
        TokenQuery {
            token: self.token.clone(),
            device_token: None,
            relay_session: self.relay_session.clone(),
        }
    }
}

async fn relay_admin(
    headers: HeaderMap,
    Query(query): Query<AdminQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let connected: Vec<String> = state.sockets.read().await.keys().cloned().collect();
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(
        &conn,
        &state.store.session_secret,
        &headers,
        &query.token_query(),
    )
    .is_none()
    {
        return unauthorized();
    }
    let conversation_window_days = query.days.unwrap_or(7).clamp(1, 365);
    let has_conversations = table_exists(&conn, "relay_conversation_events");
    let mut stmt = match conn.prepare(
        "SELECT id,email,username,role,enabled,last_seen_at,created_at FROM relay_users ORDER BY created_at ASC",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let users: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let device_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM relay_devices WHERE owner_user_id=?1",
                    params![id],
                    |count| count.get::<_, i64>(0),
                )
                .unwrap_or(0);
            let conversation_count = if has_conversations {
                conn.query_row(
                    "SELECT COUNT(*) FROM relay_conversation_events WHERE user_id=?1",
                    params![id],
                    |count| count.get::<_, i64>(0),
                )
                .unwrap_or(0)
            } else {
                0
            };
            Ok(json!({
                "id": id,
                "email": row.get::<_, String>(1)?,
                "username": row.get::<_, String>(2)?,
                "role": row.get::<_, String>(3)?,
                "enabled": row.get::<_, i64>(4)? == 1,
                "lastSeenAt": row.get::<_, Option<String>>(5)?,
                "createdAt": row.get::<_, String>(6)?,
                "deviceCount": device_count,
                "conversationCount": conversation_count
            }))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    drop(stmt);

    let mut stmt = match conn.prepare(
        "SELECT d.id,d.owner_user_id,d.name,d.token,d.token_preview,d.created_at,u.username,u.email
         FROM relay_devices d JOIN relay_users u ON u.id=d.owner_user_id ORDER BY d.created_at ASC",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let devices: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            Ok(json!({
                "id": id,
                "ownerUserId": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "token": row.get::<_, Option<String>>(3)?,
                "tokenPreview": row.get::<_, String>(4)?,
                "connected": connected.iter().any(|connected_id| connected_id == &id),
                "connectedAt": Value::Null,
                "lastHeartbeatAt": Value::Null,
                "createdAt": row.get::<_, String>(5)?,
                "ownerUsername": row.get::<_, String>(6)?,
                "ownerEmail": row.get::<_, String>(7)?,
                "ipAddress": Value::Null,
                "workspaces": [],
                "threads": []
            }))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    drop(stmt);

    let user_ids: Vec<String> = users
        .iter()
        .filter_map(|user| user.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    let shares: Vec<Value> = user_ids
        .iter()
        .flat_map(|id| relay_shares_for(&conn, "owner_user_id", id))
        .collect();
    let grants: Vec<Value> = user_ids
        .iter()
        .flat_map(|id| relay_grants_for(&conn, "owner_user_id", id))
        .collect();
    let pending_registrations = if table_exists(&conn, "relay_pending_registrations") {
        conn.prepare(
            "SELECT id,email,username,created_at,provider FROM relay_pending_registrations
             WHERE status='pending' ORDER BY created_at ASC",
        )
        .ok()
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "email": row.get::<_, String>(1)?,
                    "username": row.get::<_, String>(2)?,
                    "createdAt": row.get::<_, String>(3)?,
                    "provider": row.get::<_, String>(4)?
                }))
            })
            .ok()
            .map(|rows| rows.flatten().collect::<Vec<_>>())
        })
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let settings = registration_settings(&conn);
    let registration_enabled = settings
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Json(json!({
        "users": users,
        "devices": devices,
        "shares": shares,
        "grants": grants,
        "pendingRegistrations": pending_registrations,
        "settings": settings,
        "conversationWindowDays": conversation_window_days,
        "registrationEnabled": registration_enabled
    }))
    .into_response()
}

async fn hosted_sandbox_capability(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    Json(json!({
        "provider": "disabled",
        "configured": false,
        "reachable": false,
        "available": false,
        "reasonCode": "provider_disabled",
        "reason": "Hosted sandboxes are not implemented by the Rust relay yet.",
        "checkedAt": now_rfc3339()
    }))
    .into_response()
}

fn set_relay_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO relay_settings(key,value) VALUES (?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

async fn update_registration_settings(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    if body.get("googleAuthEnabled").and_then(Value::as_bool) == Some(true)
        || body.get("githubAuthEnabled").and_then(Value::as_bool) == Some(true)
        || body.get("approvalRequired").and_then(Value::as_bool) == Some(true)
        || body
            .get("emailVerificationEnabled")
            .and_then(Value::as_bool)
            == Some(true)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Registration approval, OAuth, and email verification are not implemented in the Rust relay",
            )),
        )
            .into_response();
    }
    if let Some(enabled) = body.get("enabled").and_then(Value::as_bool) {
        let _ = set_relay_setting(
            &conn,
            "registrationEnabled",
            if enabled { "true" } else { "false" },
        );
    }
    if let Some(approval) = body.get("approvalRequired").and_then(Value::as_bool) {
        let _ = set_relay_setting(
            &conn,
            "registrationApprovalRequired",
            if approval { "true" } else { "false" },
        );
    }
    for (key, value) in [
        (
            "googleAuthEnabled",
            body.get("googleAuthEnabled").and_then(Value::as_bool),
        ),
        (
            "githubAuthEnabled",
            body.get("githubAuthEnabled").and_then(Value::as_bool),
        ),
        (
            "emailVerificationEnabled",
            body.get("emailVerificationEnabled")
                .and_then(Value::as_bool),
        ),
    ] {
        if let Some(value) = value {
            let _ = set_relay_setting(&conn, key, if value { "true" } else { "false" });
        }
    }
    if let Some(password) = body.get("registrationPassword") {
        match password {
            Value::Null => {
                let _ = conn.execute(
                    "DELETE FROM relay_settings WHERE key='registrationPassword'",
                    [],
                );
            }
            Value::String(password) if password.trim().len() >= 8 => {
                let _ = set_relay_setting(&conn, "registrationPassword", password.trim());
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ApiError::new(
                        "bad_request",
                        "Registration password must be at least 8 characters",
                    )),
                )
                    .into_response();
            }
        }
    }
    let settings = registration_settings(&conn);
    Json(json!({
        "registrationEnabled": settings.get("enabled").cloned().unwrap_or(Value::Bool(true)),
        "settings": settings
    }))
    .into_response()
}

#[derive(Deserialize)]
struct SetUserEnabledInput {
    enabled: bool,
}

async fn set_user_enabled(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SetUserEnabledInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" && !body.enabled {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "The admin user cannot be disabled",
            )),
        )
            .into_response();
    }
    if conn
        .execute(
            "UPDATE relay_users SET enabled=?1 WHERE id=?2",
            params![body.enabled as i64, user_id],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let updated = load_user_by_id(&conn, &user_id).unwrap_or(user);
    Json(user_json(&updated)).into_response()
}

async fn admin_delete_user(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "The admin user cannot be deleted",
            )),
        )
            .into_response();
    }
    if conn
        .execute("DELETE FROM relay_users WHERE id=?1", params![user_id])
        .is_err()
    {
        return (
            StatusCode::CONFLICT,
            Json(ApiError::new(
                "conflict",
                "User still owns relay resources that must be reassigned",
            )),
        )
            .into_response();
    }
    Json(json!({ "id": user_id })).into_response()
}

#[derive(Deserialize)]
struct ResetPasswordInput {
    password: String,
}

async fn admin_reset_password(
    Path(user_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetPasswordInput>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    if authenticated_admin_user(&conn, &state.store.session_secret, &headers, &query).is_none() {
        return unauthorized();
    }
    let Some(user) = load_user_by_id(&conn, &user_id) else {
        return (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "User not found")),
        )
            .into_response();
    };
    if user.role == "admin" || body.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiError::new(
                "bad_request",
                "Only non-admin users can be reset to a password of at least 8 characters",
            )),
        )
            .into_response();
    }
    let Ok((salt, hash)) = hash_password(&body.password) else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    if conn
        .execute(
            "UPDATE relay_users SET password_salt=?1,password_hash=?2 WHERE id=?3",
            params![salt, hash, user_id],
        )
        .is_err()
    {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    Json(user_json(&user)).into_response()
}

async fn device_healthz(
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let allowed = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query)
            .and_then(|user| effective_access(&conn, &user.id, &device_id, None, None))
            .is_some()
    };
    if !allowed {
        return unauthorized();
    }
    forward_device(
        state,
        device_id,
        "GET".into(),
        "/healthz".into(),
        None,
        None,
        json!({}),
    )
    .await
}

async fn device_api(
    Path((device_id, rest)): Path<(String, String)>,
    method: Method,
    uri: Uri,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let path = relay_api_target_path(&rest, &uri);
    let thread_id = resource_id_from_path(&path, "threads");
    let workspace_id = resource_id_from_path(&path, "workspaces");
    let access = {
        let conn = state.store.conn.lock().await;
        authenticated_user(&conn, &state.store.session_secret, &headers, &query).and_then(|user| {
            effective_access(
                &conn,
                &user.id,
                &device_id,
                thread_id.as_deref(),
                workspace_id.as_deref(),
            )
        })
    };
    let Some(access) = access else {
        return unauthorized();
    };
    if !relay_target_allowed(&path) || !access_allows(&access, &method, &path) {
        return (
            StatusCode::FORBIDDEN,
            Json(ApiError::new(
                "forbidden",
                "This relay session does not allow that operation",
            )),
        )
            .into_response();
    }
    let forwarded_headers = [header::CONTENT_TYPE, header::ACCEPT]
        .into_iter()
        .filter_map(|name| {
            headers
                .get(&name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.as_str().to_string(), Value::String(value.to_string())))
        })
        .collect::<serde_json::Map<String, Value>>();
    let (body, body_encoding) = encode_relay_request_body(&body);
    forward_device(
        state,
        device_id,
        method.as_str().to_string(),
        path,
        body,
        body_encoding,
        Value::Object(forwarded_headers),
    )
    .await
}

async fn relay_api_compat(
    Path(rest): Path<String>,
    method: Method,
    uri: Uri,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let path = relay_api_target_path(&rest, &uri);
    let thread_id = resource_id_from_path(&path, "threads");
    let workspace_id = resource_id_from_path(&path, "workspaces");
    let connected_device_ids: Vec<String> = state.sockets.read().await.keys().cloned().collect();
    let resolved = {
        let conn = state.store.conn.lock().await;
        let Some(user) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
        else {
            return unauthorized();
        };
        connected_device_ids.iter().find_map(|device_id| {
            effective_access(
                &conn,
                &user.id,
                device_id,
                thread_id.as_deref(),
                workspace_id.as_deref(),
            )
            .map(|access| (device_id.clone(), access))
        })
    };
    let Some((device_id, access)) = resolved else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiError::new(
                "service_unavailable",
                "No accessible supervisor is connected to this relay",
            )),
        )
            .into_response();
    };
    if !relay_target_allowed(&path) || !access_allows(&access, &method, &path) {
        return (
            StatusCode::FORBIDDEN,
            Json(ApiError::new(
                "forbidden",
                "This relay session does not allow that operation",
            )),
        )
            .into_response();
    }
    let forwarded_headers = [header::CONTENT_TYPE, header::ACCEPT]
        .into_iter()
        .filter_map(|name| {
            headers
                .get(&name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.as_str().to_string(), Value::String(value.to_string())))
        })
        .collect::<serde_json::Map<String, Value>>();
    let (body, body_encoding) = encode_relay_request_body(&body);
    forward_device(
        state,
        device_id,
        method.as_str().to_string(),
        path,
        body,
        body_encoding,
        Value::Object(forwarded_headers),
    )
    .await
}

fn relay_api_target_path(rest: &str, uri: &Uri) -> String {
    let mut path = format!("/api/{rest}");
    if let Some(raw) = uri.query() {
        let filtered: Vec<&str> = raw
            .split('&')
            .filter(|part| {
                let key = part.split('=').next().unwrap_or("");
                key != "token" && key != "deviceToken" && key != "relaySession"
            })
            .collect();
        if !filtered.is_empty() {
            path.push('?');
            path.push_str(&filtered.join("&"));
        }
    }
    path
}

fn encode_relay_request_body(body: &[u8]) -> (Option<String>, Option<String>) {
    if body.is_empty() {
        (None, None)
    } else {
        match String::from_utf8(body.to_vec()) {
            Ok(body) => (Some(body), None),
            Err(error) => (
                Some(base64::engine::general_purpose::STANDARD.encode(error.into_bytes())),
                Some("base64".to_string()),
            ),
        }
    }
}

fn resource_id_from_path(path: &str, resource: &str) -> Option<String> {
    let path = path.split('?').next().unwrap_or(path);
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    while let Some(segment) = segments.next() {
        if segment == resource {
            let id = segments.next()?;
            if id == "start" || id == "import" {
                return None;
            }
            return Some(id.to_string());
        }
    }
    None
}

fn relay_target_allowed(path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path);
    path == "/healthz" || path.starts_with("/api/") || path == "/api"
}

fn access_allows(access: &EffectiveAccess, method: &Method, path: &str) -> bool {
    if access.kind == "owner" {
        return true;
    }
    let method = method.as_str();
    let pathname = path.split('?').next().unwrap_or(path);
    if shared_runtime_metadata_allowed(method, pathname) {
        return true;
    }
    let thread_id = resource_id_from_path(path, "threads");
    let workspace_id = resource_id_from_path(path, "workspaces");

    if pathname == "/api/threads/start" {
        return access.scope == "device"
            && access.can_create_threads
            && access.thread_access == "control"
            && method == "POST";
    }
    if let Some(thread_id) = thread_id {
        if access.scope != "device" && access.thread_id.as_deref() != Some(thread_id.as_str()) {
            return false;
        }
        return shared_thread_path_allowed(
            method,
            pathname,
            &thread_id,
            access.thread_access == "control",
        );
    }
    if let Some(workspace_id) = workspace_id {
        let workspace_matches = access.scope == "device"
            || access.workspace_id.as_deref() == Some(workspace_id.as_str())
            || (access.workspace_scope.as_deref() == Some("selected")
                && access.workspace_ids.iter().any(|id| id == &workspace_id));
        if !workspace_matches || access.workspace_access == "none" {
            return false;
        }
        return shared_workspace_path_allowed(
            method,
            pathname,
            &workspace_id,
            access.workspace_access == "write",
        );
    }
    access.scope == "device"
        && method == "GET"
        && matches!(pathname, "/api/threads" | "/api/workspaces")
}

fn shared_runtime_metadata_allowed(method: &str, pathname: &str) -> bool {
    if method != "GET" {
        return false;
    }
    if matches!(pathname, "/api/agent-runtimes" | "/api/plugins") {
        return true;
    }
    let segments: Vec<&str> = pathname
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    segments.len() == 4
        && segments[0] == "api"
        && segments[1] == "agent-runtimes"
        && matches!(
            segments[3],
            "status" | "models" | "agents" | "subscription-usage"
        )
}

fn shared_thread_path_allowed(
    method: &str,
    pathname: &str,
    thread_id: &str,
    control: bool,
) -> bool {
    let base = format!("/api/threads/{thread_id}");
    let Some(suffix) = pathname.strip_prefix(&base) else {
        return false;
    };
    if !suffix.is_empty() && !suffix.starts_with('/') {
        return false;
    }
    if method == "GET" {
        if matches!(
            suffix,
            "" | "/export-turns"
                | "/exports/pdf"
                | "/assets/image"
                | "/goal"
                | "/skills"
                | "/mcp-servers"
                | "/hooks"
        ) {
            return true;
        }
        let parts: Vec<&str> = suffix.split('/').filter(|part| !part.is_empty()).collect();
        if parts.len() == 3 && parts[0] == "items" && parts[2] == "detail" {
            return true;
        }
        return control && suffix == "/fork-turns";
    }
    if !control {
        return false;
    }
    match method {
        "PATCH" => matches!(suffix, "/goal" | "/settings"),
        "DELETE" => suffix == "/goal",
        "PUT" => suffix == "/hooks",
        "POST" => {
            if matches!(
                suffix,
                "/goal"
                    | "/resume"
                    | "/prompt"
                    | "/interrupt"
                    | "/compact"
                    | "/fork"
                    | "/hooks"
                    | "/hooks/trust"
                    | "/hooks/untrust"
            ) {
                return true;
            }
            let parts: Vec<&str> = suffix.split('/').filter(|part| !part.is_empty()).collect();
            parts.len() == 3 && parts[0] == "requests" && parts[2] == "respond"
        }
        _ => false,
    }
}

fn shared_workspace_path_allowed(
    method: &str,
    pathname: &str,
    workspace_id: &str,
    write: bool,
) -> bool {
    let base = format!("/api/workspaces/{workspace_id}");
    let Some(suffix) = pathname.strip_prefix(&base) else {
        return false;
    };
    if !suffix.is_empty() && !suffix.starts_with('/') {
        return false;
    }
    if method == "GET" {
        if matches!(
            suffix,
            "" | "/files/tree" | "/files/preview" | "/files/raw" | "/files/download" | "/artifacts"
        ) {
            return true;
        }
        let parts: Vec<&str> = suffix.split('/').filter(|part| !part.is_empty()).collect();
        return (parts.len() == 2 && parts[0] == "artifacts")
            || (parts.len() == 3 && parts[0] == "artifacts" && parts[2] == "download");
    }
    write
        && matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
        && matches!(suffix, "/files" | "/files/upload" | "/files/move")
}

async fn forward_device(
    state: Arc<AppState>,
    device_id: String,
    method: String,
    path: String,
    body: Option<String>,
    body_encoding: Option<String>,
    headers: Value,
) -> axum::response::Response {
    forward_device_with_timeout(
        state,
        device_id,
        method,
        path,
        body,
        body_encoding,
        headers,
        Duration::from_secs(30),
    )
    .await
}

struct PendingRequestGuard<'a> {
    pending: &'a StdMutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>,
    request_id: &'a str,
}

impl Drop for PendingRequestGuard<'_> {
    fn drop(&mut self) {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(self.request_id);
    }
}

#[allow(clippy::too_many_arguments)]
async fn forward_device_with_timeout(
    state: Arc<AppState>,
    device_id: String,
    method: String,
    path: String,
    body: Option<String>,
    body_encoding: Option<String>,
    headers: Value,
    response_timeout: Duration,
) -> axum::response::Response {
    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(request_id.clone(), tx);
    let _pending_guard = PendingRequestGuard {
        pending: &state.pending,
        request_id: &request_id,
    };
    let mut request_payload = json!({
        "method": method,
        "path": path,
        "headers": headers,
        "body": body
    });
    if let Some(body_encoding) = body_encoding {
        request_payload["bodyEncoding"] = Value::String(body_encoding);
    }
    let payload = json!({
        "type": "relay.request",
        "timestamp": now_rfc3339(),
        "requestId": request_id,
        "deviceId": device_id,
        "payload": request_payload
    })
    .to_string();
    let sent = {
        let sockets = state.sockets.read().await;
        if let Some(socket) = sockets.get(&device_id) {
            socket.tx.send(payload).is_ok()
        } else {
            false
        }
    };
    if !sent {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "code": "service_unavailable", "message": "device is offline" })),
        )
            .into_response();
    }
    match tokio::time::timeout(response_timeout, rx).await {
        Ok(Ok(value)) => forwarded_device_response(value),
        _ => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({ "code": "timeout", "message": "device did not respond" })),
        )
            .into_response(),
    }
}

fn forwarded_device_response(value: Value) -> Response {
    let status = value
        .get("statusCode")
        .and_then(Value::as_u64)
        .and_then(|status| StatusCode::from_u16(status as u16).ok())
        .unwrap_or(StatusCode::OK);
    let encoded_body = if value.get("bodyEncoding").and_then(Value::as_str) == Some("base64") {
        value.get("body").and_then(Value::as_str)
    } else {
        value.get("bodyBase64").and_then(Value::as_str)
    };
    let bytes = if let Some(encoded) = encoded_body {
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(bytes) => bytes,
            Err(_) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "code": "invalid_supervisor_response",
                        "message": "Supervisor returned an invalid binary response."
                    })),
                )
                    .into_response();
            }
        }
    } else {
        match value.get("body").cloned().unwrap_or(Value::Null) {
            Value::String(raw) => raw.into_bytes(),
            Value::Null => Vec::new(),
            other => serde_json::to_vec(&other).unwrap_or_default(),
        }
    };

    let mut response = Response::builder().status(status);
    if let Some(headers) = value.get("headers").and_then(Value::as_object) {
        for name in [
            "content-type",
            "content-disposition",
            "cache-control",
            "x-content-type-options",
        ] {
            if let Some(header_value) = headers.get(name).and_then(Value::as_str) {
                response = response.header(name, header_value);
            }
        }
    }
    response
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn list_shares(
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let conn = state.store.conn.lock().await;
    let Some(owner) = authenticated_user(&conn, &state.store.session_secret, &headers, &query)
    else {
        return unauthorized();
    };
    let mut stmt = conn
        .prepare(
            "SELECT id,target_username,device_id,thread_id,thread_access,created_at
                  FROM relay_shares WHERE owner_user_id=?1 AND revoked_at IS NULL",
        )
        .expect("stmt");
    let shares: Vec<Value> = stmt
        .query_map(params![owner.id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "targetUsername": row.get::<_, String>(1)?,
                "deviceId": row.get::<_, String>(2)?,
                "threadId": row.get::<_, String>(3)?,
                "threadAccess": row.get::<_, String>(4)?,
                "createdAt": row.get::<_, String>(5)?
            }))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    Json(json!({ "shares": shares })).into_response()
}

async fn supervisor_tunnel(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let token = query
        .device_token()
        .or_else(|| bearer_token(&headers))
        .unwrap_or_default();
    if token.is_empty() {
        return unauthorized();
    }
    let device_id = {
        let conn = state.store.conn.lock().await;
        device_id_for_supervisor_token(&conn, &token, state.legacy_supervisor_token.as_deref())
    };
    let Some(device_id) = device_id else {
        return unauthorized();
    };
    ws.on_upgrade(move |socket| handle_supervisor(socket, state, device_id))
        .into_response()
}

fn device_id_for_supervisor_token(
    conn: &Connection,
    token: &str,
    legacy_supervisor_token: Option<&str>,
) -> Option<String> {
    conn.query_row(
        "SELECT id FROM relay_devices WHERE token_hash=?1",
        params![hash_device_token(token)],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .or_else(|| {
        legacy_supervisor_token
            .filter(|expected| token.as_bytes().ct_eq(expected.as_bytes()).into())
            .map(|_| "legacy-default".to_string())
    })
}

async fn handle_supervisor(socket: WebSocket, state: Arc<AppState>, device_id: String) {
    let connection_id = Uuid::new_v4();
    let connected_at = now_rfc3339();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    state.sockets.write().await.insert(
        device_id.clone(),
        DeviceSocket {
            tx,
            connection_id,
            connected_at: connected_at.clone(),
            last_heartbeat_at: connected_at.clone(),
        },
    );
    let (mut sink, mut stream) = socket.split();
    let _ = sink
        .send(Message::Text(
            json!({
                "type": "relay.connected",
                "timestamp": connected_at,
                "deviceId": device_id
            })
            .to_string()
            .into(),
        ))
        .await;
    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                            match msg.get("type").and_then(Value::as_str) {
                                Some("relay.response") => {
                                    if let Some(request_id) = msg.get("requestId").and_then(Value::as_str) {
                                        if let Some(pending) = state
                                            .pending
                                            .lock()
                                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                                            .remove(request_id)
                                        {
                                            let payload = msg.get("payload").cloned().unwrap_or(json!({}));
                                            let _ = pending.send(payload);
                                        }
                                    }
                                }
                                Some("relay.server.message") => {
                                    if let (Some(client_id), Some(payload)) = (
                                        msg.get("clientId").and_then(Value::as_str),
                                        msg.get("payload"),
                                    ) {
                                        forward_server_message_to_client(
                                            &state,
                                            &device_id,
                                            connection_id,
                                            client_id,
                                            payload,
                                        )
                                        .await;
                                    }
                                }
                                Some("relay.heartbeat") => {
                                    let timestamp = msg
                                        .get("timestamp")
                                        .and_then(Value::as_str)
                                        .map(str::to_string)
                                        .unwrap_or_else(now_rfc3339);
                                    let mut sockets = state.sockets.write().await;
                                    if let Some(socket) = sockets.get_mut(&device_id) {
                                        if socket.connection_id == connection_id {
                                            socket.last_heartbeat_at = timestamp;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }
    remove_supervisor_connection(&state, &device_id, connection_id).await;
}

async fn remove_supervisor_connection(state: &AppState, device_id: &str, connection_id: Uuid) {
    let mut sockets = state.sockets.write().await;
    if sockets
        .get(device_id)
        .is_some_and(|socket| socket.connection_id == connection_id)
    {
        sockets.remove(device_id);
    }
    drop(sockets);
    state.clients.write().await.retain(|_, client| {
        client.device_id != device_id || client.supervisor_connection_id != connection_id
    });
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ClientWsQuery {
    token: Option<String>,
    relay_session: Option<String>,
    thread_id: Option<String>,
}

impl ClientWsQuery {
    fn token_query(&self) -> TokenQuery {
        TokenQuery {
            token: self.token.clone(),
            device_token: None,
            relay_session: self.relay_session.clone(),
        }
    }
}

async fn client_ws(
    ws: WebSocketUpgrade,
    Path(device_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ClientWsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let user_and_access = {
        let conn = state.store.conn.lock().await;
        authenticated_user(
            &conn,
            &state.store.session_secret,
            &headers,
            &query.token_query(),
        )
        .and_then(|user| {
            effective_access(
                &conn,
                &user.id,
                &device_id,
                query.thread_id.as_deref(),
                None,
            )
            .map(|access| (user, access))
        })
    };
    let Some((user, access)) = user_and_access else {
        return unauthorized();
    };
    if !state.sockets.read().await.contains_key(&device_id) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiError::new(
                "service_unavailable",
                "No supervisor is connected for this device",
            )),
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| {
        handle_client_socket(socket, state, device_id, user.id, query.thread_id, access)
    })
    .into_response()
}

async fn client_ws_compat(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(query): Query<ClientWsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let device_ids: Vec<String> = state.sockets.read().await.keys().cloned().collect();
    let resolved = {
        let conn = state.store.conn.lock().await;
        authenticated_user(
            &conn,
            &state.store.session_secret,
            &headers,
            &query.token_query(),
        )
        .and_then(|user| {
            device_ids.iter().find_map(|device_id| {
                effective_access(&conn, &user.id, device_id, query.thread_id.as_deref(), None)
                    .map(|access| (device_id.clone(), user.clone(), access))
            })
        })
    };
    let Some((device_id, user, access)) = resolved else {
        return unauthorized();
    };
    ws.on_upgrade(move |socket| {
        handle_client_socket(socket, state, device_id, user.id, query.thread_id, access)
    })
    .into_response()
}

async fn handle_client_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    device_id: String,
    user_id: String,
    thread_id: Option<String>,
    _initial_access: EffectiveAccess,
) {
    let client_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let supervisor_connection_id = {
        let sockets = state.sockets.read().await;
        let Some(supervisor) = sockets.get(&device_id) else {
            return;
        };
        let supervisor_connection_id = supervisor.connection_id;
        state.clients.write().await.insert(
            client_id.clone(),
            ClientSocket {
                tx,
                device_id: device_id.clone(),
                supervisor_connection_id,
                user_id: user_id.clone(),
                thread_id: thread_id.clone(),
                attached_shell_id: None,
            },
        );
        supervisor_connection_id
    };
    send_to_supervisor_connection(
        &state,
        &device_id,
        supervisor_connection_id,
        json!({
            "type": "relay.client.connected",
            "timestamp": now_rfc3339(),
            "clientId": client_id
        }),
    )
    .await;

    let (mut sink, mut stream) = socket.split();
    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(payload) = serde_json::from_str::<Value>(&text) else { continue; };
                        let message_thread = payload.get("threadId").and_then(Value::as_str);
                        let fresh_access = {
                            let conn = state.store.conn.lock().await;
                            effective_access(
                                &conn,
                                &user_id,
                                &device_id,
                                thread_id.as_deref().or(message_thread),
                                None,
                            )
                        };
                        let Some(fresh_access) = fresh_access else {
                            break;
                        };
                        if fresh_access.kind == "shared" && fresh_access.thread_access != "control" {
                            break;
                        }
                        match payload.get("type").and_then(Value::as_str) {
                            Some("shell.attach") => {
                                if let Some(shell_id) = payload.get("shellId").and_then(Value::as_str) {
                                    if let Some(client) = state.clients.write().await.get_mut(&client_id) {
                                        client.attached_shell_id = Some(shell_id.to_string());
                                    }
                                }
                            }
                            Some("shell.detach") => {
                                if let Some(client) = state.clients.write().await.get_mut(&client_id) {
                                    client.attached_shell_id = None;
                                }
                            }
                            _ => {}
                        }
                        send_to_supervisor_connection(
                            &state,
                            &device_id,
                            supervisor_connection_id,
                            json!({
                                "type": "relay.client.message",
                                "timestamp": now_rfc3339(),
                                "clientId": client_id,
                                "payload": payload
                            }),
                        ).await;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }
    state.clients.write().await.remove(&client_id);
    send_to_supervisor_connection(
        &state,
        &device_id,
        supervisor_connection_id,
        json!({
            "type": "relay.client.disconnected",
            "timestamp": now_rfc3339(),
            "clientId": client_id
        }),
    )
    .await;
}

async fn send_to_supervisor_connection(
    state: &AppState,
    device_id: &str,
    connection_id: Uuid,
    message: Value,
) {
    if let Some(supervisor) = state.sockets.read().await.get(device_id) {
        if supervisor.connection_id == connection_id {
            let _ = supervisor.tx.send(message.to_string());
        }
    }
}

async fn forward_server_message_to_client(
    state: &AppState,
    device_id: &str,
    connection_id: Uuid,
    client_id: &str,
    payload: &Value,
) {
    let client = {
        let clients = state.clients.read().await;
        clients.get(client_id).and_then(|client| {
            (client.device_id == device_id && client.supervisor_connection_id == connection_id)
                .then(|| {
                    (
                        client.tx.clone(),
                        client.user_id.clone(),
                        client.thread_id.clone(),
                        client.attached_shell_id.clone(),
                    )
                })
        })
    };
    let Some((tx, user_id, configured_thread, attached_shell)) = client else {
        return;
    };
    let event_thread = payload.get("threadId").and_then(Value::as_str);
    if let Some(expected) = configured_thread.as_deref() {
        let control_event = matches!(
            payload.get("type").and_then(Value::as_str),
            Some("supervisor.connected" | "supervisor.pong")
        );
        let attached_shell_event = attached_shell.as_deref().is_some_and(|shell_id| {
            payload.get("shellId").and_then(Value::as_str) == Some(shell_id)
        });
        if !control_event && !attached_shell_event && event_thread != Some(expected) {
            return;
        }
    }
    let authorized = {
        let conn = state.store.conn.lock().await;
        effective_access(
            &conn,
            &user_id,
            device_id,
            configured_thread.as_deref().or(event_thread),
            None,
        )
        .is_some()
    };
    if authorized {
        let _ = tx.send(payload.to_string());
    } else {
        state.clients.write().await.remove(client_id);
    }
}

const RELAY_BOOTSTRAP: &str = r#"<script>window.__REMOTE_CODEX_BOOTSTRAP__={"mode":"relay","relayApiBase":"/relay"};</script>"#;

fn inject_bootstrap(html: &str) -> String {
    if html.contains("</head>") {
        html.replacen("</head>", &format!("{RELAY_BOOTSTRAP}</head>"), 1)
    } else {
        format!("{RELAY_BOOTSTRAP}{html}")
    }
}

fn mime_for(path: &FsPath) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;

    fn temporary_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "remote-codex-relay-{name}-{}",
            Uuid::new_v4().simple()
        ))
    }

    fn test_app_state(name: &str) -> (Arc<AppState>, PathBuf) {
        let data_dir = temporary_test_dir(name);
        let store = RelayStore::open(
            data_dir.join("relay-store.sqlite"),
            "test-secret".to_string(),
        )
        .unwrap();
        (
            Arc::new(AppState {
                store,
                sockets: RwLock::new(HashMap::new()),
                clients: RwLock::new(HashMap::new()),
                pending: StdMutex::new(HashMap::new()),
                web_dist: None,
                legacy_supervisor_token: None,
            }),
            data_dir,
        )
    }

    fn device_socket(
        connection_id: Uuid,
    ) -> (DeviceSocket, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (
            DeviceSocket {
                tx,
                connection_id,
                connected_at: "2026-01-01T00:00:00Z".to_string(),
                last_heartbeat_at: "2026-01-01T00:00:00Z".to_string(),
            },
            rx,
        )
    }

    fn client_socket(device_id: &str, supervisor_connection_id: Uuid) -> ClientSocket {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        ClientSocket {
            tx,
            device_id: device_id.to_string(),
            supervisor_connection_id,
            user_id: "user".to_string(),
            thread_id: None,
            attached_shell_id: None,
        }
    }

    #[tokio::test]
    async fn forward_device_always_cleans_pending_requests() {
        let (state, data_dir) = test_app_state("pending-cleanup");
        let device_id = "device".to_string();

        let (closed_socket, closed_rx) = device_socket(Uuid::new_v4());
        drop(closed_rx);
        state
            .sockets
            .write()
            .await
            .insert(device_id.clone(), closed_socket);
        let response = forward_device_with_timeout(
            state.clone(),
            device_id.clone(),
            "GET".to_string(),
            "/healthz".to_string(),
            None,
            None,
            json!({}),
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert!(state
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());

        let (timeout_socket, _timeout_rx) = device_socket(Uuid::new_v4());
        state
            .sockets
            .write()
            .await
            .insert(device_id.clone(), timeout_socket);
        let response = forward_device_with_timeout(
            state.clone(),
            device_id.clone(),
            "GET".to_string(),
            "/healthz".to_string(),
            None,
            None,
            json!({}),
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert!(state
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());

        let (cancelled_socket, mut cancelled_rx) = device_socket(Uuid::new_v4());
        state
            .sockets
            .write()
            .await
            .insert(device_id.clone(), cancelled_socket);
        let cancelled_state = state.clone();
        let task = tokio::spawn(async move {
            forward_device_with_timeout(
                cancelled_state,
                device_id,
                "GET".to_string(),
                "/healthz".to_string(),
                None,
                None,
                json!({}),
                Duration::from_secs(60),
            )
            .await
        });
        cancelled_rx
            .recv()
            .await
            .expect("request must be forwarded");
        assert_eq!(
            state
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .len(),
            1
        );
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(state
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());

        drop(state);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[tokio::test]
    async fn stale_supervisor_cleanup_preserves_replacement_socket_and_clients() {
        let (state, data_dir) = test_app_state("connection-replacement");
        let device_id = "device";
        let old_connection_id = Uuid::new_v4();
        let new_connection_id = Uuid::new_v4();
        let (new_socket, _new_socket_rx) = device_socket(new_connection_id);
        state
            .sockets
            .write()
            .await
            .insert(device_id.to_string(), new_socket);
        {
            let mut clients = state.clients.write().await;
            clients.insert(
                "old-client".to_string(),
                client_socket(device_id, old_connection_id),
            );
            clients.insert(
                "new-client".to_string(),
                client_socket(device_id, new_connection_id),
            );
            clients.insert(
                "other-device-client".to_string(),
                client_socket("other-device", old_connection_id),
            );
        }

        remove_supervisor_connection(&state, device_id, old_connection_id).await;

        assert_eq!(
            state
                .sockets
                .read()
                .await
                .get(device_id)
                .map(|socket| socket.connection_id),
            Some(new_connection_id)
        );
        let clients = state.clients.read().await;
        assert!(!clients.contains_key("old-client"));
        assert!(clients.contains_key("new-client"));
        assert!(clients.contains_key("other-device-client"));
        drop(clients);

        drop(state);
        std::fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn crypto_matches_node_relay_vectors() {
        assert_eq!(
            node_scrypt_hash("correct horse battery staple", "AAECAwQFBgcICQoLDA0ODw").unwrap(),
            "sMGyuUMAja8z78gH2EOR8D5lXFo8yw1ug53QsfLGa2I"
        );
        assert_eq!(
            hash_device_token("rcd_fixture-token"),
            "CSf_fKICWBS9ci6nUJNDiD9tgMrjriIAaZtlYfjqP04"
        );
        let token = "eyJ1c2VySWQiOiJ1c2VyLWZpeHR1cmUiLCJleHBpcmVzQXQiOjQxMDI0NDQ4MDAwMDAsIm5vbmNlIjoiZml4dHVyZS1ub25jZSJ9.-bLJOekm5U89qOX49uYjtsE5bTwyzTbKr9_F3D0Cxqc";
        let payload = verify_session("fixture-secret", token).expect("Node session must verify");
        assert_eq!(payload.user_id, "user-fixture");
        assert!(verify_session("wrong-secret", token).is_none());
    }

    #[test]
    fn anonymous_session_never_exposes_registration_password() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE relay_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
             INSERT INTO relay_settings VALUES ('registrationPassword','top-secret-value');",
        )
        .unwrap();
        let session = session_json(&conn, None);
        assert_eq!(
            session["registrationSettings"]["registrationPassword"],
            Value::Null
        );
        assert_eq!(
            session["registrationSettings"]["registrationPasswordConfigured"],
            true
        );
        assert!(!session.to_string().contains("top-secret-value"));
    }

    #[test]
    fn accepts_node_device_tokens_and_explicit_legacy_supervisor_token() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE relay_devices (id TEXT PRIMARY KEY,token_hash TEXT NOT NULL);
             INSERT INTO relay_devices VALUES ('device-1','CSf_fKICWBS9ci6nUJNDiD9tgMrjriIAaZtlYfjqP04');",
        )
        .unwrap();
        assert_eq!(
            device_id_for_supervisor_token(&conn, "rcd_fixture-token", None).as_deref(),
            Some("device-1")
        );
        assert_eq!(
            device_id_for_supervisor_token(&conn, "legacy-token", Some("legacy-token")).as_deref(),
            Some("legacy-default")
        );
        assert!(device_id_for_supervisor_token(&conn, "wrong", Some("legacy-token")).is_none());
    }

    #[test]
    fn signed_sessions_round_trip_and_reject_tampering() {
        let token = create_session("session-secret", "user-1").unwrap();
        assert_eq!(
            verify_session("session-secret", &token)
                .expect("new session must verify")
                .user_id,
            "user-1"
        );
        let mut tampered = token.into_bytes();
        let last = tampered.last_mut().expect("session is non-empty");
        *last = if *last == b'a' { b'b' } else { b'a' };
        assert!(
            verify_session("session-secret", std::str::from_utf8(&tampered).unwrap()).is_none()
        );
    }

    #[test]
    fn binary_request_body_uses_node_base64_contract() {
        let expected = b"multipart-prefix\0\xff\x80binary";
        let (body, encoding) = encode_relay_request_body(expected);
        assert_eq!(encoding.as_deref(), Some("base64"));
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(body.unwrap())
                .unwrap(),
            expected
        );
        assert_eq!(
            encode_relay_request_body(b"plain utf8"),
            (Some("plain utf8".to_string()), None)
        );
    }

    #[test]
    fn shared_access_uses_explicit_route_allowlists() {
        let mut access = EffectiveAccess {
            kind: "shared",
            grant_id: None,
            share_id: Some("share".to_string()),
            scope: "thread".to_string(),
            thread_id: Some("thread-1".to_string()),
            thread_access: "read".to_string(),
            workspace_access: "none".to_string(),
            workspace_id: None,
            workspace_scope: Some("selected".to_string()),
            workspace_ids: Vec::new(),
            can_create_threads: false,
        };
        assert!(access_allows(
            &access,
            &Method::GET,
            "/api/threads/thread-1/items/item-1/detail"
        ));
        assert!(!access_allows(
            &access,
            &Method::GET,
            "/api/threads/thread-1/private-debug"
        ));
        assert!(!access_allows(
            &access,
            &Method::POST,
            "/api/threads/thread-1/prompt"
        ));
        access.thread_access = "control".to_string();
        assert!(access_allows(
            &access,
            &Method::POST,
            "/api/threads/thread-1/prompt"
        ));
        assert!(!access_allows(
            &access,
            &Method::DELETE,
            "/api/threads/thread-1"
        ));
        let uri: Uri = "/relay/api/threads?token=secret&workspaceId=workspace-1"
            .parse()
            .unwrap();
        assert_eq!(
            relay_api_target_path("threads", &uri),
            "/api/threads?workspaceId=workspace-1"
        );
    }

    #[tokio::test]
    async fn copies_and_imports_legacy_rust_database_without_deleting_source() {
        let data_dir = temporary_test_dir("legacy-import");
        std::fs::create_dir_all(&data_dir).unwrap();
        let legacy_path = data_dir.join("relay.sqlite");
        let legacy = Connection::open(&legacy_path).unwrap();
        legacy
            .execute_batch(
                "
                CREATE TABLE users (
                  id TEXT PRIMARY KEY,email TEXT NOT NULL,username TEXT NOT NULL,
                  password_hash TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL
                );
                CREATE TABLE devices (
                  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,token TEXT,
                  token_hash TEXT NOT NULL,token_preview TEXT,created_at TEXT NOT NULL
                );
                CREATE TABLE sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE shares (
                  id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,target_username TEXT NOT NULL,
                  device_id TEXT NOT NULL,thread_id TEXT,workspace_id TEXT,thread_access TEXT NOT NULL,
                  workspace_access TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT
                );
                CREATE TABLE grants (
                  id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,target_username TEXT NOT NULL,
                  device_id TEXT NOT NULL,scope TEXT NOT NULL,thread_id TEXT,workspace_id TEXT,
                  thread_access TEXT NOT NULL,workspace_access TEXT NOT NULL,
                  can_create_threads INTEGER NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT
                );
                ",
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO users VALUES (?1,?2,?3,?4,'user',1,?5)",
                params![
                    "owner",
                    "owner@example.com",
                    "owner",
                    legacy_sha256("owner-pass"),
                    "2026-01-01T00:00:00Z"
                ],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO users VALUES (?1,?2,?3,?4,'user',1,?5)",
                params![
                    "target",
                    "target@example.com",
                    "target",
                    legacy_sha256("target-pass"),
                    "2026-01-01T00:00:00Z"
                ],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO devices VALUES ('device','owner','Laptop','rcd_old','old-hash','rcd_old','2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO shares VALUES ('share','owner','target','device','thread',NULL,'read','none','2026-01-01T00:00:00Z',NULL)",
                [],
            )
            .unwrap();
        legacy
            .execute(
                "INSERT INTO grants VALUES ('grant','owner','target','device','device',NULL,NULL,'control','none',1,'2026-01-01T00:00:00Z',NULL)",
                [],
            )
            .unwrap();
        drop(legacy);

        let plan = inspect_relay_migration(&data_dir).unwrap();
        assert_eq!(plan.source_kind, "legacy-rust");
        assert!(!plan.applied);
        assert!(!data_dir.join("relay-store.sqlite").exists());
        let refusal = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false)
            .err()
            .expect("normal startup must refuse implicit legacy migration");
        assert!(refusal.to_string().contains("relay-migrate"));
        let report = migrate_relay_data_dir(&data_dir).unwrap();
        assert!(report.applied);
        assert_eq!(report.user_count, 2);
        let store = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false).unwrap();
        assert!(legacy_path.exists(), "the source database must be retained");
        assert!(data_dir.join("relay-store.sqlite").exists());
        let conn = store.conn.lock().await;
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM relay_users", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row(
                "SELECT token_hash FROM relay_devices WHERE id='device'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            hash_device_token("rcd_old")
        );
        assert!(verify_password(
            "owner-pass",
            LEGACY_SHA256_SALT,
            &legacy_sha256("owner-pass")
        ));
        let share_access = effective_access(&conn, "target", "device", Some("thread"), None)
            .expect("migrated share must grant access");
        assert_eq!(share_access.share_id.as_deref(), Some("share"));
        let device_access = effective_access(&conn, "target", "device", None, None)
            .expect("migrated device grant must grant access");
        assert_eq!(device_access.grant_id.as_deref(), Some("grant"));
        assert!(effective_access(&conn, "missing", "device", None, None).is_none());
        drop(conn);
        drop(store);
        std::fs::remove_dir_all(&data_dir).unwrap();
    }

    #[tokio::test]
    async fn snapshots_existing_node_database_before_first_rust_open() {
        let data_dir = temporary_test_dir("node-backup");
        std::fs::create_dir_all(&data_dir).unwrap();
        let database_path = data_dir.join("relay-store.sqlite");
        let initial = RelayStore::open(database_path.clone(), "secret".to_string()).unwrap();
        {
            let conn = initial.conn.lock().await;
            let (salt, hash) = hash_password("password-1").unwrap();
            conn.execute(
                "INSERT INTO relay_users
                 (id,email,username,role,enabled,last_seen_at,created_at,password_salt,password_hash)
                 VALUES ('user','user@example.com','user','user',1,NULL,'2026-01-01T00:00:00Z',?1,?2)",
                params![salt, hash],
            )
            .unwrap();
        }
        drop(initial);

        let plan = inspect_relay_migration(&data_dir).unwrap();
        assert_eq!(plan.source_kind, "node");
        assert!(!plan.ready_for_rust);
        let refusal = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false)
            .err()
            .expect("normal startup must refuse an unapproved Node database");
        assert!(refusal.to_string().contains("relay-migrate"));
        let report = migrate_relay_data_dir(&data_dir).unwrap();
        assert!(report.ready_for_rust);
        assert_eq!(report.user_count, 1);
        let reopened = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false).unwrap();
        let backup_path = data_dir.join("relay-store.pre-rust-0.12.sqlite");
        assert!(backup_path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&backup_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let backup =
            Connection::open_with_flags(backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        assert_eq!(
            backup
                .query_row("SELECT COUNT(*) FROM relay_users", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(backup);
        drop(reopened);
        std::fs::remove_dir_all(&data_dir).unwrap();
    }

    #[tokio::test]
    async fn fresh_database_is_marked_and_reopens_without_migration() {
        let data_dir = temporary_test_dir("fresh-marker");
        let first = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false).unwrap();
        drop(first);

        let database_path = data_dir.join("relay-store.sqlite");
        assert!(rust_schema_ready(&database_path).unwrap());
        let second = RelayStore::open_data_dir(&data_dir, "secret".to_string(), false).unwrap();
        drop(second);
        std::fs::remove_dir_all(&data_dir).unwrap();
    }

    #[test]
    fn legacy_import_fails_on_unmappable_rows_and_keeps_source() {
        let data_dir = temporary_test_dir("invalid-legacy-import");
        std::fs::create_dir_all(&data_dir).unwrap();
        let legacy_path = data_dir.join("relay.sqlite");
        let legacy = Connection::open(&legacy_path).unwrap();
        legacy
            .execute_batch(
                "
                CREATE TABLE users (
                  id TEXT PRIMARY KEY,email TEXT NOT NULL,username TEXT NOT NULL,
                  password_hash TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL
                );
                CREATE TABLE devices (
                  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,token TEXT,
                  token_hash TEXT NOT NULL,token_preview TEXT,created_at TEXT NOT NULL
                );
                CREATE TABLE shares (
                  id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,target_username TEXT NOT NULL,
                  device_id TEXT NOT NULL,thread_id TEXT,workspace_id TEXT,thread_access TEXT NOT NULL,
                  workspace_access TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT
                );
                CREATE TABLE grants (
                  id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,target_username TEXT NOT NULL,
                  device_id TEXT NOT NULL,scope TEXT NOT NULL,thread_id TEXT,workspace_id TEXT,
                  thread_access TEXT NOT NULL,workspace_access TEXT NOT NULL,
                  can_create_threads INTEGER NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT
                );
                INSERT INTO users VALUES
                  ('owner','owner@example.com','owner','legacy','user',1,'2026-01-01T00:00:00Z');
                INSERT INTO devices VALUES
                  ('device','owner','Laptop','rcd_old','old-hash','rcd_old','2026-01-01T00:00:00Z');
                INSERT INTO shares VALUES
                  ('share','owner','missing-target','device','thread',NULL,'read','none','2026-01-01T00:00:00Z',NULL);
                ",
            )
            .unwrap();
        drop(legacy);

        let error = migrate_relay_data_dir(&data_dir).unwrap_err();
        assert!(error.to_string().contains("count mismatch"));
        assert!(legacy_path.exists());
        assert!(!data_dir.join("relay-store.sqlite").exists());
        std::fs::remove_dir_all(&data_dir).unwrap();
    }

    #[test]
    fn node_migration_requires_explicit_unsupported_data_override() {
        let data_dir = temporary_test_dir("unsupported-node-data");
        std::fs::create_dir_all(&data_dir).unwrap();
        let database_path = data_dir.join("relay-store.sqlite");
        drop(RelayStore::open(database_path.clone(), "secret".to_string()).unwrap());
        let conn = Connection::open(&database_path).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE relay_hosted_sandboxes (id TEXT PRIMARY KEY);
            CREATE TABLE relay_user_identities (id TEXT PRIMARY KEY);
            CREATE TABLE relay_pending_registrations (id TEXT PRIMARY KEY, status TEXT NOT NULL);
            INSERT INTO relay_hosted_sandboxes VALUES ('sandbox');
            INSERT INTO relay_user_identities VALUES ('identity');
            INSERT INTO relay_pending_registrations VALUES ('registration','pending');
            INSERT INTO relay_settings(key,value) VALUES ('googleAuthEnabled','true');
            ",
        )
        .unwrap();
        drop(conn);

        let plan = inspect_relay_migration(&data_dir).unwrap();
        assert_eq!(plan.hosted_sandbox_count, 1);
        assert_eq!(plan.oauth_identity_count, 1);
        assert_eq!(plan.pending_registration_count, 1);
        assert_eq!(plan.active_unsupported_settings, vec!["googleAuthEnabled"]);
        let error = migrate_relay_data_dir(&data_dir).unwrap_err();
        assert!(error.to_string().contains("unsupported active data"));
        assert!(!plan.backup_path.unwrap().exists());

        let report = migrate_relay_data_dir_with_options(
            &data_dir,
            RelayMigrationOptions {
                allow_unsupported_data: true,
            },
        )
        .unwrap();
        assert!(report.ready_for_rust);
        assert!(report.unsupported_data_allowed);
        let conn = Connection::open(&database_path).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM relay_hosted_sandboxes", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            1
        );
        drop(conn);
        std::fs::remove_dir_all(&data_dir).unwrap();
    }

    #[tokio::test]
    async fn forwarded_device_response_preserves_binary_body_and_headers() {
        let expected = b"%PDF-1.7\n\0binary";
        let response = forwarded_device_response(json!({
            "statusCode": 200,
            "headers": {
                "content-type": "application/pdf",
                "content-disposition": "attachment; filename=\"thread.pdf\""
            },
            "bodyBase64": base64::engine::general_purpose::STANDARD.encode(expected)
        }));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            response.headers()[header::CONTENT_DISPOSITION],
            "attachment; filename=\"thread.pdf\""
        );
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), expected);
    }

    #[tokio::test]
    async fn forwarded_device_response_accepts_node_body_encoding() {
        let expected = b"\0\xffnode-binary";
        let response = forwarded_device_response(json!({
            "statusCode": 200,
            "headers": { "content-type": "application/octet-stream" },
            "body": base64::engine::general_purpose::STANDARD.encode(expected),
            "bodyEncoding": "base64"
        }));
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), expected);
    }
}

fn safe_dist_path(dist: &FsPath, url_path: &str) -> Option<PathBuf> {
    let rel = url_path.trim_start_matches('/');
    if rel.is_empty() {
        return Some(dist.join("index.html"));
    }
    if rel.split('/').any(|segment| segment == "..") {
        return None;
    }
    Some(dist.join(rel))
}

async fn spa_fallback(State(state): State<Arc<AppState>>, req: Request) -> Response {
    let Some(dist) = state.web_dist.as_ref() else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    };
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    }
    let path = req.uri().path();
    if path.starts_with("/relay/") || path == "/healthz" || path == "/supervisor/tunnel" {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "not_found", "message": "not found" })),
        )
            .into_response();
    }
    let Some(candidate) = safe_dist_path(dist, path) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let has_ext = FsPath::new(path).extension().is_some();
    let file_path = if tokio::fs::metadata(&candidate)
        .await
        .map(|meta| meta.is_file())
        .unwrap_or(false)
    {
        candidate
    } else if has_ext {
        return StatusCode::NOT_FOUND.into_response();
    } else {
        dist.join("index.html")
    };
    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let is_html = file_path.extension().and_then(|ext| ext.to_str()) == Some("html");
            let (body, content_type) = if is_html {
                let html = String::from_utf8_lossy(&bytes);
                (
                    Body::from(inject_bootstrap(&html)),
                    "text/html; charset=utf-8",
                )
            } else {
                (Body::from(bytes), mime_for(&file_path))
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(
                    header::CACHE_CONTROL,
                    if is_html {
                        "no-cache"
                    } else {
                        "public, max-age=31536000, immutable"
                    },
                )
                .body(body)
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "code": "not_found",
                "message": "Relay web frontend is not built."
            })),
        )
            .into_response(),
    }
}
