use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use remote_codex_protocol::{now_rfc3339, ThreadHistoryItemDto, ThreadTurnDto};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;

use crate::actor::ImportSessionMeta;
use crate::import_id::session_ids_match;

const CANDIDATE_LIMIT: usize = 80;

#[derive(Debug, Clone)]
pub struct LocalSessionHomes {
    pub codex_home: PathBuf,
    pub grok_home: PathBuf,
    pub claude_home: PathBuf,
}

impl LocalSessionHomes {
    pub fn from_env() -> Self {
        let home = crate::config::home_dir();
        Self {
            codex_home: env_dir("CODEX_HOME").unwrap_or_else(|| home.join(".codex")),
            grok_home: env_dir("GROK_HOME").unwrap_or_else(|| home.join(".grok")),
            claude_home: env_dir("CLAUDE_CONFIG_DIR")
                .or_else(|| env_dir("CLAUDE_HOME"))
                .unwrap_or_else(|| home.join(".claude")),
        }
    }
}

pub fn list_local_sessions(homes: &LocalSessionHomes, agent_id: &str) -> Vec<ImportSessionMeta> {
    let mut sessions = match agent_id {
        "codex" => list_codex_sessions(&homes.codex_home),
        "grok" => list_grok_sessions(&homes.grok_home),
        "claude" => list_claude_sessions(&homes.claude_home),
        _ => Vec::new(),
    };
    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
    sessions.truncate(CANDIDATE_LIMIT);
    sessions
}

pub fn find_local_session(
    homes: &LocalSessionHomes,
    agent_id: &str,
    session_id: &str,
) -> Option<ImportSessionMeta> {
    let session_id = crate::import_id::parse_session_ref(session_id).raw_id;
    if session_id.is_empty() {
        return None;
    }
    match agent_id {
        "codex" => find_codex_session(&homes.codex_home, &session_id),
        "grok" => find_grok_session(&homes.grok_home, &session_id),
        "claude" => find_claude_session(&homes.claude_home, &session_id),
        _ => None,
    }
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn list_codex_sessions(home: &Path) -> Vec<ImportSessionMeta> {
    let mut out = Vec::new();
    for sqlite in codex_state_files(home) {
        if let Ok(conn) = open_readonly(&sqlite) {
            if let Ok(mut sessions) = query_codex_threads(&conn, None) {
                out.append(&mut sessions);
            }
        }
    }
    dedupe_sessions(out)
}

fn find_codex_session(home: &Path, session_id: &str) -> Option<ImportSessionMeta> {
    for sqlite in codex_state_files(home) {
        if let Ok(conn) = open_readonly(&sqlite) {
            if let Ok(sessions) = query_codex_threads(&conn, Some(session_id)) {
                if let Some(mut session) = sessions.into_iter().next() {
                    if session.turns.is_empty() {
                        session.turns = load_codex_history(home, session_id, Some(&session.cwd));
                    }
                    return Some(session);
                }
            }
        }
    }
    find_codex_rollout(home, session_id).map(|path| {
        parse_codex_rollout(&path).unwrap_or_else(|| ImportSessionMeta {
            session_id: session_id.into(),
            agent_id: "codex".into(),
            cwd: String::new(),
            title: "Untitled imported session".into(),
            preview: None,
            created_at: None,
            updated_at: None,
            model: None,
            turns: Vec::new(),
        })
    })
}

fn query_codex_threads(
    conn: &Connection,
    session_id: Option<&str>,
) -> rusqlite::Result<Vec<ImportSessionMeta>> {
    let sql = if session_id.is_some() {
        "SELECT id, cwd, title, model, first_user_message, preview, created_at, updated_at
         FROM threads WHERE id = ?1 LIMIT 1"
    } else {
        "SELECT id, cwd, title, model, first_user_message, preview, created_at, updated_at
         FROM threads ORDER BY updated_at DESC LIMIT 80"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(id) = session_id {
        stmt.query(params![id])?
    } else {
        stmt.query([])?
    };
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let cwd: String = row.get(1).unwrap_or_default();
        let title: Option<String> = row.get(2).ok();
        let model: Option<String> = row.get(3).ok();
        let first_user: Option<String> = row.get(4).ok();
        let preview: Option<String> = row.get(5).ok();
        let created_at = int_to_rfc3339(row.get::<_, i64>(6).ok());
        let updated_at = int_to_rfc3339(row.get::<_, i64>(7).ok());
        let preview = nonempty(preview).or_else(|| nonempty(first_user.clone()));
        let title = nonempty(title)
            .or_else(|| preview.clone())
            .unwrap_or_else(|| "Untitled imported session".into());
        out.push(ImportSessionMeta {
            session_id: id,
            agent_id: "codex".into(),
            cwd,
            title: truncate_title(&title),
            preview,
            created_at,
            updated_at,
            model: nonempty(model),
            turns: Vec::new(),
        });
    }
    Ok(out)
}

fn load_codex_history(home: &Path, session_id: &str, cwd: Option<&str>) -> Vec<ThreadTurnDto> {
    let paginated = load_codex_paginated_history(home, session_id).unwrap_or_default();
    let rollout = find_codex_rollout(home, session_id)
        .and_then(|path| parse_codex_rollout(&path))
        .filter(|session| cwd.map(|value| session.cwd == value).unwrap_or(true))
        .map(|session| session.turns)
        .unwrap_or_default();
    merge_codex_turns(paginated, rollout)
}

