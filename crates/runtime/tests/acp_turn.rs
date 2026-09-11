use std::collections::HashSet;
use std::time::{Duration, Instant};

use remote_codex_runtime::acp::AcpRuntime;
use remote_codex_runtime::actor::{AgentRuntime, EventBus, StartSessionInput, StartTurnInput};
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn live_prompt_streams_tools_and_waits_for_agent() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;

    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();
    let started = Instant::now();
    let items = runtime
        .start_turn(turn_input(&session_id, "hello", "turn-1"), bus, cancel)
        .await
        .expect("complete ACP turn");
    assert!(
        started.elapsed() >= Duration::from_millis(1400),
        "session/prompt should wait for a long-running agent, not a 180s-or-shorter RPC cutoff"
    );

    let mut received = Vec::new();
    while let Ok(event) = events.try_recv() {
        received.push(event);
    }
    let types: Vec<_> = received
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert!(
        types.contains(&"thread.item.started"),
        "live tool/thought items should be broadcast during ACP execution, got {types:?}"
    );
    assert!(
        types.iter().position(|ty| *ty == "thread.item.started")
            < types.iter().position(|ty| *ty == "thread.turn.completed"),
        "tool calls must appear before the turn completes, got {types:?}"
    );
    assert!(received.iter().any(|event| {
        event.event_type == "thread.item.started"
            && event.payload["item"]["kind"] == "commandExecution"
    }));
    assert!(received.iter().any(|event| {
        event.event_type == "thread.item.started" && event.payload["item"]["kind"] == "reasoning"
    }));
    assert!(items
        .iter()
        .any(|item| item.kind == "agentMessage" && item.text == "done"));
    assert!(items.iter().any(|item| item.kind == "commandExecution"));
    assert!(items.iter().all(|item| item.text != "(no output)"));
}

#[tokio::test]
async fn interleaved_text_and_tools_keep_provider_order() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();
    let mut events = bus.subscribe();

    let items = runtime
        .start_turn(
            turn_input(&session_id, "interleaved-order", "ordered-turn"),
            bus,
            CancellationToken::new(),
        )
        .await
        .expect("complete interleaved ACP turn");

    assert_eq!(
        items
            .iter()
            .map(|item| (item.kind.as_str(), item.text.as_str(), item.sequence))
            .collect::<Vec<_>>(),
        vec![
            ("agentMessage", "Before tools.", Some(1)),
            ("commandExecution", "first command", Some(2)),
            ("reasoning", "Checking the result.", Some(3)),
            ("commandExecution", "second command", Some(4)),
            ("agentMessage", "After tools.", Some(5)),
        ]
    );

    let mut streamed = Vec::new();
    let mut seen_sequences = HashSet::new();
    while let Ok(event) = events.try_recv() {
        let streamed_item = match event.event_type.as_str() {
            "thread.output.delta" => Some((
                "agentMessage".to_string(),
                event.payload["delta"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                event.payload["sequence"].as_i64(),
            )),
            "thread.item.started" | "thread.item.completed" => Some((
                event.payload["item"]["kind"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                event.payload["item"]["text"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                event.payload["item"]["sequence"].as_i64(),
            )),
            _ => None,
        };
        if let Some(streamed_item) = streamed_item {
            if streamed_item
                .2
                .is_some_and(|sequence| seen_sequences.insert(sequence))
            {
                streamed.push(streamed_item);
            }
        }
    }
    assert_eq!(
        streamed,
        vec![
            ("agentMessage".into(), "Before tools.".into(), Some(1)),
            ("commandExecution".into(), "first command".into(), Some(2)),
            ("reasoning".into(), "Checking the result.".into(), Some(3)),
            ("commandExecution".into(), "second command".into(), Some(4)),
            ("agentMessage".into(), "After tools.".into(), Some(5)),
        ]
    );
}

#[tokio::test]
async fn prompt_preparation_failure_does_not_leave_an_active_turn() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();

    let error = runtime
        .start_turn(
            turn_input(&session_id, "[PHOTO ../outside.png]", "bad-turn"),
            bus.clone(),
            CancellationToken::new(),
        )
        .await
        .expect_err("attachment path outside the workspace must fail");
    assert!(
        error.to_string().contains("outside the workspace"),
        "{error:#}"
    );

    let items = tokio::time::timeout(
        Duration::from_secs(2),
        runtime.start_turn(
            turn_input(&session_id, "quick-success", "retry-turn"),
            bus,
            CancellationToken::new(),
        ),
    )
    .await
    .expect("retry should not hang behind stale active state")
    .expect("retry after preparation failure should succeed");
    assert!(items
        .iter()
        .any(|item| item.kind == "agentMessage" && item.text == "done"));
}

#[tokio::test]
async fn prompt_rpc_error_is_failed_and_clears_active_state() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();

    let error = runtime
        .start_turn(
            turn_input(&session_id, "rpc-error", "failed-turn"),
            bus.clone(),
            cancel.clone(),
        )
        .await
        .expect_err("JSON-RPC error should fail the turn");
    assert!(format!("{error:#}").contains("forced prompt failure"));
    assert!(
        !cancel.is_cancelled(),
        "provider failure is not user cancellation"
    );
    let completed = completed_event(&mut events);
    assert_eq!(completed.payload["status"], "failed");
    assert!(completed.payload["error"]
        .as_str()
        .unwrap_or_default()
        .contains("forced prompt failure"));

    tokio::time::timeout(
        Duration::from_secs(2),
        runtime.start_turn(
            turn_input(&session_id, "quick-success", "recovery-turn"),
            bus,
            CancellationToken::new(),
        ),
    )
    .await
    .expect("recovery turn should not hang")
    .expect("RPC failure must clear active state");
}

