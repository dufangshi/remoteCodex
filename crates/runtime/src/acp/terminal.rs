use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use uuid::Uuid;

struct LiveTerminal {
    output: std::sync::Arc<Mutex<String>>,
    child_id: u32,
    killed: std::sync::Arc<Mutex<bool>>,
}

#[derive(Default)]
pub struct AgentTerminals {
    inner: Mutex<HashMap<String, LiveTerminal>>,
}

impl AgentTerminals {
    pub async fn create(&self, command: &str, args: &[String], cwd: PathBuf) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let mut cmd = Command::new(command);
        cmd.args(args)
            .current_dir(&cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn()?;
        let child_id = child.id().unwrap_or(0);
        let output = std::sync::Arc::new(Mutex::new(String::new()));
        let killed = std::sync::Arc::new(Mutex::new(false));
        if let Some(mut stdout) = child.stdout.take() {
            let output = output.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                while let Ok(n) = stdout.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    output
                        .lock()
                        .unwrap()
                        .push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            });
        }
        if let Some(mut stderr) = child.stderr.take() {
            let output = output.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                while let Ok(n) = stderr.read(&mut buf).await {
                    if n == 0 {
                        break;
                    }
                    output
                        .lock()
                        .unwrap()
                        .push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            });
        }
        let killed_flag = killed.clone();
        tokio::spawn(async move {
            let _ = child.wait().await;
            *killed_flag.lock().unwrap() = true;
        });
        self.inner.lock().unwrap().insert(
            id.clone(),
            LiveTerminal {
                output,
                child_id,
                killed,
            },
        );
        let _ = child_id;
        Ok(id)
    }

    pub fn output(&self, id: &str) -> Result<Value> {
        let hub = self.inner.lock().unwrap();
        let term = hub.get(id).ok_or_else(|| anyhow!("terminal not found"))?;
        let output = term.output.lock().unwrap().clone();
        let exited = *term.killed.lock().unwrap();
        Ok(json!({
            "output": output,
            "truncated": false,
            "exitStatus": if exited { json!({ "exitCode": 0, "signal": null }) } else { Value::Null }
        }))
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let hub = self.inner.lock().unwrap();
        let term = hub.get(id).ok_or_else(|| anyhow!("terminal not found"))?;
        if term.child_id > 0 {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &term.child_id.to_string()])
                .status();
        }
        Ok(())
    }

    pub fn release(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }
}
