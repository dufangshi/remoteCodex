use remote_codex_protocol::{
    toolbox_from_capabilities, AgentProviderCapabilitiesDto, ModelOptionDto, ToolboxItemDto,
};
use serde_json::{json, Value};

use super::capabilities::NegotiatedCaps;
use super::grok;

#[derive(Debug, Clone)]
pub struct HarnessProjection {
    pub state: Value,
    pub models: Vec<ModelOptionDto>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SessionSettingOp {
    SetConfig { config_id: String, value: String },
    SetModel { model_id: String },
    SetMode { mode_id: String },
    LoadWithMeta { meta: Value },
}

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
    fn prompt_preamble(&self) -> Option<&'static str> {
        None
    }
    fn model_list_method(&self) -> Option<&'static str> {
        None
    }
    fn project_model_list(&self, _response: &Value) -> Option<Vec<ModelOptionDto>> {
        None
    }
    fn model_list_supports_performance(&self, _response: &Value) -> bool {
        false
    }
    fn fs_read_text_file(&self) -> bool {
        true
    }
    fn fs_write_text_file(&self) -> bool {
        true
    }
    fn session_new_meta(&self, _reasoning_effort: Option<&str>) -> Value {
        json!({})
    }
    fn project_session(&self, _response: &Value) -> Option<HarnessProjection> {
        None
    }
    fn apply_model(&self, _model: &str, _state: &Value) -> Option<SessionSettingOp> {
        None
    }
    fn apply_reasoning(&self, _effort: &str, _state: &Value) -> Option<SessionSettingOp> {
        None
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        let _ = (caps, negotiated);
    }
    fn toolbox_items(
        &self,
        caps: &AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) -> Vec<ToolboxItemDto> {
        let mut items = toolbox_from_capabilities(caps);
        for command in &negotiated.available_commands {
            let slash_command = format!("/{}", command.name);
            if items.iter().any(|item| item.command == slash_command) {
                continue;
            }
            items.push(ToolboxItemDto {
                action: "prompt".into(),
                command: slash_command,
                label: command.name.clone(),
                description: command.description.clone(),
                panel: None,
            });
        }
        items
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

pub struct CursorAdapter;

impl HarnessAdapter for CursorAdapter {
    fn id(&self) -> &'static str {
        "cursor"
    }
    fn initialize_client_meta(&self) -> Value {
        json!({ "parameterizedModelPicker": true })
    }
    fn prompt_preamble(&self) -> Option<&'static str> {
        Some(
            "Cursor ACP client constraint: do not launch background subagents. If you delegate \
             work, wait for every subagent result in the current turn and deliver the complete \
             requested answer before ending the turn.",
        )
    }
    fn model_list_method(&self) -> Option<&'static str> {
        Some("cursor/list_available_models")
    }
    fn project_model_list(&self, response: &Value) -> Option<Vec<ModelOptionDto>> {
        let models = response.get("models")?.as_array()?;
        let projected: Vec<_> = models
            .iter()
            .enumerate()
            .filter_map(|(index, model)| cursor_model(model, index))
            .collect();
        (!projected.is_empty()).then_some(projected)
    }
    fn model_list_supports_performance(&self, response: &Value) -> bool {
        response
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .flat_map(|model| {
                model
                    .get("configOptions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
            })
            .any(is_fast_option)
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
        caps.management.models = true;
    }
}

pub struct GrokAdapter;

impl HarnessAdapter for GrokAdapter {
    fn id(&self) -> &'static str {
        "grok"
    }
    fn fs_read_text_file(&self) -> bool {
        false
    }
    fn session_new_meta(&self, reasoning_effort: Option<&str>) -> Value {
        match grok::normalize_acp_effort(reasoning_effort) {
            Some(effort) => json!({ "reasoningEffort": effort }),
            None => json!({}),
        }
    }
    fn project_session(&self, response: &Value) -> Option<HarnessProjection> {
        grok::project_session(response)
    }
    fn apply_model(&self, model: &str, _state: &Value) -> Option<SessionSettingOp> {
        Some(grok::apply_model(model))
    }
    fn apply_reasoning(&self, effort: &str, state: &Value) -> Option<SessionSettingOp> {
        grok::apply_reasoning(effort, state)
    }
    fn patch_capabilities(
        &self,
        caps: &mut AgentProviderCapabilitiesDto,
        negotiated: &NegotiatedCaps,
    ) {
        apply_negotiated(caps, negotiated);
        caps.management.models = true;
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
        "cursor" => Box::new(CursorAdapter),
        "grok" => Box::new(GrokAdapter),
        "deepseek" => Box::new(DeepSeekAdapter),
        _ => Box::new(StandardAdapter),
    }
}

