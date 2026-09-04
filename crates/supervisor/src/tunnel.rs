use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use remote_codex_protocol::{now_rfc3339, ThreadEventEnvelope};
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use url::Url;

const RELAY_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const RELAY_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const RELAY_RECONNECT_INITIAL_DELAY: Duration = Duration::from_secs(1);
const RELAY_RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);

struct RelayClientSession {
    socket: crate::socket::SocketSession,
    bridge: tokio::task::JoinHandle<()>,
}

impl Drop for RelayClientSession {
    fn drop(&mut self) {
        self.bridge.abort();
    }
}

pub async fn run_relay_tunnel(state: Arc<Supervisor>) -> Result<()> {
    let server_url = state
        .config
        .relay_server_url
        .as_deref()
        .ok_or_else(|| anyhow!("REMOTE_CODEX_RELAY_SERVER_URL is required"))?;
    let token = state
        .config
        .relay_agent_token
        .as_deref()
        .ok_or_else(|| anyhow!("REMOTE_CODEX_RELAY_AGENT_TOKEN is required"))?;
    let tunnel_url = relay_tunnel_url(server_url, token)?;
    let mut reconnect_delay = RELAY_RECONNECT_INITIAL_DELAY;

    loop {
        match tokio::time::timeout(RELAY_CONNECT_TIMEOUT, connect_async(tunnel_url.as_str())).await
        {
            Ok(Ok((socket, _))) => {
                tracing::info!(relay_origin = %tunnel_url.origin().ascii_serialization(), "relay tunnel connected");
                reconnect_delay = RELAY_RECONNECT_INITIAL_DELAY;
                if let Err(error) = run_connected_tunnel(state.clone(), socket).await {
                    tracing::warn!(%error, "relay tunnel connection ended");
                }
            }
            Ok(Err(_)) => {
                // Do not log the websocket error verbatim: some implementations
                // include the credential-bearing URL in connection errors.
                tracing::warn!("relay tunnel connect failed");
            }
            Err(_) => {
                tracing::warn!("relay tunnel connection attempt timed out");
            }
        }
        tokio::time::sleep(reconnect_delay).await;
        reconnect_delay = reconnect_delay
            .checked_mul(2)
            .unwrap_or(RELAY_RECONNECT_MAX_DELAY)
            .min(RELAY_RECONNECT_MAX_DELAY);
    }
}

fn relay_tunnel_url(server_url: &str, token: &str) -> Result<Url> {
    let mut url = Url::parse(server_url)?;
    match url.scheme() {
        "http" => url
            .set_scheme("ws")
            .map_err(|_| anyhow!("invalid relay server URL scheme"))?,
        "https" => url
            .set_scheme("wss")
            .map_err(|_| anyhow!("invalid relay server URL scheme"))?,
        "ws" | "wss" => {}
        scheme => return Err(anyhow!("unsupported relay server URL scheme: {scheme}")),
    }
    url.set_path("/supervisor/tunnel");
    url.set_query(None);
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("token", token);
        query.append_pair("deviceToken", token);
    }
    Ok(url)
}