#[tokio::test]
async fn user_cancellation_is_interrupted_not_failed() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();
    let cancel_trigger = {
        let cancel = cancel.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(80)).await;
            cancel.cancel();
        }
    };

    let (result, ()) = tokio::join!(
        runtime.start_turn(
            turn_input(&session_id, "slow-cancel", "cancelled-turn"),
            bus,
            cancel.clone(),
        ),
        cancel_trigger,
    );
    let items = result.expect("user cancellation should return interrupted items");
    assert!(items
        .iter()
        .all(|item| { matches!(item.status.as_deref(), Some("interrupted" | "failed")) }));
    let completed = completed_event(&mut events);
    assert_eq!(completed.payload["status"], "interrupted");
    assert!(completed.payload["error"].is_null());
}

#[tokio::test]
async fn cancelled_prompt_response_is_interrupted() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();

    runtime
        .start_turn(
            turn_input(&session_id, "cancelled-response", "agent-cancelled-turn"),
            bus,
            cancel.clone(),
        )
        .await
        .expect("cancelled stop reason is not a provider failure");
    assert!(cancel.is_cancelled());
    let completed = completed_event(&mut events);
    assert_eq!(completed.payload["status"], "interrupted");
}

#[tokio::test]
async fn process_exit_fails_the_active_turn() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &python).await;
    let bus = EventBus::new();
    let mut events = bus.subscribe();

    let error = tokio::time::timeout(
        Duration::from_secs(2),
        runtime.start_turn(
            turn_input(&session_id, "exit-before-response", "exit-turn"),
            bus,
            CancellationToken::new(),
        ),
    )
    .await
    .expect("process exit must settle an unbounded prompt RPC")
    .expect_err("process exit should fail the turn");
    assert!(
        error.to_string().contains("stdout closed") || error.to_string().contains("process exited"),
        "{error:#}"
    );
    let completed = completed_event(&mut events);
    assert_eq!(completed.payload["status"], "failed");
    assert!(!completed.payload["error"].is_null());
}

