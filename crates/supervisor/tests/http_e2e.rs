use std::sync::Arc;
use std::time::Duration;

use remote_codex_protocol::{Provider, ThreadHistoryItemDto, ThreadTurnDto};
use remote_codex_runtime::actor::{ImportSessionMeta, SharedRuntime};
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::local_sessions::LocalSessionHomes;
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::net::TcpListener;

async fn spawn_supervisor(
    providers: Vec<Provider>,
) -> (tempfile::TempDir, u16, std::path::PathBuf) {
    spawn_supervisor_seeded(providers, |_| {}).await
}

async fn spawn_supervisor_seeded(
    providers: Vec<Provider>,
    seed: impl Fn(&FakeRuntime),
) -> (tempfile::TempDir, u16, std::path::PathBuf) {
    let dir = tempdir().unwrap();
    let ws_root = dir.path().join("workspaces");
    std::fs::create_dir_all(&ws_root).unwrap();
    let config = RuntimeConfig {
        mode: remote_codex_protocol::Mode::Local,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root: ws_root.clone(),
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
        enabled_providers: providers.clone(),
        acp_command: None,
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    };
    let db = Database::open(&config.database_url).unwrap();
    let fakes: Vec<Arc<FakeRuntime>> = providers
        .into_iter()
        .map(|provider| {
            let fake = Arc::new(FakeRuntime::new(provider));
            seed(&fake);
            fake
        })
        .collect();
    let runtimes: Vec<SharedRuntime> = fakes
        .iter()
        .map(|fake| fake.clone() as SharedRuntime)
        .collect();
    let state = Arc::new(
        Supervisor::new(config, db, runtimes).with_local_session_homes(LocalSessionHomes {
            codex_home: dir.path().join("codex-home"),
            grok_home: dir.path().join("grok-home"),
            claude_home: dir.path().join("claude-home"),
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, remote_codex_supervisor::router(state))
            .await
            .unwrap();
    });
    for _ in 0..50 {
        if reqwest::get(format!("http://127.0.0.1:{port}/healthz"))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    (dir, port, ws_root)
}

async fn spawn_authenticated_supervisor() -> (tempfile::TempDir, u16) {
    let dir = tempdir().unwrap();
    let workspace_root = dir.path().join("workspaces");
    std::fs::create_dir_all(&workspace_root).unwrap();
    let config = RuntimeConfig {
        mode: remote_codex_protocol::Mode::Server,
        host: "127.0.0.1".into(),
        port: 0,
        workspace_root,
        database_url: dir.path().join("test.sqlite"),
        app_name: "test".into(),
        app_version: "0.12.0".into(),
        environment: "test".into(),
        auth_required: true,
        admin_username: Some("admin".into()),
        admin_password: Some("secret123".into()),
        session_secret: Some("0123456789abcdef".into()),
        relay_server_url: None,
        relay_agent_token: None,
        enabled_providers: vec![Provider::Codex],
        acp_command: None,
        acp_startup_timeout_ms: 1000,
        fake_runtime: true,
    };
    let db = Database::open(&config.database_url).unwrap();
    let state = Arc::new(Supervisor::new(
        config,
        db,
        vec![Arc::new(FakeRuntime::new(Provider::Codex)) as SharedRuntime],
    ));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, remote_codex_supervisor::router(state))
            .await
            .unwrap();
    });
    (dir, port)
}

async fn json(_client: &reqwest::Client, req: reqwest::RequestBuilder) -> Value {
    let response = req.send().await.unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    assert!(status.is_success(), "{status} {text}");
    if text.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }))
    }
}

