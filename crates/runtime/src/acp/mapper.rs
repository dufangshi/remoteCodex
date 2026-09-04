use std::collections::HashMap;

use remote_codex_protocol::{now_rfc3339, ThreadHistoryItemDto};
use serde_json::Value;

use crate::actor::GoalState;

#[derive(Debug, Default)]
pub struct MappedUpdate {
    pub deltas: Vec<(String, String, i64)>,
    pub items: Vec<ThreadHistoryItemDto>,
    pub title: Option<String>,
    pub usage: Option<Value>,
    pub commands: Option<Value>,
    pub goal: Option<Option<GoalState>>,
    pub plan: Option<Vec<(String, String)>>,
}

pub struct TurnMapper {
    turn_id: String,
    agent_text: String,
    thought_text: String,
    tools: Vec<ThreadHistoryItemDto>,
    tool_payloads: HashMap<String, Value>,
    plans: Vec<ThreadHistoryItemDto>,
    compactions: Vec<ThreadHistoryItemDto>,
    seq: i64,
}

impl TurnMapper {
    pub fn new(turn_id: impl Into<String>) -> Self {
        Self {
            turn_id: turn_id.into(),
            agent_text: String::new(),
            thought_text: String::new(),
            tools: Vec::new(),
            tool_payloads: HashMap::new(),
            plans: Vec::new(),
            compactions: Vec::new(),
            seq: 0,
        }
    }

    pub fn apply(&mut self, update: &Value) -> MappedUpdate {
        let body = update.get("update").unwrap_or(update);
        let kind = body
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or("");
        let mut mapped = MappedUpdate::default();
        match kind {
            "agent_message_chunk" => {
                if let Some(text) = content_text(body) {
                    self.agent_text.push_str(&text);
                    self.seq += 1;
                    let item_id = format!("{}:assistant", self.turn_id);
                    mapped.deltas.push((item_id, text, self.seq));
                }
            }
            "agent_thought_chunk" => {
                if let Some(text) = content_text(body) {
                    self.thought_text.push_str(&text);
                    mapped.items.push(item(
                        format!("{}:thought", self.turn_id),
                        "reasoning",
                        self.thought_text.clone(),
                        "running",
                        &self.turn_id,
                    ));
                }
            }
            "tool_call" | "tool_call_update" => {
                if let Some(tool_id) = body.get("toolCallId").and_then(Value::as_str) {
                    let payload = merge_tool_payload(self.tool_payloads.get(tool_id), body);
                    self.tool_payloads
                        .insert(tool_id.to_string(), payload.clone());
                    let item = tool_item(&self.turn_id, &payload);
                    if let Some(existing) = self
                        .tools
                        .iter_mut()
                        .find(|candidate| candidate.id == item.id)
                    {
                        *existing = item.clone();
                    } else {
                        self.tools.push(item.clone());
                    }
                    mapped.items.push(item);
                }
            }
            "plan" => {
                if let Some(item) = plan_item(&self.turn_id, body) {
                    self.plans = vec![item.clone()];
                    mapped.items.push(item);
                    mapped.plan = plan_steps(body);
                }
            }
            "compaction_update" | "compaction_summary_chunk" => {
                if let Some(item) = compaction_item(&self.turn_id, body) {
                    self.compactions = vec![item.clone()];
                    mapped.items.push(item);
                }
            }
            "available_commands_update" => {
                mapped.commands = body.get("availableCommands").cloned();
            }
            "session_info_update" => {
                mapped.title = body
                    .get("title")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                mapped.goal = goal_from_update(update).or_else(|| goal_from_update(body));
            }
            "usage_update" => {
                mapped.usage = body
                    .get("used")
                    .cloned()
                    .or_else(|| body.get("usage").cloned());
            }
            _ => {}
        }
        mapped
    }