fn merge_codex_turns(
    paginated: Vec<ThreadTurnDto>,
    rollout: Vec<ThreadTurnDto>,
) -> Vec<ThreadTurnDto> {
    if paginated.is_empty() {
        return rollout;
    }
    let rollout_order: Vec<_> = rollout.iter().map(|turn| turn.id.clone()).collect();
    let mut rollout_by_id: HashMap<_, _> = rollout
        .into_iter()
        .map(|turn| (turn.id.clone(), turn))
        .collect();
    let mut merged = Vec::new();
    for mut turn in paginated {
        if let Some(transcript) = rollout_by_id.remove(&turn.id) {
            let item_ids: HashSet<_> = turn.items.iter().map(|item| item.id.clone()).collect();
            let message_keys: HashSet<_> = turn.items.iter().filter_map(message_key).collect();
            turn.items
                .extend(transcript.items.into_iter().filter(|item| {
                    !item_ids.contains(&item.id)
                        && message_key(item)
                            .map(|key| !message_keys.contains(&key))
                            .unwrap_or(true)
                }));
            turn.items = stable_sort_history_items(turn.items);
            turn.started_at = turn.started_at.or(transcript.started_at);
            turn.status = transcript.status;
            turn.error = transcript.error.or(turn.error);
            turn.completed_at = turn.completed_at.or(transcript.completed_at);
            turn.model = transcript.model.or(turn.model);
            turn.reasoning_effort = transcript.reasoning_effort.or(turn.reasoning_effort);
            turn.token_usage = transcript.token_usage.or(turn.token_usage);
            turn.price_estimate = transcript.price_estimate.or(turn.price_estimate);
        }
        merged.push(turn);
    }
    for turn_id in rollout_order {
        if let Some(turn) = rollout_by_id.remove(&turn_id) {
            merged.push(turn);
        }
    }
    let mut indexed: Vec<_> = merged.into_iter().enumerate().collect();
    indexed.sort_by(|(left_index, left), (right_index, right)| {
        timestamp_sort_key(left.started_at.as_deref())
            .cmp(&timestamp_sort_key(right.started_at.as_deref()))
            .then_with(|| left_index.cmp(right_index))
    });
    indexed.into_iter().map(|(_, turn)| turn).collect()
}

pub(crate) fn message_key(item: &ThreadHistoryItemDto) -> Option<(String, String, bool)> {
    matches!(item.kind.as_str(), "userMessage" | "agentMessage").then(|| {
        let phase = item
            .extra
            .get("phase")
            .and_then(Value::as_str)
            .or(item.status.as_deref());
        let is_commentary = item.kind == "agentMessage" && phase == Some("commentary");
        (
            item.kind.clone(),
            item.text.trim().to_string(),
            is_commentary,
        )
    })
}

fn stable_sort_history_items(items: Vec<ThreadHistoryItemDto>) -> Vec<ThreadHistoryItemDto> {
    let mut indexed: Vec<_> = items.into_iter().enumerate().collect();
    indexed.sort_by(|(left_index, left), (right_index, right)| {
        match (
            timestamp_sort_key(left.created_at.as_deref()),
            timestamp_sort_key(right.created_at.as_deref()),
        ) {
            (Some(left), Some(right)) => left.cmp(&right).then_with(|| left_index.cmp(right_index)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => left_index.cmp(right_index),
        }
    });
    indexed
        .into_iter()
        .enumerate()
        .map(|(sequence, (_, mut item))| {
            item.sequence = Some(sequence as i64);
            item
        })
        .collect()
}

fn timestamp_sort_key(value: Option<&str>) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn parse_codex_turn_error(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|parsed| {
            parsed
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| Some(value.to_string()))
}

fn load_codex_paginated_history(home: &Path, session_id: &str) -> Option<Vec<ThreadTurnDto>> {
    let path = home.join("thread_history_1.sqlite");
    let conn = open_readonly(&path).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT turn_id, status, error_json, started_at FROM thread_turns
             WHERE thread_id = ?1 ORDER BY rollout_ordinal ASC",
        )
        .ok()?;
    let turns: Vec<(String, String, Option<String>, Option<i64>)> = stmt
        .query_map(params![session_id], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, String>(1)
                    .unwrap_or_else(|_| "completed".into()),
                row.get(2).ok(),
                row.get(3).ok(),
            ))
        })
        .ok()?
        .filter_map(|row| row.ok())
        .collect();
    if turns.is_empty() {
        return None;
    }
    let mut item_stmt = conn
        .prepare(
            "SELECT turn_id, rollout_ordinal, created_at_ms, item_type, item_json
             FROM thread_items
             WHERE thread_id = ?1 ORDER BY rollout_ordinal ASC",
        )
        .ok()?;
    let mut items_by_turn: HashMap<String, Vec<ThreadHistoryItemDto>> = HashMap::new();
    if let Ok(rows) = item_stmt.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<i64>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    }) {
        for row in rows.flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&row.4) {
                if let Some(item) =
                    history_item_from_codex_json(&row.0, &value, &row.3, row.2, Some(row.1))
                {
                    items_by_turn.entry(row.0).or_default().push(item);
                }
            }
        }
    }
    Some(
        turns
            .into_iter()
            .map(|(id, status, error, started)| ThreadTurnDto {
                id: id.clone(),
                started_at: int_to_rfc3339(started),
                completed_at: None,
                status: normalize_status(&status),
                error: parse_codex_turn_error(error.as_deref()),
                model: None,
                reasoning_effort: None,
                token_usage: None,
                price_estimate: None,
                has_deferred_items: None,
                deferred_item_count: None,
                items: items_by_turn.remove(&id).unwrap_or_default(),
            })
            .collect(),
    )
}

