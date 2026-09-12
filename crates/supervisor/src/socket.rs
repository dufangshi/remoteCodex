use std::sync::Arc;

use crate::bounded_channel as mpsc;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use remote_codex_protocol::{now_rfc3339, SupervisorConnectedEnvelope};
use remote_codex_runtime::Supervisor;
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) struct SocketSession {
    input: mpsc::Sender<Value>,
    task: tokio::task::JoinHandle<()>,
}

impl SocketSession {
    pub(crate) fn spawn(state: Arc<Supervisor>, output: mpsc::Sender<Value>) -> Self {
        let (input, incoming) = mpsc::channel();
        let task = tokio::spawn(run_socket_session(state, incoming, output));
        Self { input, task }
    }

    pub(crate) fn send(&self, message: Value) -> bool {
        self.input.send(message).is_ok()
    }
}

impl Drop for SocketSession {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) async fn websocket_loop(socket: WebSocket, state: Arc<Supervisor>) {
    let (output, mut outgoing) = mpsc::channel();
    let session = SocketSession::spawn(state, output);
    let (mut sink, mut stream) = socket.split();

    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(message) = serde_json::from_str::<Value>(&text) {
                            if !session.send(message) {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            outgoing = outgoing.recv() => {
                let Some(outgoing) = outgoing else {
                    break;
                };
                if sink.send(Message::Text(outgoing.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    drop(session);
}

async fn run_socket_session(
    state: Arc<Supervisor>,
    mut incoming: mpsc::Receiver<Value>,
    output: mpsc::Sender<Value>,
) {
    let mut client_state = SocketClientState::default();
    let mut events = state.bus.subscribe();
    let mut shells = crate::shells::hub().subscribe_all();
    if output
        .send(
            serde_json::to_value(SupervisorConnectedEnvelope {
                event_type: "supervisor.connected".into(),
                timestamp: now_rfc3339(),
            })
            .unwrap_or_else(
                |_| json!({ "type": "supervisor.connected", "timestamp": now_rfc3339() }),
            ),
        )
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            message = incoming.recv() => {
                let Some(message) = message else {
                    break;
                };
                for response in handle_client_message(&message, &mut client_state) {
                    if output.send(response).is_err() {
                        return;
                    }
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        let event = serde_json::to_value(event).unwrap_or_else(|_| json!({}));
                        if output.send(event).is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "supervisor socket client lagged thread events");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            shell = shells.recv() => {
                match shell {
                    Ok(shell) => {
                        if client_state.attached_shell_id.as_deref() != Some(&shell.shell_id) {
                            continue;
                        }
                        let message = json!({
                            "type": "shell.output",
                            "shellId": shell.shell_id,
                            "timestamp": now_rfc3339(),
                            "payload": { "data": shell.data }
                        });
                        if output.send(message).is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "supervisor socket client lagged terminal output");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

#[derive(Default)]
struct SocketClientState {
    attached_shell_id: Option<String>,
    viewer_id: Option<String>,
}

fn handle_client_message(message: &Value, state: &mut SocketClientState) -> Vec<Value> {
    match message.get("type").and_then(Value::as_str) {
        Some("supervisor.ping") => vec![json!({
            "type": "supervisor.pong",
            "timestamp": now_rfc3339(),
            "payload": {
                "requestTimestamp": message.get("timestamp").and_then(Value::as_str)
            }
        })],
        Some("shell.attach") => {
            let (Some(id), Some(cols), Some(rows)) = (
                message.get("shellId").and_then(Value::as_str),
                message.get("cols").and_then(Value::as_u64),
                message.get("rows").and_then(Value::as_u64),
            ) else {
                return shell_error(message, "invalid_request", "Invalid shell attach request");
            };
            let shell = match crate::shells::hub().get(id) {
                Ok(shell) => shell,
                Err(error) => return shell_error(message, "shell_not_found", &error.to_string()),
            };
            if let Err(error) = crate::shells::hub().resize(id, cols as u16, rows as u16) {
                return shell_error(message, "resize_failed", &error.to_string());
            }
            let viewer_id = Uuid::new_v4().to_string();
            state.attached_shell_id = Some(id.to_string());
            state.viewer_id = Some(viewer_id.clone());
            vec![
                json!({
                    "type": "shell.connected",
                    "shellId": id,
                    "timestamp": now_rfc3339(),
                    "payload": { "viewerId": viewer_id }
                }),
                json!({
                    "type": "shell.status",
                    "shellId": id,
                    "timestamp": now_rfc3339(),
                    "payload": {
                        "threadId": shell.get("threadId").cloned().unwrap_or(Value::Null),
                        "state": "attached",
                        "viewerId": viewer_id
                    }
                }),
            ]
        }
        Some("shell.detach") => {
            let Some((shell_id, viewer_id)) = owned_shell(message, state) else {
                return shell_error(
                    message,
                    "invalid_viewer",
                    "This browser session does not own the shell attachment",
                );
            };
            let shell_id = shell_id.to_string();
            let viewer_id = viewer_id.to_string();
            state.attached_shell_id = None;
            state.viewer_id = None;
            vec![json!({
                "type": "shell.detached",
                "shellId": shell_id,
                "timestamp": now_rfc3339(),
                "payload": {
                    "state": "detached",
                    "viewerId": viewer_id
                }
            })]
        }
        Some("shell.input") => {
            let Some((shell_id, _)) = owned_shell(message, state) else {
                return shell_error(
                    message,
                    "invalid_viewer",
                    "This browser session does not own the shell attachment",
                );
            };
            let Some(data) = message.get("data").and_then(Value::as_str) else {
                return shell_error(message, "invalid_request", "Shell input data is required");
            };
            if let Err(error) = crate::shells::hub().write(shell_id, data) {
                return shell_error(message, "input_failed", &error.to_string());
            }
            Vec::new()
        }
        Some("shell.resize") => {
            let Some((shell_id, _)) = owned_shell(message, state) else {
                return shell_error(
                    message,
                    "invalid_viewer",
                    "This browser session does not own the shell attachment",
                );
            };
            let (Some(cols), Some(rows)) = (
                message.get("cols").and_then(Value::as_u64),
                message.get("rows").and_then(Value::as_u64),
            ) else {
                return shell_error(message, "invalid_request", "Invalid shell size");
            };
            if let Err(error) = crate::shells::hub().resize(shell_id, cols as u16, rows as u16) {
                return shell_error(message, "resize_failed", &error.to_string());
            }
            Vec::new()
        }
        Some("shell.clear") => {
            let Some((shell_id, _)) = owned_shell(message, state) else {
                return shell_error(
                    message,
                    "invalid_viewer",
                    "This browser session does not own the shell attachment",
                );
            };
            if let Err(error) = crate::shells::hub().write(shell_id, "\u{000c}") {
                return shell_error(message, "clear_failed", &error.to_string());
            }
            vec![json!({
                "type": "shell.output",
                "shellId": shell_id,
                "timestamp": now_rfc3339(),
                "payload": { "data": "", "replace": true }
            })]
        }
        _ => Vec::new(),
    }
}

fn owned_shell<'a>(message: &'a Value, state: &'a SocketClientState) -> Option<(&'a str, &'a str)> {
    let shell_id = message.get("shellId").and_then(Value::as_str)?;
    let viewer_id = message.get("viewerId").and_then(Value::as_str)?;
    (state.attached_shell_id.as_deref() == Some(shell_id)
        && state.viewer_id.as_deref() == Some(viewer_id))
    .then_some((shell_id, viewer_id))
}

fn shell_error(message: &Value, code: &str, error_message: &str) -> Vec<Value> {
    let Some(shell_id) = message.get("shellId").and_then(Value::as_str) else {
        return Vec::new();
    };
    vec![json!({
        "type": "shell.error",
        "shellId": shell_id,
        "timestamp": now_rfc3339(),
        "payload": { "code": code, "message": error_message }
    })]
}
