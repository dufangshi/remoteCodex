use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

pub struct Pending {
    pub tx: oneshot::Sender<Result<Value>>,
}

/// One ACP stdio process. stdin is locked only for the write, so multiple
/// sessions on the same process can request/notify concurrently.
pub struct AcpProcess {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<Mutex<HashMap<i64, Pending>>>,
    next_id: AtomicI64,
}

impl AcpProcess {
    pub async fn spawn(
        command: &str,
        cwd: &str,
        extra_env: &[(&str, String)],
    ) -> Result<(
        Self,
        mpsc::UnboundedReceiver<Value>,
        mpsc::UnboundedReceiver<(i64, String, Value)>,
    )> {
        let mut parts = command.split_whitespace();
        let exe = parts.next().ok_or_else(|| anyhow!("empty ACP command"))?;
        let args: Vec<&str> = parts.collect();
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (key, value) in extra_env {
            cmd.env(key, value);
        }
        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn ACP `{command}`"))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("missing stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("missing stdout"))?;
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                loop {
                    match stderr.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            tracing::debug!(target: "acp.stderr", "{}", String::from_utf8_lossy(&buf[..n]));
                        }
                    }
                }
            });
        }
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (updates_tx, updates_rx) = mpsc::unbounded_channel();
        let (req_tx, req_rx) = mpsc::unbounded_channel();
        let pending_reader = pending.clone();
        tokio::spawn(async move {
            if let Err(err) = read_loop(stdout, pending_reader, updates_tx, req_tx).await {
                tracing::warn!(error = %err, "ACP reader exited");
            }
        });
        Ok((
            Self {
                stdin: Mutex::new(stdin),
                child: Mutex::new(child),
                pending,
                next_id: AtomicI64::new(1),
            },
            updates_rx,
            req_rx,
        ))
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, Pending { tx });
        {
            let mut stdin = self.stdin.lock().await;
            write_message(
                &mut stdin,
                &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
            )
            .await?;
        }
        timeout(Duration::from_secs(180), rx)
            .await
            .context("ACP request timeout")?
            .map_err(|_| anyhow!("ACP request dropped"))?
    }

    pub async fn respond(&self, id: i64, result: Value) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        write_message(
            &mut stdin,
            &json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        )
        .await
    }

    pub async fn respond_error(&self, id: i64, message: &str) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        write_message(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32000, "message": message }
            }),
        )
        .await
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let mut stdin = self.stdin.lock().await;
        write_message(
            &mut stdin,
            &json!({ "jsonrpc": "2.0", "method": method, "params": params }),
        )
        .await
    }

    pub async fn exited(&self) -> Result<bool> {
        Ok(self.child.lock().await.try_wait()?.is_some())
    }
}

async fn write_message(stdin: &mut ChildStdin, value: &Value) -> Result<()> {
    let mut body = serde_json::to_vec(value)?;
    body.push(b'\n');
    stdin.write_all(&body).await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_loop(
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<i64, Pending>>>,
    updates: mpsc::UnboundedSender<Value>,
    requests: mpsc::UnboundedSender<(i64, String, Value)>,
) -> Result<()> {
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf).await?;
        if n == 0 {
            break;
        }
        let line = String::from_utf8_lossy(&buf);
        let msg = if line.to_ascii_lowercase().starts_with("content-length:") {
            let len: usize = line
                .split(':')
                .nth(1)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
            let mut rest = String::new();
            loop {
                rest.clear();
                reader.read_line(&mut rest).await?;
                if rest.trim().is_empty() {
                    break;
                }
            }
            let mut body = vec![0; len];
            reader.read_exact(&mut body).await?;
            serde_json::from_slice::<Value>(&body)?
        } else {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            serde_json::from_str::<Value>(trimmed)?
        };
        dispatch(msg, &pending, &updates, &requests).await;
    }
    Ok(())
}

async fn dispatch(
    msg: Value,
    pending: &Arc<Mutex<HashMap<i64, Pending>>>,
    updates: &mpsc::UnboundedSender<Value>,
    requests: &mpsc::UnboundedSender<(i64, String, Value)>,
) {
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    if let Some(id) = msg.get("id").and_then(Value::as_i64) {
        if !method.is_empty() {
            let _ = requests.send((
                id,
                method.to_string(),
                msg.get("params").cloned().unwrap_or(json!({})),
            ));
            return;
        }
        if let Some(pending) = pending.lock().await.remove(&id) {
            if let Some(error) = msg.get("error") {
                let _ = pending.tx.send(Err(anyhow!("{error}")));
            } else {
                let _ = pending
                    .tx
                    .send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
            }
        }
        return;
    }
    if method == "session/update" {
        let _ = updates.send(msg.get("params").cloned().unwrap_or(json!({})));
    }
}

impl Drop for AcpProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.start_kill();
        }
    }
}