fn history_item_from_codex_json(
    turn_id: &str,
    value: &Value,
    fallback_kind: &str,
    created_at_ms: Option<i64>,
    sequence: Option<i64>,
) -> Option<ThreadHistoryItemDto> {
    let raw_kind = value
        .get("type")
        .or_else(|| value.get("kind"))
        .and_then(Value::as_str)
        .filter(|kind| !kind.is_empty())
        .unwrap_or(fallback_kind);
    let kind = match raw_kind {
        "userMessage" | "user_message" | "user" => "userMessage",
        "agentMessage" | "agent_message" | "assistant" | "text" => "agentMessage",
        "reasoning" | "thought" => "reasoning",
        "commandExecution" | "command_execution" | "command" => "commandExecution",
        "fileChange" | "file_change" => "fileChange",
        "plan" => "plan",
        "contextCompaction" | "context_compaction" => "contextCompaction",
        "webSearch" | "web_search" | "webSearchCall" | "web_search_call" => "webSearch",
        "imageView" | "image_view" | "viewImage" | "view_image" => "imageView",
        "mcpToolCall" | "mcp_tool_call" | "dynamicToolCall" | "dynamic_tool_call" => "toolCall",
        "collabAgentToolCall" | "collab_agent_tool_call" => "agentToolCall",
        _ => "other",
    };
    let direct_text = codex_text(value).and_then(|text| {
        if kind == "userMessage" {
            sanitize_codex_user_text(&text)
        } else {
            Some(text)
        }
    });
    let command = codex_record_text(value, &["command", "cmd", "argv"]);
    let output = codex_record_text(
        value,
        &[
            "aggregatedOutput",
            "aggregated_output",
            "output",
            "stdout",
            "stderr",
        ],
    );
    let summary = codex_record_text(
        value,
        &[
            "summary",
            "summaryText",
            "summary_text",
            "rawContent",
            "raw_content",
        ],
    );
    let label = codex_record_text(
        value,
        &[
            "query",
            "path",
            "filePath",
            "file_path",
            "title",
            "name",
            "tool",
            "toolName",
        ],
    );
    let (text, preview_text, detail_text) = match kind {
        "reasoning" | "contextCompaction" => {
            let text = [summary, direct_text]
                .into_iter()
                .flatten()
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            (text, None, None)
        }
        "commandExecution" => {
            let title = command.or(label).unwrap_or_else(|| "Command output".into());
            let detail = output
                .filter(|output| !output.trim().is_empty())
                .map(|output| format!("{title}\n\n{output}"));
            (title.clone(), Some(title), detail)
        }
        "toolCall" | "agentToolCall" => {
            let title = label.unwrap_or_else(|| "Tool call".into());
            let detail = serde_json::to_string_pretty(value).ok();
            (title.clone(), Some(title), detail)
        }
        "webSearch" => {
            let text = label.or(direct_text).unwrap_or_else(|| "Web search".into());
            (text, None, None)
        }
        "imageView" => {
            let text = label.or(direct_text).unwrap_or_else(|| "Image".into());
            (text, None, None)
        }
        "fileChange" | "plan" => {
            let text = direct_text
                .or(label)
                .unwrap_or_else(|| raw_kind.to_string());
            (text, None, None)
        }
        "other" => {
            let text = direct_text
                .or(label)
                .unwrap_or_else(|| raw_kind.to_string());
            (text, None, serde_json::to_string_pretty(value).ok())
        }
        _ => (direct_text.unwrap_or_default(), None, None),
    };
    if text.trim().is_empty() && kind != "other" {
        return None;
    }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{turn_id}:{kind}:{}", sequence.unwrap_or_default()));
    let created_at = created_at_ms
        .and_then(epoch_millis_to_rfc3339)
        .or_else(|| codex_item_created_at(value));
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .map(normalize_item_status)
        .unwrap_or_else(|| "completed".into());
    let mut extra: BTreeMap<String, Value> = value
        .as_object()
        .into_iter()
        .flat_map(|object| object.iter())
        .filter(|(key, _)| {
            !matches!(
                key.as_str(),
                "id" | "kind"
                    | "text"
                    | "createdAt"
                    | "created_at"
                    | "previewText"
                    | "preview_text"
                    | "detailText"
                    | "detail_text"
                    | "status"
                    | "sequence"
                    | "sourceTurnId"
                    | "source_turn_id"
                    | "artifact"
            )
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    extra.insert("providerItemType".into(), Value::String(raw_kind.into()));
    Some(ThreadHistoryItemDto {
        id,
        created_at,
        kind: kind.into(),
        text,
        preview_text,
        detail_text,
        status: Some(status),
        sequence,
        source_turn_id: Some(turn_id.into()),
        artifact: value.get("artifact").cloned(),
        extra,
    })
}

fn codex_text(value: &Value) -> Option<String> {
    codex_record_text(value, &["text", "message"])
        .or_else(|| content_text(value.get("content").unwrap_or(value)))
}

fn codex_record_text(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(candidate) = value.get(*key) else {
            continue;
        };
        let text = match candidate {
            Value::String(text) => text.clone(),
            Value::Array(entries) => entries
                .iter()
                .filter_map(|entry| {
                    entry.as_str().map(str::to_string).or_else(|| {
                        entry
                            .get("text")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                })
                .collect::<Vec<_>>()
                .join("\n"),
            _ => continue,
        };
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

fn codex_item_created_at(value: &Value) -> Option<String> {
    for key in [
        "createdAt",
        "created_at",
        "startedAt",
        "started_at",
        "completedAt",
        "completed_at",
    ] {
        let Some(candidate) = value.get(key) else {
            continue;
        };
        if let Some(timestamp) = timestamp_to_rfc3339(candidate) {
            return Some(timestamp);
        }
    }
    None
}

fn timestamp_to_rfc3339(value: &Value) -> Option<String> {
    if let Some(number) = value.as_f64() {
        if !number.is_finite() || number <= 0.0 {
            return None;
        }
        let millis = if number < 10_000_000_000.0 {
            number * 1000.0
        } else {
            number
        };
        return epoch_millis_to_rfc3339(millis.trunc() as i64);
    }
    let text = value.as_str()?.trim();
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|timestamp| timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn epoch_millis_to_rfc3339(value: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(value)
        .map(|timestamp| timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn normalize_item_status(status: &str) -> String {
    match status {
        "in_progress" | "inProgress" | "running" => "running".into(),
        "failed" => "failed".into(),
        "interrupted" | "cancelled" => "interrupted".into(),
        _ => "completed".into(),
    }
}

pub(crate) fn find_codex_rollout(home: &Path, session_id: &str) -> Option<PathBuf> {
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return None;
    }
    for entry in walkdir::WalkDir::new(sessions)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
    {
        let name = entry.file_name().to_string_lossy();
        if name.ends_with(".jsonl") && name.contains(session_id) {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

fn parse_codex_rollout(path: &Path) -> Option<ImportSessionMeta> {
    let raw = fs::read_to_string(path).ok()?;
    let entries: Vec<Value> = raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    parse_codex_rollout_entries(entries)
}

pub(crate) fn read_codex_usage_history(path: &Path) -> Option<Vec<ThreadTurnDto>> {
    use std::io::BufRead;
    let file = fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let mut entries = Vec::new();
    let mut line = String::new();
    while reader.read_line(&mut line).ok()? > 0 {
        // Avoid parsing large tool outputs and assistant transcripts when only
        // restoring billing metadata. Keep prompts for unambiguous turn matching.
        if [
            "session_meta",
            "turn_context",
            "task_started",
            "task_complete",
            "token_count",
            "user_message",
            "turn_aborted",
            "task_cancelled",
            "\"user\"",
        ]
        .iter()
        .any(|kind| {
            line.as_bytes()[..line.len().min(512)]
                .windows(kind.len())
                .any(|window| window == kind.as_bytes())
        }) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                entries.push(value);
            }
        }
        line.clear();
    }
    parse_codex_rollout_entries(entries).map(|session| session.turns)
}

fn parse_codex_rollout_entries(entries: Vec<Value>) -> Option<ImportSessionMeta> {
    let mut segment_index = -1_i64;
    let indexed_entries: Vec<_> = entries
        .into_iter()
        .map(|entry| {
            if entry.get("type").and_then(Value::as_str) == Some("event_msg")
                && entry.pointer("/payload/type").and_then(Value::as_str) == Some("task_started")
            {
                segment_index += 1;
            }
            (entry, segment_index)
        })
        .collect();
    let legacy_segments: HashSet<_> = indexed_entries
        .iter()
        .filter(|(entry, _)| {
            entry.get("type").and_then(Value::as_str) == Some("event_msg")
                && matches!(
                    entry.pointer("/payload/type").and_then(Value::as_str),
                    Some("user_message" | "agent_message")
                )
        })
        .map(|(_, segment)| *segment)
        .collect();
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut title = String::new();
    let mut model = None;
    let mut turns: Vec<ThreadTurnDto> = Vec::new();
    let mut current: Option<ThreadTurnDto> = None;
    let mut fallback_turn_count = 0_usize;
    let mut user_item_count = 0_usize;
    let mut agent_item_count = 0_usize;
    let mut created_at = None;
    let mut updated_at = None;
    let mut cumulative_tokens = crate::usage::Tokens::default();
    let mut turn_baseline = crate::usage::Tokens::default();
    let mut turn_tier = "standard";
    for (value, segment) in indexed_entries {
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        if created_at.is_none() {
            created_at = timestamp.clone();
        }
        if timestamp.is_some() {
            updated_at = timestamp.clone();
        }
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = value.get("payload").unwrap_or(&value);
        if kind == "session_meta" {
            session_id = payload
                .get("id")
                .or_else(|| payload.get("session_id"))
                .and_then(Value::as_str)
                .unwrap_or(&session_id)
                .to_string();
            cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or(&cwd)
                .to_string();
            title = payload
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(&title)
                .to_string();
            model = payload
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string);
            continue;
        }

        if kind == "turn_context" {
            model = payload
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(model);
            let turn =
                ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
            turn.model = model.clone();
            turn.reasoning_effort = payload
                .get("effort")
                .or_else(|| payload.get("reasoning_effort"))
                .and_then(Value::as_str)
                .map(str::to_string);
            turn_tier = if payload.get("service_tier").and_then(Value::as_str) == Some("fast") {
                "fast"
            } else {
                "standard"
            };
            continue;
        }

        if kind == "response_item"
            && !legacy_segments.contains(&segment)
            && payload.get("type").and_then(Value::as_str) == Some("message")
        {
            let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
            if role == "user" && !codex_message_is_user_authored(payload) {
                continue;
            }
            let raw_text =
                content_text(payload.get("content").unwrap_or(payload)).unwrap_or_default();
            let text = if role == "user" {
                sanitize_codex_user_text(&raw_text).unwrap_or_default()
            } else {
                raw_text
            };
            if text.trim().is_empty() || !matches!(role, "user" | "assistant") {
                continue;
            }
            let turn =
                ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
            let (item_kind, item_count) = if role == "user" {
                user_item_count += 1;
                ("userMessage", user_item_count)
            } else {
                agent_item_count += 1;
                ("agentMessage", agent_item_count)
            };
            let id = payload
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{}:{role}:{item_count}", turn.id));
            let status = if role == "assistant" {
                payload
                    .get("phase")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            } else {
                None
            };
            turn.items.push(ThreadHistoryItemDto {
                id,
                created_at: timestamp,
                kind: item_kind.into(),
                text,
                preview_text: None,
                detail_text: None,
                status,
                sequence: Some(turn.items.len() as i64),
                source_turn_id: Some(turn.id.clone()),
                artifact: None,
                extra: Default::default(),
            });
            continue;
        }

        if kind != "event_msg" {
            continue;
        }
        match payload.get("type").and_then(Value::as_str).unwrap_or("") {
            "task_started" => {
                finish_codex_turn(&mut current, &mut turns);
                fallback_turn_count += 1;
                let id = payload
                    .get("turn_id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.trim().is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("local-turn-{fallback_turn_count}"));
                current = Some(empty_codex_turn(id, timestamp));
                turn_baseline = cumulative_tokens.clone();
                turn_tier = "standard";
                user_item_count = 0;
                agent_item_count = 0;
            }
            "token_count" => {
                let Some(info) = payload.get("info") else {
                    continue;
                };
                let Some(total) = info
                    .get("total_token_usage")
                    .and_then(crate::usage::Tokens::parse)
                else {
                    continue;
                };
                let last = info
                    .get("last_token_usage")
                    .and_then(crate::usage::Tokens::parse)
                    .unwrap_or_else(|| total.clone());
                if let Some(turn) = current.as_mut() {
                    turn.model = turn.model.take().or(model.clone());
                    let delta = total.cumulative_delta(&cumulative_tokens);
                    let previous = turn
                        .token_usage
                        .as_ref()
                        .and_then(|usage| crate::usage::Tokens::parse(&usage["total"]))
                        .unwrap_or_default();
                    let mut usage = serde_json::json!({"total":previous.add(&delta),"last":last,"modelContextWindow":info.get("model_context_window"),"baselineTotal":turn_baseline,"cumulativeTotal":total});
                    let delta_usage = serde_json::json!({"total":delta,"last":last});
                    if let Some(mut price) = crate::usage::estimate_price(
                        &delta_usage,
                        turn.model.as_deref(),
                        Some(turn_tier),
                    ) {
                        if let Some(previous) = &turn.price_estimate {
                            for field in [
                                "inputUsd",
                                "cachedInputUsd",
                                "cacheWriteInputUsd",
                                "outputUsd",
                                "totalUsd",
                            ] {
                                price[field] = serde_json::json!(
                                    price[field].as_f64().unwrap_or_default()
                                        + previous[field].as_f64().unwrap_or_default()
                                );
                            }
                        }
                        usage["priceEstimate"] = price.clone();
                        turn.price_estimate = Some(price);
                    }
                    turn.token_usage = Some(usage);
                }
                cumulative_tokens = total;
            }
            "user_message" | "agent_message" => {
                let Some(text) = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                else {
                    continue;
                };
                let turn =
                    ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
                let user = payload.get("type").and_then(Value::as_str) == Some("user_message");
                let count = if user {
                    user_item_count += 1;
                    user_item_count
                } else {
                    agent_item_count += 1;
                    agent_item_count
                };
                let role = if user { "user" } else { "agent" };
                turn.items.push(ThreadHistoryItemDto {
                    id: format!("{}:{role}:{count}", turn.id),
                    created_at: timestamp,
                    kind: if user { "userMessage" } else { "agentMessage" }.into(),
                    text: text.to_string(),
                    preview_text: None,
                    detail_text: None,
                    status: None,
                    sequence: Some(turn.items.len() as i64),
                    source_turn_id: Some(turn.id.clone()),
                    artifact: None,
                    extra: Default::default(),
                });
            }
            "item_completed" => {
                let Some(raw_item) = payload.get("item") else {
                    continue;
                };
                let turn =
                    ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
                let created_at_ms = payload.get("started_at_ms").and_then(Value::as_i64);
                if let Some(mut item) = history_item_from_codex_json(
                    &turn.id,
                    raw_item,
                    raw_item
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("other"),
                    created_at_ms,
                    Some(turn.items.len() as i64),
                ) {
                    if created_at_ms.is_none() {
                        item.created_at = item.created_at.or(timestamp);
                    }
                    if let Some(existing) = turn.items.iter_mut().find(|entry| entry.id == item.id)
                    {
                        *existing = item;
                    } else {
                        turn.items.push(item);
                    }
                }
            }
            "error" => {
                let turn =
                    ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
                turn.status = "failed".into();
                turn.error = Some(
                    payload
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Local Codex session failed")
                        .to_string(),
                );
            }
            "turn_aborted" | "task_cancelled" => {
                let turn =
                    ensure_codex_turn(&mut current, &mut fallback_turn_count, timestamp.as_deref());
                turn.status = "interrupted".into();
                finish_codex_turn(&mut current, &mut turns);
            }
            "task_complete" => {
                if let Some(turn) = current.as_mut() {
                    if turn.error.is_none() && turn.status != "interrupted" {
                        turn.status = "completed".into();
                    }
                    turn.completed_at = timestamp.clone();
                }
                finish_codex_turn(&mut current, &mut turns);
            }
            _ => {}
        }
    }
    finish_codex_turn(&mut current, &mut turns);
    if cwd.is_empty() {
        return None;
    }
    let preview = turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .find(|item| item.kind == "userMessage")
        .map(|item| item.text.clone());
    Some(ImportSessionMeta {
        session_id,
        agent_id: "codex".into(),
        cwd,
        title: truncate_title(
            nonempty(Some(title))
                .or_else(|| preview.clone())
                .as_deref()
                .unwrap_or("Untitled imported session"),
        ),
        preview,
        created_at,
        updated_at,
        model,
        turns,
    })
}

fn codex_message_is_user_authored(payload: &Value) -> bool {
    let Some(kinds) = payload
        .get("internal_chat_message_metadata_passthrough")
        .and_then(|metadata| metadata.get("content_item_kinds"))
        .and_then(Value::as_array)
    else {
        return true;
    };
    kinds
        .iter()
        .filter_map(Value::as_str)
        .any(|kind| kind.starts_with("user."))
}

pub(crate) fn sanitize_codex_user_text(text: &str) -> Option<String> {
    const REQUEST_MARKER: &str = "## My request:";
    let trimmed = text.trim();
    let has_injected_context = trimmed.starts_with("# AGENTS.md instructions")
        || trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<in-app-browser-context")
        || trimmed.starts_with("<skills_instructions>")
        || trimmed.starts_with("# Context from my IDE setup:");
    let request = has_injected_context
        .then(|| trimmed.split_once(REQUEST_MARKER))
        .flatten()
        .map(|(_, request)| request.trim());
    let cleaned = request.unwrap_or(trimmed);
    if cleaned.is_empty() || (has_injected_context && request.is_none()) {
        return None;
    }
    Some(cleaned.to_string())
}

fn empty_codex_turn(id: String, started_at: Option<String>) -> ThreadTurnDto {
    ThreadTurnDto {
        id,
        started_at,
        completed_at: None,
        status: "inProgress".into(),
        error: None,
        model: None,
        reasoning_effort: None,
        token_usage: None,
        price_estimate: None,
        has_deferred_items: None,
        deferred_item_count: None,
        items: Vec::new(),
    }
}

fn ensure_codex_turn<'a>(
    current: &'a mut Option<ThreadTurnDto>,
    fallback_turn_count: &mut usize,
    started_at: Option<&str>,
) -> &'a mut ThreadTurnDto {
    if current.is_none() {
        *fallback_turn_count += 1;
        *current = Some(empty_codex_turn(
            format!("local-turn-{fallback_turn_count}"),
            started_at.map(str::to_string),
        ));
    }
    current.as_mut().expect("turn initialized")
}

fn finish_codex_turn(current: &mut Option<ThreadTurnDto>, turns: &mut Vec<ThreadTurnDto>) {
    if let Some(turn) = current.take().filter(|turn| !turn.items.is_empty()) {
        turns.push(turn);
    }
}

fn list_grok_sessions(home: &Path) -> Vec<ImportSessionMeta> {
    grok_summary_paths(home)
        .into_iter()
        .filter_map(|path| parse_grok_summary(&path, false))
        .collect()
}

fn find_grok_session(home: &Path, session_id: &str) -> Option<ImportSessionMeta> {
    grok_summary_paths(home).into_iter().find_map(|path| {
        let parsed = parse_grok_summary(&path, true)?;
        session_ids_match(&parsed.session_id, session_id).then_some(parsed)
    })
}

fn grok_summary_paths(home: &Path) -> Vec<PathBuf> {
    let root = home.join("sessions");
    if !root.is_dir() {
        return Vec::new();
    }
    walkdir::WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && entry.file_name() == "summary.json")
        .map(|entry| entry.path().to_path_buf())
        .collect()
}

fn parse_grok_summary(path: &Path, with_history: bool) -> Option<ImportSessionMeta> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let info = value.get("info").cloned().unwrap_or(value.clone());
    let session_id = info.get("id").and_then(Value::as_str)?.to_string();
    let cwd = info
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if cwd.is_empty() {
        return None;
    }
    let model = value
        .get("current_model_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let turns = if with_history {
        parse_grok_history(&path.with_file_name("chat_history.jsonl"))
    } else {
        Vec::new()
    };
    let preview = turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .find(|item| item.kind == "userMessage")
        .map(|item| item.text.clone());
    let title = nonempty(
        value
            .get("session_summary")
            .and_then(Value::as_str)
            .map(str::to_string),
    )
    .or_else(|| preview.clone())
    .unwrap_or_else(|| "Untitled imported session".into());
    Some(ImportSessionMeta {
        session_id,
        agent_id: "grok".into(),
        cwd,
        title: truncate_title(&title),
        preview,
        created_at: value
            .get("created_at")
            .and_then(Value::as_str)
            .map(str::to_string),
        updated_at: value
            .get("updated_at")
            .and_then(Value::as_str)
            .map(str::to_string),
        model,
        turns,
    })
}

fn parse_grok_history(path: &Path) -> Vec<ThreadTurnDto> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut turns = Vec::new();
    let mut current: Option<ThreadTurnDto> = None;
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let text = content_text(value.get("content").unwrap_or(&value)).unwrap_or_default();
        if text.trim().is_empty() || text.contains("<system-reminder>") {
            continue;
        }
        match kind {
            "user" => {
                if let Some(turn) = current.take() {
                    turns.push(turn);
                }
                let id = format!("imported-{}", turns.len() + 1);
                current = Some(ThreadTurnDto {
                    id: id.clone(),
                    started_at: None,
                    completed_at: None,
                    status: "completed".into(),
                    error: None,
                    model: None,
                    reasoning_effort: None,
                    token_usage: None,
                    price_estimate: None,
                    has_deferred_items: None,
                    deferred_item_count: None,
                    items: vec![item(
                        format!("{id}:user"),
                        "userMessage",
                        text,
                        "completed",
                        &id,
                    )],
                });
            }
            "assistant" => {
                if let Some(turn) = current.as_mut() {
                    turn.items.push(item(
                        format!("{}:assistant", turn.id),
                        "agentMessage",
                        text,
                        "completed",
                        &turn.id,
                    ));
                }
            }
            _ => {}
        }
    }
    if let Some(turn) = current {
        turns.push(turn);
    }
    turns
}

fn list_claude_sessions(home: &Path) -> Vec<ImportSessionMeta> {
    claude_jsonl_paths(home)
        .into_iter()
        .filter_map(|path| parse_claude_jsonl(&path, false))
        .collect()
}

fn find_claude_session(home: &Path, session_id: &str) -> Option<ImportSessionMeta> {
    claude_jsonl_paths(home).into_iter().find_map(|path| {
        let parsed = parse_claude_jsonl(&path, true)?;
        session_ids_match(&parsed.session_id, session_id).then_some(parsed)
    })
}

fn claude_jsonl_paths(home: &Path) -> Vec<PathBuf> {
    let root = home.join("projects");
    if !root.is_dir() {
        return Vec::new();
    }
    walkdir::WalkDir::new(root)
        .max_depth(2)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.file_type().is_file()
                && entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl")
        })
        .map(|entry| entry.path().to_path_buf())
        .collect()
}