#[tokio::test]
async fn fast_mode_is_applied_and_an_unsupported_request_is_rejected() {
    let python = which_python();
    let supported_dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(supported_dir.path(), &python).await;
    assert!(
        runtime
            .negotiated_caps(Some("custom"))
            .controls
            .performance_mode
    );
    let mut input = turn_input(&session_id, "check-fast", "fast-turn");
    input.performance_mode = Some(true);
    let items = runtime
        .start_turn(input, EventBus::new(), CancellationToken::new())
        .await
        .expect("fast mode config should be applied");
    assert!(items
        .iter()
        .any(|item| item.kind == "agentMessage" && item.text == "fast=true"));

    let unsupported_dir = tempdir().unwrap();
    let (unsupported, session_id) =
        start_runtime_with_args(unsupported_dir.path(), &python, "--no-fast").await;
    let mut input = turn_input(&session_id, "check-fast", "unsupported-fast-turn");
    input.performance_mode = Some(true);
    let error = unsupported
        .start_turn(input, EventBus::new(), CancellationToken::new())
        .await
        .expect_err("fast mode must not be silently stored for unsupported agents");
    assert!(
        error.to_string().contains("does not expose fast mode"),
        "{error:#}"
    );
}

#[tokio::test]
async fn steering_is_acknowledged_and_processed_before_the_active_turn_finishes() {
    let dir = tempdir().unwrap();
    let (runtime, session_id) = start_runtime(dir.path(), &which_python()).await;
    let runtime = std::sync::Arc::new(runtime);
    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let task = {
        let runtime = runtime.clone();
        let session_id = session_id.clone();
        tokio::spawn(async move {
            runtime
                .start_turn(
                    turn_input(&session_id, "wait-for-steer", "steered-turn"),
                    bus,
                    CancellationToken::new(),
                )
                .await
        })
    };
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if event.event_type == "thread.output.delta" {
                break;
            }
        }
    })
    .await
    .expect("agent is waiting within the original prompt");
    assert!(!task.is_finished());
    assert!(runtime
        .send_input(&session_id, "wrong-turn", "hello")
        .await
        .is_err());
    for prompt in ["reject-steer", "fail-steer", "unknown-steer"] {
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            runtime.send_input(&session_id, "steered-turn", prompt),
        )
        .await
        .expect("steering response must not wait for turn completion");
        assert!(result.is_err(), "must not report accepted for {prompt}");
        assert!(
            !task.is_finished(),
            "failed steering must not end the active turn"
        );
    }
    tokio::time::timeout(
        Duration::from_secs(2),
        runtime.send_input(&session_id, "steered-turn", "change direction"),
    )
    .await
    .expect("steering must receive its own acknowledgement")
    .unwrap();
    let items = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("steering unblocks the original prompt")
        .unwrap()
        .unwrap();
    assert!(items
        .iter()
        .any(|item| item.text.contains("handled steer: change direction")));
}

#[tokio::test]
async fn restored_session_applies_advertised_effort_and_recovers_after_settings_failure() {
    let dir = tempdir().unwrap();
    let python = which_python();
    let (_original, session_id) = start_runtime(dir.path(), &python).await;
    // A fresh runtime has no in-memory session/settings cache, as after restart.
    let command = format!(
        r#"{python} "{}""#,
        dir.path().join("fake_acp_agent.py").display()
    );
    let restored = AcpRuntime::catalog(Some(command), 5_000);
    restored.start().await.unwrap();
    assert!(!restored.session_loaded(&session_id));
    restored
        .resume_session(&session_id, dir.path().to_str(), Default::default())
        .await
        .unwrap();
    for (turn_id, effort) in [("after-restart", "high"), ("retry", "medium")] {
        let mut input = turn_input(&session_id, "report-effort", turn_id);
        input.reasoning_effort = Some(effort.into());
        let items = restored
            .start_turn(input, EventBus::new(), CancellationToken::new())
            .await
            .expect("restored session must accept follow-up prompts");
        assert!(items
            .iter()
            .any(|item| item.text == format!("effort={effort}")));
        let mut invalid = turn_input(&session_id, "report-effort", "invalid-setting");
        invalid.reasoning_effort = Some("unsupported-effort".into());
        assert!(restored
            .start_turn(invalid, EventBus::new(), CancellationToken::new())
            .await
            .is_err());
    }
}

