use std::sync::Arc;
use std::time::Duration;

use remote_codex_protocol::{
    CreateThreadInput, CreateWorkspaceInput, Provider, ThreadEventEnvelope, ThreadTurnDto,
};
use remote_codex_runtime::actor::SharedRuntime;
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::Supervisor;
use rusqlite::params;
use serde_json::{json, Value};
use tempfile::{tempdir, TempDir};

async fn running_thread() -> (TempDir, Arc<Supervisor>, String) {
    let dir = tempdir().unwrap();
    let config = RuntimeConfig {
        mode: remote_codex_protocol::Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: dir.path().join("workspaces"),
        database_url: dir.path().join("test.sqlite"),
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
    };
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Arc::new(Supervisor::new(config, db, vec![runtime]));
    let workspace = supervisor
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(dir.path().to_string_lossy().into()),
            git_url: None,
            label: Some("test".into()),
        })
        .unwrap();
    let thread = supervisor
        .create_thread(CreateThreadInput {
            workspace_id: workspace.id,
            title: Some("live history".into()),
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "INSERT INTO thread_turns(id, thread_id, status, started_at, ordinal)
             VALUES ('live-turn', ?1, 'inProgress', '2026-09-05T10:00:00Z', 1)",
                params![thread.id],
            )?;
            conn.execute(
                "UPDATE threads SET status='running' WHERE id=?1",
                params![thread.id],
            )?;
            Ok(())
        })
        .unwrap();
    (dir, supervisor, thread.id)
}

fn emit(supervisor: &Supervisor, thread_id: &str, event_type: &str, payload: Value) {
    supervisor.bus.emit(ThreadEventEnvelope {
        event_type: event_type.into(),
        thread_id: thread_id.into(),
        timestamp: "2026-09-05T10:00:01Z".into(),
        payload,
    });
}

async fn wait_for_item(supervisor: &Supervisor, thread_id: &str, item_id: &str) -> ThreadTurnDto {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let turn = supervisor
                .get_thread_turn_detail(thread_id, "live-turn")
                .await
                .unwrap();
            if turn.items.iter().any(|item| item.id == item_id) {
                return turn;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("live events should be persisted before the turn ends")
}

#[tokio::test]
async fn reloading_running_history_restores_streamed_text_and_interleaved_activity() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    // Deliberately emit before yielding to exercise immediate snapshot reads.
    for delta in ["正在检查", "代码。"] {
        emit(
            &supervisor,
            &thread_id,
            "thread.output.delta",
            json!({
                "turnId": "live-turn", "itemId": "assistant-1", "sequence": 1,
                "createdAt": "2026-09-05T10:00:00.500Z", "delta": delta,
            }),
        );
    }
    emit(
        &supervisor,
        &thread_id,
        "thread.item.started",
        json!({
            "turnId": "live-turn", "item": {
                "id": "thought-1", "kind": "reasoning", "text": "Checking the output.",
                "status": "running", "sequence": 2, "createdAt": "2026-09-05T10:00:00.750Z",
            },
        }),
    );
    emit(
        &supervisor,
        &thread_id,
        "thread.output.delta",
        json!({
            "turnId": "live-turn", "itemId": "assistant-2", "sequence": 3, "delta": "继续。",
        }),
    );
    wait_for_item(&supervisor, &thread_id, "assistant-2").await;
    let restored = supervisor
        .get_thread_detail_view(&thread_id, Some(10), true)
        .await
        .unwrap()
        .turns
        .into_iter()
        .find(|turn| turn.id == "live-turn")
        .unwrap();
    assert_eq!(restored.status, "inProgress");
    assert_eq!(restored.has_deferred_items, Some(true));
    assert_eq!(restored.deferred_item_count, Some(1));
    assert_eq!(
        restored
            .items
            .iter()
            .map(|item| (item.kind.as_str(), item.text.as_str(), item.sequence,))
            .collect::<Vec<_>>(),
        vec![
            ("agentMessage", "正在检查代码。", Some(1)),
            ("agentMessage", "继续。", Some(3)),
        ]
    );
    assert_eq!(
        restored.items[0].created_at.as_deref(),
        Some("2026-09-05T10:00:00.500Z")
    );
    assert_eq!(
        restored.items[0].source_turn_id.as_deref(),
        Some("live-turn")
    );

    // More chunks must extend the persisted prefix after the browser reload.
    emit(
        &supervisor,
        &thread_id,
        "thread.output.delta",
        json!({
            "turnId": "live-turn", "itemId": "assistant-2", "sequence": 3, "delta": "完成检查。",
        }),
    );
    emit(
        &supervisor,
        &thread_id,
        "thread.item.completed",
        json!({
            "turnId": "live-turn", "item": {
                "id": "barrier", "kind": "commandExecution", "text": "pwd", "status": "completed",
            },
        }),
    );
    let continued = wait_for_item(&supervisor, &thread_id, "barrier").await;
    assert_eq!(
        continued
            .items
            .iter()
            .find(|item| item.id == "assistant-2")
            .unwrap()
            .text,
        "继续。完成检查。"
    );
}

