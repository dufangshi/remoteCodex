//! Provider-independent local thread operations. Uses the existing prompt queue and KV store.
mod transcript;
pub use transcript::TranscriptQuery;

use crate::Supervisor;
use anyhow::{ensure, Result};
use remote_codex_protocol::{now_rfc3339, ThreadEventEnvelope};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use uuid::Uuid;

#[derive(Clone)]
pub struct CliContext {
    pub url: String,
    pub token: String,
}

tokio::task_local! { static CLI_ENV: Vec<(String, String)>; }
pub fn launch_env() -> Vec<(String, String)> {
    CLI_ENV.try_with(Clone::clone).unwrap_or_default()
}

#[derive(Default)]
pub struct InteractionState {
    pub context: std::sync::RwLock<Option<CliContext>>,
    started: AtomicBool,
}

pub use remote_codex_protocol::ThreadSendInput as SendInput;

impl Supervisor {
    pub fn configure_cli(&self, url: String) -> CliContext {
        let mut context = self.interaction.context.write().unwrap();
        context
            .get_or_insert_with(|| CliContext {
                url,
                token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            })
            .clone()
    }

    pub async fn with_cli_context<T>(&self, thread_id: &str, future: impl Future<Output = T>) -> T {
        let context = self.interaction.context.read().unwrap().clone();
        let env = context
            .map(|c| {
                let mut env = vec![
                    ("REMOTE_CODEX_URL".into(), c.url),
                    ("REMOTE_CODEX_TOKEN".into(), c.token),
                    ("REMOTE_CODEX_THREAD_ID".into(), thread_id.into()),
                ];
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(dir) = exe.parent() {
                        let paths = std::iter::once(dir.to_path_buf())
                            .chain(std::env::split_paths(
                                &std::env::var_os("PATH").unwrap_or_default(),
                            ))
                            .collect::<Vec<_>>();
                        if let Ok(path) = std::env::join_paths(paths) {
                            env.push(("PATH".into(), path.to_string_lossy().into()));
                        }
                    }
                }
                env
            })
            .unwrap_or_default();
        CLI_ENV.scope(env, future).await
    }

    pub fn send_to_thread(&self, id: &str, input: SendInput) -> Result<Value> {
        let thread = self.get_thread(id)?;
        self.ensure_prompt_allowed(&thread)?;
        ensure!(
            !input.text.trim().is_empty() && input.text.len() <= 256 * 1024,
            "text must be nonempty and at most 256 KiB"
        );
        if let Some(from) = &input.from_thread_id {
            self.get_thread(from)?;
        }
        ensure!(
            !input.notify_on_complete || input.from_thread_id.is_some(),
            "notifyOnComplete requires fromThreadId"
        );
        if let Some(key) = &input.client_request_id {
            ensure!(
                !key.is_empty() && key.len() <= 128,
                "invalid clientRequestId"
            );
        }
        let pending_id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let prompt = match &input.from_thread_id {
            Some(from) => format!("[Message from remoteCodex thread {from}]\n{}", input.text),
            None => input.text.clone(),
        };
        let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(&input)?));
        let receipt = json!({"threadId":id,"pendingSteerId":pending_id,"clientRequestId":input.client_request_id,"delivery":"queued","acceptedAt":now});
        let result = self.db.with(|conn| {
            let tx = conn.unchecked_transaction()?;
            let retry_key = input.client_request_id.as_ref().map(|key| {
                format!(
                    "cli:request:{id}:{}:{key}",
                    input.from_thread_id.as_deref().unwrap_or("local")
                )
            });
            if let Some(key) = &retry_key {
                if let Some(raw) = tx
                    .query_row("SELECT value FROM kv WHERE key=?1", [key], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()?
                {
                    let saved: Value = serde_json::from_str(&raw)?;
                    ensure!(
                        saved["fingerprint"] == fingerprint,
                        "conflict: clientRequestId was used with different input"
                    );
                    return Ok(saved["receipt"].clone());
                }
            }
            enqueue(
                &tx,
                &pending_id,
                id,
                &prompt,
                input.client_request_id.as_deref(),
                &now,
            )?;
            if input.notify_on_complete {
                tx.execute(
                    "INSERT INTO kv(key,value) VALUES(?1,?2)",
                    params![
                        format!("cli:notify:pending:{pending_id}"),
                        input.from_thread_id
                    ],
                )?;
            }
            if let Some(key) = retry_key {
                tx.execute(
                    "INSERT INTO kv(key,value) VALUES(?1,?2)",
                    params![
                        key,
                        json!({"fingerprint":fingerprint,"receipt":receipt}).to_string()
                    ],
                )?;
            }
            tx.commit()?;
            Ok(receipt)
        })?;
        self.bus.emit(ThreadEventEnvelope {
            event_type: "thread.updated".into(),
            thread_id: id.into(),
            timestamp: now,
            payload: json!({"reason":"pending_steer_updated"}),
        });
        Ok(result)
    }

    pub async fn interaction_status(&self, id: &str) -> Result<Value> {
        let thread = self.get_thread(id)?;
        let pending = if let Ok(runtime) = self.runtime(thread.provider) {
            runtime.pending_requests(id).await
        } else {
            vec![]
        };
        let queued: i64 = self.db.with(|c| {
            Ok(c.query_row(
                "SELECT count(*) FROM thread_pending_steers WHERE thread_id=?1",
                [id],
                |r| r.get(0),
            )?)
        })?;
        Ok(
            json!({"threadId":id,"title":thread.title,"workspaceId":thread.workspace_id,"provider":thread.provider,"agentId":thread.agent_id,"model":thread.model,"reasoningEffort":thread.reasoning_effort,"status":thread.status,"activeTurnId":thread.active_turn_id,"updatedAt":thread.updated_at,"lastError":thread.last_error,"waitingForInput":!pending.is_empty(),"queuedCount":queued}),
        )
    }

    pub fn start_interaction_worker(self: &Arc<Self>) {
        if self.interaction.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let running = Arc::new(std::sync::Mutex::new(HashSet::<String>::new()));
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                let Some(state) = weak.upgrade() else {
                    break;
                };
                if let Err(error) = state.recover_cli_notifications() {
                    tracing::warn!(%error,"CLI notification recovery failed");
                }
                let ids = state.db.with(|c| {
                    let mut stmt = c.prepare("SELECT DISTINCT p.thread_id FROM thread_pending_steers p JOIN threads t ON t.id=p.thread_id WHERE p.delivery='continuation' AND t.status!='running'")?;
                    let ids=stmt.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
                    Ok(ids)
                });
                let Ok(ids) = ids else {
                    continue;
                };
                for id in ids {
                    if !running.lock().unwrap().insert(id.clone()) {
                        continue;
                    }
                    let state = state.clone();
                    let running = running.clone();
                    tokio::spawn(async move {
                        if let Err(error) = state.drain_steers(&id).await {
                            tracing::warn!(%error,thread_id=%id,"queued prompt deferred");
                            if !error.to_string().starts_with("conflict:") {
                                let _ = state.db.with(|c| {
                                    c.execute(
                                        "UPDATE threads SET last_error=?1 WHERE id=?2",
                                        params![error.to_string(), id],
                                    )?;
                                    Ok(())
                                });
                                // A missing/unavailable harness should not be restarted four times per second.
                                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            }
                        }
                        running.lock().unwrap().remove(&id);
                    });
                }
            }
        });
    }

    fn recover_cli_notifications(&self) -> Result<()> {
        self.db.with(|conn| {
            let tx = conn.unchecked_transaction()?;
            // The prefix uses KV's primary-key index, rather than scanning old turns on every tick.
            let turns = {
                let mut stmt = tx.prepare("SELECT DISTINCT substr(key,17,36) FROM kv WHERE key GLOB 'cli:notify:turn:*'")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
                rows
            };
            for turn in turns {
                let ended = tx.query_row("SELECT thread_id,status FROM thread_turns WHERE id=?1 AND status!='inProgress'", [&turn], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).optional()?;
                if let Some((thread,status)) = ended { finish_notification(&tx, &thread, &turn, &status, &now_rfc3339())?; }
            }
            tx.commit()?;
            Ok(())
        })
    }
}