fn parse_claude_jsonl(path: &Path, with_history: bool) -> Option<ImportSessionMeta> {
    let raw = fs::read_to_string(path).ok()?;
    let mut session_id = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut cwd = String::new();
    let mut turns = Vec::new();
    let mut current: Option<ThreadTurnDto> = None;
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(id) = value.get("sessionId").and_then(Value::as_str) {
            session_id = id.to_string();
        }
        if cwd.is_empty() {
            if let Some(found) = value.get("cwd").and_then(Value::as_str) {
                cwd = found.to_string();
            }
        }
        if !with_history {
            continue;
        }
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let message = value.get("message").cloned().unwrap_or(value.clone());
        let text = content_text(message.get("content").unwrap_or(&message)).unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        match kind {
            "user" => {
                if message
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items.iter().any(|item| {
                            item.get("type").and_then(Value::as_str) == Some("tool_result")
                        })
                    })
                    .unwrap_or(false)
                {
                    continue;
                }
                if let Some(turn) = current.take() {
                    turns.push(turn);
                }
                let id = format!("imported-{}", turns.len() + 1);
                current = Some(ThreadTurnDto {
                    id: id.clone(),
                    started_at: value
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    completed_at: None,
                    status: "completed".into(),
                    error: None,
                    model: None,
                    reasoning_effort: None,
                    token_usage: None,
                    price_estimate: None,
                    has_deferred_items: None,
                    deferred_item_count: None,
                    items: vec![item(
                        format!("{id}:user"),
                        "userMessage",
                        text,
                        "completed",
                        &id,
                    )],
                });
            }
            "assistant" => {
                if let Some(turn) = current.as_mut() {
                    turn.items.push(item(
                        format!("{}:assistant", turn.id),
                        "agentMessage",
                        text,
                        "completed",
                        &turn.id,
                    ));
                }
            }
            _ => {}
        }
    }
    if let Some(turn) = current {
        turns.push(turn);
    }
    if cwd.is_empty() {
        return None;
    }
    let preview = turns
        .iter()
        .flat_map(|turn| turn.items.iter())
        .find(|item| item.kind == "userMessage")
        .map(|item| item.text.clone());
    Some(ImportSessionMeta {
        session_id,
        agent_id: "claude".into(),
        cwd,
        title: truncate_title(preview.as_deref().unwrap_or("Untitled imported session")),
        preview,
        created_at: None,
        updated_at: None,
        model: None,
        turns,
    })
}