#[tokio::test]
async fn broadcast_output_is_already_persisted_and_contains_the_complete_prefix() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    supervisor.spawn_live_item_persister();
    let mut events = supervisor.bus.subscribe();
    for (delta, expected) in [("Hello", "Hello"), (" 世界", "Hello 世界")] {
        emit(
            &supervisor,
            &thread_id,
            "thread.output.delta",
            json!({
                "turnId": "live-turn", "itemId": "assistant-1", "sequence": 1,
                "delta": delta,
            }),
        );
        // No yielding or retries: receiving an event guarantees a refresh can read it.
        let event = events.try_recv().unwrap();
        assert_eq!(event.payload["delta"], delta);
        assert_eq!(event.payload["text"], expected);
        let restored = supervisor
            .get_thread_turn_detail(&thread_id, "live-turn")
            .await
            .unwrap();
        assert_eq!(restored.items[0].text, expected);
    }
    emit(
        &supervisor,
        &thread_id,
        "thread.item.completed",
        json!({
            "turnId": "live-turn", "item": {
                "id": "assistant-1", "kind": "agentMessage", "text": "Hello 世界",
                "status": "failed", "sequence": 1,
            },
        }),
    );
    let restored = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(restored.items[0].text, "Hello 世界");
    assert_eq!(restored.items[0].status.as_deref(), Some("failed"));

    let weak = Arc::downgrade(&supervisor);
    let bus = supervisor.bus.clone();
    drop(supervisor);
    assert!(
        weak.upgrade().is_none(),
        "the persistence hook must not keep the supervisor alive"
    );
    drop(bus);
}

#[tokio::test]
async fn output_bursts_remain_complete_when_websocket_receivers_lag() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    let mut events = supervisor.bus.subscribe();
    // Exceed the websocket broadcast queue without yielding to another task.
    for _ in 0..2200 {
        emit(
            &supervisor,
            &thread_id,
            "thread.output.delta",
            json!({
                "turnId": "live-turn", "itemId": "assistant-1", "sequence": 1, "delta": "x",
            }),
        );
    }
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_))
    ));
    let restored = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(restored.items[0].text, "x".repeat(2200));
}

#[tokio::test]
async fn queued_live_events_cannot_overwrite_completed_history() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    let final_item = json!({
        "id": "assistant-1", "kind": "agentMessage", "text": "The completed reply.",
        "status": "completed", "sequence": 1,
    });
    supervisor.db.with(|conn| {
        conn.execute("UPDATE thread_turns SET status='completed' WHERE id='live-turn'", [])?;
        conn.execute(
            "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
             VALUES ('stored-item', ?1, 'live-turn', 'assistant-1', ?2, '2026-09-05T10:00:01Z', '2026-09-05T10:00:01Z')",
            params![thread_id, final_item.to_string()],
        )?;
        Ok(())
    }).unwrap();
    emit(
        &supervisor,
        &thread_id,
        "thread.output.delta",
        json!({
            "turnId": "live-turn", "itemId": "assistant-1", "sequence": 1, "delta": " reply.",
        }),
    );
    emit(
        &supervisor,
        &thread_id,
        "thread.item.started",
        json!({
            "turnId": "live-turn", "item": {
                "id": "assistant-1", "kind": "agentMessage", "text": "The", "status": "running",
            },
        }),
    );
    emit(
        &supervisor,
        &thread_id,
        "thread.item.completed",
        json!({
            "turnId": "live-turn", "item": {
                "id": "barrier", "kind": "agentMessage", "text": "Persisted.", "status": "completed",
            },
        }),
    );
    wait_for_item(&supervisor, &thread_id, "barrier").await;
    let turn = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    let reply = turn
        .items
        .iter()
        .find(|item| item.id == "assistant-1")
        .unwrap();
    assert_eq!(reply.text, "The completed reply.");
    assert_eq!(reply.status.as_deref(), Some("completed"));
}

