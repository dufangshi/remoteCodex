//! Keep native session defaults aligned with ACP permissions, including goal continuations.
use super::modes::ProductSessionPolicy;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) fn native_policy(policy: &ProductSessionPolicy) -> Value {
    let sandbox = policy
        .sandbox_mode
        .as_deref()
        .unwrap_or(if policy.auto_approve() {
            "danger-full-access"
        } else {
            "workspace-write"
        });
    let sandbox_policy = match sandbox {
        "danger-full-access" => json!({"type":"dangerFullAccess"}),
        "read-only" => json!({"type":"readOnly"}),
        _ => json!({"type":"workspaceWrite", "networkAccess":false}),
    };
    json!({"sandbox":sandbox,"sandboxPolicy":sandbox_policy,
        "approvalPolicy":if policy.auto_approve() {"never"} else {"on-request"},
        "approvalsReviewer":"user"})
}

pub(super) struct PermissionBridge {
    initial: Value,
    threads: HashMap<String, Value>,
    pending: HashMap<String, (Option<String>, Value)>,
}
impl PermissionBridge {
    pub fn new(initial: Value) -> Self {
        Self {
            initial,
            threads: HashMap::new(),
            pending: HashMap::new(),
        }
    }
    pub fn request(&mut self, message: &mut Value) {
        let method = message["method"].as_str().unwrap_or("").to_string();
        if !matches!(
            method.as_str(),
            "thread/start" | "thread/resume" | "thread/fork" | "thread/settings/update"
        ) {
            return;
        }
        let source = message["params"]["threadId"].as_str().map(str::to_owned);
        let mut policy = source
            .as_ref()
            .and_then(|id| self.threads.get(id))
            .unwrap_or(&self.initial)
            .clone();
        let params = &mut message["params"];
        if method == "thread/settings/update" {
            // Only track explicit permission updates; never reinterpret collaboration settings.
            if params["sandboxPolicy"].is_null() {
                return;
            }
            policy["sandboxPolicy"] = params["sandboxPolicy"].clone();
            policy["sandbox"] = json!(match params["sandboxPolicy"]["type"].as_str() {
                Some("dangerFullAccess") => "danger-full-access",
                Some("readOnly") => "read-only",
                _ => "workspace-write",
            });
            for key in ["approvalPolicy", "approvalsReviewer"] {
                if !params[key].is_null() {
                    policy[key] = params[key].clone();
                }
            }
        } else {
            // Audit forks can explicitly request read-only. Preserve all explicit overrides.
            if !params["permissions"].is_null() || !params["sandbox"].is_null() {
                return;
            }
            for key in ["sandbox", "approvalPolicy", "approvalsReviewer"] {
                if params[key].is_null() {
                    params[key] = policy[key].clone();
                }
            }
        }
        self.pending.insert(
            message["id"].to_string(),
            (
                if method == "thread/fork" {
                    None
                } else {
                    source
                },
                policy,
            ),
        );
    }
    pub fn response(&mut self, message: &Value) {
        let Some((source, policy)) = self.pending.remove(&message["id"].to_string()) else {
            return;
        };
        if message.get("error").is_some() {
            return;
        }
        let id = message
            .pointer("/result/thread/id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(source);
        if let Some(id) = id {
            self.threads.insert(id, policy);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resume_and_fork_inherit_native_defaults_and_explicit_restrictions_survive() {
        let full = native_policy(&ProductSessionPolicy {
            sandbox_mode: Some("danger-full-access".into()),
            ..Default::default()
        });
        let mut bridge = PermissionBridge::new(full);
        let mut resume = json!({"id":1,"method":"thread/resume","params":{"threadId":"a"}});
        bridge.request(&mut resume);
        assert_eq!(resume["params"]["sandbox"], "danger-full-access");
        assert_eq!(resume["params"]["approvalPolicy"], "never");
        bridge.response(&json!({"id":1,"result":{"thread":{"id":"a"}}}));
        let mut restricted = json!({"id":2,"method":"thread/settings/update","params":{"threadId":"a","sandboxPolicy":{"type":"readOnly"},"approvalPolicy":"on-request"}});
        bridge.request(&mut restricted);
        bridge.response(&json!({"id":2,"result":{}}));
        let mut fork = json!({"id":3,"method":"thread/fork","params":{"threadId":"a"}});
        bridge.request(&mut fork);
        assert_eq!(fork["params"]["sandbox"], "read-only");
        bridge.response(&json!({"id":3,"result":{"thread":{"id":"b"}}}));
        let mut load = json!({"id":4,"method":"thread/resume","params":{"threadId":"b"}});
        bridge.request(&mut load);
        assert_eq!(load["params"]["sandbox"], "read-only");
        let mut audit = json!({"id":5,"method":"thread/fork","params":{"threadId":"a","sandbox":"read-only","approvalPolicy":"never"}});
        let before = audit.clone();
        bridge.request(&mut audit);
        assert_eq!(audit, before);
    }
}
