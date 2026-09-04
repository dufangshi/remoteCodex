use serde_json::{json, Value};

/// Product-level session policy. ACP only exposes a single `currentModeId`,
/// so these axes are resolved into one advertised mode id per harness.
#[derive(Debug, Clone, Default)]
pub struct ProductSessionPolicy {
    pub collaboration_mode: Option<String>,
    pub sandbox_mode: Option<String>,
    pub approval_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMode {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionChoice {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

impl ProductSessionPolicy {
    pub fn auto_approve(&self) -> bool {
        matches!(self.approval_mode.as_deref(), Some("yolo"))
            || matches!(self.sandbox_mode.as_deref(), Some("danger-full-access"))
    }

    pub fn allows_writes_outside_workspace(&self) -> bool {
        matches!(self.sandbox_mode.as_deref(), Some("danger-full-access"))
    }

    pub fn rejects_writes(&self) -> bool {
        matches!(self.sandbox_mode.as_deref(), Some("read-only"))
            || matches!(self.collaboration_mode.as_deref(), Some("plan"))
                && !self.allows_writes_outside_workspace()
    }
}

/// Preferred ACP mode ids for the product controls.
///
/// ACP `session/new` returns `modes.availableModes` and the client switches
/// with `session/set_mode`. IDs are harness-defined:
/// - Codex ACP: `read-only`, `agent` / `auto`, `agent-full-access` / `full-access`, optional `plan`
/// - Claude-like: `plan` / `architect` / `ask` vs `code` / `build`
/// - Grok and others may omit modes entirely
///
/// Full access wins over Plan: Plan is a collaboration hint, Full is an
/// explicit permission grant. Plan still wins over workspace-write/read-only.
pub fn preferred_mode_ids(policy: &ProductSessionPolicy) -> Vec<&'static str> {
    if matches!(policy.sandbox_mode.as_deref(), Some("danger-full-access")) {
        vec![
            "agent-full-access",
            "full-access",
            "danger-full-access",
            "yolo",
        ]
    } else if matches!(policy.collaboration_mode.as_deref(), Some("plan")) {
        vec!["plan", "architect", "ask"]
    } else if matches!(policy.sandbox_mode.as_deref(), Some("read-only")) {
        vec!["read-only", "readonly", "ask"]
    } else {
        vec!["agent", "code", "build", "auto"]
    }
}

pub fn resolve_mode(available: &[SessionMode], policy: &ProductSessionPolicy) -> Option<String> {
    if available.is_empty() {
        return None;
    }
    for preferred in preferred_mode_ids(policy) {
        if let Some(found) = available.iter().find(|mode| ids_match(&mode.id, preferred)) {
            return Some(found.id.clone());
        }
    }
    available.iter().find_map(|mode| {
        let name = mode.name.as_deref().unwrap_or("");
        preferred_mode_ids(policy)
            .iter()
            .any(|preferred| ids_match(name, preferred) || name_matches_preferred(name, preferred))
            .then(|| mode.id.clone())
    })
}

pub fn parse_available_modes(session: &Value) -> (Option<String>, Vec<SessionMode>) {
    let modes = match session.get("modes") {
        Some(modes) => modes,
        None => return (None, Vec::new()),
    };
    let current = modes
        .get("currentModeId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let available = modes
        .get("availableModes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some(SessionMode {
                id: entry.get("id").and_then(Value::as_str)?.to_string(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect();
    (current, available)
}

pub fn parse_permission_choices(params: &Value) -> Vec<PermissionChoice> {
    params
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some(PermissionChoice {
                option_id: entry
                    .get("optionId")
                    .or_else(|| entry.get("id"))
                    .and_then(Value::as_str)?
                    .to_string(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                kind: entry
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

pub fn permission_title(params: &Value) -> String {
    params
        .pointer("/toolCall/title")
        .and_then(Value::as_str)
        .filter(|title| !title.is_empty())
        .unwrap_or("Permission required")
        .to_string()
}

pub fn permission_description(params: &Value) -> Option<String> {
    let tool_call = params.get("toolCall")?;
    let kind = tool_call
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("operation");
    let raw_input = tool_call.get("rawInput");
    let detail = raw_input
        .and_then(|input| input.get("command"))
        .or_else(|| raw_input.and_then(|input| input.get("path")))
        .or_else(|| raw_input.and_then(|input| input.get("url")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    Some(match detail {
        Some(detail) => format!("{}: {detail}", kind.replace('_', " ")),
        None => format!(
            "Review this {} operation before continuing.",
            kind.replace('_', " ")
        ),
    })
}

pub fn permission_questions(title: &str, choices: &[PermissionChoice]) -> Vec<Value> {
    vec![json!({
        "id": "permission",
        "header": "Permission",
        "question": title,
        "isOther": false,
        "isSecret": false,
        "options": choices.iter().map(|choice| json!({
            "label": if choice.name.is_empty() { choice.option_id.clone() } else { choice.name.clone() },
            "description": choice.kind.replace('_', " "),
        })).collect::<Vec<_>>(),
    })]
}

/// Pick the optionId advertised by the agent. Never invent `allow-once`.
pub fn select_permission_option(
    choices: &[PermissionChoice],
    auto_allow: bool,
    answer: Option<&str>,
) -> Option<String> {
    if let Some(answer) = answer.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(found) = choices.iter().find(|choice| {
            choice.option_id == answer
                || choice.name == answer
                || ids_match(&choice.option_id, answer)
                || ids_match(&choice.name, answer)
        }) {
            return Some(found.option_id.clone());
        }
    }
    let preferred_kinds = if auto_allow {
        ["allow_always", "allow-always", "allow_once", "allow-once"]
    } else {
        [
            "reject_once",
            "reject-once",
            "reject_always",
            "reject-always",
        ]
    };
    for kind in preferred_kinds {
        if let Some(found) = choices.iter().find(|choice| ids_match(&choice.kind, kind)) {
            return Some(found.option_id.clone());
        }
    }
    if auto_allow {
        choices.first().map(|choice| choice.option_id.clone())
    } else {
        None
    }
}

pub fn resolve_mode_config_value(
    config_options: &Value,
    policy: &ProductSessionPolicy,
) -> Option<(String, String)> {
    let option = config_options.as_array()?.iter().find(|entry| {
        let id = entry.get("id").and_then(Value::as_str).unwrap_or("");
        let category = entry.get("category").and_then(Value::as_str).unwrap_or("");
        ids_match(id, "mode") || ids_match(category, "mode")
    })?;
    let config_id = option.get("id").and_then(Value::as_str)?.to_string();
    let select_options = collect_select_options(option);
    let modes: Vec<SessionMode> = select_options
        .iter()
        .filter_map(|entry| {
            let value = entry.get("value").and_then(Value::as_str)?;
            Some(SessionMode {
                id: value.to_string(),
                name: entry
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect();
    resolve_mode(&modes, policy).map(|value| (config_id, value))
}

fn collect_select_options(option: &Value) -> Vec<Value> {
    option
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            if let Some(nested) = entry.get("options").and_then(Value::as_array) {
                nested.clone()
            } else {
                vec![entry.clone()]
            }
        })
        .collect()
}

fn ids_match(left: &str, right: &str) -> bool {
    normalize_id(left) == normalize_id(right)
}

fn name_matches_preferred(name: &str, preferred: &str) -> bool {
    normalize_id(name).contains(&normalize_id(preferred))
}

fn normalize_id(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '_'], "-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn modes(ids: &[&str]) -> Vec<SessionMode> {
        ids.iter()
            .map(|id| SessionMode {
                id: (*id).to_string(),
                name: Some((*id).to_string()),
            })
            .collect()
    }

    #[test]
    fn full_access_maps_to_codex_agent_full_access() {
        let policy = ProductSessionPolicy {
            sandbox_mode: Some("danger-full-access".into()),
            collaboration_mode: Some("plan".into()),
            approval_mode: Some("yolo".into()),
        };
        let available = modes(&["read-only", "agent", "agent-full-access", "plan"]);
        assert_eq!(
            resolve_mode(&available, &policy).as_deref(),
            Some("agent-full-access")
        );
        assert!(policy.auto_approve());
        assert!(policy.allows_writes_outside_workspace());
    }

    #[test]
    fn full_access_maps_to_legacy_full_access_alias() {
        let policy = ProductSessionPolicy {
            sandbox_mode: Some("danger-full-access".into()),
            ..ProductSessionPolicy::default()
        };
        let available = modes(&["read-only", "auto", "full-access"]);
        assert_eq!(
            resolve_mode(&available, &policy).as_deref(),
            Some("full-access")
        );
    }

    #[test]
    fn plan_maps_when_sandbox_is_workspace_write() {
        let policy = ProductSessionPolicy {
            collaboration_mode: Some("plan".into()),
            sandbox_mode: Some("workspace-write".into()),
            ..ProductSessionPolicy::default()
        };
        let available = modes(&["plan", "agent", "read-only"]);
        assert_eq!(resolve_mode(&available, &policy).as_deref(), Some("plan"));
        assert!(policy.rejects_writes());
    }

    #[test]
    fn read_only_and_workspace_write_use_codex_ids() {
        let read_only = ProductSessionPolicy {
            sandbox_mode: Some("read-only".into()),
            ..ProductSessionPolicy::default()
        };
        let workspace = ProductSessionPolicy {
            sandbox_mode: Some("workspace-write".into()),
            ..ProductSessionPolicy::default()
        };
        let available = modes(&["read-only", "agent", "agent-full-access"]);
        assert_eq!(
            resolve_mode(&available, &read_only).as_deref(),
            Some("read-only")
        );
        assert_eq!(
            resolve_mode(&available, &workspace).as_deref(),
            Some("agent")
        );
    }

    #[test]
    fn permission_prefers_allow_always_option_id() {
        let choices = vec![
            PermissionChoice {
                option_id: "approved".into(),
                name: "Allow always".into(),
                kind: "allow_always".into(),
            },
            PermissionChoice {
                option_id: "once".into(),
                name: "Allow once".into(),
                kind: "allow_once".into(),
            },
            PermissionChoice {
                option_id: "reject".into(),
                name: "Reject".into(),
                kind: "reject_once".into(),
            },
        ];
        assert_eq!(
            select_permission_option(&choices, true, None).as_deref(),
            Some("approved")
        );
        assert_eq!(
            select_permission_option(&choices, false, None).as_deref(),
            Some("reject")
        );
        assert_eq!(
            select_permission_option(&choices, false, Some("Allow once")).as_deref(),
            Some("once")
        );
    }

    #[test]
    fn parses_session_modes_and_permission_options() {
        let session = json!({
            "modes": {
                "currentModeId": "agent",
                "availableModes": [
                    { "id": "read-only", "name": "Read Only" },
                    { "id": "agent", "name": "Agent" }
                ]
            }
        });
        let (current, available) = parse_available_modes(&session);
        assert_eq!(current.as_deref(), Some("agent"));
        assert_eq!(available.len(), 2);
        let params = json!({
            "toolCall": { "title": "Escalate sandbox" },
            "options": [
                { "optionId": "allow-always", "name": "Always", "kind": "allow_always" }
            ]
        });
        assert_eq!(permission_title(&params), "Escalate sandbox");
        assert_eq!(
            permission_description(&json!({
                "toolCall": {
                    "kind": "execute",
                    "rawInput": { "command": "cargo test" }
                }
            }))
            .as_deref(),
            Some("execute: cargo test")
        );
        assert_eq!(
            parse_permission_choices(&params)[0].option_id,
            "allow-always"
        );
    }

    #[test]
    fn mode_config_option_is_a_fallback_surface() {
        let options = json!([{
            "id": "mode",
            "category": "mode",
            "type": "select",
            "options": [
                { "value": "read-only", "name": "Read only" },
                { "value": "agent-full-access", "name": "Full access" }
            ]
        }]);
        let policy = ProductSessionPolicy {
            sandbox_mode: Some("danger-full-access".into()),
            ..ProductSessionPolicy::default()
        };
        assert_eq!(
            resolve_mode_config_value(&options, &policy),
            Some(("mode".into(), "agent-full-access".into()))
        );
    }
}
