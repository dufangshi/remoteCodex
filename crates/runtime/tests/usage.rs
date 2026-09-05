use std::sync::Arc;

use remote_codex_protocol::{
    CreateThreadInput, CreateWorkspaceInput, Provider, ThreadEventEnvelope,
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
            model: "gpt-6-astra".into(),
            reasoning_effort: Some("high".into()),
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

#[tokio::test]
async fn usage_is_priced_live_persisted_and_restored_without_double_counting() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.db.with(|conn| {
        conn.execute("UPDATE thread_turns SET model='gpt-6-astra', reasoning_effort='high', pricing_model_key='gpt-6-astra', pricing_tier_key='standard' WHERE id='live-turn'",[])?;
        Ok(())
    }).unwrap();
    supervisor.spawn_live_item_persister();
    let mut events = supervisor.bus.subscribe();
    let usage = |input, output, last_input| json!({"turnId":"live-turn","usage":{"total":{"inputTokens":input,"outputTokens":output,"cachedInputTokens":100},"last":{"inputTokens":last_input,"outputTokens":10},"baselineTotal":{"inputTokens":1000,"outputTokens":100,"cachedInputTokens":100},"cumulative":true,"source":"codexRollout","modelContextWindow":1050000}});
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        usage(101000, 1100, 100000),
    );
    let first = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(
        first.token_usage.as_ref().unwrap()["total"]["inputTokens"],
        100000
    );
    assert_eq!(first.price_estimate.as_ref().unwrap()["totalUsd"], 1.05);
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        usage(401000, 2100, 300000),
    );
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        usage(401000, 2100, 300000),
    );
    let turn = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(
        turn.token_usage.as_ref().unwrap()["total"]["inputTokens"],
        400000
    );
    assert!(
        (turn.price_estimate.as_ref().unwrap()["totalUsd"]
            .as_f64()
            .unwrap()
            - 7.125)
            .abs()
            < 1e-10
    );
    assert_eq!(turn.reasoning_effort.as_deref(), Some("high"));
    let mut published = Vec::new();
    while let Ok(event) = events.try_recv() {
        if event.event_type == "thread.turn.token.updated" {
            published.push(event);
        }
    }
    assert_eq!(published.len(), 3);
    assert_eq!(published[0].payload["model"], "gpt-6-astra");
    assert_eq!(
        published[2].payload["tokenUsage"]["total"]["inputTokens"],
        400000
    );
    assert!(published[2].payload["tokenUsage"]
        .get("baselineTotal")
        .is_none());
    let stored = supervisor
        .db
        .with(|conn| {
            Ok(conn.query_row(
                "SELECT token_usage_json FROM thread_turns WHERE id='live-turn'",
                [],
                |row| row.get::<_, String>(0),
            )?)
        })
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&stored).unwrap()["cumulativeTotal"]["inputTokens"],
        401000
    );
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        json!({"turnId":"live-turn","usage":{"inputTokens":50,"outputTokens":10,"cachedReadTokens":0}}),
    );
    assert_eq!(
        supervisor
            .get_thread_turn_detail(&thread_id, "live-turn")
            .await
            .unwrap()
            .token_usage,
        turn.token_usage
    );
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "UPDATE thread_turns SET status='completed' WHERE id='live-turn'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let reopened = Supervisor::new(
        supervisor.config.clone(),
        Database::open(&supervisor.config.database_url).unwrap(),
        vec![],
    );
    let completed = reopened
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(completed.token_usage, turn.token_usage);
    assert_eq!(completed.price_estimate, turn.price_estimate);
}