#[tokio::test]
async fn unadvertised_reasoning_does_not_block_creation_turns_or_resume() {
    for args in ["--no-config", "--no-fast"] {
        let dir = tempdir().unwrap();
        let python = which_python();
        let (runtime, _) = start_runtime_with_args(dir.path(), &python, args).await;
        let session = runtime
            .start_session(StartSessionInput {
                cwd: dir.path().to_string_lossy().into_owned(),
                agent_id: Some("custom".into()),
                model: "default".into(),
                reasoning_effort: Some("medium".into()),
                approval_mode: "guarded".into(),
                sandbox_mode: None,
            })
            .await
            .expect("UI default effort must not require an unadvertised config method");
        assert_eq!(session.reasoning_effort, None);
        let command = format!(
            r#"{python} "{}" {args}"#,
            dir.path().join("fake_acp_agent.py").display()
        );
        let restored = AcpRuntime::catalog(Some(command), 5_000);
        restored.start().await.unwrap();
        restored
            .resume_session(
                &session.provider_session_id,
                dir.path().to_str(),
                remote_codex_runtime::actor::SessionSettings {
                    effort: Some("medium".into()),
                    ..Default::default()
                },
            )
            .await
            .expect("persisted default effort must not block session/load");
        for (runtime, turn_id) in [(&runtime, "first"), (&restored, "restored")] {
            let mut input = turn_input(&session.provider_session_id, "report-effort", turn_id);
            input.reasoning_effort = Some("high".into());
            let items = runtime
                .start_turn(input, EventBus::new(), CancellationToken::new())
                .await
                .expect("follow-up must not send unadvertised reasoning settings");
            assert!(items.iter().any(|item| item.text == "effort=medium"));
        }
        assert!(!dir.path().join("unexpected-config.json").exists());
    }
}

#[tokio::test]
#[ignore = "requires installed Gemini CLI and configured authentication; sends real prompts"]
async fn installed_gemini_creates_and_follows_up_with_default_effort() {
    let dir = tempdir().unwrap();
    let runtime = AcpRuntime::catalog(None, 30_000);
    runtime.start().await.unwrap();
    let mut input = StartSessionInput {
        cwd: dir.path().to_string_lossy().into_owned(),
        agent_id: Some("gemini".into()),
        model: "default".into(),
        reasoning_effort: Some("medium".into()),
        approval_mode: "guarded".into(),
        sandbox_mode: None,
    };
    let default_session = runtime.start_session(input.clone()).await.unwrap();
    assert_eq!(default_session.reasoning_effort, None);
    let models = runtime
        .list_models(Some("gemini"), dir.path().to_str())
        .await
        .unwrap();
    assert!(!models.is_empty());
    assert!(models
        .iter()
        .all(|model| model.supported_reasoning_efforts.is_empty()));
    input.model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| default_session.model.unwrap());
    let session = runtime.start_session(input).await.unwrap();
    for turn_id in ["first", "follow-up"] {
        let mut turn = turn_input(
            &session.provider_session_id,
            "Reply exactly GEMINI_ACP_OK. Do not use tools.",
            turn_id,
        );
        turn.model = session.model.clone();
        turn.reasoning_effort = Some("medium".into());
        let items = tokio::time::timeout(
            Duration::from_secs(90),
            runtime.start_turn(turn, EventBus::new(), CancellationToken::new()),
        )
        .await
        .expect("Gemini prompt timeout")
        .expect("Gemini prompt succeeds");
        assert!(items
            .iter()
            .any(|item| item.kind == "agentMessage" && item.text.contains("GEMINI_ACP_OK")));
        eprintln!("Gemini {turn_id}: GEMINI_ACP_OK");
    }
}

async fn start_runtime(dir: &std::path::Path, python: &str) -> (AcpRuntime, String) {
    start_runtime_with_args(dir, python, "").await
}

