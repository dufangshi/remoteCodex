use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use remote_codex_protocol::now_rfc3339;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone)]
pub struct ShellOutput {
    pub shell_id: String,
    pub data: String,
}

struct LiveShell {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    #[allow(dead_code)]
    events: broadcast::Sender<String>,
    thread_id: String,
    workspace_id: String,
    cwd: String,
    tmux_session_name: String,
    created_at: String,
    metadata: Arc<Mutex<ShellMetadata>>,
}

struct ShellMetadata {
    label: Option<String>,
    cols: u16,
    rows: u16,
    updated_at: String,
    last_activity_at: Option<String>,
}

struct HubState {
    shells: HashMap<String, LiveShell>,
    all: broadcast::Sender<ShellOutput>,
}

pub struct ShellHub {
    inner: Arc<Mutex<HubState>>,
}

impl Default for ShellHub {
    fn default() -> Self {
        let (all, _) = broadcast::channel(256);
        Self {
            inner: Arc::new(Mutex::new(HubState {
                shells: HashMap::new(),
                all,
            })),
        }
    }
}

pub fn hub() -> &'static ShellHub {
    static HUB: std::sync::OnceLock<ShellHub> = std::sync::OnceLock::new();
    HUB.get_or_init(ShellHub::default)
}

impl ShellHub {
    pub fn create(
        &self,
        thread_id: &str,
        workspace_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        label: Option<String>,
    ) -> Result<(String, Value)> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(cwd);
        let child = pair.slave.spawn_command(cmd)?;
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (tx, _) = broadcast::channel(64);
        let events = tx.clone();
        let id = Uuid::new_v4().to_string();
        let all = {
            let hub = self.inner.lock().unwrap();
            hub.all.clone()
        };
        let output_id = id.clone();
        let now = now_rfc3339();
        let metadata = Arc::new(Mutex::new(ShellMetadata {
            label: label.and_then(|label| {
                let label = label.trim();
                (!label.is_empty()).then(|| label.to_string())
            }),
            cols,
            rows,
            updated_at: now.clone(),
            last_activity_at: None,
        }));
        let output_metadata = metadata.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let activity_at = now_rfc3339();
                        let mut metadata = output_metadata.lock().unwrap();
                        metadata.updated_at = activity_at.clone();
                        metadata.last_activity_at = Some(activity_at);
                        drop(metadata);
                        let _ = events.send(data.clone());
                        let _ = all.send(ShellOutput {
                            shell_id: output_id.clone(),
                            data,
                        });
                    }
                }
            }
        });
        self.inner.lock().unwrap().shells.insert(
            id.clone(),
            LiveShell {
                writer: Mutex::new(writer),
                master: Mutex::new(pair.master),
                child: Mutex::new(child),
                events: tx,
                thread_id: thread_id.into(),
                workspace_id: workspace_id.into(),
                cwd: cwd.into(),
                tmux_session_name: format!("remote-codex-pty-{id}"),
                created_at: now,
                metadata,
            },
        );
        Ok((id.clone(), self.shell_json(&id)?))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let hub = self.inner.lock().unwrap();
        let shell = hub
            .shells
            .get(id)
            .ok_or_else(|| anyhow!("shell not found"))?;
        shell.writer.lock().unwrap().write_all(data.as_bytes())?;
        let now = now_rfc3339();
        let mut metadata = shell.metadata.lock().unwrap();
        metadata.updated_at = now.clone();
        metadata.last_activity_at = Some(now);
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let hub = self.inner.lock().unwrap();
        let shell = hub
            .shells
            .get(id)
            .ok_or_else(|| anyhow!("shell not found"))?;
        shell.master.lock().unwrap().resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut metadata = shell.metadata.lock().unwrap();
        metadata.cols = cols;
        metadata.rows = rows;
        metadata.updated_at = now_rfc3339();
        Ok(())
    }

    pub fn update_label(&self, id: &str, label: Option<String>) -> Result<Value> {
        let hub = self.inner.lock().unwrap();
        let shell = hub
            .shells
            .get(id)
            .ok_or_else(|| anyhow!("shell not found"))?;
        let mut metadata = shell.metadata.lock().unwrap();
        metadata.label = label.and_then(|label| {
            let label = label.trim();
            (!label.is_empty()).then(|| label.to_string())
        });
        metadata.updated_at = now_rfc3339();
        drop(metadata);
        self.shell_json_locked(&hub, id)
    }

    pub fn terminate(&self, id: &str) -> Result<Value> {
        let mut hub = self.inner.lock().unwrap();
        let terminated = {
            let shell = hub
                .shells
                .get(id)
                .ok_or_else(|| anyhow!("shell not found"))?;
            let mut child = shell.child.lock().unwrap();
            child.kill()?;
            child.wait()?;
            let mut value = self.shell_json_locked(&hub, id)?;
            value["status"] = json!("exited");
            value["updatedAt"] = json!(now_rfc3339());
            value
        };
        hub.shells.remove(id);
        Ok(terminated)
    }

    pub fn subscribe_all(&self) -> broadcast::Receiver<ShellOutput> {
        self.inner.lock().unwrap().all.subscribe()
    }

    pub fn list_for_thread(&self, thread_id: &str) -> Vec<Value> {
        let hub = self.inner.lock().unwrap();
        hub.shells
            .iter()
            .filter(|(_, shell)| shell.thread_id == thread_id)
            .filter_map(|(id, _)| self.shell_json_locked(&hub, id).ok())
            .collect()
    }

    pub(crate) fn get(&self, id: &str) -> Result<Value> {
        self.shell_json(id)
    }

    fn shell_json(&self, id: &str) -> Result<Value> {
        let hub = self.inner.lock().unwrap();
        self.shell_json_locked(&hub, id)
    }

    fn shell_json_locked(&self, hub: &HubState, id: &str) -> Result<Value> {
        let shell = hub
            .shells
            .get(id)
            .ok_or_else(|| anyhow!("shell not found"))?;
        let metadata = shell.metadata.lock().unwrap();
        Ok(json!({
            "id": id,
            "threadId": shell.thread_id,
            "workspaceId": shell.workspace_id,
            "label": metadata.label,
            "tmuxSessionName": shell.tmux_session_name,
            "backend": "pty",
            "cwd": shell.cwd,
            "status": "running",
            "attachedViewerId": Value::Null,
            "createdAt": shell.created_at,
            "updatedAt": metadata.updated_at,
            "lastActivityAt": metadata.last_activity_at,
            "cols": metadata.cols,
            "rows": metadata.rows
        }))
    }
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_update_and_terminate_manage_the_real_child() {
        let dir = tempfile::tempdir().unwrap();
        let hub = ShellHub::default();
        let (id, created) = hub
            .create(
                "thread-1",
                "workspace-1",
                dir.path().to_str().unwrap(),
                100,
                30,
                None,
            )
            .unwrap();
        assert_eq!(created["workspaceId"], "workspace-1");
        assert_eq!(created["backend"], "pty");
        assert_eq!(created["cols"], 100);

        let updated = hub.update_label(&id, Some("Build shell".into())).unwrap();
        assert_eq!(updated["label"], "Build shell");

        let terminated = hub.terminate(&id).unwrap();
        assert_eq!(terminated["status"], "exited");
        assert!(hub.list_for_thread("thread-1").is_empty());
    }
}
