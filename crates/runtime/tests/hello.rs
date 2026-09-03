use std::sync::Arc;

use remote_codex_protocol::{
    CreateThreadInput, CreateWorkspaceInput, Provider, SendThreadPromptInput,
};
use remote_codex_runtime::actor::{AgentRuntime, SharedRuntime};
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::{Supervisor, UploadedPromptAttachment};
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

#[tokio::test]
async fn workspace_and_hello_turn() {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    std::fs::write(ws_path.join("README.md"), "# hi\n").unwrap();
    let config = test_config(dir.path());
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
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
            workspace_id: workspace.id,
            title: Some("t1".into()),
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    assert_eq!(thread.sandbox_mode.as_deref(), Some("danger-full-access"));
    let attachment_prompt = supervisor
        .prepare_prompt_attachments(
            &thread.id,
            "Describe [PHOTO image.png]",
            vec![UploadedPromptAttachment {
                kind: "photo".into(),
                original_name: "image.png".into(),
                placeholder: "[PHOTO image.png]".into(),
                bytes: b"png".to_vec(),
            }],
        )
        .unwrap();
    assert!(attachment_prompt.starts_with(&format!(
        "Describe [PHOTO ./.temp/threads/{}/image-",
        thread.id
    )));
    assert!(attachment_prompt.ends_with(".png]"));
    assert!(!attachment_prompt.contains("[PHOTO [PHOTO"));
    supervisor
        .prompt(
            &thread.id,
            SendThreadPromptInput {
                prompt: "hello, reply me with hello".into(),
                client_request_id: None,
                model: None,
                reasoning_effort: None,
                collaboration_mode: None,
                images: vec![],
            },
        )
        .await
        .unwrap();
    let detail = supervisor
        .get_thread_detail(&thread.id, None)
        .await
        .unwrap();
    let texts: Vec<_> = detail
        .turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .map(|item| item.text.clone())
        .collect();
    assert!(texts.iter().any(|text| text == "hello"), "{texts:?}");
    assert_eq!(detail.thread.status, "idle");
}

#[tokio::test]
async fn path_escape_rejected() {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    let config = test_config(dir.path());
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Supervisor::new(config, db, vec![runtime]);
    let workspace = supervisor
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some(ws_path.to_string_lossy().into()),
            git_url: None,
            label: Some("proj".into()),
        })
        .unwrap();
    let err = supervisor
        .workspace_preview(&workspace.id, "../secret")
        .unwrap_err();
    assert!(err.to_string().contains("outside"));
}

#[tokio::test]
async fn codex_fake_has_compact_not_fork() {
    let runtime = FakeRuntime::new(Provider::Codex);
    let caps = runtime.negotiated_caps(Some("codex"));
    assert!(caps.turns.compact);
    assert!(!caps.branching.fork);
    assert!(!caps.management.mcp_status);
    assert!(!caps.management.skills);
    let commands: Vec<_> = runtime
        .toolbox(Some("codex"))
        .into_iter()
        .map(|item| item.command)
        .collect();
    assert!(commands.contains(&"/compact".to_string()));
    assert!(!commands.contains(&"/fork".to_string()));
}

#[tokio::test]
async fn claude_fake_has_fork_not_compact() {
    let runtime = FakeRuntime::new(Provider::Claude);
    let caps = runtime.negotiated_caps(Some("claude"));
    assert!(caps.branching.fork);
    assert!(!caps.turns.compact);
    let commands: Vec<_> = runtime
        .toolbox(Some("claude"))
        .into_iter()
        .map(|item| item.command)
        .collect();
    assert!(commands.contains(&"/fork".to_string()));
    assert!(!commands.contains(&"/compact".to_string()));
}

#[tokio::test]
async fn claude_fork_copies_history() {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    let mut config = test_config(dir.path());
    config.enabled_providers = vec![Provider::Claude];
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Claude));
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
            workspace_id: workspace.id,
            title: Some("t1".into()),
            provider: Some(Provider::Claude),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    supervisor
        .prompt(
            &thread.id,
            SendThreadPromptInput {
                prompt: "hello, reply me with hello".into(),
                client_request_id: None,
                model: None,
                reasoning_effort: None,
                collaboration_mode: None,
                images: vec![],
            },
        )
        .await
        .unwrap();
    let forked = supervisor.fork_thread(&thread.id).await.unwrap();
    let detail = supervisor
        .get_thread_detail(&forked.id, None)
        .await
        .unwrap();
    assert!(detail
        .turns
        .iter()
        .any(|turn| { turn.items.iter().any(|item| item.text == "hello") }));
}