async fn start_runtime_with_args(
    dir: &std::path::Path,
    python: &str,
    args: &str,
) -> (AcpRuntime, String) {
    let script = dir.join("fake_acp_agent.py");
    std::fs::write(&script, include_str!("fixtures/fake_acp_agent.py")).unwrap();
    let command = format!(r#"{python} "{}" {args}"#, script.display());
    let runtime = AcpRuntime::catalog(Some(command), 5_000);
    runtime.start().await.unwrap();
    let session = runtime
        .start_session(StartSessionInput {
            cwd: dir.to_string_lossy().into_owned(),
            agent_id: Some("custom".into()),
            model: "default".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            sandbox_mode: Some("danger-full-access".into()),
        })
        .await
        .expect("start custom ACP session");
    (runtime, session.provider_session_id)
}

fn turn_input(session_id: &str, prompt: &str, turn_id: &str) -> StartTurnInput {
    StartTurnInput {
        provider_session_id: session_id.into(),
        prompt: prompt.into(),
        model: None,
        reasoning_effort: None,
        sandbox_mode: None,
        collaboration_mode: None,
        approval_mode: None,
        performance_mode: None,
        thread_id: "thread-1".into(),
        turn_id: turn_id.into(),
        hidden: false,
        images: Vec::new(),
    }
}

fn completed_event(
    events: &mut tokio::sync::broadcast::Receiver<remote_codex_protocol::ThreadEventEnvelope>,
) -> remote_codex_protocol::ThreadEventEnvelope {
    let mut completed = None;
    while let Ok(event) = events.try_recv() {
        if event.event_type == "thread.turn.completed" {
            completed = Some(event);
        }
    }
    completed.expect("turn should emit a completion event")
}

fn which_python() -> String {
    for candidate in ["python3", "python"] {
        if std::process::Command::new(candidate)
            .arg("-c")
            .arg("import sys; sys.exit(0)")
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return candidate.to_string();
        }
    }
    panic!("python3 is required for ACP turn tests");
}