fn open_readonly(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
}

fn codex_state_files(home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in [home.to_path_buf(), home.join("sqlite")] {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("state_") && name.ends_with(".sqlite") {
                files.push(entry.path());
            }
        }
    }
    files.sort_by_key(|path| {
        std::cmp::Reverse(
            path.metadata()
                .and_then(|meta| meta.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0),
        )
    });
    files
}

fn dedupe_sessions(sessions: Vec<ImportSessionMeta>) -> Vec<ImportSessionMeta> {
    let mut out = Vec::new();
    for session in sessions {
        if out.iter().any(|existing: &ImportSessionMeta| {
            session_ids_match(&existing.session_id, &session.session_id)
        }) {
            continue;
        }
        out.push(session);
    }
    out
}

fn content_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    let items = value.as_array()?;
    let text = items
        .iter()
        .filter_map(|item| {
            let kind = item.get("type").and_then(Value::as_str).unwrap_or("text");
            if matches!(kind, "text" | "input_text" | "output_text") {
                item.get("text").and_then(Value::as_str).map(str::to_string)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

fn item(id: String, kind: &str, text: String, status: &str, turn_id: &str) -> ThreadHistoryItemDto {
    ThreadHistoryItemDto {
        id,
        created_at: Some(now_rfc3339()),
        kind: kind.into(),
        text,
        preview_text: None,
        detail_text: None,
        status: Some(status.into()),
        sequence: None,
        source_turn_id: Some(turn_id.into()),
        artifact: None,
        extra: Default::default(),
    }
}

fn truncate_title(value: &str) -> String {
    remote_codex_protocol::truncate_title(value)
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn normalize_status(status: &str) -> String {
    match status {
        "in_progress" | "inProgress" => "inProgress".into(),
        "failed" => "failed".into(),
        "interrupted" => "interrupted".into(),
        _ => "completed".into(),
    }
}

fn int_to_rfc3339(value: Option<i64>) -> Option<String> {
    let value = value?;
    if value <= 0 {
        return None;
    }
    let secs = if value > 10_000_000_000 {
        value / 1000
    } else {
        value
    };
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn finds_grok_and_claude_sessions_from_disk() {
        let root = tempfile::tempdir().unwrap();
        let grok_home = root.path().join("grok");
        let claude_home = root.path().join("claude");
        let cwd = root.path().join("proj");
        fs::create_dir_all(&cwd).unwrap();
        let grok_dir = grok_home
            .join("sessions")
            .join("%2Ftmp%2Fproj")
            .join("01a0513a-7417-7553-8c77-399316ec7a9b");
        fs::create_dir_all(&grok_dir).unwrap();
        fs::write(
            grok_dir.join("summary.json"),
            serde_json::json!({
                "info": {
                    "id": "01a0513a-7417-7553-8c77-399316ec7a9b",
                    "cwd": cwd.to_string_lossy()
                },
                "session_summary": "Grok imported",
                "updated_at": "2026-08-30T05:53:00.802931Z"
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            grok_dir.join("chat_history.jsonl"),
            "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello grok\"}]}\n{\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}\n",
        )
        .unwrap();

        let claude_dir = claude_home.join("projects").join("tmp-proj");
        fs::create_dir_all(&claude_dir).unwrap();
        let mut claude =
            fs::File::create(claude_dir.join("e2136e08-a223-4ae9-9b03-57180a8a822c.jsonl"))
                .unwrap();
        writeln!(
            claude,
            "{}",
            serde_json::json!({
                "type": "user",
                "cwd": cwd,
                "sessionId": "e2136e08-a223-4ae9-9b03-57180a8a822c",
                "message": { "content": [{ "type": "text", "text": "hello claude" }] }
            })
        )
        .unwrap();
        writeln!(
            claude,
            "{}",
            serde_json::json!({
                "type": "assistant",
                "sessionId": "e2136e08-a223-4ae9-9b03-57180a8a822c",
                "message": { "content": [{ "type": "text", "text": "ready" }] }
            })
        )
        .unwrap();

        let homes = LocalSessionHomes {
            codex_home: root.path().join("missing-codex"),
            grok_home,
            claude_home,
        };
        let grok = find_local_session(
            &homes,
            "grok",
            "grok://sessions/01a0513a-7417-7553-8c77-399316ec7a9b",
        )
        .unwrap();
        assert_eq!(grok.cwd, cwd.to_string_lossy());
        assert!(grok.turns.iter().any(|turn| {
            turn.items
                .iter()
                .any(|item| item.kind == "userMessage" && item.text.contains("hello grok"))
        }));

        let claude =
            find_local_session(&homes, "claude", "e2136e08-a223-4ae9-9b03-57180a8a822c").unwrap();
        assert_eq!(claude.cwd, cwd.to_string_lossy());
        assert!(claude.turns.iter().any(|turn| {
            turn.items
                .iter()
                .any(|item| item.kind == "agentMessage" && item.text.contains("ready"))
        }));
    }

    #[test]
    fn codex_rollout_restores_turn_model_effort_tokens_and_request_prices() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("rollout.jsonl");
        let mut rows = vec![
            serde_json::json!({"type":"session_meta","payload":{"id":"session","cwd":root.path()}}),
            serde_json::json!({"timestamp":"2026-09-05T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"one"}}),
            serde_json::json!({"type":"turn_context","payload":{"model":"gpt-6-astra","effort":"high"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"first"}}),
        ];
        for (input, output, last) in [
            (100000, 1000, 100000),
            (400000, 2000, 300000),
            (400000, 2000, 300000),
        ] {
            rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":input,"output_tokens":output},"last_token_usage":{"input_tokens":last,"output_tokens":1000},"model_context_window":1050000}}}));
        }
        rows.extend([
            serde_json::json!({"timestamp":"2026-09-05T10:01:00Z","type":"event_msg","payload":{"type":"task_complete"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"two"}}),
            serde_json::json!({"type":"turn_context","payload":{"model":"gpt-5.6-luna","effort":"medium"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"second"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":401000,"output_tokens":2100},"last_token_usage":{"input_tokens":1000,"output_tokens":100},"model_context_window":1050000}}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"task_complete"}}),
        ]);
        fs::write(
            &path,
            rows.iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let session = parse_codex_rollout(&path).unwrap();
        assert_eq!(session.turns.len(), 2);
        let first = &session.turns[0];
        assert_eq!(first.model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(first.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(first.completed_at.as_deref(), Some("2026-09-05T10:01:00Z"));
        assert!(
            (first.price_estimate.as_ref().unwrap()["totalUsd"]
                .as_f64()
                .unwrap()
                - 7.125)
                .abs()
                < 1e-10
        );
        let second = &session.turns[1];
        assert_eq!(
            second.token_usage.as_ref().unwrap()["total"]["inputTokens"],
            1000
        );
        assert_eq!(
            second.token_usage.as_ref().unwrap()["total"]["outputTokens"],
            100
        );
        assert!(
            (second.price_estimate.as_ref().unwrap()["totalUsd"]
                .as_f64()
                .unwrap()
                - 0.00032)
                .abs()
                < 1e-10
        );
    }

    #[test]
    fn finds_codex_rollout_when_sqlite_is_absent() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("codex");
        let cwd = root.path().join("workspace");
        fs::create_dir_all(&cwd).unwrap();
        let sessions = home.join("sessions").join("2026").join("09");
        fs::create_dir_all(&sessions).unwrap();
        let id = "01a0634a-23df-7191-acd2-1fca43a10418";
        fs::write(
            sessions.join(format!("rollout-{id}.jsonl")),
            format!(
                "{}\n{}\n{}\n{}\n",
                serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":cwd}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /tmp/project"}],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["agents_md.instructions"]}}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<in-app-browser-context>hidden</in-app-browser-context>\n\n## My request:\nimported prompt"}],"internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text"]}}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"imported reply"}]}}),
            ),
        )
        .unwrap();
        let homes = LocalSessionHomes {
            codex_home: home,
            grok_home: root.path().join("grok"),
            claude_home: root.path().join("claude"),
        };
        let session =
            find_local_session(&homes, "codex", &format!("codex://threads/{id}")).unwrap();
        assert_eq!(session.cwd, cwd.to_string_lossy());
        assert_eq!(session.turns[0].items.len(), 2);
        assert_eq!(session.turns[0].items[0].text, "imported prompt");
        assert_eq!(session.turns[0].items[1].text, "imported reply");
    }

    #[test]
    fn merges_paginated_history_with_rollout_only_items_and_turns() {
        let history_item = |id: &str, kind: &str, timestamp: &str| {
            let mut item = item(id.into(), kind, id.into(), "completed", "turn-rich");
            item.created_at = Some(timestamp.into());
            item
        };
        let paginated = vec![ThreadTurnDto {
            id: "turn-rich".into(),
            started_at: Some("2026-08-31T00:00:01.000Z".into()),
            completed_at: None,
            status: "failed".into(),
            error: Some("cached error".into()),
            model: None,
            reasoning_effort: None,
            token_usage: None,
            price_estimate: None,
            has_deferred_items: None,
            deferred_item_count: None,
            items: vec![
                history_item("user-rich", "userMessage", "2026-08-31T00:00:02.000Z"),
                history_item(
                    "command-rich",
                    "commandExecution",
                    "2026-08-31T00:00:04.000Z",
                ),
            ],
        }];
        let rollout = vec![
            ThreadTurnDto {
                id: "turn-rich".into(),
                started_at: Some("2026-08-31T00:00:01.000Z".into()),
                completed_at: None,
                status: "completed".into(),
                error: None,
                model: None,
                reasoning_effort: None,
                token_usage: None,
                price_estimate: None,
                has_deferred_items: None,
                deferred_item_count: None,
                items: {
                    let mut duplicate =
                        history_item("rollout-user-id", "userMessage", "2026-08-31T00:00:02.000Z");
                    duplicate.text = "user-rich".into();
                    vec![
                        duplicate,
                        history_item(
                            "agent-commentary",
                            "agentMessage",
                            "2026-08-31T00:00:03.000Z",
                        ),
                    ]
                },
            },
            ThreadTurnDto {
                id: "turn-new".into(),
                started_at: Some("2026-08-31T00:01:00.000Z".into()),
                completed_at: None,
                status: "inProgress".into(),
                error: None,
                model: None,
                reasoning_effort: None,
                token_usage: None,
                price_estimate: None,
                has_deferred_items: None,
                deferred_item_count: None,
                items: vec![],
            },
        ];

        let merged = merge_codex_turns(paginated, rollout);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].status, "completed");
        assert_eq!(merged[0].error.as_deref(), Some("cached error"));
        assert_eq!(
            merged[0]
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["user-rich", "agent-commentary", "command-rich"]
        );
        assert_eq!(merged[1].id, "turn-new");
    }

    #[test]
    fn paginated_items_keep_error_timestamp_and_extended_kinds() {
        assert_eq!(
            parse_codex_turn_error(Some(r#"{"message":"provider failed"}"#)).as_deref(),
            Some("provider failed")
        );
        let cases = [
            ("text", "agentMessage"),
            ("plan", "plan"),
            ("context_compaction", "contextCompaction"),
            ("web_search_call", "webSearch"),
            ("view_image", "imageView"),
            ("dynamicToolCall", "toolCall"),
            ("collabAgentToolCall", "agentToolCall"),
            ("future_item", "other"),
        ];
        for (raw_kind, expected) in cases {
            let value = serde_json::json!({
                "id": format!("item-{raw_kind}"),
                "type": raw_kind,
                "text": "detail"
            });
            let item = history_item_from_codex_json(
                "turn-1",
                &value,
                raw_kind,
                Some(1_788_134_403_456),
                Some(3),
            )
            .unwrap();
            assert_eq!(item.kind, expected);
            assert_eq!(item.created_at.as_deref(), Some("2026-08-31T00:00:03.456Z"));
            assert_eq!(item.sequence, Some(3));
        }

        let user = history_item_from_codex_json(
            "turn-1",
            &serde_json::json!({
                "id": "user-1",
                "type": "userMessage",
                "content": [{
                    "type": "text",
                    "text": "<in-app-browser-context>hidden</in-app-browser-context>\n\n## My request:\nkeep this"
                }]
            }),
            "userMessage",
            None,
            Some(4),
        )
        .unwrap();
        assert_eq!(user.text, "keep this");
    }

    #[test]
    fn preserves_request_headings_and_image_markup_in_user_authored_text() {
        let plain = "Please edit this template.\n\n## My request:\nFirst section\n\n## My request:\nSecond section\n<image name=\"example\">literal markup</image>";
        assert_eq!(sanitize_codex_user_text(plain).as_deref(), Some(plain));

        let wrapped = format!(
            "<in-app-browser-context>hidden</in-app-browser-context>\n\n## My request:\n{plain}"
        );
        assert_eq!(sanitize_codex_user_text(&wrapped).as_deref(), Some(plain));
        assert_eq!(
            sanitize_codex_user_text("<environment_context>hidden</environment_context>"),
            None
        );
    }

    #[test]
    fn distinguishes_commentary_and_final_messages_during_import_deduplication() {
        let mut commentary = history_item_from_codex_json(
            "turn-1",
            &serde_json::json!({"id":"commentary","type":"agentMessage","text":"Done."}),
            "agentMessage",
            None,
            Some(0),
        )
        .unwrap();
        commentary.status = Some("commentary".into());
        let mut final_message = commentary.clone();
        final_message.id = "final".into();
        final_message.status = Some("final".into());
        assert_ne!(message_key(&commentary), message_key(&final_message));

        let mut paginated_commentary = commentary.clone();
        paginated_commentary.status = Some("completed".into());
        paginated_commentary
            .extra
            .insert("phase".into(), serde_json::json!("commentary"));
        assert_eq!(message_key(&commentary), message_key(&paginated_commentary));
    }
}
