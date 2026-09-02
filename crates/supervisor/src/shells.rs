use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
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
    #[allow(dead_code)]
    events: broadcast::Sender<String>,
    thread_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
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
    pub fn create(&self, thread_id: &str, cwd: &str) -> Result<(String, Value)> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(cwd);
        let _child = pair.slave.spawn_command(cmd)?;
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
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
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
                events: tx,
                thread_id: thread_id.into(),
                cwd: cwd.into(),
                cols: 80,
                rows: 24,
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
        Ok(())
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

    fn shell_json(&self, id: &str) -> Result<Value> {
        let hub = self.inner.lock().unwrap();
        self.shell_json_locked(&hub, id)
    }

    fn shell_json_locked(&self, hub: &HubState, id: &str) -> Result<Value> {
        let shell = hub
            .shells
            .get(id)
            .ok_or_else(|| anyhow!("shell not found"))?;
        Ok(json!({
            "id": id,
            "status": "running",
            "cwd": shell.cwd,
            "cols": shell.cols,
            "rows": shell.rows,
            "threadId": shell.thread_id
        }))
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}