async fn run_connected_tunnel(
    state: Arc<Supervisor>,
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<()> {
    let (mut sink, mut stream) = socket.split();
    let (outgoing, mut outbound) = mpsc::unbounded_channel::<Value>();
    let mut clients = HashMap::<String, RelayClientSession>::new();
    let mut heartbeat = tokio::time::interval(RELAY_HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut activity = state.bus.subscribe();

    outgoing
        .send(json!({ "type": "relay.heartbeat", "timestamp": now_rfc3339() }))
        .map_err(|_| anyhow!("relay tunnel writer closed"))?;
    // Consume the interval's immediate first tick because the initial heartbeat
    // was queued explicitly above.
    heartbeat.tick().await;

    loop {
        tokio::select! {
            message = outbound.recv() => {
                let Some(message) = message else {
                    return Err(anyhow!("relay tunnel writer closed"));
                };
                sink.send(Message::Text(message.to_string().into())).await?;
            }
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(message) = serde_json::from_str::<Value>(&text) else {
                            continue;
                        };
                        handle_relay_message(
                            state.clone(),
                            &mut clients,
                            &outgoing,
                            message,
                        );
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        sink.send(Message::Pong(payload)).await?;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        return Err(anyhow!("relay tunnel closed: {frame:?}"));
                    }
                    Some(Err(error)) => return Err(error.into()),
                    None => return Err(anyhow!("relay tunnel closed")),
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                if outgoing.send(json!({
                    "type": "relay.heartbeat",
                    "timestamp": now_rfc3339()
                })).is_err() {
                    return Err(anyhow!("relay tunnel writer closed"));
                }
            }
            event = activity.recv() => {
                match event {
                    Ok(event) => {
                        if let Some(activity) = relay_activity(&event) {
                            let _ = outgoing.send(activity);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "relay tunnel lagged turn lifecycle activity");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {}
                }
            }
        }
    }
}

fn handle_relay_message(
    state: Arc<Supervisor>,
    clients: &mut HashMap<String, RelayClientSession>,
    outgoing: &mpsc::UnboundedSender<Value>,
    message: Value,
) {
    match message.get("type").and_then(Value::as_str) {
        Some("relay.request") => {
            let Some(request_id) = message
                .get("requestId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
            else {
                return;
            };
            let payload = message.get("payload").cloned().unwrap_or_else(|| json!({}));
            let outgoing = outgoing.clone();
            tokio::spawn(async move {
                let payload = forward_local(&state, payload).await;
                let _ = outgoing.send(json!({
                    "type": "relay.response",
                    "timestamp": now_rfc3339(),
                    "requestId": request_id,
                    "payload": payload
                }));
            });
        }
        Some("relay.client.connected") => {
            if let Some(client_id) = message
                .get("clientId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                connect_relay_client(state, clients, outgoing, client_id.to_string());
            }
        }
        Some("relay.client.message") => {
            if let (Some(client_id), Some(payload)) = (
                message.get("clientId").and_then(Value::as_str),
                message.get("payload"),
            ) {
                if let Some(client) = clients.get(client_id) {
                    let _ = client.socket.send(payload.clone());
                }
            }
        }
        Some("relay.client.disconnected") => {
            if let Some(client_id) = message.get("clientId").and_then(Value::as_str) {
                clients.remove(client_id);
            }
        }
        _ => {}
    }
}

fn connect_relay_client(
    state: Arc<Supervisor>,
    clients: &mut HashMap<String, RelayClientSession>,
    outgoing: &mpsc::UnboundedSender<Value>,
    client_id: String,
) {
    clients.remove(&client_id);
    let (session_output, mut output) = mpsc::unbounded_channel::<Value>();
    let socket = crate::socket::SocketSession::spawn(state, session_output);
    let relay_output = outgoing.clone();
    let output_client_id = client_id.clone();
    let bridge = tokio::spawn(async move {
        while let Some(payload) = output.recv().await {
            if relay_output
                .send(json!({
                    "type": "relay.server.message",
                    "timestamp": now_rfc3339(),
                    "clientId": output_client_id,
                    "payload": payload
                }))
                .is_err()
            {
                break;
            }
        }
    });
    clients.insert(client_id, RelayClientSession { socket, bridge });
}

fn relay_activity(event: &ThreadEventEnvelope) -> Option<Value> {
    let kind = match event.event_type.as_str() {
        "thread.turn.started" => "turn_started",
        "thread.turn.completed" => "turn_terminal",
        _ => return None,
    };
    let turn_id = event.payload.get("turnId").and_then(Value::as_str)?;
    Some(json!({
        "type": "relay.activity",
        "timestamp": now_rfc3339(),
        "payload": {
            "kind": kind,
            "threadId": event.thread_id,
            "turnId": turn_id
        }
    }))
}

async fn forward_local(state: &Arc<Supervisor>, payload: Value) -> Value {
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    let path = payload.get("path").and_then(Value::as_str).unwrap_or("/");
    if !path.starts_with('/') || !(path == "/healthz" || path.starts_with("/api/")) {
        return relay_error_response(403, "This relay path is not allowed.");
    }
    let Ok(method) = reqwest::Method::from_bytes(method.as_bytes()) else {
        return relay_error_response(400, "Invalid relay request method.");
    };
    let url = format!("http://127.0.0.1:{}{path}", state.config.port);
    let client = reqwest::Client::new();
    let mut request = client
        .request(method, &url)
        .header("x-remote-codex-relay-forwarded", "1");
    if let Some(headers) = payload.get("headers").and_then(Value::as_object) {
        for name in ["content-type", "accept", "if-none-match", "range"] {
            if let Some(value) = headers.get(name).and_then(Value::as_str) {
                request = request.header(name, value);
            }
        }
    }
    let body = match decode_relay_request_body(&payload) {
        Ok(body) => body,
        Err(message) => return relay_error_response(400, message),
    };
    if let Some(bytes) = body {
        request = request.body(bytes);
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    matches!(
                        name.as_str(),
                        "content-type"
                            | "content-disposition"
                            | "cache-control"
                            | "x-content-type-options"
                    )
                    .then(|| {
                        value.to_str().ok().map(|value| {
                            (name.as_str().to_string(), Value::String(value.to_string()))
                        })
                    })
                    .flatten()
                })
                .collect::<serde_json::Map<String, Value>>();
            let content_type = headers
                .get("content-type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let bytes = response.bytes().await.unwrap_or_default();
            let text_response = content_type.starts_with("text/")
                || content_type.contains("application/json")
                || content_type.contains("+json")
                || content_type.contains("application/javascript")
                || content_type.contains("application/xml")
                || content_type.contains("+xml")
                || content_type.contains("image/svg+xml");
            if text_response {
                json!({
                    "statusCode": status,
                    "headers": headers,
                    "body": String::from_utf8_lossy(&bytes)
                })
            } else {
                json!({
                    "statusCode": status,
                    "headers": headers,
                    "body": base64::engine::general_purpose::STANDARD.encode(bytes),
                    "bodyEncoding": "base64"
                })
            }
        }
        Err(error) => relay_error_response(502, &format!("Local supervisor unavailable: {error}")),
    }
}