#[tokio::test]
async fn native_and_acp_questions_preserve_all_answers() {
    for prompt in ["ask-native-questions", "ask-acp-questions"] {
        let dir = tempdir().unwrap();
        let (runtime, session) = start_runtime(dir.path(), &which_python()).await;
        let runtime = std::sync::Arc::new(runtime);
        let bus = EventBus::new();
        let mut events = bus.subscribe();
        let runner = runtime.clone();
        let input = turn_input(&session, prompt, "question-turn");
        let task = tokio::spawn(async move {
            runner
                .start_turn(input, bus, CancellationToken::new())
                .await
        });
        let request = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let event = events.recv().await.unwrap();
                if event.event_type == "thread.request.created" {
                    break event.payload["request"].clone();
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(request["kind"], "requestUserInput");
        assert_eq!(request["questions"].as_array().unwrap().len(), 2);
        let id = request["id"].as_str().unwrap();
        assert!(runtime
            .respond_permission(id, true, Some(r#"{"choice":{"answers":["C"]}}"#))
            .await
            .is_err());
        assert_eq!(runtime.pending_requests("thread-1").await.len(), 1);
        runtime
            .respond_permission(
                id,
                true,
                Some(r#"{"choice":{"answers":["C"]},"detail":{"answers":["because"]}}"#),
            )
            .await
            .unwrap();
        let items = tokio::time::timeout(Duration::from_secs(10), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let text = items
            .iter()
            .find(|item| item.text.starts_with("ANSWERS="))
            .unwrap()
            .text
            .strip_prefix("ANSWERS=")
            .unwrap();
        let answer: serde_json::Value = serde_json::from_str(text).unwrap();
        let expected = if prompt == "ask-native-questions" {
            serde_json::json!({"answers":{"choice":{"answers":["C"]},"detail":{"answers":["because"]}}})
        } else {
            serde_json::json!({"action":"accept","content":{"choice_other":"C","detail":"because"}})
        };
        assert_eq!(answer, expected);
        assert!(runtime.pending_requests("thread-1").await.is_empty());
    }
}

#[tokio::test]
async fn cancelled_question_turn_clears_pending_card() {
    let dir = tempdir().unwrap();
    let (runtime, session) = start_runtime(dir.path(), &which_python()).await;
    let runtime = std::sync::Arc::new(runtime);
    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();
    let runner = runtime.clone();
    let trigger = cancel.clone();
    let task = tokio::spawn(async move {
        runner
            .start_turn(
                turn_input(&session, "ask-acp-questions", "cancel-question"),
                bus,
                cancel,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if events.recv().await.unwrap().event_type == "thread.request.created" {
                break;
            }
        }
    })
    .await
    .unwrap();
    trigger.cancel();
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while !runtime.pending_requests("thread-1").await.is_empty() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn commands_before_session_response_survive_and_dynamic_updates_replace_them() {
    let dir = tempdir().unwrap();
    let (runtime, session) = start_runtime(dir.path(), &which_python()).await;
    let commands = |snapshot: remote_codex_protocol::AgentCapabilitySnapshotDto| {
        snapshot
            .toolbox_items
            .into_iter()
            .map(|i| i.command)
            .collect::<Vec<_>>()
    };
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if commands(
                runtime
                    .session_capabilities(Some("custom"), &session)
                    .await
                    .unwrap(),
            )
            .contains(&"/status".into())
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    runtime
        .start_turn(
            turn_input(&session, "replace-commands", "commands-turn"),
            EventBus::new(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let result = commands(
        runtime
            .session_capabilities(Some("custom"), &session)
            .await
            .unwrap(),
    );
    assert!(result.contains(&"/review".into()));
    assert!(
        !result.contains(&"/status".into()),
        "the new list replaces obsolete commands"
    );
    assert!(
        !commands(runtime.capabilities(Some("custom")).await.unwrap()).contains(&"/review".into()),
        "session commands must not leak to agent-wide defaults"
    );
}

#[tokio::test]
async fn restarting_harness_reloads_config_and_preserves_resumable_session() {
    let dir = tempdir().unwrap();
    std::fs::write(dir.path().join("restart-config.txt"), "before").unwrap();
    let (runtime, session) = start_runtime(dir.path(), &which_python()).await;
    let first = runtime
        .start_turn(
            turn_input(&session, "read-startup-config", "a"),
            EventBus::new(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(first.iter().any(|item| item.text == "before"));
    std::fs::write(dir.path().join("restart-config.txt"), "after").unwrap();
    assert_eq!(runtime.restart("custom").await.unwrap(), 1);
    assert!(!runtime.session_loaded(&session));
    runtime
        .resume_session(&session, dir.path().to_str(), Default::default())
        .await
        .unwrap();
    let second = runtime
        .start_turn(
            turn_input(&session, "read-startup-config", "b"),
            EventBus::new(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(second.iter().any(|item| item.text == "after"));
}

#[tokio::test]
async fn slow_goal_control_does_not_block_session_reads_and_recovers_after_timeout() {
    let dir = tempdir().unwrap();
    let (runtime, session) = start_runtime(dir.path(), &which_python()).await;
    let runtime = std::sync::Arc::new(runtime);
    let pending = {
        let runtime = runtime.clone();
        let session = session.clone();
        tokio::spawn(async move {
            runtime
                .set_goal(&session, Some("stalled-goal".into()), None)
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    tokio::time::timeout(Duration::from_millis(300), runtime.get_goal(&session))
        .await
        .expect("goal RPC must not lock all sessions")
        .unwrap();
    let error = pending.await.unwrap().unwrap_err().to_string();
    assert!(error.contains("timed out"), "{error}");
    assert!(runtime
        .set_goal(&session, Some("working goal".into()), None)
        .await
        .unwrap()
        .is_some());
    runtime
        .start_turn(
            turn_input(&session, "hello", "after-goal"),
            EventBus::new(),
            CancellationToken::new(),
        )
        .await
        .expect("session still usable after a stalled extension");
}
