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
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
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
    if let Some(turns) = load_codex_paginated_history(home, session_id) {
        if !turns.is_empty() {
            return turns;
        }
    }
    find_codex_rollout(home, session_id)
        .and_then(|path| parse_codex_rollout(&path))
        .filter(|session| cwd.map(|value| session.cwd == value).unwrap_or(true))
        .map(|session| session.turns)
        .unwrap_or_default()
}

fn load_codex_paginated_history(home: &Path, session_id: &str) -> Option<Vec<ThreadTurnDto>> {
    let path = home.join("thread_history_1.sqlite");
    let conn = open_readonly(&path).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT turn_id, status, started_at FROM thread_turns
             WHERE thread_id = ?1 ORDER BY rollout_ordinal ASC",
        )
        .ok()?;
    let turns: Vec<(String, String, Option<i64>)> = stmt
        .query_map(params![session_id], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, String>(1)
                    .unwrap_or_else(|_| "completed".into()),
                row.get(2).ok(),
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
            "SELECT turn_id, item_json FROM thread_items
             WHERE thread_id = ?1 ORDER BY rollout_ordinal ASC",
        )
        .ok()?;
    let mut items_by_turn: std::collections::HashMap<String, Vec<ThreadHistoryItemDto>> =
        std::collections::HashMap::new();
    if let Ok(rows) = item_stmt.query_map(params![session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        for row in rows.flatten() {
            if let Ok(value) = serde_json::from_str::<Value>(&row.1) {
                if let Some(item) = history_item_from_codex_json(&row.0, &value) {
                    items_by_turn.entry(row.0).or_default().push(item);
                }
            }
        }
    }
    Some(
        turns
            .into_iter()
            .map(|(id, status, started)| ThreadTurnDto {
                id: id.clone(),
                started_at: int_to_rfc3339(started),
                status: normalize_status(&status),
                error: None,
                model: None,
                reasoning_effort: None,
                token_usage: None,
                has_deferred_items: None,
                deferred_item_count: None,
                items: items_by_turn.remove(&id).unwrap_or_default(),
            })
            .collect(),
    )
}

fn history_item_from_codex_json(turn_id: &str, value: &Value) -> Option<ThreadHistoryItemDto> {
    let kind = value
        .get("type")
        .or_else(|| value.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let mapped = match kind {
        "userMessage" | "user_message" | "user" => "userMessage",
        "agentMessage" | "agent_message" | "assistant" => "agentMessage",
        "reasoning" | "thought" => "reasoning",
        "commandExecution" | "command" => "commandExecution",
        "fileChange" | "file_change" => "fileChange",
        _ => return None,
    };
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| content_text(value.get("content").unwrap_or(value)))
        .unwrap_or_default();
    if text.trim().is_empty() {
        return None;
    }
    Some(item(
        value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(&format!("{turn_id}:{mapped}"))
            .to_string(),
        mapped,
        text,
        "completed",
        turn_id,
    ))
}

fn find_codex_rollout(home: &Path, session_id: &str) -> Option<PathBuf> {
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
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut title = String::new();
    let mut model = None;
    let mut turns: Vec<ThreadTurnDto> = Vec::new();
    let mut current: Option<ThreadTurnDto> = None;
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = value.get("payload").cloned().unwrap_or(value.clone());
        match kind {
            "session_meta" => {
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
            }
            "response_item" => {
                if payload.get("type").and_then(Value::as_str) != Some("message") {
                    continue;
                }
                let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
                let text =
                    content_text(payload.get("content").unwrap_or(&payload)).unwrap_or_default();
                if text.trim().is_empty() {
                    continue;
                }
                if role == "user" {
                    if let Some(turn) = current.take() {
                        turns.push(turn);
                    }
                    let id = format!("imported-{}", turns.len() + 1);
                    current = Some(ThreadTurnDto {
                        id: id.clone(),
                        started_at: None,
                        status: "completed".into(),
                        error: None,
                        model: None,
                        reasoning_effort: None,
                        token_usage: None,
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
                } else if role == "assistant" {
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
        agent_id: "codex".into(),
        cwd,
        title: truncate_title(
            nonempty(Some(title))
                .or_else(|| preview.clone())
                .as_deref()
                .unwrap_or("Untitled imported session"),
        ),
        preview,
        created_at: None,
        updated_at: None,
        model,
        turns,
    })
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
                    status: "completed".into(),
                    error: None,
                    model: None,
                    reasoning_effort: None,
                    token_usage: None,
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
                    status: "completed".into(),
                    error: None,
                    model: None,
                    reasoning_effort: None,
                    token_usage: None,
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
        status: Some(status.into()),
        sequence: None,
        source_turn_id: Some(turn_id.into()),
        artifact: None,
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
                "{}\n{}\n{}\n",
                serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":cwd}}),
                serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"imported prompt"}]}}),
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
        assert_eq!(session.turns[0].items[0].text, "imported prompt");
        assert_eq!(session.turns[0].items[1].text, "imported reply");
    }
}
