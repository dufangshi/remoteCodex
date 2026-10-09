//! Opt-in real Claude acceptance. Separate session/workspace/database; never
//! restarts the host Supervisor. Uses the cheapest advertised Haiku model.
use remote_codex_protocol::{CreateThreadInput, CreateWorkspaceInput, Mode, Provider};
use remote_codex_runtime::{
    acp::AcpRuntime,
    actor::{AgentRuntime, StartTurnInput},
    Database, RuntimeConfig, Supervisor,
};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[tokio::test]
#[ignore = "uses real Claude authentication and tokens in an isolated session"]
async fn haiku_reports_native_tokens_and_speed_during_first_tool_wait() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = Arc::new(AcpRuntime::bound(Provider::Claude, "claude", 60000));
    let models = runtime
        .list_models(Some("claude"), Some(dir.path().to_str().unwrap()))
        .await
        .unwrap();
    let model = models
        .iter()
        .find(|m| {
            m.id.to_lowercase().contains("haiku") || m.display_name.to_lowercase().contains("haiku")
        })
        .expect("an advertised Haiku model is required to bound test cost")
        .id
        .clone();
    let mut config = RuntimeConfig::from_env();
    config.database_url = dir.path().join("isolated.sqlite");
    config.workspace_root = dir.path().join("workspaces");
    config.mode = Mode::Local;
    config.fake_runtime = false;
    config.relay_server_url = None;
    config.relay_agent_token = None;
    let state = Arc::new(Supervisor::new(
        config.clone(),
        Database::open(&config.database_url).unwrap(),
        vec![runtime.clone()],
    ));
    state.spawn_live_item_persister();
    let workspace = state
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(dir.path().to_string_lossy().into()),
            git_url: None,
            label: None,
        })
        .unwrap();
    let thread = state
        .create_thread(CreateThreadInput {
            workspace_id: workspace.id,
            provider: Some(Provider::Claude),
            agent_id: None,
            model: model.clone(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            parent_thread_id: None,
            title: Some("isolated token acceptance".into()),
        })
        .await
        .unwrap();
    let turn_id = uuid::Uuid::new_v4().to_string();
    state.db.with(|conn| {
        conn.execute("INSERT INTO thread_turns(id,thread_id,status,model,started_at,ordinal) VALUES(?1,?2,'inProgress',?3,?4,1)", rusqlite::params![turn_id,thread.id,model,remote_codex_protocol::now_rfc3339()])?;
        Ok(())
    }).unwrap();
    let mut events = state.bus.subscribe();
    let cancel = CancellationToken::new();
    let input = StartTurnInput {
        provider_session_id: thread.provider_session_id.clone().unwrap(), thread_id:thread.id.clone(), turn_id:turn_id.clone(),
        prompt:"This is an isolated throughput acceptance test. Do not edit files, create agents or call remote-codex. First write two short sentences. Then call Bash with exactly sleep 12 and wait for it to finish. Finally reply with CLAUDE_THROUGHPUT_DONE. Only one tool call is needed.".into(),
        model:Some(model.clone()), reasoning_effort:None, sandbox_mode:Some("danger-full-access".into()), collaboration_mode:None,
        approval_mode:Some("yolo".into()), performance_mode:None, hidden:false, images:vec![], title:None, context_delivered:false,
    };
    let runner = runtime.clone();
    let bus = state.bus.clone();
    let token = cancel.clone();
    let mut task = tokio::spawn(async move { runner.start_turn(input, bus, token).await });
    let observed = tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let event = events.recv().await.map_err(|error| error.to_string())?;
            if event.event_type == "thread.turn.completed" {
                return Err("turn completed before live native usage appeared".to_string());
            }
            if event.event_type != "thread.turn.token.updated" {
                continue;
            }
            let usage = &event.payload["tokenUsage"];
            if usage["generationSpeed"]["state"] == "tool"
                && usage["generationSpeed"]["latestOutputTokensPerSecond"]
                    .as_f64()
                    .is_some_and(|r| r > 0.0)
            {
                return Ok(usage.clone());
            }
        }
    })
    .await;
    if !matches!(&observed, Ok(Ok(_))) {
        cancel.cancel();
    }
    let done = tokio::time::timeout(Duration::from_secs(90), &mut task).await;
    if done.is_err() {
        cancel.cancel();
        task.abort();
    }
    // This runtime owns only its isolated test process, not the installed service.
    runtime.restart("claude").await.unwrap();
    let live = observed
        .expect("live usage while first tool executes")
        .unwrap();
    assert!(live["total"]["outputTokens"].as_u64().unwrap() > 0);
    let items = done.expect("test completes").unwrap().unwrap();
    assert!(items
        .iter()
        .any(|item| item.text.contains("CLAUDE_THROUGHPUT_DONE")));
    let raw = state
        .db
        .with(|c| {
            Ok(c.query_row(
                "SELECT token_usage_json FROM thread_turns WHERE id=?1",
                [&turn_id],
                |r| r.get::<_, String>(0),
            )?)
        })
        .unwrap();
    let final_usage: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(final_usage["source"], "claudeRollout");
    assert_eq!(final_usage["generationSpeed"]["active"], false);
    println!(
        "{}",
        serde_json::json!({"model":model,"liveOutputTokens":live["total"]["outputTokens"],"liveSpeed":live["generationSpeed"]["latestOutputTokensPerSecond"],"finalOutputTokens":final_usage["total"]["outputTokens"],"finalSpeed":final_usage["generationSpeed"]["averageOutputTokensPerSecond"]})
    );
}
