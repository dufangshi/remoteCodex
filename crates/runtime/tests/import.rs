use std::sync::Arc;

use remote_codex_protocol::{
    ImportThreadInput, Provider, SendThreadPromptInput, ThreadHistoryItemDto, ThreadTurnDto,
};
use remote_codex_runtime::actor::{ImportSessionMeta, SharedRuntime};
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::local_sessions::LocalSessionHomes;
use remote_codex_runtime::Supervisor;
use tempfile::tempdir;

fn test_config(dir: &std::path::Path, providers: Vec<Provider>) -> RuntimeConfig {
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
        enabled_providers: providers,
        acp_command: None,
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    }
}

fn item(id: &str, kind: &str, text: &str, turn_id: &str) -> ThreadHistoryItemDto {
    ThreadHistoryItemDto {
        id: id.into(),
        created_at: None,
        kind: kind.into(),
        text: text.into(),
        preview_text: None,
        detail_text: None,
        status: Some("completed".into()),
        sequence: None,
        source_turn_id: Some(turn_id.into()),
        artifact: None,
        extra: Default::default(),
    }
}

#[tokio::test]
async fn imports_selected_codex_agent_into_native_provider_and_requires_resume() {
    let dir = tempdir().unwrap();
    let cwd = dir.path().join("imported-project");
    std::fs::create_dir_all(&cwd).unwrap();
    let config = test_config(dir.path(), vec![Provider::Codex, Provider::Acp]);
    let db = Database::open(&config.database_url).unwrap();
    let fake = Arc::new(FakeRuntime::new(Provider::Codex));
    fake.seed_import_session(ImportSessionMeta {
        session_id: "01a0634a-23df-7191-acd2-1fca43a10418".into(),
        agent_id: "codex".into(),
        cwd: cwd.to_string_lossy().into(),
        title: "Imported writer session".into(),
        preview: Some("imported prompt".into()),
        created_at: None,
        updated_at: None,
        model: Some("gpt-5.4".into()),
        turns: vec![ThreadTurnDto {
            id: "turn-imported-1".into(),
            started_at: None,
            completed_at: None,
            status: "completed".into(),
            error: None,
            model: None,
            reasoning_effort: None,
            token_usage: None,
            price_estimate: None,
            has_deferred_items: None,
            deferred_item_count: None,
            items: vec![
                item("u1", "userMessage", "imported prompt", "turn-imported-1"),
                item(
                    "u-injected",
                    "userMessage",
                    "<environment_context>hidden</environment_context>",
                    "turn-imported-1",
                ),
                item(
                    "u-duplicate",
                    "userMessage",
                    "<in-app-browser-context>hidden</in-app-browser-context>\n\n## My request:\nimported prompt",
                    "turn-imported-1",
                ),
                item("command-1", "commandExecution", "pwd", "turn-imported-1"),
                item("a1", "agentMessage", "imported reply", "turn-imported-1"),
                item(
                    "a-duplicate",
                    "agentMessage",
                    "imported reply",
                    "turn-imported-1",
                ),
            ],
        }],
    });
    let supervisor = Supervisor::new(
        config,
        db,
        vec![
            fake.clone() as SharedRuntime,
            Arc::new(FakeRuntime::new(Provider::Acp)) as SharedRuntime,
        ],
    )
    .with_local_session_homes(LocalSessionHomes {
        codex_home: dir.path().join("codex-home"),
        grok_home: dir.path().join("grok-home"),
        claude_home: dir.path().join("claude-home"),
    });

    let imported = supervisor
        .import_thread(ImportThreadInput {
            session_id: "01a0634a-23df-7191-acd2-1fca43a10418".into(),
            provider: Some(Provider::Acp),
            agent_id: Some("codex".into()),
        })
        .await
        .unwrap();
    assert_eq!(imported.thread.provider, Provider::Codex);
    assert_eq!(
        imported.thread.provider_session_id.as_deref(),
        Some("codex::01a0634a-23df-7191-acd2-1fca43a10418")
    );
    assert_eq!(imported.thread.source, "local_codex_import");
    assert!(!imported.thread.is_loaded);
    assert_eq!(imported.workspace.label, "imported-project");
    assert_eq!(imported.turns[0].items.len(), 2);
    assert_eq!(imported.turns[0].items[0].text, "imported prompt");
    assert_eq!(imported.turns[0].items[1].id, "a1");
    assert_eq!(imported.turns[0].has_deferred_items, Some(true));
    assert_eq!(imported.turns[0].deferred_item_count, Some(1));
    let imported_summary = supervisor
        .get_thread_detail_view(&imported.thread.id, Some(10), true)
        .await
        .unwrap();
    assert_eq!(imported_summary.turns[0].items.len(), 2);
    assert_eq!(imported_summary.turns[0].items[0].text, "imported prompt");
    assert_eq!(imported_summary.turns[0].items[1].id, "a1");
    assert_eq!(imported_summary.turns[0].deferred_item_count, Some(1));
    let imported_detail = supervisor
        .get_thread_detail(&imported.thread.id, None)
        .await
        .unwrap();
    assert_eq!(imported_detail.turns[0].items.len(), 3);
    assert_eq!(imported_detail.turns[0].items[0].text, "imported prompt");
    assert_eq!(imported_detail.turns[0].items[1].id, "command-1");
    assert_eq!(imported_detail.turns[0].items[2].text, "imported reply");
    let imported_turn = supervisor
        .get_thread_turn_detail(&imported.thread.id, "turn-imported-1")
        .await
        .unwrap();
    assert_eq!(imported_turn.items.len(), 3);
    assert_eq!(imported_turn.items[0].text, "imported prompt");
    assert_eq!(imported_turn.items[1].id, "command-1");
    assert_eq!(imported_turn.items[2].id, "a1");
    assert_eq!(imported_turn.has_deferred_items, Some(false));
    assert_eq!(imported_turn.deferred_item_count, Some(0));

    let duplicate = supervisor
        .import_thread(ImportThreadInput {
            session_id: "01a0634a-23df-7191-acd2-1fca43a10418".into(),
            provider: Some(Provider::Codex),
            agent_id: None,
        })
        .await
        .unwrap();
    assert_eq!(duplicate.thread.id, imported.thread.id);

    let prompt_err = supervisor
        .prompt(
            &imported.thread.id,
            SendThreadPromptInput {
                prompt: "hello".into(),
                client_request_id: None,
                model: None,
                reasoning_effort: None,
                collaboration_mode: None,
                images: vec![],
            },
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(prompt_err.contains("Resume / Connect"));

    supervisor.resume_thread(&imported.thread.id).await.unwrap();
    supervisor
        .prompt(
            &imported.thread.id,
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
}

#[tokio::test]
async fn imports_grok_session_through_acp_catalog() {
    let dir = tempdir().unwrap();
    let cwd = dir.path().join("grok-project");
    std::fs::create_dir_all(&cwd).unwrap();
    let config = test_config(dir.path(), vec![Provider::Acp]);
    let db = Database::open(&config.database_url).unwrap();
    let fake = Arc::new(FakeRuntime::new(Provider::Acp));
    fake.seed_import_session(ImportSessionMeta {
        session_id: "01a0513a-7417-7553-8c77-399316ec7a9b".into(),
        agent_id: "grok".into(),
        cwd: cwd.to_string_lossy().into(),
        title: "Grok imported".into(),
        preview: Some("hello grok".into()),
        created_at: None,
        updated_at: None,
        model: Some("grok-4.6".into()),
        turns: vec![ThreadTurnDto {
            id: "g1".into(),
            started_at: None,
            completed_at: None,
            status: "completed".into(),
            error: None,
            model: None,
            reasoning_effort: None,
            token_usage: None,
            price_estimate: None,
            has_deferred_items: None,
            deferred_item_count: None,
            items: vec![item("u1", "userMessage", "hello grok", "g1")],
        }],
    });
    let supervisor = Supervisor::new(config, db, vec![fake as SharedRuntime])
        .with_local_session_homes(LocalSessionHomes {
            codex_home: dir.path().join("codex-home"),
            grok_home: dir.path().join("grok-home"),
            claude_home: dir.path().join("claude-home"),
        });
    let candidates = supervisor
        .list_import_candidates(Some(Provider::Acp), Some("grok"))
        .await
        .unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(
        candidates[0].session_id,
        "01a0513a-7417-7553-8c77-399316ec7a9b"
    );

    let imported = supervisor
        .import_thread(ImportThreadInput {
            session_id: "grok://sessions/01a0513a-7417-7553-8c77-399316ec7a9b".into(),
            provider: Some(Provider::Acp),
            agent_id: Some("grok".into()),
        })
        .await
        .unwrap();
    assert_eq!(imported.thread.provider, Provider::Acp);
    assert_eq!(imported.thread.agent_id.as_deref(), Some("grok"));
    assert_eq!(imported.thread.source, "local_provider_import");
    assert_eq!(imported.turns[0].items[0].text, "hello grok");

    let after = supervisor
        .list_import_candidates(Some(Provider::Acp), Some("grok"))
        .await
        .unwrap();
    assert!(after.is_empty());
}