#[tokio::test]
async fn server_auth_blocks_anonymous_requests_and_accepts_node_sessions() {
    let (_dir, port) = spawn_authenticated_supervisor().await;
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");

    let anonymous = client
        .get(format!("{base}/api/workspaces"))
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status(), reqwest::StatusCode::UNAUTHORIZED);

    let login = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({ "username": "admin", "password": "secret123" }))
        .send()
        .await
        .unwrap();
    assert!(login.status().is_success());
    assert!(login.headers().contains_key(reqwest::header::SET_COOKIE));
    let login_body: Value = login.json().await.unwrap();
    let token = login_body["token"].as_str().unwrap();

    let authenticated = client
        .get(format!("{base}/api/workspaces"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert!(authenticated.status().is_success());

    let node_token = "eyJ1c2VybmFtZSI6ImFkbWluIiwiZXhwaXJlc0F0Ijo0MTAyNDQ0ODAwMDAwLCJub25jZSI6ImxlZ2FjeS1ub2RlIn0.bosISUS4ohy_K_Ygr6Oj9zpuOaRokEQkzosjQwrgAgI";
    let legacy = client
        .get(format!("{base}/api/auth/session"))
        .bearer_auth(node_token)
        .send()
        .await
        .unwrap();
    let legacy_body: Value = legacy.json().await.unwrap();
    assert_eq!(legacy_body["authenticated"], true);
    assert_eq!(legacy_body["username"], "admin");

    let websocket_without_auth = client.get(format!("{base}/ws")).send().await.unwrap();
    assert_eq!(
        websocket_without_auth.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn local_api_does_not_enable_cross_origin_access_by_default() {
    let (_dir, port, _workspace_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/api/version"))
        .header(reqwest::header::ORIGIN, "https://attacker.example")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    assert!(!response
        .headers()
        .contains_key(reqwest::header::ACCESS_CONTROL_ALLOW_ORIGIN));
}

async fn wait_thread(client: &reqwest::Client, base: &str, id: &str) -> Value {
    for _ in 0..200 {
        let detail = json(client, client.get(format!("{base}/api/threads/{id}"))).await;
        let status = detail["thread"]["status"].as_str().unwrap_or("");
        if matches!(status, "idle" | "interrupted" | "failed")
            && detail["turns"]
                .as_array()
                .map(|turns| !turns.is_empty())
                .unwrap_or(false)
        {
            return detail;
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    panic!("thread {id} did not settle");
}

async fn wait_for_turn_count(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    expected: usize,
) -> Value {
    for _ in 0..200 {
        let detail = json(
            client,
            client.get(format!("{base}/api/threads/{id}?view=full&limit=100")),
        )
        .await;
        if detail["thread"]["status"] != "running"
            && detail["turns"].as_array().map(Vec::len) == Some(expected)
        {
            return detail;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("thread {id} did not reach {expected} turns");
}

async fn wait_for_pending_count(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    expected: usize,
) -> Value {
    for _ in 0..100 {
        let detail = json(
            client,
            client.get(format!("{base}/api/threads/{id}?view=summary&limit=10")),
        )
        .await;
        if detail["pendingSteers"].as_array().map(Vec::len) == Some(expected) {
            return detail;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("thread {id} did not reach {expected} pending prompts");
}

#[tokio::test]
async fn terminal_plugin_toggle_updates_persisted_state() {
    let (_dir, port, _ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();

    let initial = json(&client, client.get(format!("{base}/api/plugins"))).await;
    assert_eq!(initial.as_array().map(Vec::len), Some(1));
    assert_eq!(initial[0]["id"], "remote-codex.terminal");
    assert_eq!(initial[0]["enabled"], cfg!(unix));

    let disabled = json(
        &client,
        client
            .patch(format!("{base}/api/plugins/remote-codex.terminal"))
            .json(&json!({ "enabled": false })),
    )
    .await;
    assert_eq!(disabled["enabled"], false);

    let after_disable = json(&client, client.get(format!("{base}/api/plugins"))).await;
    assert_eq!(after_disable[0]["enabled"], false);

    let enabled = json(
        &client,
        client
            .patch(format!("{base}/api/plugins/remote-codex.terminal"))
            .json(&json!({ "enabled": true })),
    )
    .await;
    assert_eq!(enabled["enabled"], cfg!(unix));
}

#[tokio::test]
async fn thread_creation_and_full_access_keep_approval_mode_in_sync() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("permission-policy");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Permission policy"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "guarded"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();
    assert_eq!(thread["sandboxMode"], "workspace-write");
    assert_eq!(thread["approvalMode"], "guarded");

    let guarded = json(
        &client,
        client
            .patch(format!("{base}/api/threads/{thread_id}/settings"))
            .json(&json!({ "sandboxMode": "workspace-write" })),
    )
    .await;
    assert_eq!(guarded["approvalMode"], "guarded");

    let full = json(
        &client,
        client
            .patch(format!("{base}/api/threads/{thread_id}/settings"))
            .json(&json!({ "sandboxMode": "danger-full-access" })),
    )
    .await;
    assert_eq!(full["approvalMode"], "yolo");
}

#[tokio::test]
async fn thread_history_pages_before_turn_without_repeating_latest_turns() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("history-pages");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "History pages"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();

    for index in 1..=7 {
        json(
            &client,
            client
                .post(format!("{base}/api/threads/{thread_id}/prompt"))
                .json(&json!({
                    "prompt": format!("Reply with exactly page-{index}.")
                })),
        )
        .await;
        wait_for_turn_count(&client, &base, thread_id, index).await;
    }

    let latest = json(
        &client,
        client.get(format!(
            "{base}/api/threads/{thread_id}?view=summary&limit=3"
        )),
    )
    .await;
    assert_eq!(latest["totalTurnCount"], 7);
    let latest_ids = latest["turns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|turn| turn["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(latest_ids.len(), 3);

    let middle = json(
        &client,
        client.get(format!(
            "{base}/api/threads/{thread_id}?view=summary&limit=3&beforeTurnId={}",
            latest_ids[0]
        )),
    )
    .await;
    assert_eq!(middle["totalTurnCount"], 7);
    let middle_ids = middle["turns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|turn| turn["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(middle_ids.len(), 3);
    assert!(middle_ids.iter().all(|id| !latest_ids.contains(id)));

    let oldest = json(
        &client,
        client.get(format!(
            "{base}/api/threads/{thread_id}?view=summary&limit=3&beforeTurnId={}",
            middle_ids[0]
        )),
    )
    .await;
    assert_eq!(oldest["turns"].as_array().map(Vec::len), Some(1));
    let oldest_id = oldest["turns"][0]["id"].as_str().unwrap();
    assert!(!latest_ids.iter().any(|id| id == oldest_id));
    assert!(!middle_ids.iter().any(|id| id == oldest_id));

    let unknown_cursor = json(
        &client,
        client.get(format!(
            "{base}/api/threads/{thread_id}?view=summary&limit=3&beforeTurnId=missing-turn"
        )),
    )
    .await;
    let unknown_ids = unknown_cursor["turns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|turn| turn["id"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(unknown_ids, latest_ids);
}

#[tokio::test]
async fn pending_prompt_routes_match_the_frontend_contract() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("pending-prompts");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Pending prompts"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();
    json(
        &client,
        client
            .post(format!("{base}/api/threads/{thread_id}/prompt"))
            .json(&json!({
                "prompt": "Inspect this repository in depth and keep the turn running while I add follow-ups."
            })),
    )
    .await;

    json(
        &client,
        client
            .post(format!("{base}/api/threads/{thread_id}/prompt"))
            .json(&json!({
                "prompt": "Cancel this queued follow-up.",
                "clientRequestId": "queued-cancel"
            })),
    )
    .await;
    let queued = wait_for_pending_count(&client, &base, thread_id, 1).await;
    let pending = &queued["pendingSteers"][0];
    assert_eq!(pending["clientRequestId"], "queued-cancel");
    assert_eq!(pending["prompt"], "Cancel this queued follow-up.");
    assert_eq!(pending["delivery"], "continuation");
    assert!(pending.get("displayPrompt").is_none());
    assert!(pending.get("submittedPrompt").is_none());
    assert!(pending.get("threadId").is_none());
    let cancelled_id = pending["id"].as_str().unwrap();
    let cancelled = json(
        &client,
        client.delete(format!(
            "{base}/api/threads/{thread_id}/pending-steers/{cancelled_id}"
        )),
    )
    .await;
    assert_eq!(cancelled["thread"]["id"], thread_id);
    assert_eq!(cancelled["pendingSteers"].as_array().map(Vec::len), Some(0));

    json(
        &client,
        client
            .post(format!("{base}/api/threads/{thread_id}/prompt"))
            .json(&json!({
                "prompt": "Steer this queued follow-up now.",
                "clientRequestId": "queued-steer"
            })),
    )
    .await;
    let queued = wait_for_pending_count(&client, &base, thread_id, 1).await;
    let steer_id = queued["pendingSteers"][0]["id"].as_str().unwrap();
    let steered = json(
        &client,
        client.post(format!(
            "{base}/api/threads/{thread_id}/pending-steers/{steer_id}/steer"
        )),
    )
    .await;
    assert_eq!(steered["thread"]["id"], thread_id);
    assert_eq!(
        steered["pendingSteers"][0]["clientRequestId"],
        "queued-steer"
    );
    assert_eq!(steered["pendingSteers"][0]["delivery"], "steer");
    let duplicate_steer = client
        .post(format!(
            "{base}/api/threads/{thread_id}/pending-steers/{steer_id}/steer"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(duplicate_steer.status(), reqwest::StatusCode::CONFLICT);

    json(
        &client,
        client.post(format!("{base}/api/threads/{thread_id}/interrupt")),
    )
    .await;
    let settled = wait_thread(&client, &base, thread_id).await;
    assert_eq!(settled["pendingSteers"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn thread_mutation_responses_match_the_frontend_contracts() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("mutation-contracts");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Mutation contracts"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();

    let compacted = json(
        &client,
        client.post(format!("{base}/api/threads/{thread_id}/compact")),
    )
    .await;
    assert_eq!(compacted["id"], thread_id);
    assert!(compacted.get("thread").is_none());

    let responded = json(
        &client,
        client
            .post(format!(
                "{base}/api/threads/{thread_id}/requests/test-request/respond"
            ))
            .json(&json!({
                "answers": { "permission": { "answers": ["allow"] } }
            })),
    )
    .await;
    assert_eq!(responded["thread"]["id"], thread_id);
    assert!(responded["turns"].is_array());

    let disconnected = json(
        &client,
        client.post(format!("{base}/api/threads/{thread_id}/disconnect")),
    )
    .await;
    assert_eq!(disconnected["thread"]["id"], thread_id);
    assert!(disconnected["turns"].is_array());
}

#[tokio::test]
async fn fork_turns_and_fork_modes_match_the_frontend_contract() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Claude]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("fork-contract");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Fork contract"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "claude",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();
    for index in 1..=2 {
        json(
            &client,
            client
                .post(format!("{base}/api/threads/{thread_id}/prompt"))
                .json(&json!({ "prompt": format!("Reply with exactly fork-{index}.") })),
        )
        .await;
        wait_for_turn_count(&client, &base, thread_id, index).await;
    }

    let options = json(
        &client,
        client.get(format!("{base}/api/threads/{thread_id}/fork-turns")),
    )
    .await;
    assert_eq!(options.as_array().map(Vec::len), Some(2));
    assert_eq!(options[0]["turnIndex"], 1);
    assert_eq!(options[1]["turnIndex"], 2);

    let historical = client
        .post(format!("{base}/api/threads/{thread_id}/fork"))
        .json(&json!({ "mode": "turn", "turnId": options[0]["turnId"] }))
        .send()
        .await
        .unwrap();
    assert_eq!(historical.status(), reqwest::StatusCode::CONFLICT);

    let forked = json(
        &client,
        client
            .post(format!("{base}/api/threads/{thread_id}/fork"))
            .json(&json!({ "mode": "turn", "turnId": options[1]["turnId"] })),
    )
    .await;
    assert_eq!(forked["sourceThreadId"], thread_id);
    assert_eq!(forked["sourceTurnId"], options[1]["turnId"]);
    assert_eq!(forked["sourceTurnIndex"], 2);
    assert_eq!(forked["thread"]["turns"].as_array().map(Vec::len), Some(2));
    assert_ne!(forked["thread"]["thread"]["id"], thread_id);
}

#[tokio::test]
async fn goal_routes_return_complete_stable_dtos() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("goal-contract");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Goal contract"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();

    let created = json(
        &client,
        client
            .patch(format!("{base}/api/threads/{thread_id}/goal"))
            .json(&json!({ "objective": "Ship parity", "tokenBudget": 1200 })),
    )
    .await;
    let goal = &created["goal"];
    assert_eq!(goal["threadId"], thread_id);
    assert_eq!(goal["objective"], "Ship parity");
    assert_eq!(goal["status"], "active");
    assert_eq!(goal["tokenBudget"], 1200);
    assert_eq!(goal["tokensUsed"], 0);
    assert_eq!(goal["timeUsedSeconds"], 0);
    assert!(goal["localGoalId"].is_string());
    assert!(goal["createdAt"].is_string());
    assert!(goal["updatedAt"].is_string());
    assert!(goal["completedAt"].is_null());
    let goal_id = goal["localGoalId"].clone();
    let created_at = goal["createdAt"].clone();

    let fetched = json(
        &client,
        client.get(format!("{base}/api/threads/{thread_id}/goal")),
    )
    .await;
    assert_eq!(fetched["goal"]["localGoalId"], goal_id);
    assert_eq!(fetched["goal"]["createdAt"], created_at);
    assert_eq!(fetched["goal"]["tokenBudget"], 1200);

    let paused = json(
        &client,
        client
            .patch(format!("{base}/api/threads/{thread_id}/goal"))
            .json(&json!({ "status": "paused" })),
    )
    .await;
    assert_eq!(paused["goal"]["status"], "paused");
    assert_eq!(paused["goal"]["localGoalId"], goal_id);

    let without_budget = json(
        &client,
        client
            .patch(format!("{base}/api/threads/{thread_id}/goal"))
            .json(&json!({ "tokenBudget": null })),
    )
    .await;
    assert!(without_budget["goal"]["tokenBudget"].is_null());
    assert_eq!(without_budget["goal"]["localGoalId"], goal_id);

    let cleared = json(
        &client,
        client.delete(format!("{base}/api/threads/{thread_id}/goal")),
    )
    .await;
    assert_eq!(cleared["cleared"], true);
    assert!(cleared["goalHistory"].is_array());
    let after_clear = json(
        &client,
        client.get(format!("{base}/api/threads/{thread_id}/goal")),
    )
    .await;
    assert!(after_clear["goal"].is_null());
}

#[cfg(unix)]
#[tokio::test]
async fn shell_create_update_and_terminate_return_complete_sessions() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("shell-contract");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Shell contract"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let thread_id = thread["id"].as_str().unwrap();
    let created = json(
        &client,
        client
            .post(format!("{base}/api/threads/{thread_id}/shell"))
            .json(&json!({ "cols": 100, "rows": 30, "label": "Initial" })),
    )
    .await;
    let shell = &created["shell"];
    assert_eq!(shell["threadId"], thread_id);
    assert_eq!(shell["workspaceId"], workspace["id"]);
    assert_eq!(shell["label"], "Initial");
    assert_eq!(shell["backend"], "pty");
    assert_eq!(shell["status"], "running");
    assert!(shell["tmuxSessionName"].is_string());
    assert!(shell["createdAt"].is_string());
    assert!(shell["updatedAt"].is_string());
    let shell_id = shell["id"].as_str().unwrap();

    let updated = json(
        &client,
        client
            .patch(format!("{base}/api/shells/{shell_id}"))
            .json(&json!({ "label": "Renamed" })),
    )
    .await;
    assert_eq!(updated["label"], "Renamed");

    let terminated = json(
        &client,
        client.post(format!("{base}/api/shells/{shell_id}/terminate")),
    )
    .await;
    assert_eq!(terminated["status"], "exited");
    let state = json(
        &client,
        client.get(format!("{base}/api/threads/{thread_id}/shell")),
    )
    .await;
    assert_eq!(state["state"], "not_created");
    assert_eq!(state["shells"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn workspace_upload_raw_and_download_preserve_binary_bytes() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace_path = ws_root.join("binary-files");
    std::fs::create_dir_all(&workspace_path).unwrap();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": workspace_path,
            "label": "Binary files"
        })),
    )
    .await;
    let workspace_id = workspace["id"].as_str().unwrap();
    let expected = (0..100_000)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    let boundary = "remote-codex-workspace-upload";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"blob.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(&expected);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let uploaded = json(
        &client,
        client
            .post(format!("{base}/api/workspaces/{workspace_id}/files/upload"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body),
    )
    .await;
    assert_eq!(uploaded["kind"], "file");
    assert_eq!(uploaded["file"]["path"], "blob.bin");
    assert_eq!(uploaded["file"]["size"], expected.len());

    let raw = client
        .get(format!(
            "{base}/api/workspaces/{workspace_id}/files/raw?path=blob.bin"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(raw.status(), reqwest::StatusCode::OK);
    assert_eq!(raw.bytes().await.unwrap().as_ref(), expected.as_slice());

    let download = client
        .get(format!(
            "{base}/api/workspaces/{workspace_id}/files/download?path=blob.bin"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), reqwest::StatusCode::OK);
    assert!(download
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("blob.bin"));
    assert_eq!(
        download.bytes().await.unwrap().as_ref(),
        expected.as_slice()
    );
}

#[tokio::test]
async fn plugin_detail_and_unsupported_mutations_are_explicit() {
    let (_dir, port, _ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();

    let plugin = json(
        &client,
        client.get(format!("{base}/api/plugins/remote-codex.terminal")),
    )
    .await;
    assert_eq!(plugin["id"], "remote-codex.terminal");

    let import = client
        .post(format!("{base}/api/plugins/import"))
        .json(&json!({ "manifestJson": "{}", "enabled": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(import.status(), reqwest::StatusCode::NOT_IMPLEMENTED);
    let import_error: Value = import.json().await.unwrap();
    assert_eq!(import_error["code"], "unsupported");

    let delete_builtin = client
        .delete(format!("{base}/api/plugins/remote-codex.terminal"))
        .send()
        .await
        .unwrap();
    assert_eq!(delete_builtin.status(), reqwest::StatusCode::CONFLICT);
    let delete_error: Value = delete_builtin.json().await.unwrap();
    assert_eq!(delete_error["code"], "unsupported");
}

#[tokio::test]
async fn http_files_prompt_interrupt_export_and_capabilities() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![
        Provider::Codex,
        Provider::Claude,
        Provider::Opencode,
        Provider::Acp,
    ])
    .await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let proj = ws_root.join("proj");
    std::fs::create_dir_all(proj.join("src")).unwrap();
    std::fs::write(proj.join("README.md"), "# files\n").unwrap();
    std::fs::write(proj.join("src/main.rs"), "fn main() {}\n").unwrap();
    std::fs::write(
        proj.join("dot.png"),
        [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ],
    )
    .unwrap();

    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": proj.to_string_lossy(),
            "label": "proj"
        })),
    )
    .await;
    let workspace_id = workspace["id"].as_str().unwrap();

    let tree = json(
        &client,
        client.get(format!(
            "{base}/api/workspaces/{workspace_id}/files/tree?path=."
        )),
    )
    .await;
    assert_eq!(tree["kind"], "directory");
    let names: Vec<_> = tree["children"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|node| node["name"].as_str())
        .collect();
    assert!(names.contains(&"README.md"));
    assert!(names.contains(&"src"));

    let preview = json(
        &client,
        client.get(format!(
            "{base}/api/workspaces/{workspace_id}/files/preview?path=README.md"
        )),
    )
    .await;
    assert!(preview["content"].as_str().unwrap().contains("# files"));

    json(
        &client,
        client
            .put(format!("{base}/api/workspaces/{workspace_id}/files"))
            .json(&json!({
                "path": "notes.txt",
                "content": "hello-files"
            })),
    )
    .await;
    json(
        &client,
        client
            .patch(format!("{base}/api/workspaces/{workspace_id}/files/move"))
            .json(&json!({ "fromPath": "notes.txt", "toPath": "docs/notes.txt" })),
    )
    .await;
    let moved = json(
        &client,
        client.get(format!(
            "{base}/api/workspaces/{workspace_id}/files/preview?path=docs/notes.txt"
        )),
    )
    .await;
    assert_eq!(moved["content"], "hello-files");

    let escaped = client
        .get(format!(
            "{base}/api/workspaces/{workspace_id}/files/preview?path=../secret"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(escaped.status(), 400);

    let backends = json(&client, client.get(format!("{base}/api/agent-runtimes"))).await;
    let list = backends.as_array().cloned().unwrap_or_default();
    assert!(list.iter().any(|backend| backend["provider"] == "codex"));
    assert!(list.iter().any(|backend| backend["provider"] == "claude"));
    let codex = list
        .iter()
        .find(|backend| backend["provider"] == "codex")
        .unwrap();
    assert_eq!(codex["capabilities"]["turns"]["compact"], true);
    assert_eq!(codex["capabilities"]["branching"]["fork"], false);
    let claude = list
        .iter()
        .find(|backend| backend["provider"] == "claude")
        .unwrap();
    assert_eq!(claude["capabilities"]["branching"]["fork"], true);

    for provider in ["codex", "claude", "opencode", "acp"] {
        let thread = json(
            &client,
            client
                .post(format!("{base}/api/threads/start"))
                .json(&json!({
                    "workspaceId": workspace_id,
                    "title": format!("{provider} hello"),
                    "provider": provider,
                    "model": "ios-e2e-stream",
                    "approvalMode": "yolo"
                })),
        )
        .await;
        let thread_id = thread["id"].as_str().unwrap().to_string();
        json(
            &client,
            client
                .post(format!("{base}/api/threads/{thread_id}/prompt"))
                .json(&json!({ "prompt": "hello, reply me with hello" })),
        )
        .await;
        let detail = wait_thread(&client, &base, &thread_id).await;
        let texts = detail["turns"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|turn| turn["items"].as_array().cloned().unwrap_or_default())
            .filter_map(|item| item["text"].as_str().map(str::to_string))
            .collect::<Vec<_>>();
        assert!(
            texts.iter().any(|text| text == "hello"),
            "{provider} {texts:?}"
        );

        if provider == "codex" {
            let turn_id = detail["turns"][0]["id"].as_str().unwrap();
            let summary = json(
                &client,
                client.get(format!("{base}/api/threads/{thread_id}?view=summary")),
            )
            .await;
            assert!(summary["turns"][0]["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["kind"] == "userMessage"));
            let turn_detail = json(
                &client,
                client.get(format!(
                    "{base}/api/threads/{thread_id}/turns/{turn_id}/detail"
                )),
            )
            .await;
            assert_eq!(turn_detail["id"], turn_id);
            assert_eq!(turn_detail["hasDeferredItems"], false);
            let image = client
                .get(format!(
                    "{base}/api/threads/{thread_id}/assets/image?path=dot.png"
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(image.status(), 200);
            assert_eq!(image.headers().get("content-type").unwrap(), "image/png");
            let escaped_image = client
                .get(format!(
                    "{base}/api/threads/{thread_id}/assets/image?path=../secret.png"
                ))
                .send()
                .await
                .unwrap();
            assert_eq!(escaped_image.status(), 400);
        }

        let html = client
            .get(format!(
                "{base}/api/threads/{thread_id}/exports/pdf?format=html&mode=latest&limit=10"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(html.status(), 200);
        assert_eq!(
            html.headers().get("content-type").unwrap(),
            "text/html; charset=utf-8"
        );
        assert!(html
            .headers()
            .get("content-disposition")
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".html\""));
        let html_body = html.text().await.unwrap();
        assert!(html_body.starts_with("<!doctype html>"));
        assert!(html_body.contains("hello"));
        let pdf = client
            .get(format!(
                "{base}/api/threads/{thread_id}/exports/pdf?format=pdf&mode=latest&limit=10"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(pdf.status(), 200);
        assert_eq!(
            pdf.headers().get("content-type").unwrap(),
            "application/pdf"
        );
        assert!(pdf
            .headers()
            .get("content-disposition")
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".pdf\""));
        let pdf_body = pdf.bytes().await.unwrap();
        assert!(pdf_body.starts_with(b"%PDF-"));
        assert!(pdf_body.ends_with(b"%%EOF"));
    }

    let long = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace_id,
                "title": "long",
                "provider": "codex",
                "model": "ios-e2e-stream",
                "approvalMode": "yolo"
            })),
    )
    .await;
    let long_id = long["id"].as_str().unwrap().to_string();
    json(
        &client,
        client.post(format!("{base}/api/threads/{long_id}/prompt")).json(&json!({
            "prompt": "Inspect this repository in depth and write a detailed multi-section report."
        })),
    )
    .await;
    for _ in 0..50 {
        let thread = json(&client, client.get(format!("{base}/api/threads/{long_id}"))).await;
        if thread["thread"]["status"] == "running" || thread["status"] == "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    json(
        &client,
        client.post(format!("{base}/api/threads/{long_id}/interrupt")),
    )
    .await;
    let interrupted = wait_thread(&client, &base, &long_id).await;
    assert_ne!(interrupted["thread"]["status"], "running");
}

#[tokio::test]
async fn named_workspace_and_backend_status_are_usable() {
    let (_dir, port, ws_root) = spawn_supervisor(vec![Provider::Codex, Provider::Claude]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();

    let backends = json(&client, client.get(format!("{base}/api/agent-runtimes"))).await;
    let backends = backends.as_array().expect("backend list");
    assert!(backends.iter().all(|backend| {
        backend["enabled"] == true
            && backend["capabilities"]["sessions"]["resume"] == true
            && backend["capabilities"]["turns"]["start"] == true
            && backend["capabilities"]["management"]["models"] == true
    }));

    let status = json(
        &client,
        client.get(format!("{base}/api/agent-runtimes/codex/status")),
    )
    .await;
    assert_eq!(status["provider"], "codex");
    assert_eq!(status["capabilities"]["sessions"]["resume"], true);
    assert_eq!(status["capabilities"]["management"]["models"], true);
    assert!(status["managementSchema"]["toolboxItems"].is_array());

    let capability_snapshot = json(
        &client,
        client.get(format!(
            "{base}/api/agent-runtimes/codex/capabilities?agentId=codex"
        )),
    )
    .await;
    assert!(capability_snapshot["toolboxItems"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["command"] == "/compact")));

    let created = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": "from-name"
        })),
    )
    .await;
    assert_eq!(created["label"], "from-name");
    let abs = created["absPath"].as_str().unwrap();
    assert!(abs.ends_with("from-name"));
    assert!(ws_root.join("from-name").is_dir());

    let deleted = json(
        &client,
        client.delete(format!(
            "{base}/api/workspaces/{}",
            created["id"].as_str().unwrap()
        )),
    )
    .await;
    assert_eq!(deleted["id"], created["id"]);
}

#[tokio::test]
async fn multipart_photo_uses_manifest_placeholder_and_preserves_extension() {
    let (_dir, port, _ws_root) = spawn_supervisor(vec![Provider::Codex]).await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();
    let workspace = json(
        &client,
        client.post(format!("{base}/api/workspaces")).json(&json!({
            "absPath": "image-upload"
        })),
    )
    .await;
    let thread = json(
        &client,
        client
            .post(format!("{base}/api/threads/start"))
            .json(&json!({
                "workspaceId": workspace["id"],
                "model": "gpt-5",
                "approvalMode": "yolo"
            })),
    )
    .await;

    let boundary = "remote-codex-image-boundary";
    let manifest = json!([{
        "clientId": "photo-1",
        "kind": "photo",
        "originalName": "image.png",
        "placeholder": "[PHOTO image.png]"
    }]);
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nDescribe [PHOTO image.png]\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"attachmentManifest\"\r\n\r\n{manifest}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"attachments\"; filename=\"image.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(b"png");
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let response = client
        .post(format!(
            "{base}/api/threads/{}/prompt",
            thread["id"].as_str().unwrap()
        ))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let attachment_dir = std::path::Path::new(workspace["absPath"].as_str().unwrap())
        .join(".temp")
        .join("threads")
        .join(thread["id"].as_str().unwrap());
    let saved = std::fs::read_dir(attachment_dir)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(saved.len(), 1);
    assert!(saved[0].starts_with("image-"));
    assert!(saved[0].ends_with(".png"));
}

#[tokio::test]
async fn import_extracts_codex_uri_and_hydrates_history() {
    let dir = tempdir().unwrap();
    let cwd = dir.path().join("imported-project");
    std::fs::create_dir_all(&cwd).unwrap();
    let session = ImportSessionMeta {
        session_id: "01a0634a-23df-7191-acd2-1fca43a10418".into(),
        agent_id: "codex".into(),
        cwd: cwd.to_string_lossy().into(),
        title: "Imported writer session".into(),
        preview: Some("imported prompt".into()),
        created_at: None,
        updated_at: Some("2026-09-01T00:00:00.000Z".into()),
        model: Some("gpt-5.4".into()),
        turns: vec![ThreadTurnDto {
            id: "turn-imported-1".into(),
            started_at: None,
            status: "completed".into(),
            error: None,
            model: None,
            reasoning_effort: None,
            token_usage: None,
            has_deferred_items: None,
            deferred_item_count: None,
            items: vec![
                ThreadHistoryItemDto {
                    id: "u1".into(),
                    created_at: None,
                    kind: "userMessage".into(),
                    text: "imported prompt".into(),
                    preview_text: None,
                    detail_text: None,
                    status: Some("completed".into()),
                    sequence: None,
                    source_turn_id: Some("turn-imported-1".into()),
                    artifact: None,
                    extra: Default::default(),
                },
                ThreadHistoryItemDto {
                    id: "a1".into(),
                    created_at: None,
                    kind: "agentMessage".into(),
                    text: "imported reply".into(),
                    preview_text: None,
                    detail_text: None,
                    status: Some("completed".into()),
                    sequence: None,
                    source_turn_id: Some("turn-imported-1".into()),
                    artifact: None,
                    extra: Default::default(),
                },
            ],
        }],
    };
    let (_keep, port, _) = spawn_supervisor_seeded(vec![Provider::Codex, Provider::Acp], {
        let session = session.clone();
        move |fake| fake.seed_import_session(session.clone())
    })
    .await;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::new();

    let candidates = json(
        &client,
        client.get(format!(
            "{base}/api/threads/import-candidates?provider=codex"
        )),
    )
    .await;
    assert_eq!(
        candidates[0]["sessionId"],
        "01a0634a-23df-7191-acd2-1fca43a10418"
    );

    let imported = json(
        &client,
        client
            .post(format!("{base}/api/threads/import"))
            .json(&json!({
                "sessionId": "codex://threads/01a0634a-23df-7191-acd2-1fca43a10418",
                "provider": "claude"
            })),
    )
    .await;
    assert_eq!(imported["thread"]["provider"], "codex");
    assert_eq!(
        imported["thread"]["providerSessionId"],
        "codex::01a0634a-23df-7191-acd2-1fca43a10418"
    );
    assert_eq!(imported["thread"]["source"], "local_codex_import");
    assert_eq!(imported["thread"]["isLoaded"], false);
    assert_eq!(imported["turns"][0]["items"][0]["text"], "imported prompt");

    let duplicate = json(
        &client,
        client
            .post(format!("{base}/api/threads/import"))
            .json(&json!({
                "sessionId": "01a0634a-23df-7191-acd2-1fca43a10418",
                "provider": "codex"
            })),
    )
    .await;
    assert_eq!(duplicate["thread"]["id"], imported["thread"]["id"]);

    let blocked = client
        .post(format!(
            "{base}/api/threads/{}/prompt",
            imported["thread"]["id"].as_str().unwrap()
        ))
        .json(&json!({ "prompt": "hello" }))
        .send()
        .await
        .unwrap();
    assert_eq!(blocked.status(), reqwest::StatusCode::CONFLICT);
}
