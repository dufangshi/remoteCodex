use serde_json::Value;

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
}

pub fn negotiate(initialize: &Value) -> NegotiatedCaps {
    let caps = initialize.get("agentCapabilities").cloned().unwrap_or(Value::Null);
    let session = caps.get("sessionCapabilities").cloned().unwrap_or(Value::Null);
    let prompt = caps.get("promptCapabilities").cloned().unwrap_or(Value::Null);
    let meta = initialize.get("_meta").cloned().unwrap_or(Value::Null);
    let steering = meta.get("steering").cloned().unwrap_or(Value::Null);
    let goal = meta.get("goal").cloned().unwrap_or(Value::Null);
    NegotiatedCaps {
        load_session: caps.get("loadSession").and_then(Value::as_bool).unwrap_or(false)
            || session.get("load").and_then(Value::as_bool).unwrap_or(false),
        resume: session.get("resume").and_then(Value::as_bool).unwrap_or(false),
        list: session.get("list").and_then(Value::as_bool).unwrap_or(false),
        close: session.get("close").and_then(Value::as_bool).unwrap_or(false),
        delete: session.get("delete").and_then(Value::as_bool).unwrap_or(false),
        fork: session.get("fork").and_then(Value::as_bool).unwrap_or(false),
        steer: steering.get("supported").and_then(Value::as_bool).unwrap_or(false),
        compact: false,
        goals: goal.get("controlMethod").and_then(Value::as_str).is_some()
            || goal.get("version").is_some(),
        fast: false,
        image: prompt.get("image").and_then(Value::as_bool).unwrap_or(false),
        goal_method: goal
            .get("controlMethod")
            .and_then(Value::as_str)
            .map(str::to_string),
        agent_name: initialize
            .pointer("/agentInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string),
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
}
