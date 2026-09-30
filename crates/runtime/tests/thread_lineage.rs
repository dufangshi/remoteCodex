//! Agent-spawned threads must group under the thread a person started, so a
//! fan-out cannot flood a workspace listing.
use remote_codex_protocol::{CreateThreadInput, CreateWorkspaceInput, Provider};
use remote_codex_runtime::{fake::FakeRuntime, Database, RuntimeConfig, Supervisor};
use std::sync::Arc;

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
        vec![Arc::new(FakeRuntime::new(Provider::Codex))],
    ));
    (dir, state)
}

fn workspace(s: &Supervisor) -> String {
    s.list_workspaces()
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
        })
        .id
}

async fn spawn(s: &Supervisor, ws: &str, parent: Option<&str>) -> remote_codex_protocol::ThreadDto {
    s.create_thread(CreateThreadInput {
        workspace_id: ws.to_string(),
        title: None,
        provider: Some(Provider::Codex),
        agent_id: Some("codex".into()),
        model: "ios-e2e-stream".into(),
        reasoning_effort: None,
        approval_mode: "yolo".into(),
        parent_thread_id: parent.map(str::to_owned),
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn descendants_anchor_on_the_root_a_person_started() {
    let (_dir, s) = setup();
    let ws = workspace(&s);

    let root = spawn(&s, &ws, None).await;
    assert_eq!(root.parent_thread_id, None, "a user thread has no parent");
    assert_eq!(root.root_thread_id, None, "a root does not point at itself");
    assert_eq!(root.lineage_depth, 0);

    let child = spawn(&s, &ws, Some(&root.id)).await;
    assert_eq!(child.parent_thread_id.as_deref(), Some(root.id.as_str()));
    assert_eq!(child.root_thread_id.as_deref(), Some(root.id.as_str()));
    assert_eq!(child.lineage_depth, 1);

    // The grandchild must anchor on the ORIGINAL root, not on its own parent -
    // otherwise a chain splinters into several groups in the listing.
    let grandchild = spawn(&s, &ws, Some(&child.id)).await;
    assert_eq!(
        grandchild.parent_thread_id.as_deref(),
        Some(child.id.as_str())
    );
    assert_eq!(
        grandchild.root_thread_id.as_deref(),
        Some(root.id.as_str()),
        "the whole chain groups under the thread the person started"
    );
    assert_eq!(grandchild.lineage_depth, 2);
}

#[tokio::test]
async fn nesting_is_bounded_and_an_unknown_parent_is_refused() {
    let (_dir, s) = setup();
    let ws = workspace(&s);

    let mut current = spawn(&s, &ws, None).await.id;
    // depth 0 root, then 1, 2, 3 are allowed; the fourth generation is refused.
    for _ in 0..remote_codex_runtime::service::MAX_LINEAGE_DEPTH {
        current = spawn(&s, &ws, Some(&current)).await.id;
    }
    let too_deep = s
        .create_thread(CreateThreadInput {
            workspace_id: ws.clone(),
            title: None,
            provider: Some(Provider::Codex),
            agent_id: Some("codex".into()),
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            parent_thread_id: Some(current),
        })
        .await;
    let message = too_deep
        .err()
        .expect("nesting past the cap must fail")
        .to_string();
    assert!(
        message.contains("nesting is limited"),
        "error should explain the cap, got: {message}"
    );

    let orphan = s
        .create_thread(CreateThreadInput {
            workspace_id: ws,
            title: None,
            provider: Some(Provider::Codex),
            agent_id: Some("codex".into()),
            model: "ios-e2e-stream".into(),
            reasoning_effort: None,
            approval_mode: "yolo".into(),
            parent_thread_id: Some("00000000-0000-0000-0000-000000000000".into()),
        })
        .await;
    assert!(
        orphan.is_err(),
        "an unknown parent must not create a thread"
    );
}

#[tokio::test]
async fn a_workspace_listing_shows_only_threads_a_person_started() {
    let (_dir, s) = setup();
    let ws = workspace(&s);

    let root = spawn(&s, &ws, None).await;
    let other_root = spawn(&s, &ws, None).await;
    for _ in 0..5 {
        spawn(&s, &ws, Some(&root.id)).await;
    }

    let visible = s.list_threads(Some(&ws), false).unwrap();
    assert_eq!(
        visible.len(),
        2,
        "five agent threads must not appear beside the two the person started"
    );
    assert!(visible.iter().all(|t| t.parent_thread_id.is_none()));

    let listed_root = visible.iter().find(|t| t.id == root.id).unwrap();
    assert_eq!(
        listed_root.descendant_count,
        Some(5),
        "the root should advertise how many agent threads it owns"
    );
    let quiet = visible.iter().find(|t| t.id == other_root.id).unwrap();
    assert_eq!(
        quiet.descendant_count, None,
        "a root with no descendants reports nothing rather than zero"
    );

    let everything = s.list_threads(Some(&ws), true).unwrap();
    assert_eq!(everything.len(), 7, "opting in returns the full tree");
}