#[tokio::test]
async fn per_turn_acp_totals_do_not_subtract_a_previous_turn() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    supervisor.db.with(|conn| {
        conn.execute("INSERT INTO thread_turns(id,thread_id,status,ordinal,token_usage_json) VALUES ('previous',?1,'completed',0,?2)",params![thread_id,json!({"cumulativeTotal":{"inputTokens":1000000,"outputTokens":10000}}).to_string()])?;
        Ok(())
    }).unwrap();
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        json!({"turnId":"live-turn","usage":{"total":{"inputTokens":100,"outputTokens":10},"last":{"inputTokens":100,"outputTokens":10}}}),
    );
    let turn = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(turn.token_usage.unwrap()["total"]["inputTokens"], 100);
}

#[tokio::test]
async fn old_completed_turn_hydrates_usage_from_the_native_rollout() {
    let (dir, supervisor, thread_id) = running_thread().await;
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "UPDATE thread_turns SET status='completed', completed_at='2026-09-05T10:01:00Z' WHERE id='live-turn'",
                [],
            )?;
            conn.execute("INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES ('prompt',?1,'live-turn','prompt',?2,'now','now')",
                params![thread_id,json!({"id":"prompt","kind":"userMessage","text":"old [PHOTO screenshot.png] prompt"}).to_string()])?;
            Ok(())
        })
        .unwrap();
    let session_id = supervisor
        .get_thread(&thread_id)
        .unwrap()
        .provider_session_id
        .unwrap();
    let home = dir.path().join("codex");
    std::fs::create_dir_all(home.join("sessions")).unwrap();
    let rows = [
        json!({"type":"session_meta","payload":{"id":session_id,"cwd":dir.path()}}),
        json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000000,"output_tokens":10000}}}}),
        json!({"timestamp":"2026-09-05T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"native-turn"}}),
        json!({"type":"turn_context","payload":{"model":"gpt-6-astra","effort":"high"}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"old prompt"}}),
        json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"output_tokens":100},"last_token_usage":{"input_tokens":1000,"output_tokens":100},"model_context_window":1050000}}}),
        json!({"type":"event_msg","payload":{"type":"task_complete"}}),
    ];
    std::fs::write(
        home.join("sessions")
            .join(format!("rollout-{session_id}.jsonl")),
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let reopened = Supervisor::new(
        supervisor.config.clone(),
        Database::open(&supervisor.config.database_url).unwrap(),
        vec![],
    )
    .with_local_session_homes(remote_codex_runtime::local_sessions::LocalSessionHomes {
        codex_home: home,
        grok_home: dir.path().join("grok"),
        claude_home: dir.path().join("claude"),
    });
    let turn = reopened
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(turn.model.as_deref(), Some("gpt-6-astra"));
    assert_eq!(turn.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(
        turn.token_usage.as_ref().unwrap()["total"]["inputTokens"],
        1000
    );
    assert_eq!(turn.price_estimate.as_ref().unwrap()["totalUsd"], 0.015);
    let stored = reopened
        .db
        .with(|conn| {
            Ok(conn.query_row(
                "SELECT token_usage_json FROM thread_turns WHERE id='live-turn'",
                [],
                |row| row.get::<_, String>(0),
            )?)
        })
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&stored).unwrap()["total"]["inputTokens"],
        1000
    );
    reopened.db.with(|conn| {
        conn.execute("UPDATE thread_turns SET token_usage_json=?1 WHERE id='live-turn'",
            params![json!({"total":{"totalTokens":0,"inputTokens":0,"outputTokens":0},"last":{"totalTokens":1100,"inputTokens":1000,"outputTokens":100}}).to_string()])?;
        Ok(())
    }).unwrap();
    let repaired = reopened
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(
        repaired.token_usage.as_ref().unwrap()["total"]["inputTokens"],
        1000
    );
    assert_eq!(repaired.price_estimate.as_ref().unwrap()["totalUsd"], 0.015);
}

