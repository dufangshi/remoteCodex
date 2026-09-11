use std::sync::Arc;

use remote_codex_protocol::{
    CreateThreadInput, CreateWorkspaceInput, Provider, SendThreadPromptInput,
};
use remote_codex_runtime::actor::SharedRuntime;
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::Supervisor;
use tempfile::tempdir;

fn test_config(dir: &std::path::Path) -> RuntimeConfig {
    RuntimeConfig {
        mode: remote_codex_protocol::Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: dir.join("workspaces"),
        database_url: dir.join("test.sqlite"),
        app_name: "test".into(),
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
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    }
}

fn prompt_input(prompt: &str) -> SendThreadPromptInput {
    SendThreadPromptInput {
        prompt: prompt.into(),
        client_request_id: None,
        model: None,
        reasoning_effort: None,
        collaboration_mode: None,
        images: vec![],
    }
}

fn insert_stale_turn(supervisor: &Supervisor, thread_id: &str, turn_id: &str) {
    let now = remote_codex_protocol::now_rfc3339();
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "INSERT INTO thread_turns(
                   id, thread_id, status, error, model, reasoning_effort,
                   started_at, completed_at, ordinal
                 ) VALUES (?1,?2,'inProgress',NULL,NULL,NULL,?3,NULL,1)",
                (turn_id, thread_id, &now),
            )?;
            conn.execute(
                "UPDATE threads SET status='running', updated_at=?1 WHERE id=?2",
                (&now, thread_id),
            )?;
            Ok(())
        })
        .unwrap();
}

