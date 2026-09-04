use std::sync::Arc;

use remote_codex_protocol::{
    Mode, Provider, SendThreadPromptInput, ThreadGoalDto, WorkspaceSettingsDto,
};
use remote_codex_runtime::actor::SharedRuntime;
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::Supervisor;
use rusqlite::{params, Connection, OptionalExtension};
use tempfile::tempdir;

// Final schema produced by main's packages/db migrations through 0030_thread_agent_id.sql.
const NODE_0030_SCHEMA: &str = r#"
CREATE TABLE __migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE hosts (
  id TEXT PRIMARY KEY NOT NULL,
  hostname TEXT NOT NULL,
  platform TEXT NOT NULL,
  tailscale_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL,
  label TEXT NOT NULL,
  abs_path TEXT NOT NULL UNIQUE,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  provider TEXT DEFAULT 'codex' NOT NULL,
  provider_session_id TEXT,
  provider_turn_id TEXT,
  source TEXT DEFAULT 'supervisor' NOT NULL,
  title TEXT NOT NULL,
  model TEXT,
  reasoning_effort TEXT,
  fast_mode INTEGER DEFAULT false NOT NULL,
  fast_base_model TEXT,
  fast_base_reasoning_effort TEXT,
  collaboration_mode TEXT DEFAULT 'default' NOT NULL,
  active_turn_collaboration_mode TEXT,
  approval_mode TEXT,
  sandbox_mode TEXT,
  status TEXT,
  summary_text TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_turn_started_at TEXT,
  last_turn_completed_at TEXT,
  last_viewed_at TEXT,
  is_pinned INTEGER DEFAULT false NOT NULL,
  is_connected INTEGER DEFAULT true NOT NULL,
  agent_id TEXT
);

CREATE TABLE shell_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT,
  tmux_session_name TEXT,
  cwd TEXT NOT NULL,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT,
  label TEXT
);

