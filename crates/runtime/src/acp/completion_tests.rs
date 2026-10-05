use super::*;

#[tokio::test]
async fn claude_incomplete_tool_reconciles_only_abandoned_streams() {
    // Isolate provider homes in a subprocess rather than changing process-wide
    // environment while other Rust tests are running.
    let dir = tempfile::tempdir().unwrap();
    if std::env::var("REMOTE_CODEX_COMPLETION_TEST_CHILD").is_err() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "acp::runtime::completion_tests::claude_incomplete_tool_reconciles_only_abandoned_streams", "--nocapture"])
            .env("REMOTE_CODEX_COMPLETION_TEST_CHILD", "1")
            .env("CLAUDE_CONFIG_DIR", dir.path())
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let script = dir.path().join("agent.py");
    std::fs::write(
        &script,
        include_str!("../../tests/fixtures/claude_completion_agent.py"),
    )
    .unwrap();
    let python = which::which("python3").unwrap();
    let command = shell_words::join([python.to_str().unwrap(), script.to_str().unwrap()]);
    let def = AcpAgentDef {
        id: "claude".into(),
        display_name: "Completion fixture".into(),
        description: String::new(),
        transport: "native".into(),
        base_command: command.clone(),
        server_command: command,
        install_command: None,
        model_list_command: None,
    };
    let runtime = AcpRuntime::bound(Provider::Acp, "claude", 5_000);
    for scenario in ["abandoned", "real", "missing"] {
        let (session, live) = runtime
            .spawn_session(
                &def,
                dir.path().to_str().unwrap(),
                ProductSessionPolicy::default(),
                None,
                None,
            )
            .await
            .unwrap();
        let cleanup = StartupProcess(Some(live.process.clone()));
        runtime
            .inner
            .sessions
            .lock()
            .await
            .insert(session.clone(), live);
        let bus = EventBus::new();
        let mut events = bus.subscribe();
        let result = runtime
            .start_turn(
                StartTurnInput {
                    provider_session_id: session.clone(),
                    prompt: scenario.into(),
                    model: None,
                    reasoning_effort: None,
                    sandbox_mode: None,
                    collaboration_mode: None,
                    approval_mode: None,
                    performance_mode: None,
                    thread_id: "fixture".into(),
                    turn_id: scenario.into(),
                    hidden: false,
                    images: Vec::new(),
                },
                bus,
                CancellationToken::new(),
            )
            .await;
        let mut completed = None;
        while let Ok(event) = events.try_recv() {
            if event.event_type == "thread.turn.completed" {
                completed = Some(event);
            }
        }
        let completed = completed.unwrap();
        if scenario == "abandoned" {
            let items = result.unwrap();
            assert_eq!(completed.payload["status"], "completed");
            assert!(completed.payload["error"].is_null());
            assert!(items
                .iter()
                .any(|item| item.id == "toolu_orphan"
                    && item.status.as_deref() == Some("interrupted")));
            assert!(items.iter().any(|item| item.kind == "agentMessage"
                && item.text == "done"
                && item.status.as_deref() == Some("completed")));
        } else {
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("incomplete_tool_call"));
            assert_eq!(completed.payload["status"], "failed");
        }
        assert!(runtime
            .inner
            .sessions
            .lock()
            .await
            .get(&session)
            .unwrap()
            .active
            .is_none());
        drop(cleanup);
    }
}