#[tokio::test]
async fn cumulative_counter_resets_preserve_billable_usage_without_duplicates() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    let baseline = json!({"inputTokens":1000000,"outputTokens":10000});
    for (input, expected) in [
        (1000, 1000),
        (2000, 2000),
        (2000, 2000),
        (500, 2500),
        (1500, 3500),
    ] {
        emit(
            &supervisor,
            &thread_id,
            "runtime.usage.updated",
            json!({
                "turnId":"live-turn", "usage": {
                    "total":{"inputTokens":input,"outputTokens":10},
                    "last":{"inputTokens":500,"outputTokens":10},
                    "baselineTotal":baseline, "cumulative":true, "source":"codexRollout", "model":"gpt-6-astra"
                }
            }),
        );
        let turn = supervisor
            .get_thread_turn_detail(&thread_id, "live-turn")
            .await
            .unwrap();
        assert_eq!(
            turn.token_usage.as_ref().unwrap()["total"]["inputTokens"],
            expected
        );
        assert!(
            turn.price_estimate.as_ref().unwrap()["totalUsd"]
                .as_f64()
                .unwrap()
                > 0.0
        );
    }
}

#[tokio::test]
async fn restarted_counter_above_baseline_bills_at_least_the_last_request() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor.spawn_live_item_persister();
    for _ in 0..2 {
        emit(
            &supervisor,
            &thread_id,
            "runtime.usage.updated",
            json!({
                "turnId":"live-turn", "usage":{
                    "total":{"inputTokens":46268,"outputTokens":14},
                    "last":{"inputTokens":46268,"outputTokens":14},
                    "baselineTotal":{"inputTokens":46218,"outputTokens":11},
                    "cumulative":true,"source":"codexRollout","model":"gpt-6-astra"
                }
            }),
        );
        let turn = supervisor
            .get_thread_turn_detail(&thread_id, "live-turn")
            .await
            .unwrap();
        assert_eq!(turn.token_usage.unwrap()["total"]["totalTokens"], 46282);
    }
}

#[tokio::test]
async fn custom_model_rates_match_display_names_survive_reload_and_reprice_history() {
    let (_dir, supervisor, thread_id) = running_thread().await;
    supervisor
        .db
        .with(|conn| {
            conn.execute(
                "UPDATE thread_turns SET model='opaque-harness-id' WHERE id='live-turn'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    supervisor
        .db
        .set_kv(
            "model_display_names",
            &json!({"opaque-harness-id":"My MODEL"}).to_string(),
        )
        .unwrap();
    supervisor.update_model_pricing(&json!({"id":"my-model","rates":{"inputUsdPerMillion":2,"cachedInputUsdPerMillion":0.2,"outputUsdPerMillion":10,"aliases":["My MODEL"]}})).unwrap();
    supervisor.spawn_live_item_persister();
    emit(
        &supervisor,
        &thread_id,
        "runtime.usage.updated",
        json!({"turnId":"live-turn","usage":{"inputTokens":10000,"cachedInputTokens":8000,"outputTokens":1000}}),
    );
    let first = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    let price = first.price_estimate.unwrap();
    assert_eq!(price["inputUsd"], 0.004);
    assert_eq!(price["cachedInputUsd"], 0.0016);
    assert_eq!(price["outputUsd"], 0.01);
    supervisor.update_model_pricing(&json!({"id":"my-model","rates":{"inputUsdPerMillion":4,"cachedInputUsdPerMillion":0.4,"outputUsdPerMillion":20}})).unwrap();
    let next = supervisor
        .get_thread_turn_detail(&thread_id, "live-turn")
        .await
        .unwrap();
    assert_eq!(next.price_estimate.unwrap()["inputUsd"], 0.008);
    assert!(supervisor
        .db
        .get_kv("model_pricing")
        .unwrap()
        .unwrap()
        .contains("my-model"));
    assert!(supervisor.update_model_pricing(&json!({"id":"invalid","rates":{"inputUsdPerMillion":-1,"cachedInputUsdPerMillion":0,"outputUsdPerMillion":1}})).is_err());
    supervisor
        .update_model_pricing(&json!({"id":"my-model","reset":true}))
        .unwrap();
    assert!(supervisor.model_pricing()["models"]["my-model"].is_null());
}
