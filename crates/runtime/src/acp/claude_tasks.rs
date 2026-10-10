//! Native launch receipts keep background Bash/Monitor follow-ups owned even
//! when an adapter does not forward their SDK lifecycle bookends.
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

#[derive(Default)]
pub(super) struct ClaudeNativeTasks {
    tools: HashMap<String, String>,
    tasks: HashSet<String>,
    notices: Vec<Value>,
    seen: HashSet<String>,
    following: bool,
    idle: bool,
    autonomous_result: bool,
    settled: HashSet<String>,
}

impl ClaudeNativeTasks {
    pub fn pending(&self) -> bool {
        !self.tasks.is_empty() || self.following
    }

    pub fn waiting_count(&self) -> usize {
        if self.idle {
            self.tasks.len()
        } else {
            0
        }
    }

    pub fn take_notices(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.notices)
    }

    pub fn record_sdk(&mut self, message: &Value) {
        if normalize_notification(message).is_some() {
            self.notification(message);
            return;
        }
        if message["type"] == "system"
            && message["subtype"] == "session_state_changed"
            && message["state"] == "running"
        {
            self.idle = false;
        }
        if message["type"] == "system"
            && matches!(
                message["subtype"].as_str(),
                Some("task_notification" | "task_updated")
            )
        {
            let status = message["status"]
                .as_str()
                .or_else(|| message["patch"]["status"].as_str());
            if matches!(
                status,
                Some("completed" | "failed" | "stopped" | "killed" | "cancelled")
            ) {
                if let Some(id) = message["task_id"].as_str() {
                    if self.tasks.remove(id) {
                        self.following = true;
                        self.idle = false;
                    }
                    self.settled.insert(id.into());
                    if message["subtype"] == "task_notification" {
                        self.seen.insert(format!("task:{id}"));
                    }
                }
            }
        }
        if message["type"] == "result"
            && message.pointer("/origin/kind").and_then(Value::as_str) == Some("task-notification")
        {
            self.autonomous_result = true;
        }
        if message["type"] == "system"
            && message["subtype"] == "session_state_changed"
            && message["state"] == "idle"
            && self.autonomous_result
        {
            self.following = false;
            self.idle = true;
            self.autonomous_result = false;
        }
    }

    pub fn record(&mut self, entry: &Value) {
        let content = &entry["message"]["content"];
        if entry["type"] == "assistant" {
            for block in content.as_array().into_iter().flatten() {
                if block["type"] == "tool_use" {
                    if let (Some(id), Some(name)) = (block["id"].as_str(), block["name"].as_str()) {
                        self.tools.insert(id.into(), name.into());
                    }
                    self.idle = false;
                }
            }
            // Thinking and text are separate snapshots of the same response.
            // An end_turn thinking block can precede the actual final text.
            if entry["message"]["stop_reason"] == "end_turn"
                && content.as_array().is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block["type"] == "text"
                            && block["text"]
                                .as_str()
                                .is_some_and(|text| !text.trim().is_empty())
                    })
                })
            {
                self.idle = true;
                self.following = false;
            }
            return;
        }
        if entry["type"] != "user" {
            return;
        }
        if entry.pointer("/origin/kind").and_then(Value::as_str) == Some("task-notification")
            || entry["turnOrigin"] == "task_notification"
        {
            self.notification(entry);
            return;
        }
        let receipt = &entry["toolUseResult"];
        for block in content.as_array().into_iter().flatten() {
            let Some(tool) = block["tool_use_id"]
                .as_str()
                .and_then(|id| self.tools.get(id))
            else {
                continue;
            };
            if block["type"] != "tool_result" || block["is_error"] == true {
                continue;
            }
            let id = match tool.as_str() {
                "Bash" => receipt["backgroundTaskId"].as_str(),
                "Monitor" => receipt["taskId"].as_str(),
                "Agent" | "Task" if receipt["isAsync"] == true => receipt["agentId"].as_str(),
                _ => None,
            };
            if let Some(id) = id.filter(|id| !id.is_empty()) {
                if !self.settled.contains(id) {
                    self.tasks.insert(id.into());
                }
            }
        }
    }

    fn notification(&mut self, entry: &Value) {
        let Some(mut notice) = normalize_notification(entry) else {
            return;
        };
        let id = notice["task_id"].as_str().unwrap().to_owned();
        let id = id.as_str();
        // Never attribute an unrelated/scheduled wake just because it shares
        // a session. The launch receipt must belong to this reader's turn.
        if !self.tasks.contains(id) && !self.settled.contains(id) {
            return;
        }
        let terminal = notice["status"].as_str();
        let key = notice["notificationKey"].as_str().unwrap().to_owned();
        if !self.seen.insert(key.clone()) {
            return;
        }
        if matches!(
            terminal,
            Some("completed" | "failed" | "stopped" | "killed" | "cancelled")
        ) {
            self.tasks.remove(id);
            self.settled.insert(id.into());
        }
        self.following = true;
        self.idle = false;
        notice["timestamp"] = entry["timestamp"].clone();
        self.notices.push(notice);
    }
}

