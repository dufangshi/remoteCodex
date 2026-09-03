use std::time::{Duration, Instant};

use remote_codex_runtime::acp::AcpRuntime;
use remote_codex_runtime::actor::{AgentRuntime, EventBus, StartSessionInput, StartTurnInput};
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn live_prompt_streams_tools_and_waits_for_agent() {
    let python = which_python();
    let dir = tempdir().unwrap();
    let script = dir.path().join("fake_acp_agent.py");
    std::fs::write(&script, include_str!("fixtures/fake_acp_agent.py")).unwrap();
    let command = format!("{python} {}", script.display());
    let runtime = AcpRuntime::catalog(Some(command), 5_000);
    runtime.start().await.unwrap();
    let session = runtime
        .start_session(StartSessionInput {
            cwd: dir.path().to_string_lossy().into_owned(),
            agent_id: Some("custom".into()),
            model: "default".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            sandbox_mode: Some("danger-full-access".into()),
        })
        .await
        .expect("start custom ACP session");

    let bus = EventBus::new();
    let mut events = bus.subscribe();
    let cancel = CancellationToken::new();
    let started = Instant::now();
    let items = runtime
        .start_turn(
            StartTurnInput {
                provider_session_id: session.provider_session_id,
                prompt: "hello".into(),
                model: None,
                reasoning_effort: None,
                sandbox_mode: None,
                collaboration_mode: None,
                approval_mode: None,
                thread_id: "thread-1".into(),
                turn_id: "turn-1".into(),
                hidden: false,
                images: Vec::new(),
            },
            bus,
            cancel,
        )
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