fn enqueue(
    conn: &Connection,
    id: &str,
    thread: &str,
    text: &str,
    request: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute("INSERT INTO thread_pending_steers(id,thread_id,turn_id,client_request_id,display_prompt,submitted_prompt,delivery,created_at,updated_at) VALUES(?1,?2,'',?3,?4,?4,'continuation',?5,?5)", params![id,thread,request,text,now])?;
    Ok(())
}

pub(crate) fn bind_notification(conn: &Connection, pending_id: &str, turn_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE kv SET key=?1 WHERE key=?2",
        params![
            format!("cli:notify:turn:{turn_id}:{pending_id}"),
            format!("cli:notify:pending:{pending_id}")
        ],
    )?;
    Ok(())
}

pub(crate) fn finish_notification(
    conn: &Connection,
    thread: &str,
    turn: &str,
    status: &str,
    now: &str,
) -> Result<()> {
    let key = format!("cli:notify:turn:{turn}");
    let watchers = {
        let mut stmt = conn.prepare("SELECT key,value FROM kv WHERE key=?1 OR key GLOB ?2")?;
        let rows = stmt
            .query_map(params![key, format!("{key}:*")], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (key, from) in watchers {
        let exists = conn
            .query_row("SELECT 1 FROM threads WHERE id=?1", [&from], |_| Ok(()))
            .optional()?
            .is_some();
        if exists {
            let text = format!("[remoteCodex turn notification]\nThread {thread}, turn {turn} ended with status {status} at {now}. This describes execution status, not business success. Read the result with: remote-codex transcript {thread} --turn {turn} --view overview");
            enqueue(conn, &Uuid::new_v4().to_string(), &from, &text, None, now)?;
        }
        conn.execute("DELETE FROM kv WHERE key=?1", [key])?;
    }
    Ok(())
}
