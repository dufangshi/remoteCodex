use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use remote_codex_protocol::now_rfc3339;
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

pub async fn run_relay_tunnel(state: Arc<Supervisor>) -> Result<()> {
    let url = state
        .config
        .relay_server_url
        .clone()
        .ok_or_else(|| anyhow!("REMOTE_CODEX_RELAY_SERVER_URL is required"))?;
    let token = state
        .config
        .relay_agent_token
        .clone()
        .ok_or_else(|| anyhow!("REMOTE_CODEX_RELAY_AGENT_TOKEN is required"))?;
    let ws_base = if let Some(rest) = url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        url.clone()
    };
    let join = if ws_base.contains('?') { "&" } else { "?" };
    let ws_url = format!("{ws_base}/supervisor/tunnel{join}deviceToken={token}");
    loop {
        match connect_async(&ws_url).await {
            Ok((mut socket, _)) => {
                tracing::info!("relay tunnel connected");
                let hello = json!({
                    "type": "relay.connected",
                    "timestamp": now_rfc3339()
                });
                let _ = socket.send(Message::Text(hello.to_string().into())).await;
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(30)) => {
                            let beat = json!({ "type": "relay.heartbeat", "timestamp": now_rfc3339() });
                            if socket.send(Message::Text(beat.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                        incoming = socket.next() => {
                            match incoming {
                                Some(Ok(Message::Text(text))) => {
                                    if let Ok(msg) = serde_json::from_str::<Value>(&text) {
                                        if msg.get("type").and_then(Value::as_str) == Some("relay.request") {
                                            let request_id = msg.get("requestId").and_then(Value::as_str).unwrap_or("");
                                            let payload = msg.get("payload").cloned().unwrap_or(json!({}));
                                            let forwarded = forward_local(&state, payload).await;
                                            let response = json!({
                                                "type": "relay.response",
                                                "timestamp": now_rfc3339(),
                                                "requestId": request_id,
                                                "payload": forwarded
                                            });
                                            let _ = socket.send(Message::Text(response.to_string().into())).await;
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None => break,
                                Some(Err(_)) => break,
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "relay tunnel connect failed");
            }
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn forward_local(state: &Arc<Supervisor>, payload: Value) -> Value {
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    let path = payload.get("path").and_then(Value::as_str).unwrap_or("/");
    let body = payload.get("body").and_then(Value::as_str).unwrap_or("");
    let url = format!("http://127.0.0.1:{}{path}", state.config.port);
    let client = reqwest::Client::new();
    let mut req = match method {
        "POST" => client.post(&url),
        "PATCH" => client.patch(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };
    if !body.is_empty() {
        req = req
            .header("content-type", "application/json")
            .body(body.to_string());
    }
    req = req.header("x-remote-codex-relay-forwarded", "1");
    match req.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            json!({
                "statusCode": status,
                "headers": { "content-type": "application/json" },
                "body": body
            })
        }
        Err(err) => json!({
            "statusCode": 502,
            "headers": { "content-type": "application/json" },
            "body": format!("{{\"code\":\"gateway_unavailable\",\"message\":\"{err}\"}}")
        }),
    }
}