    pub fn finish(self, interrupted: bool) -> Vec<ThreadHistoryItemDto> {
        let status = if interrupted {
            "interrupted"
        } else {
            "completed"
        };
        let mut items = Vec::new();
        if !self.thought_text.is_empty() {
            items.push(item(
                format!("{}:thought", self.turn_id),
                "reasoning",
                self.thought_text,
                status,
                &self.turn_id,
            ));
        }
        items.extend(self.tools);
        items.extend(self.plans);
        items.extend(self.compactions);
        let text = if self.agent_text.is_empty() && items.is_empty() && !interrupted {
            "(no output)".into()
        } else {
            self.agent_text
        };
        if !text.is_empty() {
            items.push(item(
                format!("{}:assistant", self.turn_id),
                "agentMessage",
                text,
                status,
                &self.turn_id,
            ));
        }
        items
    }
}

fn content_text(body: &Value) -> Option<String> {
    body.pointer("/content/text")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/update/content/text").and_then(Value::as_str))
        .map(str::to_string)
}

fn merge_tool_payload(previous: Option<&Value>, patch: &Value) -> Value {
    let mut merged = previous
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(fields) = patch.as_object() {
        for (key, value) in fields {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

fn tool_item(turn_id: &str, body: &Value) -> ThreadHistoryItemDto {
    let id = body
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let raw_kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
    let tool_name = body.get("name").and_then(Value::as_str).or_else(|| {
        body.pointer("/_meta/x.ai~1tool/name")
            .and_then(Value::as_str)
    });
    let normalized_name = format!(
        "{} {}",
        tool_name.unwrap_or(""),
        body.get("title").and_then(Value::as_str).unwrap_or("")
    )
    .to_ascii_lowercase();
    let kind = match raw_kind {
        "edit" | "delete" | "move" => "fileChange",
        "read" => "fileRead",
        "fetch" => "webSearch",
        "think" => "reasoning",
        "execute" => "commandExecution",
        _ if normalized_name.contains("web") || normalized_name.contains("http") => "webSearch",
        _ if normalized_name.contains("read") => "fileRead",
        _ if normalized_name.contains("edit")
            || normalized_name.contains("write")
            || normalized_name.contains("patch") =>
        {
            "fileChange"
        }
        _ => "toolCall",
    };
    let location_text = tool_locations(body)
        .into_iter()
        .map(|(path, line)| match line {
            Some(line) => format!("{path}:{line}"),
            None => path,
        })
        .collect::<Vec<_>>()
        .join(", ");
    let command = record_value(body.get("rawInput"), &["command", "cmd", "argv"]);
    let input_path = record_value(
        body.get("rawInput"),
        &["path", "target_file", "file", "uri"],
    );
    let title = command
        .clone()
        .or_else(|| (!location_text.is_empty()).then_some(location_text.clone()))
        .or(input_path)
        .or_else(|| nonempty_string(body.get("title")))
        .or_else(|| tool_name.map(str::to_string))
        .unwrap_or_else(|| "Tool call".into());
    let status = match body.get("status").and_then(Value::as_str).unwrap_or("") {
        "completed" | "failed" => body.get("status").and_then(Value::as_str),
        "in_progress" => Some("running"),
        _ => Some("running"),
    };
    let detail = tool_detail(body, tool_name, raw_kind, &location_text);
    let mut mapped = item(
        id,
        kind,
        title.clone(),
        status.unwrap_or("running"),
        turn_id,
    );
    mapped.preview_text = Some(title);
    mapped.detail_text = (!detail.is_empty()).then_some(detail);
    mapped
}

fn nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn record_value(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let record = value?.as_object()?;
    keys.iter().find_map(|key| match record.get(*key) {
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Some(Value::Array(values)) if values.iter().all(Value::is_string) => Some(
            values
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        _ => None,
    })
}

fn tool_locations(body: &Value) -> Vec<(String, Option<u64>)> {
    body.get("locations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|location| {
            Some((
                location.get("path")?.as_str()?.to_string(),
                location.get("line").and_then(Value::as_u64),
            ))
        })
        .collect()
}

fn tool_detail(body: &Value, tool_name: Option<&str>, raw_kind: &str, locations: &str) -> String {
    let mut parts = Vec::new();
    if let Some(name) = tool_name.or_else(|| body.get("title").and_then(Value::as_str)) {
        parts.push(format!("Tool: {name}"));
    }
    if !raw_kind.is_empty() {
        parts.push(format!("Kind: {raw_kind}"));
    }
    if let Some(status) = body.get("status").and_then(Value::as_str) {
        parts.push(format!("Status: {status}"));
    }
    if !locations.is_empty() {
        parts.push(format!("Locations:\n{locations}"));
    }
    if let Some(input) = body.get("rawInput") {
        parts.push(format!("Input:\n{}", pretty_json(input)));
    }
    let content = tool_content_text(body);
    if !content.is_empty() {
        parts.push(format!("Result:\n{content}"));
    } else if let Some(output) = body.get("rawOutput") {
        parts.push(format!("Output:\n{}", readable_output(output)));
    }
    parts.join("\n\n")
}

fn tool_content_text(body: &Value) -> String {
    body.get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| match entry.get("type").and_then(Value::as_str) {
            Some("content") => content_block_text(entry.get("content")?),
            Some("diff") => Some(format!(
                "File: {}\n\nBefore:\n{}\n\nAfter:\n{}",
                entry
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown"),
                entry
                    .get("oldText")
                    .and_then(Value::as_str)
                    .unwrap_or("(new file)"),
                entry.get("newText").and_then(Value::as_str).unwrap_or("")
            )),
            Some("terminal") => entry
                .get("terminalId")
                .and_then(Value::as_str)
                .map(|id| format!("Terminal: {id}")),
            _ => content_block_text(entry),
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn content_block_text(block: &Value) -> Option<String> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") => nonempty_string(block.get("text")),
        Some("resource_link") => {
            let label = block
                .get("title")
                .or_else(|| block.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("Resource");
            let uri = block.get("uri").and_then(Value::as_str).unwrap_or("");
            Some(format!("[{label}]({uri})"))
        }
        Some("resource") => block
            .pointer("/resource/text")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                block
                    .pointer("/resource/uri")
                    .and_then(Value::as_str)
                    .map(|uri| format!("Resource: {uri}"))
            }),
        Some("image") => Some(format!(
            "Image: {}",
            block
                .get("uri")
                .or_else(|| block.get("mimeType"))
                .and_then(Value::as_str)
                .unwrap_or("image")
        )),
        Some("audio") => Some(format!(
            "Audio: {}",
            block
                .get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or("audio")
        )),
        _ => None,
    }
}

fn readable_output(output: &Value) -> String {
    for pointer in [
        "/output_for_prompt",
        "/raw_output",
        "/output",
        "/content",
        "/FileContent/content",
    ] {
        if let Some(text) = output.pointer(pointer).and_then(Value::as_str) {
            return text.to_string();
        }
    }
    pretty_json(output)
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn plan_steps(body: &Value) -> Option<Vec<(String, String)>> {
    let entries = body.get("entries").and_then(Value::as_array)?;
    let steps = entries
        .iter()
        .filter_map(|entry| {
            Some((
                entry.get("content").and_then(Value::as_str)?.to_string(),
                entry
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("pending")
                    .to_string(),
            ))
        })
        .collect::<Vec<_>>();
    (!steps.is_empty()).then_some(steps)
}

fn plan_item(turn_id: &str, body: &Value) -> Option<ThreadHistoryItemDto> {
    let entries = body.get("entries").and_then(Value::as_array)?;
    let text = entries
        .iter()
        .filter_map(|entry| {
            let step = entry.get("content").and_then(Value::as_str)?;
            let done = entry.get("status").and_then(Value::as_str) == Some("completed");
            Some(format!("- [{}] {step}", if done { "x" } else { " " }))
        })
        .collect::<Vec<_>>()
        .join("\n");
    Some(item(
        format!("{turn_id}:plan"),
        "plan",
        text,
        "inProgress",
        turn_id,
    ))
}

fn compaction_item(turn_id: &str, body: &Value) -> Option<ThreadHistoryItemDto> {
    let from_content = content_text(body);
    let text = body
        .get("summary")
        .and_then(Value::as_str)
        .or(from_content.as_deref())
        .unwrap_or("Context compaction")
        .to_string();
    Some(item(
        format!("{turn_id}:compaction"),
        "contextCompaction",
        text,
        "completed",
        turn_id,
    ))
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
    }
}

fn goal_from_update(update: &Value) -> Option<Option<GoalState>> {
    let meta = update.get("_meta")?.as_object()?;
    if !meta.contains_key("goal") {
        return None;
    }
    let goal = meta.get("goal")?;
    if goal.is_null() {
        return Some(None);
    }
    Some(Some(GoalState {
        objective: goal
            .get("objective")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        status: goal
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active")
            .into(),
        tokens_used: goal.get("tokensUsed").and_then(Value::as_u64).unwrap_or(0) as u32,
        time_used_seconds: goal
            .get("timeUsedSeconds")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_message_tool_and_compaction() {
        let mut mapper = TurnMapper::new("t1");
        mapper.apply(&json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "hi" }
        }));
        mapper.apply(&json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "call-1",
            "title": "ls",
            "kind": "execute",
            "status": "completed"
        }));
        mapper.apply(&json!({
            "sessionUpdate": "compaction_update",
            "summary": "compacted"
        }));
        let thought = mapper.apply(&json!({
            "sessionUpdate": "agent_thought_chunk",
            "content": { "type": "text", "text": "thinking" }
        }));
        assert!(thought.items.iter().any(|item| item.kind == "reasoning"));
        let items = mapper.finish(false);
        let kinds: Vec<_> = items.iter().map(|i| i.kind.as_str()).collect();
        assert!(kinds.contains(&"commandExecution"));
        assert!(kinds.contains(&"contextCompaction"));
        assert!(kinds.contains(&"agentMessage"));
        assert!(kinds.contains(&"reasoning"));
        assert!(items.iter().any(|i| i.text == "hi"));
    }

    #[test]
    fn interrupted_empty_turn_does_not_fabricate_output() {
        let mapper = TurnMapper::new("t1");
        let items = mapper.finish(true);
        assert!(items.iter().all(|item| item.text != "(no output)"));
    }

    #[test]
    fn tool_title_falls_back_to_command() {
        let mut mapper = TurnMapper::new("t1");
        let mapped = mapper.apply(&json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "call-1",
            "kind": "execute",
            "status": "in_progress",
            "rawInput": { "command": "git status" }
        }));
        assert_eq!(mapped.items[0].text, "git status");
        assert_eq!(mapped.items[0].status.as_deref(), Some("running"));
    }

    #[test]
    fn tool_updates_retain_input_and_expose_result_detail() {
        let mut mapper = TurnMapper::new("t1");
        mapper.apply(&json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "call-1",
            "title": "run_terminal_command",
            "rawInput": {
                "command": "git status -sb",
                "description": "Inspect repository status"
            },
            "_meta": {
                "x.ai/tool": { "name": "run_terminal_command", "kind": "execute" }
            }
        }));
        mapper.apply(&json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call-1",
            "kind": "execute",
            "title": "Execute `git status -sb`",
            "locations": [],
            "status": "in_progress"
        }));
        let completed = mapper.apply(&json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "call-1",
            "status": "completed",
            "content": [{
                "type": "content",
                "content": { "type": "text", "text": "## main...origin/main" }
            }],
            "rawOutput": {
                "type": "Bash",
                "output_for_prompt": "exit: 0\n## main...origin/main"
            }
        }));

        let item = &completed.items[0];
        assert_eq!(item.kind, "commandExecution");
        assert_eq!(item.text, "git status -sb");
        assert_eq!(item.preview_text.as_deref(), Some("git status -sb"));
        let detail = item.detail_text.as_deref().unwrap();
        assert!(detail.contains("Tool: run_terminal_command"), "{detail}");
        assert!(detail.contains("Inspect repository status"), "{detail}");
        assert!(
            detail.contains("Result:\n## main...origin/main"),
            "{detail}"
        );
        assert!(!detail.contains("output_for_prompt"), "{detail}");
    }
}