#[tokio::test]
async fn accepted_steer_survives_queue_cleanup_completion_and_reopen() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.db.with(|conn| {
        conn.execute("INSERT INTO thread_pending_steers(id,thread_id,turn_id,display_prompt,submitted_prompt,delivery,created_at,updated_at) VALUES ('steer-one',?1,'live-turn','Reply 1','Reply 1','continuation','2026-09-05T10:00:02Z','2026-09-05T10:00:02Z')", params![thread_id])?;
        Ok(())
    }).unwrap();
    let detail = supervisor
        .steer_pending_prompt(&thread_id, "steer-one")
        .await
        .unwrap();
    assert!(
        detail.turns.is_empty(),
        "delivery acknowledgement must not load history"
    );
    assert_eq!(detail.pending_steers.len(), 1);
    assert_eq!(detail.pending_steers[0].delivery, "steer");
    let turn = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    let messages: Vec<_> = turn
        .items
        .iter()
        .filter(|i| i.kind == "userMessage" && i.text == "Reply 1")
        .collect();
    assert_eq!(messages.len(), 1);
    assert!(messages[0].created_at.is_some());
    assert_eq!(messages[0].source_turn_id.as_deref(), Some("live-turn"));
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "UPDATE thread_turns SET status='completed' WHERE id='live-turn'",
                [],
            )?;
            conn.execute(
                "UPDATE threads SET status='idle' WHERE id=?1",
                params![thread_id],
            )?;
            conn.execute(
                "DELETE FROM thread_pending_steers WHERE thread_id=?1",
                params![thread_id],
            )?;
            Ok(())
        })
        .unwrap();
    let config = supervisor.config.clone();
    drop(supervisor);
    let reopened = Supervisor::new(
        config.clone(),
        Database::open(&config.database_url).unwrap(),
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    );
    let receipt = reopened.thread_delivery(&thread_id).await.unwrap();
    assert_eq!(receipt["acceptedSteerIds"], json!(["steer-one"]));
    assert_eq!(receipt["turns"], json!([]));
    // A repeated request after completion/restart confirms the original delivery.
    reopened
        .steer_pending_prompt(&thread_id, "steer-one")
        .await
        .unwrap();
    let turn = reopened
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(
        turn.items
            .iter()
            .filter(|i| i.kind == "userMessage" && i.text == "Reply 1")
            .count(),
        1
    );
}

#[tokio::test]
async fn summaries_and_delivery_do_not_materialize_large_operation_history() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.db.with(|conn| {
        for n in 2..=7 {
            conn.execute("INSERT INTO thread_turns(id,thread_id,status,started_at,ordinal) VALUES (?1,?2,'completed','2026-09-05T09:00:00Z',?3)", params![format!("older-{n}"),thread_id,-n])?;
        }
        for turn in ["live-turn", "older-2", "older-3", "older-4", "older-5", "older-6", "older-7"] {
            for (kind, text) in [("userMessage", "Small prompt".to_owned()), ("commandExecution", "large output ".repeat(100_000)), ("agentMessage", "Small answer".to_owned())] {
                let id = format!("{turn}-{kind}");
                conn.execute("INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES (?1,?2,?3,?1,?4,'2026-09-05T10:00:00Z','2026-09-05T10:00:00Z')",params![id,thread_id,turn,json!({"id":id,"kind":kind,"text":text}).to_string()])?;
            }
        }
        Ok(())
    }).unwrap();
    let summary = supervisor
        .get_thread_detail_view(&thread_id, None, true)
        .await
        .unwrap();
    assert_eq!(summary.total_turn_count, Some(7));
    assert_eq!(summary.turns.len(), 3);
    for turn in &summary.turns {
        assert_eq!(turn.has_deferred_items, Some(true));
        assert_eq!(turn.items.len(), 2);
        assert!(turn
            .items
            .iter()
            .all(|item| item.kind != "commandExecution"));
    }
    assert!(serde_json::to_vec(&summary).unwrap().len() < 15_000);
    let full = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(full.items.len(), 3);
    assert!(full.items.iter().any(|item| item.text.len() > 1_000_000));
    let mut events = supervisor.bus.subscribe();
    let queued = supervisor
        .prompt(
            &thread_id,
            serde_json::from_value(
                json!({"prompt":"Quick follow-up", "clientRequestId":"receipt-test"}),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    assert!(queued.turns.is_empty());
    assert!(serde_json::to_vec(&queued).unwrap().len() < 10_000);
    let event = events.recv().await.unwrap();
    assert_eq!(
        event.payload["pendingSteers"][0]["clientRequestId"],
        "receipt-test"
    );
    let pending_id = &queued.pending_steers[0].id;
    let (first, duplicate) = tokio::join!(
        supervisor.steer_pending_prompt(&thread_id, pending_id),
        supervisor.steer_pending_prompt(&thread_id, pending_id)
    );
    assert!(first.unwrap().turns.is_empty());
    assert!(duplicate.unwrap().turns.is_empty());
    let receipt = supervisor.thread_delivery(&thread_id).await.unwrap();
    assert_eq!(receipt["acceptedSteerIds"], json!([pending_id]));
    assert!(serde_json::to_vec(&receipt).unwrap().len() < 10_000);
}