fn decode_relay_request_body(payload: &Value) -> Result<Option<Vec<u8>>, &'static str> {
    let Some(body) = payload.get("body") else {
        return Ok(None);
    };
    if body.is_null() {
        return Ok(None);
    }
    let Some(body) = body.as_str() else {
        return Err("Invalid relay request body.");
    };
    if payload.get("bodyEncoding").and_then(Value::as_str) == Some("base64") {
        base64::engine::general_purpose::STANDARD
            .decode(body)
            .map(Some)
            .map_err(|_| "Invalid base64 relay request body.")
    } else {
        Ok(Some(body.as_bytes().to_vec()))
    }
}

fn relay_error_response(status_code: u16, message: &str) -> Value {
    json!({
        "statusCode": status_code,
        "headers": { "content-type": "application/json" },
        "body": json!({
            "code": "gateway_unavailable",
            "message": message
        }).to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use remote_codex_protocol::{Mode, Provider};
    use remote_codex_runtime::actor::SharedRuntime;
    use remote_codex_runtime::config::RuntimeConfig;
    use remote_codex_runtime::db::Database;
    use remote_codex_runtime::fake::FakeRuntime;
    use tempfile::TempDir;

    fn state() -> (TempDir, Arc<Supervisor>) {
        state_with_relay_url("https://relay.example.test/base")
    }

    fn state_with_relay_url(relay_url: &str) -> (TempDir, Arc<Supervisor>) {
        let directory = tempfile::tempdir().unwrap();
        let config = RuntimeConfig {
            mode: Mode::Relay,
            host: "127.0.0.1".into(),
            port: 0,
            workspace_root: directory.path().join("workspaces"),
            database_url: directory.path().join("supervisor.sqlite"),
            app_name: "test".into(),
            app_version: "0.12.0".into(),
            environment: "test".into(),
            auth_required: true,
            admin_username: Some("admin".into()),
            admin_password: Some("secret123".into()),
            session_secret: Some("0123456789abcdef".into()),
            relay_server_url: Some(relay_url.into()),
            relay_agent_token: Some("agent token/+".into()),
            enabled_providers: vec![Provider::Codex],
            acp_command: None,
            acp_startup_timeout_ms: 1_000,
            fake_runtime: true,
        };
        std::fs::create_dir_all(&config.workspace_root).unwrap();
        let database = Database::open(&config.database_url).unwrap();
        let runtime = Arc::new(FakeRuntime::new(Provider::Codex)) as SharedRuntime;
        (
            directory,
            Arc::new(Supervisor::new(config, database, vec![runtime])),
        )
    }

    #[test]
    fn builds_node_compatible_tunnel_url() {
        let url =
            relay_tunnel_url("https://relay.example.test/base?old=1", "agent token/+").unwrap();
        assert_eq!(url.scheme(), "wss");
        assert_eq!(url.path(), "/supervisor/tunnel");
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            vec![
                ("token".into(), "agent token/+".into()),
                ("deviceToken".into(), "agent token/+".into())
            ]
        );
    }

    #[test]
    fn restores_node_base64_request_body_without_utf8_loss() {
        let expected = b"multipart-prefix\0\xff\x80binary";
        let payload = json!({
            "body": base64::engine::general_purpose::STANDARD.encode(expected),
            "bodyEncoding": "base64"
        });
        assert_eq!(
            decode_relay_request_body(&payload).unwrap().unwrap(),
            expected
        );
        assert!(decode_relay_request_body(&json!({
            "body": "not-base64!",
            "bodyEncoding": "base64"
        }))
        .is_err());
    }

    #[tokio::test]
    async fn relay_client_envelopes_use_the_shared_socket_session() {
        let (_directory, state) = state();
        let (outgoing, mut output) = mpsc::unbounded_channel();
        let mut clients = HashMap::new();
        handle_relay_message(
            state.clone(),
            &mut clients,
            &outgoing,
            json!({
                "type": "relay.client.connected",
                "clientId": "client-1",
                "timestamp": now_rfc3339()
            }),
        );
        let connected = tokio::time::timeout(Duration::from_secs(1), output.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(connected["type"], "relay.server.message");
        assert_eq!(connected["clientId"], "client-1");
        assert_eq!(connected["payload"]["type"], "supervisor.connected");

        handle_relay_message(
            state,
            &mut clients,
            &outgoing,
            json!({
                "type": "relay.client.message",
                "clientId": "client-1",
                "payload": {
                    "type": "supervisor.ping",
                    "timestamp": "2026-09-03T12:00:00.000Z"
                }
            }),
        );
        let pong = tokio::time::timeout(Duration::from_secs(1), output.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pong["payload"]["type"], "supervisor.pong");
        assert_eq!(
            pong["payload"]["payload"]["requestTimestamp"],
            "2026-09-03T12:00:00.000Z"
        );
    }

    #[tokio::test]
    async fn websocket_tunnel_routes_a_relay_client_session_end_to_end() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let relay_url = format!("ws://{}", listener.local_addr().unwrap());
        let (_directory, state) = state_with_relay_url(&relay_url);
        let tunnel = tokio::spawn(run_relay_tunnel(state));
        let (tcp, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut relay = tokio_tungstenite::accept_async(tcp).await.unwrap();

        let heartbeat = tokio::time::timeout(Duration::from_secs(2), relay.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let heartbeat: Value = serde_json::from_str(heartbeat.to_text().unwrap()).unwrap();
        assert_eq!(heartbeat["type"], "relay.heartbeat");

        relay
            .send(Message::Text(
                json!({
                    "type": "relay.client.connected",
                    "timestamp": now_rfc3339(),
                    "clientId": "client-e2e"
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        let connected = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let message = relay.next().await.unwrap().unwrap();
                let value: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                if value["type"] == "relay.server.message"
                    && value["payload"]["type"] == "supervisor.connected"
                {
                    break value;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(connected["clientId"], "client-e2e");

        relay
            .send(Message::Text(
                json!({
                    "type": "relay.client.message",
                    "timestamp": now_rfc3339(),
                    "clientId": "client-e2e",
                    "payload": {
                        "type": "supervisor.ping",
                        "timestamp": "2026-09-03T12:00:00.000Z"
                    }
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        let pong = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let message = relay.next().await.unwrap().unwrap();
                let value: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                if value["type"] == "relay.server.message"
                    && value["payload"]["type"] == "supervisor.pong"
                {
                    break value;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(
            pong["payload"]["payload"]["requestTimestamp"],
            "2026-09-03T12:00:00.000Z"
        );
        tunnel.abort();
    }
}
