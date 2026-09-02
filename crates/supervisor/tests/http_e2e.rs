use std::sync::Arc;
use std::time::Duration;

use remote_codex_protocol::Provider;
use remote_codex_runtime::actor::SharedRuntime;
use remote_codex_runtime::config::RuntimeConfig;
use remote_codex_runtime::db::Database;
use remote_codex_runtime::fake::FakeRuntime;
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use tempfile::tempdir;
use tokio::net::TcpListener;

async fn spawn_supervisor(
    providers: Vec<Provider>,
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
    let runtimes: Vec<SharedRuntime> = providers
        .into_iter()
        .map(|provider| Arc::new(FakeRuntime::new(provider)) as SharedRuntime)
        .collect();
    let state = Arc::new(Supervisor::new(config, db, runtimes));
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

        let html = client
            .get(format!("{base}/api/threads/{thread_id}/exports/html"))
            .send()
            .await
            .unwrap();
        assert_eq!(html.status(), 200);
        assert!(html.text().await.unwrap().contains("hello"));
        let pdf = client
            .get(format!("{base}/api/threads/{thread_id}/exports/pdf"))
            .send()
            .await
            .unwrap();
        assert_eq!(pdf.status(), 200);
        assert_eq!(
            pdf.headers().get("content-type").unwrap(),
            "application/pdf"
        );
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