CREATE TABLE viewer_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  shell_id TEXT,
  connected_at TEXT NOT NULL,
  last_heartbeat_at TEXT,
  active_tab TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE policies (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE thread_turn_metadata (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  model TEXT,
  reasoning_effort TEXT,
  reasoning_effort_available INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  token_usage_json TEXT,
  pricing_model_key TEXT,
  pricing_tier_key TEXT,
  display_prompt TEXT
);
CREATE UNIQUE INDEX thread_turn_metadata_thread_turn_idx
  ON thread_turn_metadata(thread_id, turn_id);

CREATE TABLE thread_pending_steers (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  client_request_id TEXT,
  display_prompt TEXT NOT NULL,
  submitted_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivery TEXT NOT NULL DEFAULT 'steer',
  turn_config_json TEXT
);
CREATE INDEX thread_pending_steers_thread_created_idx
  ON thread_pending_steers(thread_id, created_at);

CREATE TABLE thread_prompt_requests (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX thread_prompt_requests_thread_client_request_idx
  ON thread_prompt_requests(thread_id, client_request_id);

CREATE TABLE thread_history_items (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX thread_history_items_thread_turn_item_idx
  ON thread_history_items(thread_id, turn_id, item_id);

CREATE TABLE thread_activity_notes (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  anchor_turn_id TEXT
);
CREATE INDEX thread_activity_notes_thread_created_idx
  ON thread_activity_notes(thread_id, created_at);

CREATE TABLE thread_forks (
  id TEXT PRIMARY KEY NOT NULL,
  source_thread_id TEXT NOT NULL,
  source_turn_id TEXT,
  source_turn_index INTEGER,
  forked_thread_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE thread_goals (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  token_budget INTEGER,
  tokens_used INTEGER DEFAULT 0 NOT NULL,
  time_used_seconds INTEGER DEFAULT 0 NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

const NODE_MIGRATIONS: &[&str] = &[
    "0000_initial.sql",
    "0001_thread_runtime_fields.sql",
    "0002_thread_source.sql",
    "0003_thread_runtime_settings.sql",
    "0004_thread_connection_state.sql",
    "0005_thread_turn_metadata.sql",
    "0006_thread_sandbox_mode.sql",
    "0007_thread_pending_steers.sql",
    "0008_thread_fast_mode_and_activity_notes.sql",
    "0009_thread_turn_token_usage.sql",
    "0010_thread_turn_pricing_snapshot.sql",
    "0011_thread_forks.sql",
    "0012_thread_goals.sql",
    "0013_thread_activity_note_anchor.sql",
    "0014_thread_history_items.sql",
    "0015_agent_provider_fields.sql",
    "0016_remove_codex_thread_goal_id.sql",
    "0017_remove_codex_thread_columns.sql",
    "0018_shell_session_label.sql",
    "0028_thread_turn_display_prompt.sql",
    "0029_thread_turn_delivery.sql",
    "0030_thread_agent_id.sql",
];

fn seed_node_0030(path: &std::path::Path, workspace_path: &std::path::Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(NODE_0030_SCHEMA).unwrap();
    for migration in NODE_MIGRATIONS {
        conn.execute(
            "INSERT INTO __migrations(name, applied_at) VALUES (?1,'2026-01-01T00:00:00Z')",
            params![migration],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO hosts(id,hostname,platform,created_at,last_seen_at)
         VALUES ('node-host','node-hostname','darwin','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspaces(id,host_id,label,abs_path,is_favorite,created_at,last_opened_at)
         VALUES ('node-workspace','node-host','Node workspace',?1,1,'2026-01-01T00:00:00Z',NULL)",
        params![workspace_path.to_string_lossy()],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads(
           id,workspace_id,provider,agent_id,provider_session_id,provider_turn_id,source,title,
           model,reasoning_effort,collaboration_mode,approval_mode,sandbox_mode,status,
           created_at,updated_at,is_pinned,is_connected
         ) VALUES (
           'node-thread','node-workspace','codex',NULL,'node-session',NULL,'supervisor','Old thread',
           'gpt-5.4','medium','default','yolo','danger-full-access','idle',
           '2026-01-01T00:00:00Z','2026-01-01T00:03:00Z',0,1
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO threads(
           id,workspace_id,provider,agent_id,provider_session_id,provider_turn_id,source,title,
           model,reasoning_effort,collaboration_mode,approval_mode,sandbox_mode,status,
           created_at,updated_at,is_pinned,is_connected
         ) VALUES (
           'live-thread','node-workspace','codex',NULL,'live-session','live-turn','supervisor','Live thread',
           'gpt-5.4','high','default','yolo','danger-full-access','running',
           '2026-01-01T00:00:00Z','2026-01-01T00:04:00Z',0,1
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_turn_metadata(
           id,thread_id,turn_id,model,reasoning_effort,created_at,updated_at,
           token_usage_json,pricing_model_key,pricing_tier_key,display_prompt
         ) VALUES (
           'metadata-1','node-thread','node-turn-1','gpt-5.4','medium',
           '2026-01-01T00:01:00Z','2026-01-01T00:01:30Z',
           '{\"inputTokens\":12,\"outputTokens\":7}','gpt-5.4','standard','hello'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_turn_metadata(
           id,thread_id,turn_id,model,reasoning_effort,created_at,updated_at,display_prompt
         ) VALUES (
           'metadata-live','live-thread','live-turn','gpt-5.4','high',
           '2026-01-01T00:04:00Z','2026-01-01T00:04:30Z','still running'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_history_items(
           id,thread_id,turn_id,item_id,item_json,created_at,updated_at
         ) VALUES (
           'history-1','node-thread','node-turn-1','node-item-1',
           '{\"id\":\"node-item-1\",\"kind\":\"userMessage\",\"text\":\"hello from Node\",\"createdAt\":\"2026-01-01T00:01:00Z\"}',
           '2026-01-01T00:01:00Z','2026-01-01T00:01:00Z'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_history_items(
           id,thread_id,turn_id,item_id,item_json,created_at,updated_at
         ) VALUES (
           'history-only','node-thread','node-turn-2','node-item-2',
           '{\"id\":\"node-item-2\",\"kind\":\"agentMessage\",\"text\":\"history-only turn\",\"createdAt\":\"2026-01-01T00:02:00Z\"}',
           '2026-01-01T00:02:00Z','2026-01-01T00:02:30Z'
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_pending_steers(
           id,thread_id,turn_id,client_request_id,display_prompt,submitted_prompt,
           created_at,updated_at,delivery,turn_config_json
         ) VALUES (
           'node-steer','node-thread','node-turn-1','client-1','follow up','follow up',
           '2026-01-01T00:03:00Z','2026-01-01T00:03:01Z','steer',NULL
         )",
        [],
    )
    .unwrap();
    for (id, key, value) in [
        (
            "policy-dev-home",
            "dev_home",
            r#"{"absPath":"/tmp/node-dev"}"#,
        ),
        (
            "policy-backend",
            "default_backend",
            r#"{"provider":"claude"}"#,
        ),
        (
            "policy-plugins",
            "plugins",
            r#"{"enabled":{"remote-codex.terminal":false,"nested":{"enabled":true}},"imported":[]}"#,
        ),
        ("policy-unknown", "future_setting", r#"{"keep":true}"#),
    ] {
        conn.execute(
            "INSERT INTO policies(id,key,value_json,created_at,updated_at)
             VALUES (?1,?2,?3,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            params![id, key, value],
        )
        .unwrap();
    }
}

fn test_config(root: &std::path::Path, database_url: &std::path::Path) -> RuntimeConfig {
    RuntimeConfig {
        mode: Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: root.join("workspaces"),
        database_url: database_url.to_path_buf(),
        app_name: "migration-test".into(),
        app_version: "0.12.0".into(),
        environment: "test".into(),
        auth_required: false,
        admin_username: None,
        admin_password: None,
        session_secret: None,
        relay_server_url: None,
        relay_agent_token: None,
        enabled_providers: vec![Provider::Codex],
        acp_command: None,
        acp_startup_timeout_ms: 1_000,
        fake_runtime: true,
    }
}

#[tokio::test]
async fn migrates_node_0030_history_and_policies_idempotently() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("node.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);
    let conn = Connection::open(&database_path).unwrap();
    conn.execute(
        "UPDATE threads SET approval_mode=NULL WHERE id='node-thread'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE threads SET approval_mode='unexpected' WHERE id='live-thread'",
        [],
    )
    .unwrap();
    drop(conn);

    let database = Database::open(&database_path).unwrap();
    database
        .with(|conn| {
            let status: String = conn.query_row(
                "SELECT status FROM thread_turns WHERE id='live-turn'",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(status, "inProgress");
            Ok(())
        })
        .unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Supervisor::new(
        test_config(dir.path(), &database_path),
        database,
        vec![runtime],
    );

    let detail = supervisor
        .get_thread_detail("node-thread", None)
        .await
        .unwrap();
    assert_eq!(detail.total_turn_count, Some(2));
    assert_eq!(detail.turns[0].id, "node-turn-1");
    assert_eq!(detail.turns[0].status, "completed");
    assert_eq!(detail.turns[0].model.as_deref(), Some("gpt-5.4"));
    assert_eq!(detail.turns[0].reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(
        detail.turns[0].token_usage.as_ref().unwrap()["inputTokens"],
        12
    );
    assert_eq!(
        detail.turns[0].token_usage.as_ref().unwrap()["outputTokens"],
        7
    );
    assert_eq!(detail.turns[0].items[0].text, "hello from Node");
    assert_eq!(detail.turns[1].id, "node-turn-2");
    assert_eq!(detail.turns[1].items[0].text, "history-only turn");
    assert_eq!(detail.pending_steers.len(), 1);
    assert_eq!(detail.pending_steers[0].id, "node-steer");
    assert_eq!(detail.thread.approval_mode, "guarded");

    let live_detail = supervisor
        .get_thread_detail("live-thread", None)
        .await
        .unwrap();
    assert_eq!(live_detail.thread.active_turn_id, None);
    assert_eq!(live_detail.turns[0].status, "interrupted");
    assert_eq!(live_detail.thread.approval_mode, "guarded");

    let settings: WorkspaceSettingsDto =
        serde_json::from_str(&supervisor.db.get_kv("workspace_settings").unwrap().unwrap())
            .unwrap();
    assert_eq!(settings.dev_home, "/tmp/node-dev");
    assert_eq!(settings.default_backend, Provider::Claude);
    assert_eq!(
        supervisor
            .db
            .get_kv("plugin:remote-codex.terminal:enabled")
            .unwrap()
            .as_deref(),
        Some("false")
    );
    assert_eq!(
        supervisor
            .db
            .get_kv("plugin:nested:enabled")
            .unwrap()
            .as_deref(),
        Some("true")
    );
    assert_eq!(
        supervisor
            .db
            .get_kv("legacy-policy:future_setting")
            .unwrap()
            .as_deref(),
        Some(r#"{"keep":true}"#)
    );

    supervisor
        .db
        .with(|conn| {
            let node_migration_count: i64 =
                conn.query_row("SELECT COUNT(*) FROM __migrations", [], |row| row.get(0))?;
            let runtime_migration_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM __remote_codex_runtime_migrations",
                [],
                |row| row.get(0),
            )?;
            let legacy_metadata_count: i64 =
                conn.query_row("SELECT COUNT(*) FROM thread_turn_metadata", [], |row| {
                    row.get(0)
                })?;
            assert_eq!(node_migration_count, NODE_MIGRATIONS.len() as i64);
            let migrated_metadata: (String, String, String, String) = conn.query_row(
                "SELECT token_usage_json, pricing_model_key, pricing_tier_key, display_prompt
                 FROM thread_turns WHERE id='node-turn-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            assert_eq!(runtime_migration_count, 6);
            assert_eq!(legacy_metadata_count, 2);
            assert_eq!(
                migrated_metadata.0,
                r#"{"inputTokens":12,"outputTokens":7}"#
            );
            assert_eq!(migrated_metadata.1, "gpt-5.4");
            assert_eq!(migrated_metadata.2, "standard");
            assert_eq!(migrated_metadata.3, "hello");
            Ok(())
        })
        .unwrap();
    drop(supervisor);

    let reopened = Database::open(&database_path).unwrap();
    reopened
        .with(|conn| {
            let turns: i64 =
                conn.query_row("SELECT COUNT(*) FROM thread_turns", [], |row| row.get(0))?;
            let migrations: i64 = conn.query_row(
                "SELECT COUNT(*) FROM __remote_codex_runtime_migrations",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(turns, 3);
            assert_eq!(migrations, 6);
            Ok(())
        })
        .unwrap();
}

#[tokio::test]
async fn rust_turns_remain_visible_to_the_legacy_node_metadata_table() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("node-dual-write.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);

    let database = Database::open(&database_path).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Supervisor::new(
        test_config(dir.path(), &database_path),
        database,
        vec![runtime],
    );
    supervisor
        .prompt(
            "node-thread",
            SendThreadPromptInput {
                prompt: "hello from Rust".into(),
                client_request_id: Some("rust-dual-write".into()),
                model: None,
                reasoning_effort: None,
                collaboration_mode: None,
                images: vec![],
            },
        )
        .await
        .unwrap();

    supervisor
        .db
        .with(|conn| {
            let metadata: (String, String, String, String, String, String) = conn.query_row(
                "SELECT metadata.model, metadata.reasoning_effort, metadata.display_prompt,
                        metadata.created_at, metadata.updated_at, turns.completed_at
                 FROM thread_turn_metadata metadata
                 JOIN thread_turns turns ON turns.id=metadata.turn_id
                 WHERE metadata.thread_id='node-thread' AND metadata.turn_id!='node-turn-1'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )?;
            assert_eq!(metadata.0, "gpt-5.4");
            assert_eq!(metadata.1, "medium");
            assert_eq!(metadata.2, "hello from Rust");
            assert_eq!(metadata.4, metadata.5);
            assert!(metadata.3 <= metadata.4);
            Ok(())
        })
        .unwrap();
}

#[test]
fn migrates_the_node_current_goal_without_discarding_goal_history() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("node-goals.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);
    let conn = Connection::open(&database_path).unwrap();
    conn.execute_batch(
        r#"
        INSERT INTO thread_goals VALUES (
          'goal-active-old','node-thread','node-session','Old active goal','active',500,3,4,
          '2026-01-01T00:00:00Z',NULL,'2026-01-01T00:00:00Z','2026-01-01T00:02:00Z'
        );
        INSERT INTO thread_goals VALUES (
          'goal-paused-current','node-thread','node-session','Paused goal','paused',900,12,34,
          '2026-01-01T00:01:00Z',NULL,'2026-01-01T00:01:00Z','2026-01-01T00:03:00Z'
        );
        INSERT INTO thread_goals VALUES (
          'goal-terminated-newer','node-thread','node-session','Terminated goal','terminated',NULL,20,50,
          '2026-01-01T00:02:00Z','2026-01-01T00:04:00Z',
          '2026-01-01T00:02:00Z','2026-01-01T00:04:00Z'
        );
        INSERT INTO thread_goals VALUES (
          'goal-complete-newest','node-thread','node-session','Completed goal','complete',NULL,30,60,
          '2026-01-01T00:03:00Z','2026-01-01T00:05:00Z',
          '2026-01-01T00:03:00Z','2026-01-01T00:05:00Z'
        );
        INSERT INTO thread_goals VALUES (
          'goal-live-terminated','live-thread','live-session','Preserved Node fallback','terminated',NULL,1,2,
          '2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',
          '2026-01-01T00:00:00Z','2026-01-01T00:01:00Z'
        );
        INSERT INTO threads(
          id,workspace_id,provider,provider_session_id,source,title,collaboration_mode,
          approval_mode,status,created_at,updated_at,is_pinned,is_connected
        ) VALUES (
          'terminal-thread','node-workspace','codex','terminal-session','supervisor','Terminal',
          'default','yolo','idle','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',0,1
        );
        INSERT INTO thread_goals VALUES (
          'goal-terminal-fallback','terminal-thread','terminal-session','Terminated fallback','terminated',NULL,7,8,
          '2026-01-01T00:00:00Z',NULL,
          '2026-01-01T00:00:00Z','2026-01-01T00:04:00Z'
        );
        INSERT INTO thread_goals VALUES (
          'goal-terminal-complete','terminal-thread','terminal-session','Newer completion','complete',NULL,9,10,
          '2026-01-01T00:00:00Z','2026-01-01T00:05:00Z',
          '2026-01-01T00:00:00Z','2026-01-01T00:05:00Z'
        );
        CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO kv VALUES (
          'thread_goal:live-thread',
          '{"threadId":"live-thread","localGoalId":"rust-goal","objective":"Newer Rust snapshot","status":"active","tokenBudget":77,"tokensUsed":8,"timeUsedSeconds":9,"createdAt":"2026-02-01T00:00:00Z","updatedAt":"2026-02-01T00:01:00Z","completedAt":null}'
        );
        "#,
    )
    .unwrap();
    drop(conn);

    let database = Database::open(&database_path).unwrap();
    let migrated: ThreadGoalDto =
        serde_json::from_str(&database.get_kv("thread_goal:node-thread").unwrap().unwrap())
            .unwrap();
    assert_eq!(migrated.thread_id, "node-thread");
    assert_eq!(
        migrated.local_goal_id.as_deref(),
        Some("goal-paused-current")
    );
    assert_eq!(migrated.objective, "Paused goal");
    assert_eq!(migrated.status, "paused");
    assert_eq!(migrated.token_budget, Some(900));
    assert_eq!(migrated.tokens_used, 12);
    assert_eq!(migrated.time_used_seconds, 34);

    let terminal: ThreadGoalDto = serde_json::from_str(
        &database
            .get_kv("thread_goal:terminal-thread")
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        terminal.local_goal_id.as_deref(),
        Some("goal-terminal-fallback")
    );
    assert_eq!(terminal.status, "terminated");
    assert_eq!(
        terminal.completed_at.as_deref(),
        Some("2026-01-01T00:04:00Z")
    );

    let existing: ThreadGoalDto =
        serde_json::from_str(&database.get_kv("thread_goal:live-thread").unwrap().unwrap())
            .unwrap();
    assert_eq!(existing.local_goal_id.as_deref(), Some("rust-goal"));
    assert_eq!(existing.objective, "Newer Rust snapshot");
    database
        .with(|conn| {
            let rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM thread_goals", [], |row| row.get(0))?;
            assert_eq!(rows, 7);
            let unchanged: (String, String) = conn.query_row(
                "SELECT status, updated_at FROM thread_goals WHERE id='goal-paused-current'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(unchanged, ("paused".into(), "2026-01-01T00:03:00Z".into()));
            Ok(())
        })
        .unwrap();
    drop(database);

    let reopened = Database::open(&database_path).unwrap();
    let reopened_goal: ThreadGoalDto =
        serde_json::from_str(&reopened.get_kv("thread_goal:node-thread").unwrap().unwrap())
            .unwrap();
    assert_eq!(reopened_goal.local_goal_id, migrated.local_goal_id);
}

#[tokio::test]
async fn rust_goal_mutations_dual_write_the_node_history_for_rollback() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("node-goal-dual-write.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);
    let conn = Connection::open(&database_path).unwrap();
    conn.execute(
        "INSERT INTO thread_goals VALUES (
           'legacy-goal','node-thread','node-session','Legacy objective','active',100,5,6,
           '2026-01-01T00:00:00Z',NULL,'2026-01-01T00:00:00Z','2026-01-01T00:01:00Z'
         )",
        [],
    )
    .unwrap();
    drop(conn);

    let database = Database::open(&database_path).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Supervisor::new(
        test_config(dir.path(), &database_path),
        database,
        vec![runtime],
    );

    let created = supervisor
        .thread_goal(
            "node-thread",
            Some("Rust objective".into()),
            Some("active".into()),
            Some(Some(800)),
            false,
        )
        .await
        .unwrap();
    let created_goal = &created["goal"];
    let rust_goal_id = created_goal["localGoalId"].as_str().unwrap().to_string();
    assert_eq!(created_goal["threadId"], "node-thread");

    supervisor
        .db
        .with(|conn| {
            let legacy: (String, Option<String>) = conn.query_row(
                "SELECT status, completed_at FROM thread_goals WHERE id='legacy-goal'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(legacy.0, "terminated");
            assert!(legacy.1.is_some());
            let rust: (String, String, String, Option<i64>, i64) = conn.query_row(
                "SELECT thread_id,provider_session_id,status,token_budget,tokens_used
                 FROM thread_goals WHERE id=?1",
                params![rust_goal_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
            assert_eq!(
                rust,
                (
                    "node-thread".into(),
                    "node-session".into(),
                    "active".into(),
                    Some(800),
                    0
                )
            );
            Ok(())
        })
        .unwrap();

    let paused = supervisor
        .thread_goal(
            "node-thread",
            None,
            Some("paused".into()),
            Some(None),
            false,
        )
        .await
        .unwrap();
    assert_eq!(paused["goal"]["localGoalId"], rust_goal_id);
    assert_eq!(paused["goal"]["status"], "paused");
    supervisor
        .db
        .with(|conn| {
            let persisted: (String, Option<i64>) = conn.query_row(
                "SELECT status,token_budget FROM thread_goals WHERE id=?1",
                params![rust_goal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(persisted, ("paused".into(), None));
            Ok(())
        })
        .unwrap();

    let cleared = supervisor
        .thread_goal("node-thread", None, None, None, true)
        .await
        .unwrap();
    assert_eq!(cleared["cleared"], true);
    assert!(supervisor
        .db
        .get_kv("thread_goal:node-thread")
        .unwrap()
        .is_none());
    supervisor
        .db
        .with(|conn| {
            let active: i64 = conn.query_row(
                "SELECT COUNT(*) FROM thread_goals
                 WHERE thread_id='node-thread'
                   AND status IN ('active','paused','budgetLimited')",
                [],
                |row| row.get(0),
            )?;
            let history: i64 = conn.query_row(
                "SELECT COUNT(*) FROM thread_goals WHERE thread_id='node-thread'",
                [],
                |row| row.get(0),
            )?;
            let rust_status: (String, Option<String>) = conn.query_row(
                "SELECT status,completed_at FROM thread_goals WHERE id=?1",
                params![rust_goal_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(active, 0);
            assert_eq!(history, 2);
            assert_eq!(rust_status.0, "terminated");
            assert!(rust_status.1.is_some());
            Ok(())
        })
        .unwrap();
}

#[test]
fn pre_rust_backup_includes_uncheckpointed_wal_content() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("node-wal.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);

    let writer = Connection::open(&database_path).unwrap();
    writer
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
        .unwrap();
    writer
        .execute(
            "INSERT INTO policies(id,key,value_json,created_at,updated_at)
             VALUES ('wal-policy','wal-only','{\"present\":true}',
                     '2026-01-03T00:00:00Z','2026-01-03T00:00:00Z')",
            [],
        )
        .unwrap();
    let wal_path = std::path::PathBuf::from(format!("{}-wal", database_path.display()));
    assert!(wal_path.is_file());

    let migrated = Database::open(&database_path).unwrap();
    let backup_path = dir.path().join("node-wal.pre-rust-0.12.sqlite");
    assert!(backup_path.is_file());
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
        Connection::open_with_flags(&backup_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let wal_value: String = backup
        .query_row(
            "SELECT value_json FROM policies WHERE key='wal-only'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(wal_value, r#"{"present":true}"#);
    let rust_table: Option<String> = backup
        .query_row(
            "SELECT name FROM sqlite_schema
             WHERE type='table' AND name='__remote_codex_runtime_migrations'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(
        rust_table.is_none(),
        "backup must be taken before migration"
    );
    drop(backup);
    drop(migrated);
    drop(writer);
}

#[test]
fn backup_is_not_created_for_empty_databases_or_overwritten() {
    let dir = tempdir().unwrap();
    let empty_path = dir.path().join("empty.sqlite");
    drop(Database::open(&empty_path).unwrap());
    assert!(!dir.path().join("empty.pre-rust-0.12.sqlite").exists());

    let node_path = dir.path().join("node.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&node_path, &workspace_path);
    let backup_path = dir.path().join("node.pre-rust-0.12.sqlite");
    std::fs::write(&backup_path, b"existing recovery point").unwrap();
    drop(Database::open(&node_path).unwrap());
    assert_eq!(
        std::fs::read(&backup_path).unwrap(),
        b"existing recovery point"
    );
}

#[test]
fn rejects_unknown_schema_without_writing_runtime_tables() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("unknown.sqlite");
    let conn = Connection::open(&database_path).unwrap();
    conn.execute("CREATE TABLE unrelated(id INTEGER PRIMARY KEY)", [])
        .unwrap();
    drop(conn);

    let error = Database::open(&database_path).err().unwrap();
    assert!(
        error.to_string().contains("validate sqlite"),
        "unexpected error: {error:#}"
    );

    let conn = Connection::open(&database_path).unwrap();
    let runtime_table: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_schema
             WHERE type='table' AND name='__remote_codex_runtime_migrations'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(runtime_table.is_none());
    let unrelated_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM unrelated", [], |row| row.get(0))
        .unwrap();
    assert_eq!(unrelated_count, 0);
}

#[test]
fn rejects_future_node_migration_before_runtime_migration() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("future.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);
    let conn = Connection::open(&database_path).unwrap();
    conn.execute(
        "INSERT INTO __migrations(name, applied_at)
         VALUES ('0031_unknown_future.sql','2026-01-02T00:00:00Z')",
        [],
    )
    .unwrap();
    drop(conn);

    let error = Database::open(&database_path).err().unwrap();
    assert!(
        format!("{error:#}").contains("unsupported Node migration `0031_unknown_future.sql`"),
        "unexpected error: {error:#}"
    );
    let conn = Connection::open(&database_path).unwrap();
    let runtime_table: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_schema
             WHERE type='table' AND name='__remote_codex_runtime_migrations'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(runtime_table.is_none());
}

#[test]
fn rolls_back_the_whole_upgrade_when_legacy_turn_ids_conflict() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("conflicting.sqlite");
    let workspace_path = dir.path().join("node-workspace");
    std::fs::create_dir(&workspace_path).unwrap();
    seed_node_0030(&database_path, &workspace_path);
    let conn = Connection::open(&database_path).unwrap();
    conn.execute(
        "INSERT INTO threads(
           id,workspace_id,provider,provider_session_id,source,title,collaboration_mode,
           approval_mode,status,created_at,updated_at,is_pinned,is_connected
         ) VALUES (
           'other-thread','node-workspace','codex','other-session','supervisor','Other',
           'default','yolo','idle','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',0,1
         )",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_history_items(
           id,thread_id,turn_id,item_id,item_json,created_at,updated_at
         ) VALUES (
           'conflicting-history','other-thread','node-turn-1','other-item',
           '{\"id\":\"other-item\",\"kind\":\"userMessage\",\"text\":\"conflict\"}',
           '2026-01-01T00:05:00Z','2026-01-01T00:05:00Z'
         )",
        [],
    )
    .unwrap();
    drop(conn);

    let error = Database::open(&database_path).err().unwrap();
    assert!(
        format!("{error:#}").contains("runtime turn ids must be globally unique"),
        "unexpected error: {error:#}"
    );
    let conn = Connection::open(&database_path).unwrap();
    for table in ["__remote_codex_runtime_migrations", "thread_turns", "kv"] {
        let created: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_schema WHERE type='table' AND name=?1",
                params![table],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(created.is_none(), "migration left `{table}` behind");
    }
    let legacy_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM thread_history_items", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(legacy_rows, 3);
}

#[test]
fn upgrades_the_unversioned_rust_pending_steer_table() {
    let dir = tempdir().unwrap();
    let database_path = dir.path().join("old-rust.sqlite");
    let conn = Connection::open(&database_path).unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE hosts (
          id TEXT PRIMARY KEY,
          hostname TEXT NOT NULL,
          platform TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          host_id TEXT NOT NULL,
          label TEXT NOT NULL,
          abs_path TEXT NOT NULL UNIQUE,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_opened_at TEXT
        );
        CREATE TABLE threads (
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
        CREATE TABLE thread_turns (
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
        CREATE TABLE thread_history_items (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          item_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(thread_id, turn_id, item_id)
        );
        CREATE TABLE thread_pending_steers (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          display_prompt TEXT NOT NULL,
          submitted_prompt TEXT NOT NULL,
          delivery TEXT NOT NULL DEFAULT 'steer',
          created_at TEXT NOT NULL
        );
        CREATE TABLE auth_sessions (
          token TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE TABLE kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO hosts VALUES (
          'rust-host','localhost','darwin','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
        );
        INSERT INTO thread_pending_steers VALUES (
          'rust-steer','rust-thread','rust-turn','display','submitted','steer','2026-01-01T00:01:00Z'
        );
        "#,
    )
    .unwrap();
    drop(conn);

    let database = Database::open(&database_path).unwrap();
    database
        .with(|conn| {
            let updated_at: String = conn.query_row(
                "SELECT updated_at FROM thread_pending_steers WHERE id='rust-steer'",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(updated_at, "2026-01-01T00:01:00Z");
            let updated_at_not_null: i64 = conn.query_row(
                "SELECT \"notnull\" FROM pragma_table_info('thread_pending_steers')
                 WHERE name='updated_at'",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(updated_at_not_null, 1);
            let client_request_id_columns: i64 = conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('thread_pending_steers')
                 WHERE name='client_request_id'",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(client_request_id_columns, 1);
            let metadata_columns: i64 = conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('thread_turns')
                 WHERE name IN (
                   'token_usage_json','pricing_model_key','pricing_tier_key','display_prompt'
                 )",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(metadata_columns, 4);
            Ok(())
        })
        .unwrap();
}