#[tokio::test]
async fn codex_fork_is_rejected() {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    let config = test_config(dir.path());
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
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
            workspace_id: workspace.id,
            title: Some("t1".into()),
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    let err = supervisor.fork_thread(&thread.id).await.unwrap_err();
    assert!(err.to_string().contains("fork"));
}

#[tokio::test]
async fn codex_compact_succeeds() {
    let dir = tempdir().unwrap();
    let ws_path = dir.path().join("proj");
    std::fs::create_dir_all(&ws_path).unwrap();
    let config = test_config(dir.path());
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
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
            workspace_id: workspace.id,
            title: Some("t1".into()),
            provider: Some(Provider::Codex),
            agent_id: None,
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
        })
        .await
        .unwrap();
    supervisor
        .compact_thread(&thread.id)
        .await
        .expect("codex compact");
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

#[tokio::test]
async fn file_browser_tree_preview_write_and_move() {
    let (_dir, supervisor, workspace, _thread) = seeded_thread(Provider::Codex).await;
    let tree = supervisor.workspace_tree(&workspace.id, ".").unwrap();
    assert!(tree.iter().any(|node| node.name == "README.md"));
    let preview = supervisor
        .workspace_preview(&workspace.id, "README.md")
        .unwrap();
    assert!(preview.content.contains("# hi"));
    supervisor
        .workspace_write(&workspace.id, "src/hello.txt", "alpha")
        .unwrap();
    let written = supervisor
        .workspace_preview(&workspace.id, "src/hello.txt")
        .unwrap();
    assert_eq!(written.content, "alpha");
    let ws = supervisor.get_workspace(&workspace.id).unwrap();
    let from = std::path::Path::new(&ws.abs_path).join("src/hello.txt");
    let to = std::path::Path::new(&ws.abs_path).join("src/moved.txt");
    std::fs::rename(from, to).unwrap();
    let moved = supervisor
        .workspace_preview(&workspace.id, "src/moved.txt")
        .unwrap();
    assert_eq!(moved.content, "alpha");
}

#[tokio::test]
async fn long_turn_can_be_interrupted() {
    let (_dir, supervisor, _workspace, thread) = seeded_thread(Provider::Codex).await;
    let supervisor = Arc::new(supervisor);
    let id = thread.id.clone();
    let run = {
        let supervisor = supervisor.clone();
        let id = id.clone();
        tokio::spawn(async move {
            supervisor
                .prompt(
                    &id,
                    prompt_input("Inspect this repository in depth and write a detailed report."),
                )
                .await
        })
    };
    for _ in 0..50 {
        if supervisor.get_thread(&thread.id).unwrap().status == "running" {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    let detail = supervisor.interrupt(&thread.id).await.unwrap();
    assert_ne!(detail.thread.status, "running");
    let _ = run.await;
}

#[tokio::test]
async fn fake_providers_all_complete_a_hello_turn() {
    for provider in [
        Provider::Codex,
        Provider::Claude,
        Provider::Opencode,
        Provider::Acp,
    ] {
        let (_dir, supervisor, _workspace, thread) = seeded_thread(provider).await;
        supervisor
            .prompt(&thread.id, prompt_input("hello, reply me with hello"))
            .await
            .unwrap();
        let detail = supervisor
            .get_thread_detail(&thread.id, None)
            .await
            .unwrap();
        let texts: Vec<_> = detail
            .turns
            .iter()
            .flat_map(|turn| turn.items.iter())
            .map(|item| item.text.clone())
            .collect();
        assert!(
            texts.iter().any(|text| text == "hello"),
            "{provider:?} texts={texts:?}"
        );
        assert_eq!(detail.thread.status, "idle");
    }
}

#[test]
fn create_workspace_from_simple_name_under_dev_home() {
    let dir = tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("workspaces")).unwrap();
    let config = test_config(dir.path());
    let db = Database::open(&config.database_url).unwrap();
    let runtime: SharedRuntime = Arc::new(FakeRuntime::new(Provider::Codex));
    let supervisor = Supervisor::new(config, db, vec![runtime]);
    let workspace = supervisor
        .create_workspace(CreateWorkspaceInput {
            abs_path: Some("named-app".into()),
            git_url: None,
            label: None,
        })
        .unwrap();
    let expected = dir.path().join("workspaces").join("named-app");
    assert_eq!(workspace.label, "named-app");
    assert_eq!(
        std::fs::canonicalize(&workspace.abs_path).unwrap(),
        std::fs::canonicalize(&expected).unwrap()
    );
    assert!(expected.is_dir());
}
