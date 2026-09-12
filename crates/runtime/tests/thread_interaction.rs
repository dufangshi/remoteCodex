use remote_codex_protocol::{CreateThreadInput, CreateWorkspaceInput, Provider};
use remote_codex_runtime::{
    fake::FakeRuntime,
    interaction::{SendInput, TranscriptQuery},
    Database, RuntimeConfig, Supervisor,
};
use rusqlite::params;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

fn setup() -> (tempfile::TempDir, Arc<Supervisor>) {
    let dir = tempfile::tempdir().unwrap();
    let config = RuntimeConfig {
        mode: remote_codex_protocol::Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: dir.path().into(),
        database_url: dir.path().join("db.sqlite"),
        app_name: "test".into(),
        app_version: "test".into(),
        environment: "test".into(),
        auth_required: false,
        admin_username: None,
        admin_password: None,
        session_secret: None,
        relay_server_url: Some("https://relay.example.test".into()),
        relay_agent_token: None,
        enabled_providers: vec![Provider::Codex, Provider::Acp],
        acp_command: None,
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    };
    let db = Database::open(&config.database_url).unwrap();
    let state = Arc::new(Supervisor::new(
        config,
        db,
        vec![
            Arc::new(FakeRuntime::new(Provider::Codex)),
            Arc::new(FakeRuntime::new(Provider::Acp)),
        ],
    ));
    state.spawn_live_item_persister();
    (dir, state)
}
async fn thread(s: &Supervisor, p: Provider) -> String {
    let ws = s
        .list_workspaces()
        .unwrap()
        .into_iter()
        .next()
        .unwrap_or_else(|| {
            s.create_workspace(CreateWorkspaceInput {
                abs_path: Some(s.config.workspace_root.to_string_lossy().into()),
                git_url: None,
                label: Some("test".into()),
            })
            .unwrap()
        });
    s.create_thread(CreateThreadInput {
        workspace_id: ws.id,
        title: None,
        provider: Some(p),
        agent_id: Some(if p == Provider::Acp { "grok" } else { "codex" }.into()),
        model: "ios-e2e-stream".into(),
        reasoning_effort: None,
        approval_mode: "yolo".into(),
    })
    .await
    .unwrap()
    .id
}
fn send(from: &str, text: &str, notify: bool, key: &str) -> SendInput {
    SendInput {
        delivery: "queue".into(),
        notify_delivery: "queue".into(),
        text: text.into(),
        from_thread_id: Some(from.into()),
        notify_on_complete: notify,
        client_request_id: Some(key.into()),
    }
}
async fn until(mut check: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(8), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn conversation_is_recent_bounded_and_every_stored_detail_is_discoverable() {
    let (_dir, s) = setup();
    let a = thread(&s, Provider::Codex).await;
    s.db.with(|c|{
        for n in 1..=5 {
            let turn=format!("turn-{n}");
            c.execute("INSERT INTO thread_turns(id,thread_id,status,ordinal,started_at) VALUES(?1,?2,'completed',?3,'2026-09-11T00:00:00Z')",params![turn,a,n])?;
            for (i,kind,text) in [(0,"userMessage",format!("question {n}")),(1,"agentMessage","progress".into()),(2,"commandExecution","secret-tool-output".repeat(20000)),(3,"agentMessage","字".repeat(10000)),(4,"agentMessage","final".into())] {
                let value=json!({"id":format!("item-{i}"),"kind":kind,"text":text,"createdAt":"2026-09-11T00:00:01Z","vendor":{"preserved":true}});
                c.execute("INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'2026-09-11T00:00:01Z','2026-09-11T00:00:02Z')",params![format!("{n}-{i}"),a,turn,format!("item-{i}"),value.to_string()])?;
            }
        } Ok(())
    }).unwrap();
    let latest = s.transcript(&a, &TranscriptQuery::default()).unwrap();
    assert_eq!(latest["turns"][0]["id"], "turn-3");
    assert_eq!(latest["turns"].as_array().unwrap().len(), 3);
    assert_eq!(latest["nextBeforeTurnId"], "turn-3");
    assert!(!latest.to_string().contains("secret-tool-output"));
    let items = latest["turns"][0]["items"].as_array().unwrap();
    assert_eq!(items.len(), 4);
    assert_eq!(items[1]["text"], "progress");
    assert_eq!(items[2]["truncated"], true);
    assert_eq!(items[3]["text"], "final");
    assert!(latest.to_string().len() < 30000);
    let early = s
        .transcript(
            &a,
            &TranscriptQuery {
                before_turn_id: Some("turn-3".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(early["turns"][0]["items"][0]["text"], "question 1");
    let expanded = s
        .transcript(
            &a,
            &TranscriptQuery {
                turn_id: Some("turn-3".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(expanded["turns"][0]["items"].as_array().unwrap().len(), 5);
    let mut offset = 0;
    let mut all = String::new();
    loop {
        let part = s
            .transcript(
                &a,
                &TranscriptQuery {
                    turn_id: Some("turn-3".into()),
                    item_id: Some("item-3".into()),
                    text_offset: Some(offset),
                    ..Default::default()
                },
            )
            .unwrap();
        all.push_str(part["text"].as_str().unwrap());
        match part["nextTextOffset"].as_u64() {
            Some(next) => offset = next as u32,
            None => break,
        }
    }
    assert_eq!(all, "字".repeat(10000));
    let raw = s
        .transcript(
            &a,
            &TranscriptQuery {
                turn_id: Some("turn-3".into()),
                item_id: Some("item-1".into()),
                raw: true,
                ..Default::default()
            },
        )
        .unwrap();
    let raw: Value = serde_json::from_str(raw["text"].as_str().unwrap()).unwrap();
    assert_eq!(raw["vendor"]["preserved"], true);
    assert!(s
        .transcript(
            &a,
            &TranscriptQuery {
                before_turn_id: Some("missing".into()),
                ..Default::default()
            }
        )
        .is_err());
}

#[tokio::test]
async fn cli_identity_is_rebound_when_a_loaded_session_changes_thread_context() {
    use remote_codex_runtime::{
        acp::AcpRuntime,
        actor::{AgentRuntime, SessionSettings, StartSessionInput},
    };
    let (dir, s) = setup();
    s.configure_cli("http://127.0.0.1:8787".into());
    let script = dir.path().join("agent.py");
    std::fs::write(&script,format!("import os,json\nwith open('cli-context.json','w') as f: json.dump({{'threadId':os.getenv('REMOTE_CODEX_THREAD_ID'),'hasToken':bool(os.getenv('REMOTE_CODEX_TOKEN'))}},f)\n{}",include_str!("fixtures/fake_acp_agent.py"))).unwrap();
    let python = which::which("python3")
        .or_else(|_| which::which("python"))
        .unwrap();
    let runtime = AcpRuntime::catalog(
        Some(format!("\"{}\" \"{}\"", python.display(), script.display())),
        5000,
    );
    let started = s
        .with_cli_context(
            "thread-a",
            runtime.start_session(StartSessionInput {
                cwd: dir.path().to_string_lossy().into(),
                agent_id: Some("custom".into()),
                model: "default".into(),
                reasoning_effort: None,
                approval_mode: "yolo".into(),
                sandbox_mode: Some("danger-full-access".into()),
            }),
        )
        .await
        .unwrap();
    let read = || {
        serde_json::from_str::<Value>(
            &std::fs::read_to_string(dir.path().join("cli-context.json")).unwrap(),
        )
        .unwrap()
    };
    assert_eq!(read()["threadId"], "thread-a");
    assert_eq!(read()["hasToken"], true);
    assert!(
        !s.with_cli_context("thread-b", async {
            runtime.session_loaded(&started.provider_session_id)
        })
        .await
    );
    s.with_cli_context(
        "thread-b",
        runtime.resume_session(
            &started.provider_session_id,
            Some(&dir.path().to_string_lossy()),
            SessionSettings::default(),
        ),
    )
    .await
    .unwrap();
    assert_eq!(read()["threadId"], "thread-b");
    assert!(
        s.with_cli_context("thread-b", async {
            runtime.session_loaded(&started.provider_session_id)
        })
        .await
    );
}

#[tokio::test]
async fn inbox_is_passive_bounded_durable_and_acknowledged_explicitly() {
    let (_dir, state) = setup();
    let a = thread(&state, Provider::Codex).await;
    let b = thread(&state, Provider::Acp).await;
    state.start_interaction_worker();
    let mut input = send(&a, &"你好".repeat(6000), false, "mail-1");
    input.delivery = "inbox".into();
    let receipt = state.send_to_thread(&b, input.clone()).unwrap();
    assert_eq!(state.send_to_thread(&b, input).unwrap(), receipt);
    assert!(state.pending_relay_notifications().unwrap().is_empty());
    assert!(receipt["pendingSteerId"].is_null());
    let id = receipt["messageId"].as_str().unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let status = state.interaction_status(&b).await.unwrap();
    assert_eq!(status["status"], "idle");
    assert_eq!(status["queuedCount"], 0);
    assert_eq!(status["unreadMessageCount"], 1);
    let list = state.inbox_list(&b, &json!({})).unwrap();
    assert!(list["messages"][0].get("text").is_none());
    assert_eq!(
        list["messages"][0]["preview"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        240
    );
    let read = state.inbox_read(&b, &json!({"messageId":id})).unwrap();
    assert_eq!(read["text"].as_str().unwrap().chars().count(), 8192);
    assert_eq!(read["nextTextOffset"], 8192);
    let tail = state
        .inbox_read(&b, &json!({"messageId":id,"textOffset":8192}))
        .unwrap();
    assert_eq!(tail["text"].as_str().unwrap().chars().count(), 3808);
    assert_eq!(state.inbox_unread_count(&b).unwrap(), 1);
    assert!(state.inbox_read(&a, &json!({"messageId":id})).is_err());
    assert!(state
        .inbox_ack(&b, &json!({"messageIds":[id,"missing"]}))
        .is_err());
    assert_eq!(state.inbox_unread_count(&b).unwrap(), 1);
    let db = rusqlite::Connection::open(&state.config.database_url).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM kv WHERE key GLOB 'cli:inbox:*'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    state.inbox_ack(&b, &json!({"messageIds":[id]})).unwrap();
    state.inbox_ack(&b, &json!({"messageIds":[id]})).unwrap();
    assert_eq!(state.inbox_unread_count(&b).unwrap(), 0);
    assert_eq!(
        state.inbox_list(&b, &json!({})).unwrap()["messages"],
        json!([])
    );
    assert_eq!(
        state.inbox_list(&b, &json!({"all":true})).unwrap()["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn completion_can_go_to_inbox_without_waking_the_sender() {
    let (_dir, state) = setup();
    let a = thread(&state, Provider::Codex).await;
    let b = thread(&state, Provider::Acp).await;
    let mut input = send(&a, "finish task", true, "finish");
    input.delivery = "direct".into();
    input.notify_delivery = "inbox".into();
    let receipt = state.send_to_thread(&b, input.clone()).unwrap();
    assert_eq!(receipt["delivery"], "queued");
    assert_eq!(receipt["requestedDelivery"], "direct");
    state.start_interaction_worker();
    until(|| state.inbox_unread_count(&a).unwrap() == 1).await;
    assert_eq!(state.send_to_thread(&b, input).unwrap(), receipt);
    let pending = state.pending_relay_notifications().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0]["threadId"], b);
    assert_eq!(state.pending_relay_notifications().unwrap(), pending);
    state
        .acknowledge_relay_notification(pending[0]["turnId"].as_str().unwrap())
        .unwrap();
    assert!(state.pending_relay_notifications().unwrap().is_empty());
    assert_eq!(
        state.interaction_status(&a).await.unwrap()["queuedCount"],
        0
    );
    assert_eq!(state.get_thread(&a).unwrap().status, "idle");
    let list = state.inbox_list(&a, &json!({})).unwrap();
    let id = &list["messages"][0]["id"];
    assert!(
        state.inbox_read(&a, &json!({"messageId":id})).unwrap()["text"]
            .as_str()
            .unwrap()
            .contains("ended with status completed")
    );
    let mut passive = send(&a, "cannot subscribe to a passive message", true, "invalid");
    passive.delivery = "inbox".into();
    assert!(state.send_to_thread(&b, passive).is_err());
    let mut steer = send(&a, "no active turn", false, "no-steer");
    steer.delivery = "steer".into();
    assert!(state.send_to_thread(&b, steer).is_err());
    assert_eq!(
        state.interaction_status(&b).await.unwrap()["queuedCount"],
        0
    );
}

#[tokio::test]
async fn explicit_steer_uses_active_turn_and_held_input_never_auto_runs() {
    let (_dir, state) = setup();
    let a = thread(&state, Provider::Codex).await;
    let b = thread(&state, Provider::Codex).await;
    state.start_interaction_worker();
    state
        .send_to_thread(&b, send(&a, "perform the original task", false, "task"))
        .unwrap();
    until(|| state.get_thread(&b).unwrap().status == "running").await;
    let turn = state.get_thread(&b).unwrap().active_turn_id.unwrap();
    let mut urgent = send(&a, "urgent correction", true, "urgent");
    urgent.delivery = "direct".into();
    urgent.notify_delivery = "inbox".into();
    let receipt = state.send_to_thread(&b, urgent.clone()).unwrap();
    assert_eq!(receipt["delivery"], "steer");
    state
        .steer_pending_prompt(&b, receipt["pendingSteerId"].as_str().unwrap())
        .await
        .unwrap();
    until(|| state.inbox_unread_count(&a).unwrap() == 1).await;
    assert_eq!(
        state.send_to_thread(&b, urgent).unwrap(),
        receipt,
        "retry remains valid after the active turn ends"
    );
    let transcript = state
        .transcript(
            &b,
            &TranscriptQuery {
                turn_id: Some(turn),
                view: Some("overview".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(transcript.to_string().contains("urgent correction"));
    state
        .send_to_thread(&b, send(&a, "second task", false, "task2"))
        .unwrap();
    until(|| state.get_thread(&b).unwrap().status == "running").await;
    let mut held = send(&a, "late steering request", false, "held");
    held.delivery = "direct".into();
    let receipt = state.send_to_thread(&b, held).unwrap();
    until(|| state.get_thread(&b).unwrap().status != "running").await;
    state
        .send_to_thread(&b, send(&a, "replacement task", false, "task3"))
        .unwrap();
    until(|| state.get_thread(&b).unwrap().status == "running").await;
    assert!(state
        .steer_pending_prompt(&b, receipt["pendingSteerId"].as_str().unwrap())
        .await
        .is_err());
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(
        state.interaction_status(&b).await.unwrap()["queuedCount"],
        1
    );
}

#[tokio::test]
async fn direct_rejects_unavailable_state_and_unsupported_steering_without_queueing() {
    let (_dir, state) = setup();
    let a = thread(&state, Provider::Codex).await;
    let b = thread(&state, Provider::Acp).await;
    // Use the real ACP capability fallback before a steering extension has
    // been negotiated; the fake runtime advertises steering for every provider.
    let state = Arc::try_unwrap(state).ok().unwrap();
    let state = Supervisor::new(
        state.config,
        state.db,
        vec![Arc::new(remote_codex_runtime::acp::AcpRuntime::catalog(
            None, 1000,
        ))],
    );
    let mut input = send(&a, "act now", false, "direct-rejected");
    input.delivery = "direct".into();
    for status in ["recovering", "interrupted", "failed", "running"] {
        state
            .db
            .with(|c| {
                c.execute(
                    "UPDATE threads SET status=?1 WHERE id=?2",
                    params![status, b],
                )?;
                if status == "running" {
                    c.execute("INSERT INTO thread_turns(id,thread_id,status,started_at,ordinal) VALUES ('active',?1,'inProgress','2026-09-11',1)", [&b])?;
                }
                Ok(())
            })
            .unwrap();
        let error = state.send_to_thread(&b, input.clone()).unwrap_err();
        assert!(error.to_string().contains(if status == "running" {
            "does not support steering"
        } else {
            "direct requires an idle or running thread"
        }));
        assert_eq!(
            state.interaction_status(&b).await.unwrap()["queuedCount"],
            0
        );
    }
}