async fn seeded_thread(
    provider: Provider,
) -> (
    tempfile::TempDir,
    Supervisor,
    remote_codex_protocol::WorkspaceDto,
    remote_codex_protocol::ThreadDto,
) {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    std::fs::write(ws_path.join("README.md"), "# hi\n").unwrap();
    let mut config = test_config(dir.path());
    config.enabled_providers = vec![provider];
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(provider));
    let supervisor = Supervisor::new(config, db, vec![runtime]);
    let workspace = supervisor
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(ws_path.to_string_lossy().into()),
            git_url: None,
            label: Some("proj".into()),
        })
        .unwrap();
    let thread = supervisor
        .create_thread(CreateThreadInput {
            workspace_id: workspace.id.clone(),
            title: Some("t1".into()),
            provider: Some(provider),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    (dir, supervisor, workspace, thread)
}

async fn verify_update_recovery(restart: bool) {
    let (_dir, supervisor, _workspace, thread) = seeded_thread(Provider::Codex).await;
    let supervisor = Arc::new(supervisor);
    supervisor.spawn_live_item_persister();
    let mut events = supervisor.bus.subscribe();
    let running = {
        let state = supervisor.clone();
        let id = thread.id.clone();
        tokio::spawn(async move {
            state
                .prompt(
                    &id,
                    prompt_input("Inspect this repository before making changes."),
                )
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while events.recv().await.unwrap().event_type != "thread.turn.started" {}
    })
    .await
    .unwrap();
    let session = supervisor
        .get_thread(&thread.id)
        .unwrap()
        .provider_session_id;
    supervisor
        .prompt(&thread.id, prompt_input("hello queued after recovery"))
        .await
        .unwrap();
    let guard = supervisor.prepare_update_restart().await.unwrap();
    running.await.unwrap().unwrap();
    assert_eq!(
        supervisor.get_thread(&thread.id).unwrap().status,
        "interrupted"
    );
    assert!(supervisor
        .prompt(&thread.id, prompt_input("must not start while updating"))
        .await
        .unwrap_err()
        .to_string()
        .contains("updating"));
    let paused = supervisor
        .get_thread_detail(&thread.id, None)
        .await
        .unwrap();
    assert_eq!(
        paused.pending_steers.len(),
        1,
        "internal resume must stay hidden"
    );
    assert_eq!(paused.turns.len(), 1);
    drop(guard);
    let state = if restart {
        let config = supervisor.config.clone();
        drop(supervisor);
        let db = Database::open(&config.database_url).unwrap();
        Arc::new(Supervisor::new(
            config,
            db,
            vec![Arc::new(FakeRuntime::new(Provider::Codex))],
        ))
    } else {
        supervisor
    };
    state.spawn_live_item_persister();
    assert!(state.defer_update_recovery());
    assert!(state
        .prompt(
            &thread.id,
            prompt_input("wait for update health verification")
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("updating"));
    state.finish_update_attempt();
    state.spawn_update_recovery(); // Repeated startup notification must not duplicate a turn.
    tokio::time::timeout(std::time::Duration::from_secs(35), async {
        loop {
            let detail = state.get_thread_detail(&thread.id, None).await.unwrap();
            if detail.turns.len() == 3 && detail.thread.status == "idle" {
                assert_eq!(detail.turns[0].status, "interrupted");
                assert_eq!(detail.turns[1].status, "completed");
                assert!(detail.turns[1]
                    .items
                    .iter()
                    .find(|item| item.kind == "userMessage")
                    .unwrap()
                    .text
                    .as_str()
                    .contains("Supervisor was restarted for device maintenance"));
                assert_eq!(
                    detail.turns[2]
                        .items
                        .iter()
                        .find(|item| item.kind == "userMessage")
                        .unwrap()
                        .text
                        .as_str(),
                    "hello queued after recovery"
                );
                assert!(detail.pending_steers.is_empty());
                assert_eq!(detail.thread.provider_session_id, session);
                assert_eq!(
                    detail.thread.sandbox_mode.as_deref(),
                    Some("danger-full-access")
                );
                assert!(detail.thread.last_error.is_none());
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let remaining: i64 = state
        .db
        .with(|conn| {
            Ok(
                conn.query_row("SELECT count(*) FROM thread_pending_steers", [], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn supervisor_update_recovers_session_and_queue_after_process_restart() {
    verify_update_recovery(true).await;
}

#[tokio::test]
async fn supervisor_update_failure_resumes_old_process_without_duplicate_turns() {
    verify_update_recovery(false).await;
}

#[tokio::test]
async fn supervisor_update_recovery_respects_user_stop_and_ordinary_crashes() {
    let (_dir, supervisor, _workspace, thread) = seeded_thread(Provider::Codex).await;
    insert_stale_turn(&supervisor, &thread.id, "stale-update");
    supervisor.db.with(|conn| {
        conn.execute("INSERT INTO thread_pending_steers(id,thread_id,turn_id,display_prompt,submitted_prompt,delivery,created_at,updated_at) VALUES ('update-resume:stale-update',?1,'stale-update','resume','resume','update-resume','2026-09-07','2026-09-07')", [&thread.id])?;
        Ok(())
    }).unwrap();
    let config = supervisor.config.clone();
    drop(supervisor);
    let db = Database::open(&config.database_url).unwrap();
    let state = Arc::new(Supervisor::new(
        config,
        db,
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    ));
    state.interrupt(&thread.id).await.unwrap();
    state.spawn_update_recovery();
    let detail = state.get_thread_detail(&thread.id, None).await.unwrap();
    assert_eq!(detail.turns.len(), 1);
    assert_eq!(detail.thread.status, "interrupted");
    let remaining: i64 = state
        .db
        .with(|conn| {
            Ok(
                conn.query_row("SELECT count(*) FROM thread_pending_steers", [], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap();
    assert_eq!(remaining, 0);
    // Without an update marker, a restart must leave this interrupted turn alone.
    state.spawn_update_recovery();
    assert_eq!(state.get_thread(&thread.id).unwrap().status, "interrupted");
}

#[test]
fn db_owner_child() {
    let Some(path) = std::env::var_os("REMOTE_CODEX_LOCK_TEST_PATH") else {
        return;
    };
    assert!(Database::open(std::path::Path::new(&path)).is_err());
}

#[test]
fn second_process_cannot_open_owned_database_and_lock_releases_on_exit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("owned.sqlite");
    let db = Database::open(&path).unwrap();
    db.set_kv("preserved", "yes").unwrap();
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "db_owner_child", "--nocapture"])
        .env("REMOTE_CODEX_LOCK_TEST_PATH", &path)
        .output()
        .unwrap();
    assert!(
        child.status.success(),
        "{}",
        String::from_utf8_lossy(&child.stderr)
    );
    #[cfg(unix)]
    {
        let alias = dir.path().join("alias.sqlite");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(Database::open(&alias).is_err());
    }
    drop(db);
    let reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened.get_kv("preserved").unwrap().as_deref(),
        Some("yes")
    );
}

#[tokio::test]
async fn acknowledged_input_survives_restart_before_dispatch() {
    let (_dir, state, _ws, thread) = seeded_thread(Provider::Claude).await;
    let config = state.config.clone();
    let mut input = prompt_input("saved before dispatch");
    input.client_request_id = Some("before-crash".into());
    state.accept_prompt(&thread.id, &input).await.unwrap();
    assert!(state
        .get_thread_detail(&thread.id, None)
        .await
        .unwrap()
        .turns
        .is_empty());
    drop(state);
    // Other tests spawn ACP child processes concurrently. On Unix a fork can
    // briefly inherit the lock descriptor until exec closes it. Wait for actual
    // lock release instead of assuming no concurrent fork/exec overlaps the drop.
    let reopened = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            match Database::open(&config.database_url) {
                Ok(db) => break db,
                Err(error) => {
                    assert!(error.to_string().contains("already owned"), "{error:#}");
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            }
        }
    })
    .await
    .expect("old Supervisor database ownership must be released");
    let restarted = Supervisor::new(
        config.clone(),
        reopened,
        vec![Arc::new(FakeRuntime::new(Provider::Claude))],
    );
    assert_eq!(
        restarted
            .get_thread_detail(&thread.id, None)
            .await
            .unwrap()
            .pending_steers
            .len(),
        1
    );
    restarted.prompt(&thread.id, input.clone()).await.unwrap();
    assert_eq!(
        restarted
            .get_thread_detail(&thread.id, None)
            .await
            .unwrap()
            .turns
            .len(),
        1
    );
    input.prompt = "different payload".into();
    assert!(restarted
        .accept_prompt(&thread.id, &input)
        .await
        .unwrap_err()
        .to_string()
        .contains("already used"));
}
