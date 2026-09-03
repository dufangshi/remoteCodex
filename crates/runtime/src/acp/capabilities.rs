use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NegotiatedCommand {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NegotiatedCaps {
    pub load_session: bool,
    pub resume: bool,
    pub list: bool,
    pub close: bool,
    pub delete: bool,
    pub fork: bool,
    pub steer: bool,
    pub compact: bool,
    pub goals: bool,
    pub fast: bool,
    pub image: bool,
    pub goal_method: Option<String>,
    pub agent_name: Option<String>,
    pub available_commands: Vec<NegotiatedCommand>,
}

fn capability_advertised(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::Object(_)) => true,
        _ => false,
    }
}

fn available_commands(initialize: &Value) -> Vec<NegotiatedCommand> {
    initialize
        .pointer("/_meta/availableCommands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|command| {
            let name = command.get("name").and_then(Value::as_str)?.trim();
            if name.is_empty() {
                return None;
            }
            Some(NegotiatedCommand {
                name: name.to_string(),
                description: command
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

pub fn negotiate(initialize: &Value) -> NegotiatedCaps {
    let caps = initialize
        .get("agentCapabilities")
        .cloned()
        .unwrap_or(Value::Null);
    let session = caps
        .get("sessionCapabilities")
        .or_else(|| caps.get("session"))
        .cloned()
        .unwrap_or(Value::Null);
    let prompt = caps
        .get("promptCapabilities")
        .cloned()
        .unwrap_or(Value::Null);
    let meta = initialize.get("_meta").cloned().unwrap_or(Value::Null);
    let steering = meta.get("steering").cloned().unwrap_or(Value::Null);
    let goal = meta.get("goal").cloned().unwrap_or(Value::Null);
    let available_commands = available_commands(initialize);
    NegotiatedCaps {
        load_session: capability_advertised(caps.get("loadSession"))
            || capability_advertised(session.get("load")),
        resume: capability_advertised(session.get("resume")),
        list: capability_advertised(session.get("list")),
        close: capability_advertised(session.get("close")),
        delete: capability_advertised(session.get("delete")),
        fork: capability_advertised(session.get("fork")),
        steer: steering
            .get("supported")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        compact: available_commands
            .iter()
            .any(|command| command.name == "compact"),
        goals: goal.get("controlMethod").and_then(Value::as_str).is_some()
            || goal.get("version").is_some(),
        fast: false,
        image: prompt
            .get("image")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        goal_method: goal
            .get("controlMethod")
            .and_then(Value::as_str)
            .map(str::to_string),
        agent_name: initialize
            .pointer("/agentInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        available_commands,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn negotiates_claude_session_fork() {
        let caps = negotiate(&json!({
            "agentCapabilities": {
                "loadSession": true,
                "sessionCapabilities": { "fork": true, "resume": true, "close": true },
                "promptCapabilities": { "image": true }
            }
        }));
        assert!(caps.fork);
        assert!(caps.resume);
        assert!(caps.image);
        assert!(!caps.compact);
    }

    #[test]
    fn negotiates_legacy_steer_and_goal() {
        let caps = negotiate(&json!({
            "agentCapabilities": { "sessionCapabilities": {} },
            "_meta": {
                "steering": { "supported": true },
                "goal": { "controlMethod": "session/set_goal", "version": 1 }
            }
        }));
        assert!(caps.steer);
        assert!(caps.goals);
        assert_eq!(caps.goal_method.as_deref(), Some("session/set_goal"));
    }

    #[test]
    fn negotiates_object_capabilities_and_available_commands() {
        let caps = negotiate(&json!({
            "agentCapabilities": {
                "sessionCapabilities": {
                    "list": {},
                    "resume": {},
                    "close": {},
                    "fork": {}
                }
            },
            "_meta": {
                "availableCommands": [
                    { "name": "compact", "description": "Compact context" },
                    { "name": "goal", "description": "Manage a goal" },
                    { "name": "deep-research", "description": "Research a topic" }
                ]
            }
        }));
        assert!(caps.list);
        assert!(caps.resume);
        assert!(caps.close);
        assert!(caps.fork);
        assert!(caps.compact);
        assert!(!caps.goals);
        assert_eq!(caps.available_commands.len(), 3);
    }
}
