use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
    pub host_id: String,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn =
            Connection::open(path).with_context(|| format!("open sqlite {}", path.display()))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS hosts (
              id TEXT PRIMARY KEY,
              hostname TEXT NOT NULL,
              platform TEXT NOT NULL,
              created_at TEXT NOT NULL,
              last_seen_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY,
              host_id TEXT NOT NULL,
              label TEXT NOT NULL,
              abs_path TEXT NOT NULL UNIQUE,
              is_favorite INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              last_opened_at TEXT
            );
            CREATE TABLE IF NOT EXISTS threads (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              provider TEXT NOT NULL,
              agent_id TEXT,
              provider_session_id TEXT,
              source TEXT NOT NULL DEFAULT 'supervisor',
              title TEXT NOT NULL,
              model TEXT,
              reasoning_effort TEXT,
              fast_mode INTEGER NOT NULL DEFAULT 0,
              collaboration_mode TEXT NOT NULL DEFAULT 'default',
              approval_mode TEXT NOT NULL DEFAULT 'yolo',
              sandbox_mode TEXT,
              status TEXT,
              summary_text TEXT,
              last_error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_turn_started_at TEXT,
              last_turn_completed_at TEXT,
              is_pinned INTEGER NOT NULL DEFAULT 0,
              is_connected INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS thread_turns (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              status TEXT NOT NULL,
              error TEXT,
              model TEXT,
              reasoning_effort TEXT,
              started_at TEXT,
              completed_at TEXT,
              ordinal INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS thread_history_items (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              item_id TEXT NOT NULL,
              item_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              UNIQUE(thread_id, turn_id, item_id)
            );
            CREATE TABLE IF NOT EXISTS thread_pending_steers (
              id TEXT PRIMARY KEY,
              thread_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              display_prompt TEXT NOT NULL,
              submitted_prompt TEXT NOT NULL,
              delivery TEXT NOT NULL DEFAULT 'steer',
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
              token TEXT PRIMARY KEY,
              username TEXT NOT NULL,
              expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kv (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            ",
        )?;
        let host_id = {
            let existing: Option<String> = conn
                .query_row("SELECT id FROM hosts LIMIT 1", [], |row| row.get(0))
                .optional()?;
            if let Some(id) = existing {
                id
            } else {
                let id = Uuid::new_v4().to_string();
                let now = remote_codex_protocol::now_rfc3339();
                let hostname = hostname::get()
                    .map(|h| h.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "localhost".into());
                conn.execute(
                    "INSERT INTO hosts(id, hostname, platform, created_at, last_seen_at) VALUES (?1,?2,?3,?4,?5)",
                    params![id, hostname, std::env::consts::OS, now, now],
                )?;
                id
            }
        };
        Ok(Self {
            conn: Mutex::new(conn),
            host_id,
        })
    }

    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.conn.lock().expect("db mutex");
        f(&conn)
    }

    pub fn get_kv(&self, key: &str) -> Result<Option<String>> {
        self.with(|conn| {
            Ok(conn
                .query_row("SELECT value FROM kv WHERE key=?1", params![key], |row| {
                    row.get(0)
                })
                .optional()?)
        })
    }

    pub fn set_kv(&self, key: &str, value: &str) -> Result<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO kv(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }
}