fn cursor_model(model: &Value, index: usize) -> Option<ModelOptionDto> {
    let value = model.get("value").and_then(Value::as_str)?;
    let config_options = model
        .get("configOptions")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let reasoning = config_options.iter().find(|option| {
        option.get("category").and_then(Value::as_str) == Some("thought_level")
            && !select_options(option).is_empty()
    });
    let efforts: Vec<_> = reasoning
        .into_iter()
        .flat_map(select_options)
        .filter_map(|entry| {
            let raw = entry.get("value").and_then(Value::as_str)?;
            Some(remote_codex_protocol::ReasoningEffortOptionDto {
                reasoning_effort: grok::normalize_acp_effort(Some(raw))?,
                description: entry
                    .get("description")
                    .or_else(|| entry.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            })
        })
        .collect();
    let default_reasoning_effort = reasoning
        .and_then(|option| option.get("currentValue"))
        .and_then(Value::as_str)
        .and_then(|value| grok::normalize_acp_effort(Some(value)));
    Some(ModelOptionDto {
        id: value.to_string(),
        model: value.to_string(),
        display_name: model
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(value)
            .to_string(),
        description: model
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        is_default: index == 0,
        hidden: false,
        supported_reasoning_efforts: efforts,
        default_reasoning_effort,
        selection_kind: Some("model".into()),
        acp_agent: None,
    })
}

fn select_options(option: &Value) -> Vec<&Value> {
    option
        .get("options")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            if entry.get("options").is_some() {
                select_options(entry)
            } else {
                vec![entry]
            }
        })
        .collect()
}

fn is_fast_option(option: &Value) -> bool {
    matches!(
        option.get("id").and_then(Value::as_str),
        Some("fast" | "fast-mode")
    )
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
    use serde_json::json;

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

    #[test]
    fn adapter_adds_advertised_harness_commands_without_duplicates() {
        let adapter = GrokAdapter;
        let mut caps = base();
        let negotiated = super::super::capabilities::negotiate(&json!({
            "_meta": {
                "availableCommands": [
                    { "name": "compact", "description": "Compact context" },
                    { "name": "deep-research", "description": "Research a topic" }
                ]
            }
        }));
        adapter.patch_capabilities(&mut caps, &negotiated);
        let toolbox = adapter.toolbox_items(&caps, &negotiated);
        assert_eq!(
            toolbox
                .iter()
                .filter(|item| item.command == "/compact")
                .count(),
            1
        );
        assert!(toolbox
            .iter()
            .any(|item| item.command == "/deep-research" && item.action == "prompt"));
    }

    #[test]
    fn grok_disables_fs_read_and_projects_session_models() {
        let adapter = GrokAdapter;
        assert!(!adapter.fs_read_text_file());
        assert_eq!(
            adapter.session_new_meta(Some("high")),
            json!({ "reasoningEffort": "high" })
        );
        let projected = adapter
            .project_session(&json!({
                "models": {
                    "currentModelId": "grok-4.6",
                    "availableModels": [{
                        "modelId": "grok-4.6",
                        "_meta": {
                            "reasoningEffort": "high",
                            "reasoningEfforts": [
                                { "value": "low" },
                                { "value": "high" }
                            ]
                        }
                    }]
                }
            }))
            .expect("grok projection");
        assert_eq!(projected.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(projected.models[0].supported_reasoning_efforts.len(), 2);
    }

    #[test]
    fn cursor_opts_into_and_projects_the_parameterized_model_picker() {
        let adapter = CursorAdapter;
        assert_eq!(
            adapter.initialize_client_meta(),
            json!({ "parameterizedModelPicker": true })
        );
        let response = json!({
            "models": [
                {
                    "value": "cursor-fast",
                    "name": "Cursor Fast",
                    "configOptions": [
                        {
                            "id": "thought-level",
                            "category": "thought_level",
                            "type": "select",
                            "currentValue": "high",
                            "options": [
                                { "value": "low", "name": "Low" },
                                { "value": "high", "name": "High" }
                            ]
                        },
                        { "id": "fast-mode", "type": "boolean", "currentValue": false }
                    ]
                },
                { "value": "cursor-accurate", "name": "Cursor Accurate" }
            ]
        });
        let models = adapter.project_model_list(&response).unwrap();
        assert_eq!(models.len(), 2);
        assert!(models[0].is_default);
        assert_eq!(models[0].model, "cursor-fast");
        assert_eq!(models[0].default_reasoning_effort.as_deref(), Some("high"));
        assert_eq!(
            models[0]
                .supported_reasoning_efforts
                .iter()
                .map(|effort| effort.reasoning_effort.as_str())
                .collect::<Vec<_>>(),
            vec!["low", "high"]
        );
        assert!(adapter.model_list_supports_performance(&response));
        assert!(adapter
            .prompt_preamble()
            .unwrap()
            .contains("background subagents"));
    }
}
