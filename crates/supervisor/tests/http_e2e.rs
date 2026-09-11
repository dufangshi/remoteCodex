use std::sync::Arc;
use std::time::Duration;

use remote_codex_protocol::Provider;
use remote_codex_runtime::actor::SharedRuntime;
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
    let cli = state.configure_cli(format!("http://127.0.0.1:{port}"));
    std::fs::write(dir.path().join("cli-token"), cli.token).unwrap();
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
    assert_eq!(duplicate_steer.status(), reqwest::StatusCode::OK);
    let receipt = json(
        &client,
        client.get(format!("{base}/api/threads/{thread_id}?view=delivery")),
    )
    .await;
    assert_eq!(receipt["turns"], json!([]));
    assert_eq!(receipt["acceptedSteerIds"], json!([steer_id]));

    json(
        &client,
        client.post(format!("{base}/api/threads/{thread_id}/interrupt")),
    )
    .await;
    let settled = wait_thread(&client, &base, thread_id).await;
    assert_eq!(settled["pendingSteers"].as_array().map(Vec::len), Some(0));
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
    let subtree = json(
        &client,
        client.get(format!(
            "{base}/api/workspaces/{workspace_id}/files/tree?path=./src"
        )),
    )
    .await;
    assert_eq!(subtree["name"], "src");
    assert_eq!(subtree["path"], "./src");
    assert_eq!(subtree["children"][0]["path"], "./src/main.rs");
    assert_eq!(subtree["childrenLoaded"], true);

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
            let attachment_dir = proj.join(".temp/threads").join(&thread_id);
            std::fs::create_dir_all(&attachment_dir).unwrap();
            std::fs::copy(proj.join("dot.png"), attachment_dir.join("dot.png")).unwrap();
            let image = client
                .get(format!(
                    "{base}/api/threads/{thread_id}/assets/image?path=./.temp/threads/{thread_id}/dot.png"
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
                "{base}/api/threads/{thread_id}/exports/html?format=html&mode=latest&limit=10"
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
        assert_eq!(pdf.status(), 404);
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
    assert!(interrupted["turns"]
        .as_array()
        .and_then(|turns| turns.last())
        .and_then(|turn| turn["completedAt"].as_str())
        .is_some());
}

#[tokio::test]
async fn local_cli_requires_credentials_and_exposes_existing_threads() {
    let (dir, port, root) = spawn_supervisor(vec![Provider::Codex, Provider::Acp]).await;
    let client = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");
    let denied = client
        .post(format!("{base}/api/cli"))
        .json(&json!({"operation":"list"}))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), reqwest::StatusCode::UNAUTHORIZED);
    let token = std::fs::read_to_string(dir.path().join("cli-token")).unwrap();
    let path = root.join("cli-project");
    std::fs::create_dir_all(&path).unwrap();
    let ws: Value = client
        .post(format!("{base}/api/workspaces"))
        .json(&json!({"absPath":path,"label":"cli-project"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let created:Value=client.post(format!("{base}/api/cli")).bearer_auth(&token).json(&json!({"operation":"create","workspaceId":ws["id"],"provider":"acp","agentId":"grok","model":"ios-e2e-stream","approvalMode":"yolo"})).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let id = created["threadId"].as_str().unwrap();
    let receipt: Value = client
        .post(format!("{base}/api/cli"))
        .bearer_auth(&token)
        .json(&json!({"operation":"send","delivery":"queue","threadId":id,"text":"hello"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(receipt["delivery"], "queued");
    assert!(receipt["pendingSteerId"].is_string());
    for _ in 0..80 {
        let status: Value = client
            .post(format!("{base}/api/cli"))
            .bearer_auth(&token)
            .json(&json!({"operation":"status","threadId":id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(status.get("turns").is_none());
        if status["status"] == "idle" && status["queuedCount"] == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let transcript: Value = client
        .post(format!("{base}/api/cli"))
        .bearer_auth(&token)
        .json(&json!({"operation":"transcript","threadId":id}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(transcript["turns"][0]["items"][1]["text"], "hello");
}