/// Only provider-authored task notifications, never human text or a quoted XML block.
pub(super) fn normalize_notification(entry: &Value) -> Option<Value> {
    if entry["type"] != "user"
        || (entry.pointer("/origin/kind").and_then(Value::as_str) != Some("task-notification")
            && entry["turnOrigin"] != "task_notification")
    {
        return None;
    }
    let content = &entry["message"]["content"];
    let content = if content.is_null() {
        &entry["content"]
    } else {
        content
    };
    let text = content.as_str().map(str::to_owned).unwrap_or_else(|| {
        content
            .as_array()
            .into_iter()
            .flatten()
            .filter(|block| block["type"] == "text")
            .filter_map(|block| block["text"].as_str())
            .collect::<String>()
    });
    let header = text.trim().strip_prefix("<task-notification>")?;
    let id = field(header, "task-id")?;
    let status = field(header, "status").unwrap_or("updated");
    let summary = field(header, "summary").unwrap_or("Background task updated");
    let event = field(header, "event");
    let key = if status != "updated" {
        format!("task:{id}")
    } else {
        format!("event:{id}:{summary}:{}", event.unwrap_or(""))
    };
    Some(
        json!({"type":"system","subtype":"task_notification","task_id":id,"status":status,
        "summary":summary,"event":event,"notificationKey":key,"timestamp":entry["timestamp"]}),
    )
}

fn field<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    text.split_once(&format!("<{name}>"))?
        .1
        .split_once(&format!("</{name}>"))
        .map(|(value, _)| value.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn monitor_events_and_bash_completion_keep_the_same_turn_until_final_text() {
        let mut tasks = ClaudeNativeTasks::default();
        for (name, id, receipt) in [
            ("Monitor", "monitor", json!({"taskId":"watch"})),
            ("Bash", "bash", json!({"backgroundTaskId":"build"})),
        ] {
            tasks.record(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":id,"name":name}]}}));
            tasks.record(&json!({"type":"user","toolUseResult":receipt,"message":{"content":[{"type":"tool_result","tool_use_id":id}]}}));
        }
        tasks.record(&json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"Waiting."}]}}));
        assert!(tasks.pending());
        assert_eq!(tasks.waiting_count(), 2);
        let notice = json!({"type":"user","origin":{"kind":"task-notification"},"message":{"content":"<task-notification><task-id>watch</task-id><summary>Build progress</summary><event>Linux finished</event></task-notification>"}});
        tasks.record_sdk(&notice);
        tasks.record(&notice);
        assert_eq!(tasks.take_notices().len(), 1);
        assert_eq!(tasks.waiting_count(), 0);
        for id in ["watch", "build"] {
            tasks.record(&json!({"type":"user","origin":{"kind":"task-notification"},"message":{"content":format!("<task-notification><task-id>{id}</task-id><status>completed</status><summary>Done</summary></task-notification>")}}));
        }
        assert!(tasks.pending(), "completion starts autonomous work");
        tasks.record(&json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"Report next"}]}}));
        assert!(tasks.pending());
        tasks.record(&json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"All done."}]}}));
        assert!(!tasks.pending());
    }

    #[test]
    fn human_quotes_and_unknown_tasks_cannot_create_background_work() {
        let mut tasks = ClaudeNativeTasks::default();
        tasks.record(&json!({"type":"user","origin":{"kind":"task-notification"},"message":{"content":"<task-notification><task-id>unknown</task-id><status>completed</status></task-notification>"}}));
        assert!(!tasks.pending());
        assert!(tasks.take_notices().is_empty());
        tasks.record(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"bash","name":"Bash"}]}}));
        tasks.record(&json!({"type":"user","toolUseResult":{"backgroundTaskId":"build"},"message":{"content":[{"type":"tool_result","tool_use_id":"bash"}]}}));
        tasks.record(&json!({"type":"user","message":{"content":"<task-notification><task-id>build</task-id><status>completed</status></task-notification>"}}));
        assert!(tasks.pending());
        assert!(tasks.take_notices().is_empty());
    }
}
