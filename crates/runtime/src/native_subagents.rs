//! Read-only native subagent transcripts. No resume, writer or extra harness process.
use crate::{
    local_sessions::{self, LocalSessionHomes},
    usage::{estimate_price, Tokens},
};
use anyhow::{anyhow, Result};
use remote_codex_protocol::{
    NativeSubagentDetailDto, NativeSubagentDto, ThreadHistoryItemDto, ThreadSubagentDto,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

const RECENT_ITEMS: usize = 200;
const MAX_PARENTS: usize = 64;

#[derive(Default)]
pub(crate) struct NativeSubagentsCache {
    parents: HashMap<(String, String), Parent>,
}
#[derive(Default)]
struct Parent {
    path: Option<PathBuf>,
    offset: u64,
    tools: HashMap<String, Value>,
    agents: HashMap<String, Agent>,
    last_discovery: Option<Instant>,
    pending: bool,
}
struct Agent {
    summary: NativeSubagentDto,
    path: Option<PathBuf>,
    offset: u64,
    items: VecDeque<ThreadHistoryItemDto>,
    messages: HashMap<String, Tokens>,
    tier: Option<String>,
    pending: bool,
    latest: Tokens,
    total: Tokens,
    price: Option<Value>,
    usage_seen: bool,
    unpriced: bool,
    codex_own_history: bool,
}

fn text(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().map(str::to_owned)
}
fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}
fn short(value: &str) -> String {
    value.chars().take(300).collect()
}
fn status(value: &str) -> &str {
    match value {
        "completed" | "done" => "completed",
        "errored" | "failed" => "failed",
        "shutdown" | "killed" | "cancelled" | "interrupted" => "interrupted",
        "running" | "pending_init" => "running",
        _ => "unknown",
    }
}
fn records(path: &Path, offset: &mut u64, mut record: impl FnMut(Value)) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    if file.seek(SeekFrom::Start(*offset)).is_err() {
        return false;
    }
    let mut reader = BufReader::new(file);
    // Bound a single refresh; subsequent requests continue from the last complete record.
    let mut bytes = 0;
    loop {
        let mut line = String::new();
        let Ok(count) = reader.read_line(&mut line) else {
            break;
        };
        if count == 0 || !line.ends_with('\n') {
            break;
        }
        *offset += count as u64;
        bytes += count;
        if let Ok(entry) = serde_json::from_str(&line) {
            record(entry);
        }
        if bytes >= 8 * 1024 * 1024 {
            return true;
        }
    }
    false
}
impl Agent {
    fn new(id: &str, provider: &str, name: Option<String>, at: Option<String>) -> Self {
        Self {
            summary: NativeSubagentDto {
                agent: ThreadSubagentDto {
                    id: id.into(),
                    name,
                    status: "running".into(),
                    started_at: at.clone(),
                    completed_at: None,
                    parent_tool_call_id: None,
                    is_background: Some(true),
                },
                provider: provider.into(),
                native_session_id: None,
                model: None,
                prompt: None,
                updated_at: at,
                latest_activity: None,
                token_usage: None,
                price_estimate: None,
                activity_count: 0,
                details_available: false,
            },
            path: None,
            offset: 0,
            items: VecDeque::new(),
            messages: HashMap::new(),
            tier: None,
            pending: false,
            latest: Tokens::default(),
            total: Tokens::default(),
            price: None,
            usage_seen: false,
            unpriced: false,
            codex_own_history: false,
        }
    }
    fn activity(&mut self, id: String, kind: &str, body: String, at: Option<String>, state: &str) {
        if body.trim().is_empty() {
            return;
        }
        self.summary.latest_activity = Some(short(&body));
        if let Some(item) = self.items.iter_mut().find(|item| item.id == id) {
            item.text = match &item.preview_text {
                Some(command) if state != "running" => format!("{command}\n\n{body}")
                    .chars()
                    .take(16_000)
                    .collect(),
                _ => body.chars().take(16_000).collect(),
            };
            item.status = Some(state.into());
            return;
        }
        self.summary.activity_count += 1;
        self.items.push_back(ThreadHistoryItemDto {
            id,
            created_at: at,
            kind: kind.into(),
            text: body.chars().take(16_000).collect(),
            preview_text: (kind == "toolCall" && state == "running")
                .then(|| body.chars().take(4_000).collect()),
            detail_text: None,
            status: Some(state.into()),
            sequence: Some(self.summary.activity_count as i64),
            source_turn_id: None,
            artifact: None,
            extra: Default::default(),
        });
        if self.items.len() > RECENT_ITEMS {
            self.items.pop_front();
        }
    }
    fn price_delta(&mut self, usage: &Tokens, previous: Option<&Tokens>) {
        let current = estimate_price(
            &json!({"total":usage}),
            self.summary.model.as_deref(),
            self.tier.as_deref(),
        );
        let old = previous.and_then(|tokens| {
            estimate_price(
                &json!({"total":tokens}),
                self.summary.model.as_deref(),
                self.tier.as_deref(),
            )
        });
        let Some(mut current) = current else {
            self.unpriced = true;
            return;
        };
        if let Some(old) = old {
            for key in [
                "inputUsd",
                "cachedInputUsd",
                "cacheWriteInputUsd",
                "outputUsd",
                "totalUsd",
            ] {
                current[key] = json!((current[key].as_f64().unwrap_or(0.)
                    - old[key].as_f64().unwrap_or(0.))
                .max(0.));
            }
        }
        if let Some(total) = &mut self.price {
            for key in [
                "inputUsd",
                "cachedInputUsd",
                "cacheWriteInputUsd",
                "outputUsd",
                "totalUsd",
            ] {
                total[key] =
                    json!(total[key].as_f64().unwrap_or(0.) + current[key].as_f64().unwrap_or(0.));
            }
        } else {
            self.price = Some(current);
        }
    }
    fn record(&mut self, entry: Value) {
        let at = text(&entry, "timestamp");
        let provider = self.summary.provider.clone();
        let p = &entry["payload"];
        if provider == "codex" {
            if entry["type"] == "session_meta" {
                self.codex_own_history = p["id"].as_str().or_else(|| p["session_id"].as_str())
                    == self.summary.native_session_id.as_deref();
                if self.codex_own_history {
                    self.summary.agent.started_at =
                        text(p, "timestamp")
                            .or(at)
                            .or(self.summary.agent.started_at.take());
                }
                return;
            }
            if !self.codex_own_history {
                return;
            }
            // Forked rollouts may contain the parent's older usage and messages.
            if at
                .as_deref()
                .zip(self.summary.agent.started_at.as_deref())
                .is_some_and(|(at, start)| at < start)
            {
                if p["type"] == "token_count" {
                    if let Some(tokens) = Tokens::parse(&p["info"]["total_token_usage"]) {
                        self.latest = tokens;
                    }
                }
                return;
            }
        } else if entry["agentId"]
            .as_str()
            .is_some_and(|id| Some(id) != self.summary.native_session_id.as_deref())
        {
            return;
        }
        if at > self.summary.updated_at {
            self.summary.updated_at = at.clone();
        }
        self.summary.details_available = true;
        let key = entry["uuid"]
            .as_str()
            .or_else(|| p["id"].as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("record-{}", self.offset));
        if provider == "codex" {
            if entry["type"] == "turn_context" {
                self.summary.model = text(p, "model").or(self.summary.model.take());
                self.tier = text(p, "service_tier").map(|tier| {
                    if matches!(tier.as_str(), "fast" | "priority") {
                        "fast".into()
                    } else {
                        "standard".into()
                    }
                });
            }
            if entry["type"] == "event_msg" {
                match p["type"].as_str().unwrap_or("") {
                    "task_started" => {
                        self.summary.agent.status = "running".into();
                        self.summary.agent.completed_at = None;
                    }
                    "task_complete" | "task_completed" => {
                        self.summary.agent.status = "completed".into();
                        self.summary.agent.completed_at = at.clone();
                    }
                    "turn_aborted" => {
                        self.summary.agent.status = "interrupted".into();
                        self.summary.agent.completed_at = at.clone();
                    }
                    "token_count" => {
                        if let Some(total) = Tokens::parse(&p["info"]["total_token_usage"]) {
                            let last = Tokens::parse(&p["info"]["last_token_usage"]);
                            let delta = if !self.usage_seen && self.latest.total_tokens == 0 {
                                last.clone().unwrap_or_else(|| total.clone())
                            } else {
                                total.cumulative_delta(&self.latest, last.as_ref())
                            };
                            self.total = self.total.add(&delta);
                            self.latest = total;
                            self.usage_seen = true;
                            self.price_delta(&delta, None);
                        }
                    }
                    _ => {}
                }
            }
            if entry["type"] == "response_item" {
                match p["type"].as_str().unwrap_or("") {
                    "message" if p["role"] == "assistant" => {
                        let body = content_text(&p["content"]);
                        self.activity(key, "agentMessage", body, at, "completed");
                    }
                    "function_call" | "custom_tool_call" => {
                        let name = p["name"].as_str().unwrap_or("Tool");
                        let args = p["arguments"]
                            .as_str()
                            .or_else(|| p["input"].as_str())
                            .unwrap_or("");
                        self.activity(
                            p["call_id"].as_str().unwrap_or(&key).into(),
                            "toolCall",
                            format!("{name}\n{args}"),
                            at,
                            "running",
                        );
                        self.summary.agent.status = "running".into();
                        self.summary.agent.completed_at = None;
                    }
                    "function_call_output" | "custom_tool_call_output" => {
                        let id = p["call_id"].as_str().unwrap_or(&key).to_owned();
                        let body = content_text(&p["output"]);
                        self.activity(id, "toolCall", body, at, "completed");
                    }
                    _ => {}
                }
            }
        } else {
            let message = &entry["message"];
            if entry["type"] == "assistant" {
                self.summary.model = text(message, "model").or(self.summary.model.take());
                if let Some(tokens) = Tokens::parse(&message["usage"]) {
                    let id = message["id"].as_str().unwrap_or(&key).to_owned();
                    let previous = self.messages.get(&id).cloned();
                    if previous
                        .as_ref()
                        .is_none_or(|old| tokens.output_tokens >= old.output_tokens)
                    {
                        self.total = self
                            .total
                            .subtract(previous.as_ref().unwrap_or(&Tokens::default()))
                            .add(&tokens);
                        self.price_delta(&tokens, previous.as_ref());
                        self.messages.insert(id, tokens);
                        self.usage_seen = true;
                    }
                }
                for (index, block) in message["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                {
                    if block["type"] == "text" {
                        self.activity(
                            format!("{key}-{index}"),
                            "agentMessage",
                            block["text"].as_str().unwrap_or("").into(),
                            at.clone(),
                            "completed",
                        );
                    } else if block["type"] == "tool_use" {
                        let id = block["id"].as_str().unwrap_or(&key).to_owned();
                        let body = format!(
                            "{}\n{}",
                            block["name"].as_str().unwrap_or("Tool"),
                            block["input"]
                        );
                        self.activity(id, "toolCall", body, at.clone(), "running");
                    }
                }
                if message["stop_reason"] == "end_turn" {
                    self.summary.agent.status = "completed".into();
                    self.summary.agent.completed_at = at;
                } else {
                    self.summary.agent.status = "running".into();
                    self.summary.agent.completed_at = None;
                }
            } else if entry["type"] == "user" {
                for block in message["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_result" {
                        self.activity(
                            block["tool_use_id"].as_str().unwrap_or(&key).into(),
                            "toolCall",
                            content_text(&block["content"]),
                            at.clone(),
                            if block["is_error"] == true {
                                "failed"
                            } else {
                                "completed"
                            },
                        );
                    }
                }
            }
        }
        self.summary.token_usage = self
            .usage_seen
            .then(|| json!({"total":self.total,"last":self.total,"modelContextWindow":null}));
        self.summary.price_estimate = if self.unpriced {
            None
        } else {
            self.price.clone()
        };
    }
    fn refresh(&mut self) {
        let Some(path) = self.path.clone() else {
            return;
        };
        if path.metadata().is_ok_and(|meta| meta.len() < self.offset) {
            let summary = self.summary.clone();
            *self = Self::new(
                &summary.agent.id,
                &summary.provider,
                summary.agent.name,
                summary.agent.started_at,
            );
            self.summary.native_session_id = summary.native_session_id;
            self.summary.prompt = summary.prompt;
            self.path = Some(path.clone());
        }
        let mut offset = self.offset;
        self.pending = records(&path, &mut offset, |entry| {
            self.offset += 1;
            self.record(entry);
        });
        self.offset = offset;
    }
}
fn content_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.into();
    }
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
impl Parent {
    fn register(
        &mut self,
        id: &str,
        provider: &str,
        native: Option<&str>,
        tool: Option<&str>,
        input: &Value,
        at: Option<String>,
    ) {
        if !safe_id(id) || native.is_some_and(|id| !safe_id(id)) {
            return;
        }
        let name = text(input, "description")
            .or_else(|| text(input, "agent_nickname"))
            .or_else(|| text(input, "agent_role"))
            .or_else(|| {
                text(input, "message")
                    .or_else(|| text(input, "prompt"))
                    .map(|prompt| {
                        prompt
                            .lines()
                            .next()
                            .unwrap_or("")
                            .chars()
                            .take(80)
                            .collect()
                    })
            });
        let agent = self
            .agents
            .entry(id.into())
            .or_insert_with(|| Agent::new(id, provider, name.clone(), at.clone()));
        if at > agent.summary.updated_at {
            agent.summary.updated_at = at;
        }
        agent.summary.agent.name = name.or(agent.summary.agent.name.take());
        agent.summary.native_session_id = native
            .map(str::to_owned)
            .or(agent.summary.native_session_id.take());
        agent.summary.agent.parent_tool_call_id =
            tool.map(str::to_owned)
                .or(agent.summary.agent.parent_tool_call_id.take());
        agent.summary.prompt = text(input, "prompt")
            .or_else(|| text(input, "message"))
            .or(agent.summary.prompt.take());
        agent.summary.model = text(input, "model").or(agent.summary.model.take());
    }
    fn record(&mut self, entry: Value, provider: &str, session: &str) {
        let at = text(&entry, "timestamp");
        if provider == "claude" {
            if entry["sessionId"].as_str().is_some_and(|id| id != session)
                || entry["isSidechain"] == true
            {
                return;
            }
            let content = &entry["message"]["content"];
            if entry["type"] == "assistant" {
                for block in content.as_array().into_iter().flatten() {
                    if block["type"] == "tool_use"
                        && matches!(block["name"].as_str(), Some("Agent" | "Task"))
                    {
                        if let Some(id) = block["id"].as_str() {
                            self.tools.insert(id.into(), block["input"].clone());
                            self.register(
                                id,
                                provider,
                                None,
                                Some(id),
                                &block["input"],
                                at.clone(),
                            );
                            if let Some(agent) = self.agents.get_mut(id) {
                                agent.summary.agent.is_background =
                                    block["input"]["run_in_background"].as_bool();
                            }
                        }
                    }
                }
            } else if entry["type"] == "user" {
                let result = &entry["toolUseResult"];
                for block in content.as_array().into_iter().flatten() {
                    let Some(tool) = block["tool_use_id"].as_str() else {
                        continue;
                    };
                    let Some(input) = self.tools.get(tool).cloned() else {
                        continue;
                    };
                    let native = result["agentId"]
                        .as_str()
                        .or_else(|| result["resumedAgentId"].as_str());
                    self.register(tool, provider, native, Some(tool), &input, at.clone());
                    if let Some(agent) = self.agents.get_mut(tool) {
                        let asynchronous =
                            result["isAsync"] == true && result["status"] == "async_launched";
                        agent.summary.agent.is_background = Some(asynchronous);
                        agent.summary.agent.status = if asynchronous {
                            "running"
                        } else if block["is_error"] == true {
                            "failed"
                        } else {
                            "completed"
                        }
                        .into();
                        if !asynchronous {
                            agent.summary.agent.completed_at = at.clone();
                        }
                        // Receipts remain useful even before the native transcript appears.
                        if !asynchronous && agent.items.is_empty() {
                            agent.activity(
                                format!("{tool}-result"),
                                "agentMessage",
                                content_text(&block["content"]),
                                at.clone(),
                                "completed",
                            );
                        }
                    }
                }
                if (entry.pointer("/origin/kind").and_then(Value::as_str)
                    == Some("task-notification")
                    || entry["turnOrigin"] == "task_notification")
                    && content.is_string()
                {
                    let body = content.as_str().unwrap_or("");
                    if let Some(tool) = xml_field(body, "tool-use-id") {
                        if let Some(agent) = self.agents.get_mut(tool) {
                            if let Some(state) = xml_field(body, "status") {
                                agent.summary.agent.status = status(state).into();
                                agent.summary.agent.completed_at = at.clone();
                                if at > agent.summary.updated_at {
                                    agent.summary.updated_at = at.clone();
                                }
                            }
                        }
                    }
                }
            }
        } else {
            let p = &entry["payload"];
            if entry["type"] == "response_item"
                && p["type"] == "function_call"
                && p["name"]
                    .as_str()
                    .is_some_and(|name| name.rsplit('.').next() == Some("spawn_agent"))
            {
                if let Some(id) = p["call_id"].as_str() {
                    let input = p["arguments"]
                        .as_str()
                        .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        .unwrap_or(Value::Null);
                    self.tools.insert(id.into(), json!({"input":input,"at":at}));
                }
            } else if entry["type"] == "response_item" && p["type"] == "function_call_output" {
                let Some(tool) = p["call_id"].as_str() else {
                    return;
                };
                let Some(call) = self.tools.get(tool).cloned() else {
                    return;
                };
                let result = p["output"]
                    .as_str()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or(Value::Null);
                if let Some(id) = result["agent_id"]
                    .as_str()
                    .or_else(|| result["agentId"].as_str())
                {
                    self.register(
                        id,
                        provider,
                        Some(id),
                        Some(tool),
                        &call["input"],
                        text(&call, "at").or(at),
                    );
                }
            } else if entry["type"] == "event_msg" && p["type"] == "collab_agent_spawn_end" {
                if let Some(id) = p["new_thread_id"]
                    .as_str()
                    .or_else(|| p["receiver_thread_id"].as_str())
                {
                    self.register(id, provider, Some(id), p["call_id"].as_str(), p, at);
                }
            }
        }
    }
    fn discover_codex(&mut self, homes: &LocalSessionHomes, session: &str) {
        if self
            .last_discovery
            .is_some_and(|at| at.elapsed() < Duration::from_secs(5))
        {
            return;
        }
        self.last_discovery = Some(Instant::now());
        for file in local_sessions::codex_state_files(&homes.codex_home) {
            let Ok(conn) = rusqlite::Connection::open_with_flags(
                file,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            ) else {
                continue;
            };
            let Ok(mut statement) =
                conn.prepare("SELECT id,source,rollout_path FROM threads WHERE source LIKE ?1")
            else {
                continue;
            };
            let Ok(rows) = statement.query_map([format!("%{session}%")], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            }) else {
                continue;
            };
            for (id, source, path) in rows.flatten() {
                let Ok(source) = serde_json::from_str::<Value>(&source) else {
                    continue;
                };
                let spawn = source
                    .pointer("/subAgent/thread_spawn")
                    .or_else(|| source.pointer("/sub_agent/thread_spawn"))
                    .or_else(|| source.pointer("/subagent/thread_spawn"));
                let Some(spawn) = spawn.filter(|s| s["parent_thread_id"] == session) else {
                    continue;
                };
                if safe_id(&id) {
                    self.register(&id, "codex", Some(&id), None, spawn, None);
                    self.agents.get_mut(&id).unwrap().path = Some(path.into());
                }
            }
        }
    }
    fn refresh(&mut self, homes: &LocalSessionHomes, provider: &str, session: &str) {
        if self.path.is_none() {
            self.path = if provider == "codex" {
                local_sessions::find_codex_rollout(&homes.codex_home, session)
            } else {
                walkdir::WalkDir::new(homes.claude_home.join("projects"))
                    .max_depth(2)
                    .into_iter()
                    .filter_map(|entry| entry.ok())
                    .find(|entry| {
                        entry.file_type().is_file()
                            && entry.file_name() == format!("{session}.jsonl").as_str()
                    })
                    .map(|entry| entry.into_path())
            };
        }
        if let Some(path) = self.path.clone() {
            if path.metadata().is_ok_and(|meta| meta.len() < self.offset) {
                *self = Self::default();
                self.path = Some(path.clone());
            }
            let mut offset = self.offset;
            self.pending = records(&path, &mut offset, |entry| {
                self.record(entry, provider, session)
            });
            self.offset = offset;
        }
        if provider == "codex" {
            self.discover_codex(homes, session);
        }
        for agent in self.agents.values_mut() {
            if agent.path.is_none() {
                if let Some(native) = &agent.summary.native_session_id {
                    agent.path = if provider == "codex" {
                        local_sessions::find_codex_rollout(&homes.codex_home, native)
                    } else {
                        self.path
                            .as_ref()
                            .map(|parent| {
                                parent
                                    .with_extension("")
                                    .join("subagents")
                                    .join(format!("agent-{native}.jsonl"))
                            })
                            .filter(|path| path.is_file())
                    };
                }
            }
            agent.refresh();
        }
    }
}
fn xml_field<'a>(body: &'a str, tag: &str) -> Option<&'a str> {
    body.split_once(&format!("<{tag}>"))?
        .1
        .split_once(&format!("</{tag}>"))
        .map(|(text, _)| text.trim())
}
impl NativeSubagentsCache {
    pub(crate) fn list(
        &mut self,
        homes: &LocalSessionHomes,
        provider: &str,
        session: &str,
    ) -> Vec<NativeSubagentDto> {
        let session = crate::import_id::parse_session_ref(session).raw_id;
        if !safe_id(&session) || !matches!(provider, "claude" | "codex") {
            return vec![];
        }
        let key = (provider.to_owned(), session.clone());
        if !self.parents.contains_key(&key) && self.parents.len() >= MAX_PARENTS {
            if let Some(old) = self.parents.keys().next().cloned() {
                self.parents.remove(&old);
            }
        }
        let parent = self.parents.entry(key).or_default();
        parent.refresh(homes, provider, &session);
        let mut agents: Vec<_> = parent
            .agents
            .values()
            .map(|agent| agent.summary.clone())
            .collect();
        agents.sort_by(|a, b| {
            (b.agent.status == "running")
                .cmp(&(a.agent.status == "running"))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
                .then_with(|| a.agent.id.cmp(&b.agent.id))
        });
        agents
    }
    fn refreshing(&self, provider: &str, session: &str) -> bool {
        let session = crate::import_id::parse_session_ref(session).raw_id;
        self.parents
            .get(&(provider.into(), session))
            .is_some_and(|parent| {
                parent.pending || parent.agents.values().any(|agent| agent.pending)
            })
    }
    fn detail(&self, provider: &str, session: &str, id: &str) -> Option<NativeSubagentDetailDto> {
        let session = crate::import_id::parse_session_ref(session).raw_id;
        let agent = self
            .parents
            .get(&(provider.into(), session))?
            .agents
            .get(id)?;
        Some(NativeSubagentDetailDto {
            agent: agent.summary.clone(),
            items: agent.items.iter().cloned().collect(),
            has_earlier_items: agent.summary.activity_count > agent.items.len(),
        })
    }
}
impl crate::Supervisor {
    pub async fn native_subagents(&self, thread_id: &str, agent_id: Option<&str>) -> Result<Value> {
        let thread = self.get_thread(thread_id)?;
        let provider = if thread.provider == remote_codex_protocol::Provider::Codex {
            "codex"
        } else {
            thread.agent_id.as_deref().unwrap_or("")
        }
        .to_owned();
        let Some(session) = thread.provider_session_id else {
            return if agent_id.is_some() {
                Err(anyhow!("native subagent not found"))
            } else {
                Ok(json!({"agents":[]}))
            };
        };
        let homes = self.local_session_homes.clone();
        let cache = self.native_subagents.clone();
        let target = agent_id.map(str::to_owned);
        let live = self.runtime(thread.provider).ok();
        let fallback = if let Some(runtime) = live {
            runtime.active_subagents(&session).await
        } else {
            vec![]
        };
        tokio::task::spawn_blocking(move || {
            let mut cache = cache
                .lock()
                .map_err(|_| anyhow!("native subagent cache unavailable"))?;
            let mut agents = cache.list(&homes, &provider, &session);
            for agent in fallback {
                if !agents.iter().any(|existing| {
                    existing.agent.id == agent.id
                        || existing.agent.parent_tool_call_id.as_deref() == Some(agent.id.as_str())
                }) {
                    agents.push(NativeSubagentDto {
                        agent,
                        provider: provider.clone(),
                        native_session_id: None,
                        model: None,
                        prompt: None,
                        updated_at: None,
                        latest_activity: None,
                        token_usage: None,
                        price_estimate: None,
                        activity_count: 0,
                        details_available: false,
                    });
                }
            }
            if let Some(target) = target {
                if let Some(detail) = cache.detail(&provider, &session, &target) {
                    return Ok(json!(detail));
                }
                let agent = agents
                    .into_iter()
                    .find(|agent| agent.agent.id == target)
                    .ok_or_else(|| anyhow!("native subagent not found"))?;
                Ok(json!(NativeSubagentDetailDto {
                    agent,
                    items: vec![],
                    has_earlier_items: false
                }))
            } else {
                Ok(json!({"agents":agents,"refreshing":cache.refreshing(&provider, &session)}))
            }
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    fn homes(root: &Path) -> LocalSessionHomes {
        LocalSessionHomes {
            codex_home: root.join("codex"),
            claude_home: root.join("claude"),
            grok_home: root.join("grok"),
        }
    }
    fn write(path: &Path, entries: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            entries
                .iter()
                .map(|entry| format!("{entry}\n"))
                .collect::<String>(),
        )
        .unwrap();
    }
    fn append(path: &Path, entry: Value) {
        writeln!(
            fs::OpenOptions::new().append(true).open(path).unwrap(),
            "{entry}"
        )
        .unwrap();
    }
    const PARENT: &str = "11111111-1111-4111-8111-111111111111";
    const CHILD: &str = "22222222-2222-4222-8222-222222222222";
    const AT: &str = "2026-10-09T00:00:10Z";
    fn spawn_entries() -> Vec<Value> {
        vec![
            json!({"type":"response_item","timestamp":AT,"payload":{"type":"function_call","name":"functions.spawn_agent","call_id":"spawn-1","arguments":"{\"message\":\"Review code\",\"model\":\"gpt-6.1-sol\"}"}}),
            json!({"type":"response_item","timestamp":AT,"payload":{"type":"function_call_output","call_id":"spawn-1","output":format!("{{\"agent_id\":\"{CHILD}\"}}")}}),
        ]
    }
    #[test]
    fn native_subagents_codex_forks_exclude_parent_usage_and_follow_completion() {
        let dir = tempfile::tempdir().unwrap();
        let homes = homes(dir.path());
        let parent = homes
            .codex_home
            .join("sessions")
            .join(format!("rollout-{PARENT}.jsonl"));
        let child = homes
            .codex_home
            .join("sessions")
            .join(format!("rollout-{CHILD}.jsonl"));
        write(&parent, &spawn_entries());
        write(
            &child,
            &[
                json!({"type":"session_meta","payload":{"id":CHILD}}),
                json!({"timestamp":"2026-10-09T00:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"output_tokens":200}}}}),
                json!({"timestamp":"2026-10-09T00:00:02Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"text":"Parent private history"}]}}),
                json!({"timestamp":AT,"type":"turn_context","payload":{"model":"gpt-6.1-sol"}}),
                json!({"timestamp":AT,"type":"event_msg","payload":{"type":"task_started"}}),
                json!({"timestamp":"2026-10-09T00:00:11Z","type":"response_item","payload":{"type":"function_call","call_id":"tool-1","name":"exec_command","arguments":"cargo test"}}),
                json!({"timestamp":"2026-10-09T00:00:12Z","type":"response_item","payload":{"type":"function_call_output","call_id":"tool-1","output":"Tests passed"}}),
                json!({"timestamp":"2026-10-09T00:00:13Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1100,"output_tokens":220},"last_token_usage":{"input_tokens":100,"output_tokens":20}}}}),
            ],
        );
        let mut cache = NativeSubagentsCache::default();
        let list = cache.list(&homes, "codex", PARENT);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].agent.id, CHILD);
        assert_eq!(
            list[0].token_usage.as_ref().unwrap()["total"]["totalTokens"],
            120
        );
        assert!(
            list[0].price_estimate.as_ref().unwrap()["totalUsd"]
                .as_f64()
                .unwrap()
                > 0.
        );
        assert_eq!(list[0].updated_at.as_deref(), Some("2026-10-09T00:00:13Z"));
        let detail = cache.detail("codex", PARENT, CHILD).unwrap();
        assert_eq!(detail.items.len(), 1);
        assert!(detail.items[0].text.contains("cargo test"));
        assert!(detail.items[0].text.contains("Tests passed"));
        assert!(!detail
            .items
            .iter()
            .any(|item| item.text.contains("Parent private")));
        assert!(cache.detail("codex", "another-parent", CHILD).is_none());
        assert_eq!(
            cache.list(&homes, "codex", PARENT)[0].token_usage,
            list[0].token_usage
        );
        append(
            &child,
            json!({"timestamp":"2026-10-09T00:00:14Z","type":"event_msg","payload":{"type":"task_complete"}}),
        );
        assert_eq!(
            cache.list(&homes, "codex", PARENT)[0].agent.status,
            "completed"
        );
        let mut recovered = NativeSubagentsCache::default();
        assert_eq!(
            recovered.list(&homes, "codex", PARENT)[0].token_usage,
            list[0].token_usage
        );
    }
    #[test]
    fn native_subagents_claude_receipts_resolve_transcripts_and_dedupe_usage() {
        let dir = tempfile::tempdir().unwrap();
        let homes = homes(dir.path());
        let parent = homes
            .claude_home
            .join("projects/demo")
            .join(format!("{PARENT}.jsonl"));
        let child = parent.with_extension("").join("subagents/agent-a123.jsonl");
        write(
            &parent,
            &[
                json!({"type":"assistant","sessionId":PARENT,"timestamp":AT,"message":{"content":[{"type":"tool_use","id":"toolu-1","name":"Agent","input":{"description":"Review changes","prompt":"Check the diff","run_in_background":true}}]}}),
                json!({"type":"user","sessionId":PARENT,"timestamp":AT,"toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a123"},"message":{"content":[{"type":"tool_result","tool_use_id":"toolu-1"}]}}),
            ],
        );
        let record = json!({"type":"assistant","sessionId":PARENT,"agentId":"a123","timestamp":"2026-10-09T00:00:11Z","message":{"id":"msg-1","model":"claude-sonnet-4-5","stop_reason":"tool_use","usage":{"input_tokens":100,"cache_read_input_tokens":20,"output_tokens":10},"content":[{"type":"tool_use","id":"read-1","name":"Read","input":{"file_path":"src/lib.rs"}}]}});
        write(&child, &[record.clone(), record]);
        let mut cache = NativeSubagentsCache::default();
        let list = cache.list(&homes, "claude", PARENT);
        assert_eq!(list[0].native_session_id.as_deref(), Some("a123"));
        assert_eq!(list[0].agent.id, "toolu-1");
        assert_eq!(list[0].activity_count, 1);
        assert_eq!(
            list[0].token_usage.as_ref().unwrap()["total"]["totalTokens"],
            130
        );
        assert!(list[0].price_estimate.is_some());
        append(
            &child,
            json!({"type":"assistant","agentId":"a123","uuid":"final","timestamp":"2026-10-09T00:00:12Z","message":{"id":"msg-2","model":"claude-sonnet-4-5","stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5},"content":[{"type":"text","text":"Review complete"}]}}),
        );
        let list = cache.list(&homes, "claude", PARENT);
        assert_eq!(list[0].agent.status, "completed");
        assert_eq!(
            list[0].token_usage.as_ref().unwrap()["total"]["totalTokens"],
            145
        );
        assert_eq!(list[0].latest_activity.as_deref(), Some("Review complete"));
    }
    #[test]
    fn native_subagents_discover_codex_indexed_children_without_parent_acp_tools() {
        let dir = tempfile::tempdir().unwrap();
        let homes = homes(dir.path());
        fs::create_dir_all(&homes.codex_home).unwrap();
        let child = homes.codex_home.join("sessions/child.jsonl");
        write(
            &child,
            &[
                json!({"type":"session_meta","timestamp":AT,"payload":{"id":CHILD}}),
                json!({"type":"turn_context","timestamp":AT,"payload":{"model":"unknown-model"}}),
            ],
        );
        let db = rusqlite::Connection::open(homes.codex_home.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT, source TEXT, rollout_path TEXT);")
            .unwrap();
        let source = json!({"subagent":{"thread_spawn":{"parent_thread_id":PARENT,"depth":1,"agent_nickname":"Reviewer"}}});
        db.execute(
            "INSERT INTO threads VALUES (?1,?2,?3)",
            rusqlite::params![CHILD, source.to_string(), child.to_str().unwrap()],
        )
        .unwrap();
        let mut cache = NativeSubagentsCache::default();
        let list = cache.list(&homes, "codex", PARENT);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].agent.name.as_deref(), Some("Reviewer"));
        assert_eq!(list[0].agent.started_at.as_deref(), Some(AT));
        assert!(list[0].token_usage.is_none());
        assert!(list[0].price_estimate.is_none());
        assert!(cache
            .list(&homes, "codex", "33333333-3333-4333-8333-333333333333")
            .is_empty());
    }
    #[test]
    fn native_subagents_partial_lines_and_file_reset_do_not_corrupt_accounting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.jsonl");
        write(&path, &[]);
        let mut agent = Agent::new("agent-1", "claude", None, None);
        agent.path = Some(path.clone());
        let record = json!({"type":"assistant","timestamp":AT,"message":{"id":"m1","model":"unknown","usage":{"input_tokens":10,"output_tokens":2},"content":[]}});
        fs::write(&path, record.to_string()).unwrap();
        agent.refresh();
        assert!(agent.summary.token_usage.is_none());
        writeln!(fs::OpenOptions::new().append(true).open(&path).unwrap()).unwrap();
        agent.refresh();
        assert_eq!(agent.total.total_tokens, 12);
        assert!(agent.summary.price_estimate.is_none());
        agent.refresh();
        assert_eq!(agent.total.total_tokens, 12);
        write(
            &path,
            &[
                json!({"type":"assistant","timestamp":AT,"message":{"id":"m2","usage":{"input_tokens":1,"output_tokens":1},"content":[]}}),
            ],
        );
        agent.refresh();
        assert_eq!(agent.total.total_tokens, 2);
    }
    #[test]
    fn native_subagents_first_codex_snapshot_without_baseline_uses_last_usage_and_tier() {
        let mut agent = Agent::new(CHILD, "codex", None, Some(AT.into()));
        agent.summary.native_session_id = Some(CHILD.into());
        agent.record(json!({"type":"session_meta","payload":{"id":CHILD}}));
        agent.record(json!({"timestamp":AT,"type":"turn_context","payload":{"model":"gpt-6.1-sol","service_tier":"priority"}}));
        agent.record(json!({"timestamp":AT,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10000,"output_tokens":2000},"last_token_usage":{"input_tokens":100,"output_tokens":20}}}}));
        assert_eq!(agent.total.total_tokens, 120);
        let expected = estimate_price(
            &json!({"total":agent.total}),
            Some("gpt-6.1-sol"),
            Some("fast"),
        );
        assert_eq!(agent.summary.price_estimate, expected);
    }
    #[test]
    fn native_subagents_large_parent_history_continues_discovery() {
        let dir = tempfile::tempdir().unwrap();
        let homes = homes(dir.path());
        let path = homes
            .codex_home
            .join("sessions")
            .join(format!("rollout-{PARENT}.jsonl"));
        write(&path, &[json!({"padding":"x".repeat(8 * 1024 * 1024)})]);
        for record in spawn_entries() {
            append(&path, record);
        }
        let mut cache = NativeSubagentsCache::default();
        assert!(cache.list(&homes, "codex", PARENT).is_empty());
        assert!(cache.refreshing("codex", PARENT));
        assert_eq!(cache.list(&homes, "codex", PARENT).len(), 1);
        assert!(!cache.refreshing("codex", PARENT));
    }
    #[test]
    fn native_subagents_notifications_must_come_from_sdk_and_paths_never_come_from_client() {
        let mut parent = Parent::default();
        parent.register(
            "tool-1",
            "claude",
            Some("a1"),
            Some("tool-1"),
            &json!({}),
            Some(AT.into()),
        );
        let mut notice = json!({"type":"user","sessionId":PARENT,"timestamp":AT,"message":{"content":"<task-notification><tool-use-id>tool-1</tool-use-id><status>completed</status></task-notification>"}});
        parent.record(notice.clone(), "claude", PARENT);
        assert_eq!(parent.agents["tool-1"].summary.agent.status, "running");
        notice["origin"] = json!({"kind":"task-notification"});
        parent.record(notice, "claude", PARENT);
        assert_eq!(parent.agents["tool-1"].summary.agent.status, "completed");
        parent.register(
            "../outside",
            "claude",
            Some("../../secret"),
            None,
            &json!({}),
            None,
        );
        assert_eq!(parent.agents.len(), 1);
    }
}
