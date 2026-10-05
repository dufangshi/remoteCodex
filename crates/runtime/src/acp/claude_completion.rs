//! Reconcile Claude ACP placeholders discarded by the SDK during steering.
use serde_json::Value;
use std::collections::HashSet;

#[derive(Default)]
pub(super) struct ClaudeCompletion {
    prompts: HashSet<String>,
    committed_tools: HashSet<String>,
    final_text: Option<String>,
    invalid: bool,
}

impl ClaudeCompletion {
    pub fn invalidate(&mut self) {
        self.invalid = true;
    }

    // Caller filters session, time range and sidechains before recording.
    pub fn record(&mut self, entry: &Value) {
        let message = &entry["message"];
        let content = &message["content"];
        let blocks = content.as_array();
        if let Some(blocks) = blocks {
            for block in blocks {
                let id = match block["type"].as_str() {
                    Some("tool_use") => block["id"].as_str(),
                    Some("tool_result") => block["tool_use_id"].as_str(),
                    _ => None,
                };
                if let Some(id) = id {
                    self.committed_tools.insert(id.into());
                }
            }
        }
        let text = content.as_str().map(str::to_owned).unwrap_or_else(|| {
            blocks
                .into_iter()
                .flatten()
                .filter(|block| block["type"] == "text")
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        });
        match entry["type"].as_str() {
            Some("user") if entry["isMeta"] != true && !text.trim().is_empty() => {
                if let Some(id) = entry["uuid"].as_str() {
                    self.prompts.insert(id.into());
                }
                self.final_text = None;
            }
            Some("assistant") => {
                self.final_text = (message["stop_reason"] == "end_turn" && !text.trim().is_empty())
                    .then_some(text);
            }
            _ => {}
        }
    }

    pub fn abandoned_tools(
        &self,
        error: &str,
        delivered_text: Option<&str>,
    ) -> Option<Vec<String>> {
        let ids = incomplete_tool_ids(error)?;
        if self.invalid
            || self.prompts.len() < 2
            || self.final_text.as_deref()?.trim() != delivered_text?.trim()
            || ids.iter().any(|id| self.committed_tools.contains(id))
        {
            return None;
        }
        Some(ids)
    }
}

pub(super) fn incomplete_tool_ids(error: &str) -> Option<Vec<String>> {
    let error: Value = serde_json::from_str(error).ok()?;
    if error["code"] != -32603 || error["data"]["errorKind"] != "incomplete_tool_call" {
        return None;
    }
    let ids: Vec<String> = error["message"]
        .as_str()?
        .strip_prefix(
            "Internal error: Claude ended the turn without returning results for tool calls: ",
        )?
        .split(", ")
        .map(str::to_owned)
        .collect();
    ids.iter()
        .all(|id| {
            id.strip_prefix("toolu_").is_some_and(|suffix| {
                !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_alphanumeric())
            })
        })
        .then_some(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn error(ids: &str) -> String {
        json!({"code":-32603,"data":{"errorKind":"incomplete_tool_call"},
            "message":format!("Internal error: Claude ended the turn without returning results for tool calls: {ids}")}).to_string()
    }
    fn steered() -> ClaudeCompletion {
        let mut proof = ClaudeCompletion::default();
        proof.record(&json!({"type":"user","uuid":"initial","message":{"content":"start"}}));
        proof.record(&json!({"type":"assistant","message":{"content":[{"type":"thinking"}]}}));
        proof.record(&json!({"type":"user","uuid":"steer","message":{"content":[{"type":"text","text":"change direction"}]}}));
        proof.record(&json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}}));
        proof
    }
    #[test]
    fn only_discarded_tools_after_steering_and_matching_native_completion_are_recovered() {
        let mut proof = steered();
        assert_eq!(
            proof.abandoned_tools(&error("toolu_orphan"), Some("done")),
            Some(vec!["toolu_orphan".into()])
        );
        assert!(proof
            .abandoned_tools(&error("toolu_orphan"), Some("other reply"))
            .is_none());
        // A real tool without a result remains failed, even with a final reply.
        proof.record(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_real"}]}}));
        proof.record(&json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}}));
        assert!(proof
            .abandoned_tools(&error("toolu_real"), Some("done"))
            .is_none());
        assert!(proof
            .abandoned_tools(&error("toolu_orphan, toolu_real"), Some("done"))
            .is_none());
    }
    #[test]
    fn unproven_completion_and_other_errors_remain_failures() {
        let mut proof = steered();
        proof.prompts.remove("steer");
        assert!(proof
            .abandoned_tools(&error("toolu_orphan"), Some("done"))
            .is_none());
        proof.prompts.insert("steer".into());
        assert!(proof
            .abandoned_tools("provider crashed", Some("done"))
            .is_none());
        assert!(proof.abandoned_tools(&error(""), Some("done")).is_none());
        proof.record(&json!({"type":"assistant","message":{"stop_reason":"max_tokens","content":[{"type":"text","text":"done"}]}}));
        assert!(proof
            .abandoned_tools(&error("toolu_orphan"), Some("done"))
            .is_none());
        proof = steered();
        proof.invalidate();
        assert!(proof
            .abandoned_tools(&error("toolu_orphan"), Some("done"))
            .is_none());
    }
}
