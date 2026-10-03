use remote_codex_protocol::{
    CreateThreadInput, CreateWorkspaceInput, Provider, ThreadEventEnvelope,
};
use remote_codex_runtime::{fake::FakeRuntime, Database, RuntimeConfig, Supervisor};
use serde_json::{json, Value};
use std::sync::Arc;

#[tokio::test]
async fn speed_cost_and_history_survive_tool_wait_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = RuntimeConfig::from_env();
    config.database_url = dir.path().join("test.sqlite");
    config.workspace_root = dir.path().join("workspaces");
    config.fake_runtime = true;
    config.relay_server_url = None;
    config.relay_agent_token = None;
    let state = Arc::new(Supervisor::new(
        config.clone(),
        Database::open(&config.database_url).unwrap(),
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    ));
    state.spawn_live_item_persister();
    let ws = state
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(dir.path().to_string_lossy().into()),
            git_url: None,
            label: None,
        })
        .unwrap();
    let thread = state
        .create_thread(CreateThreadInput {
            workspace_id: ws.id,
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "gpt-6.1-sol".into(),
            reasoning_effort: Some("low".into()),
            approval_mode: "yolo".into(),
            parent_thread_id: None,
            title: Some("speed fixture".into()),
        })
        .await
        .unwrap();
    state.db.with(|conn| {
        conn.execute("INSERT INTO thread_turns(id,thread_id,status,model,started_at,ordinal) VALUES('speed-turn',?1,'inProgress','gpt-6.1-sol','2030-01-01T00:00:00.000Z',1)", [&thread.id])?;
        Ok(())
    }).unwrap();
    let emit = |at: &str, kind: &str, payload: Value| {
        state.bus.emit(ThreadEventEnvelope {
            event_type: kind.into(),
            thread_id: thread.id.clone(),
            timestamp: format!("2030-01-01T00:{at}Z"),
            payload,
        })
    };
    emit(
        "00:00.000",
        "thread.turn.started",
        json!({"turnId":"speed-turn"}),
    );
    emit(
        "00:10.000",
        "runtime.usage.updated",
        json!({"turnId":"speed-turn","usage":{"inputTokens":1000,"outputTokens":1000,"cachedInputTokens":0}}),
    );
    emit(
        "00:10.000",
        "thread.item.started",
        json!({"turnId":"speed-turn","item":{"id":"sleep","kind":"commandExecution","text":"sleep 60","status":"running"}}),
    );
    emit(
        "01:10.000",
        "thread.item.completed",
        json!({"turnId":"speed-turn","item":{"id":"sleep","kind":"commandExecution","text":"sleep 60","status":"completed"}}),
    );
    emit(
        "01:20.000",
        "runtime.usage.updated",
        json!({"turnId":"speed-turn","usage":{"inputTokens":2000,"outputTokens":2000,"cachedInputTokens":0}}),
    );
    emit(
        "01:20.000",
        "thread.request.created",
        json!({"request":{"id":"question","turnId":"speed-turn"}}),
    );
    emit(
        "02:20.000",
        "thread.request.resolved",
        json!({"requestId":"question"}),
    );
    emit(
        "02:30.000",
        "runtime.usage.updated",
        json!({"turnId":"speed-turn","usage":{"inputTokens":3000,"outputTokens":3000,"cachedInputTokens":0}}),
    );
    emit(
        "02:30.000",
        "thread.turn.completed",
        json!({"turnId":"speed-turn","status":"completed"}),
    );
    let raw: String = state
        .db
        .with(|conn| {
            Ok(conn.query_row(
                "SELECT token_usage_json FROM thread_turns WHERE id='speed-turn'",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    let usage: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(usage["generationSpeed"]["llmTimeMs"], 30000);
    assert_eq!(usage["generationSpeed"]["averageTokensPerSecond"], 100.0);
    assert_eq!(usage["generationSpeed"]["active"], false);
    assert!((usage["priceEstimate"]["totalUsd"].as_f64().unwrap() - 0.036).abs() < 1e-8);
    drop(state);
    let reopened = Supervisor::new(
        config.clone(),
        Database::open(&config.database_url).unwrap(),
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    );
    let detail = reopened.get_thread_detail(&thread.id, None).await.unwrap();
    assert_eq!(
        detail.turns[0].token_usage.as_ref().unwrap()["generationSpeed"],
        usage["generationSpeed"]
    );
    assert_eq!(
        detail.turns[0].price_estimate.as_ref().unwrap()["totalUsd"],
        usage["priceEstimate"]["totalUsd"]
    );
    assert_eq!(detail.turns[0].status, "completed");
}
