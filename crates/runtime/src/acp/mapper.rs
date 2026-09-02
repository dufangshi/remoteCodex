use remote_codex_protocol::{now_rfc3339, ThreadHistoryItemDto};
use serde_json::Value;

use crate::actor::GoalState;

#[derive(Debug, Default)]
pub struct MappedUpdate {
    pub deltas: Vec<(String, String)>,
    pub items: Vec<ThreadHistoryItemDto>,
    pub title: Option<String>,
    pub usage: Option<Value>,
    pub commands: Option<Value>,
    pub goal: Option<Option<GoalState>>,
}

pub struct TurnMapper {
    turn_id: String,
    agent_text: String,
    thought_text: String,
    tools: Vec<ThreadHistoryItemDto>,
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
                    let item_id = format!("{}:assistant", self.turn_id);
                    mapped.deltas.push((item_id, text));
                    self.seq += 1;
                }
            }
            "agent_thought_chunk" => {
                if let Some(text) = content_text(body) {
                    self.thought_text.push_str(&text);
                }
            }
            "tool_call" | "tool_call_update" => {
                if let Some(item) = tool_item(&self.turn_id, body) {
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
        let text = if self.agent_text.is_empty() && items.is_empty() {
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

fn tool_item(turn_id: &str, body: &Value) -> Option<ThreadHistoryItemDto> {
    let id = body
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let kind = match body.get("kind").and_then(Value::as_str).unwrap_or("") {
        "edit" | "delete" | "move" => "fileChange",
        _ => "commandExecution",
    };
    let title = body
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| body.get("name").and_then(Value::as_str))
        .unwrap_or("Tool call");
    let status = match body.get("status").and_then(Value::as_str).unwrap_or("") {
        "completed" | "failed" => body.get("status").and_then(Value::as_str),
        "in_progress" => Some("running"),
        _ => Some("running"),
    };
    Some(item(
        id,
        kind,
        title.to_string(),
        status.unwrap_or("running"),
        turn_id,
    ))
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
        let items = mapper.finish(false);
        let kinds: Vec<_> = items.iter().map(|i| i.kind.as_str()).collect();
        assert!(kinds.contains(&"commandExecution"));
        assert!(kinds.contains(&"contextCompaction"));
        assert!(kinds.contains(&"agentMessage"));
        assert!(items.iter().any(|i| i.text == "hi"));
    }
}
