use remote_codex_protocol::AgentProviderCapabilitiesDto;
use serde_json::{json, Value};

use super::capabilities::NegotiatedCaps;

/// Per-harness translator over a shared ACP client.
/// Generic session/prompt/cancel/permission stay in the runtime.
/// Unique native app-server surfaces are not mixed into the same thread.
pub trait HarnessAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn compact_prompt(&self) -> Option<&'static str> {
        None
    }
    fn initialize_client_meta(&self) -> Value {
        json!({})
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        let _ = (caps, negotiated);
    }
}

pub struct StandardAdapter;

impl HarnessAdapter for StandardAdapter {
    fn id(&self) -> &'static str {
        "standard"
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
    }
}

pub struct CodexAdapter;

impl HarnessAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }
    fn compact_prompt(&self) -> Option<&'static str> {
        Some("/compact")
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
        // Codex ACP compact is a hidden `/compact` turn, not a native method.
        caps.turns.compact = true;
        // Not on the ACP wire today — leave false until Codex ACP advertises them.
        caps.branching.fork = false;
        caps.branching.hard_rollback = false;
        caps.management.mcp_status = false;
        caps.management.skills = false;
        caps.management.hooks = false;
        caps.management.hook_trust = false;
        caps.management.host_config_files = false;
        caps.management.provider_settings = false;
    }
}

pub struct ClaudeAdapter;

impl HarnessAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
    }
}

pub struct GrokAdapter;

impl HarnessAdapter for GrokAdapter {
    fn id(&self) -> &'static str {
        "grok"
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
    }
}

pub struct DeepSeekAdapter;

impl HarnessAdapter for DeepSeekAdapter {
    fn id(&self) -> &'static str {
        "deepseek"
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
    }
}

pub fn adapter_for(agent_id: &str) -> Box<dyn HarnessAdapter> {
    match agent_id {
        "codex" => Box::new(CodexAdapter),
        "claude" => Box::new(ClaudeAdapter),
        "grok" => Box::new(GrokAdapter),
        "deepseek" => Box::new(DeepSeekAdapter),
        _ => Box::new(StandardAdapter),
    }
}

fn apply_negotiated(caps: &mut AgentProviderCapabilitiesDto, negotiated: &NegotiatedCaps) {
    // Only upgrade advertised product defaults. Empty/default negotiated caps must not
    // mark an installed harness as unable to start or resume threads.
    if negotiated.load_session {
        caps.sessions.load = Some(true);
    }
    if negotiated.resume {
        caps.sessions.resume = true;
    }
    if negotiated.close {
        caps.sessions.close = Some(true);
    }
    if negotiated.delete {
        caps.sessions.delete = Some(true);
    }
    if negotiated.list {
        caps.sessions.list = true;
    }
    if negotiated.steer {
        caps.turns.steer = true;
    }
    if negotiated.compact {
        caps.turns.compact = true;
    }
    if negotiated.fork {
        caps.branching.fork = true;
    }
    if negotiated.goals {
        caps.controls.goals = true;
    }
    if negotiated.fast {
        caps.controls.performance_mode = true;
    }
    caps.controls.permission_requests = true;
    caps.usage.token_usage = true;
    caps.usage.context_window = true;
}

#[cfg(test)]
mod tests {
    use super::*;
    use remote_codex_protocol::toolbox_from_capabilities;

    fn base() -> AgentProviderCapabilitiesDto {
        AgentProviderCapabilitiesDto::conversational()
    }

    #[test]
    fn codex_toolbox_has_compact_not_native_management() {
        let adapter = CodexAdapter;
        let mut caps = base();
        caps.turns.compact = false;
        caps.branching.fork = true;
        adapter.patch_capabilities(&mut caps, &NegotiatedCaps::default());
        assert!(caps.sessions.resume);
        assert!(caps.turns.start);
        assert!(caps.management.models);
        assert!(caps.turns.compact);
        assert!(!caps.branching.fork);
        assert!(!caps.management.mcp_status);
        assert!(!caps.management.skills);
        assert!(!caps.management.hooks);
        assert!(!caps.management.host_config_files);
        let toolbox = toolbox_from_capabilities(&caps);
        let commands: Vec<_> = toolbox.iter().map(|i| i.command.as_str()).collect();
        assert!(commands.contains(&"/compact"));
        assert!(!commands.contains(&"/fork"));
        assert!(!commands.contains(&"/mcp"));
        assert!(!commands.contains(&"/skills"));
        assert!(!commands.contains(&"/hooks"));
    }

    #[test]
    fn advertised_caps_keep_resume_when_nothing_is_negotiated() {
        let mut caps = base();
        StandardAdapter.patch_capabilities(&mut caps, &NegotiatedCaps::default());
        assert!(caps.sessions.resume);
        assert!(caps.turns.start);
        assert!(caps.management.models);
        assert!(!caps.branching.fork);
    }

    #[test]
    fn claude_toolbox_exposes_fork_when_negotiated() {
        let adapter = ClaudeAdapter;
        let mut caps = base();
        let negotiated = NegotiatedCaps {
            fork: true,
            ..NegotiatedCaps::default()
        };
        adapter.patch_capabilities(&mut caps, &negotiated);
        assert!(caps.branching.fork);
        let toolbox = toolbox_from_capabilities(&caps);
        assert!(toolbox.iter().any(|i| i.command == "/fork"));
        assert!(!caps.management.skills);
        assert!(!caps.management.hooks);
    }

    #[test]
    fn grok_and_deepseek_follow_negotiated_acp_only() {
        for adapter in [
            Box::new(GrokAdapter) as Box<dyn HarnessAdapter>,
            Box::new(DeepSeekAdapter),
        ] {
            let mut caps = base();
            adapter.patch_capabilities(&mut caps, &NegotiatedCaps::default());
            assert!(!caps.turns.compact);
            assert!(!caps.branching.fork);
            assert!(!caps.management.mcp_status);
        }
    }
}
