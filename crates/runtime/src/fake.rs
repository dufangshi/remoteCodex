use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{bail, Result};
use async_trait::async_trait;
use remote_codex_protocol::{
    now_rfc3339, toolbox_from_capabilities, AgentBackendDto, AgentBackendInstallationDto,
    AgentBackendManagementSchemaDto, AgentCapabilitySnapshotDto, AgentProviderCapabilitiesDto,
    AgentRuntimeStatusDto, ModelOptionDto, Provider, ReasoningEffortOptionDto, ThreadEventEnvelope,
    ThreadHistoryItemDto,
};
use serde_json::json;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::acp::{adapter_for, NegotiatedCaps};
use crate::actor::{
    AgentRuntime, EventBus, GoalState, ImportSessionMeta, StartSessionInput, StartSessionResult,
    StartTurnInput,
};
use crate::import_id::session_ids_match;

pub struct FakeRuntime {
    provider: Provider,
    sessions: Mutex<HashMap<String, String>>,
    started_at: Mutex<Option<String>>,
    goal: Mutex<Option<GoalState>>,
    import_sessions: Mutex<Vec<ImportSessionMeta>>,
}

impl FakeRuntime {
    pub fn new(provider: Provider) -> Self {
        Self {
            provider,
            sessions: Mutex::new(HashMap::new()),
            started_at: Mutex::new(None),
            goal: Mutex::new(None),
            import_sessions: Mutex::new(Vec::new()),
        }
    }

    pub fn seed_import_session(&self, session: ImportSessionMeta) {
        self.import_sessions.lock().unwrap().push(session);
    }

    fn agent_id(&self) -> &'static str {
        self.provider.as_str()
    }

    fn caps(&self) -> AgentProviderCapabilitiesDto {
        let mut caps = AgentProviderCapabilitiesDto::conversational();
        let negotiated = match self.provider {
            Provider::Claude => NegotiatedCaps {
                load_session: true,
                resume: true,
                close: true,
                fork: true,
                steer: true,
                image: true,
                ..NegotiatedCaps::default()
            },
            _ => NegotiatedCaps {
                load_session: true,
                resume: true,
                close: true,
                steer: true,
                image: true,
                goals: true,
                ..NegotiatedCaps::default()
            },
        };
        adapter_for(self.agent_id()).patch_capabilities(&mut caps, &negotiated);
        caps.sessions.import_local = true;
        caps
    }

    fn models() -> Vec<ModelOptionDto> {
        vec![
            ModelOptionDto {
                id: "ios-e2e-stream".into(),
                model: "ios-e2e-stream".into(),
                display_name: "E2E Stream".into(),
                description: "Deterministic streaming test model.".into(),
                is_default: true,
                hidden: false,
                supported_reasoning_efforts: efforts(),
                default_reasoning_effort: Some("medium".into()),
                selection_kind: Some("model".into()),
                acp_agent: None,
            },
            ModelOptionDto {
                id: "gpt-5.4".into(),
                model: "gpt-5.4".into(),
                display_name: "GPT-5.4".into(),
                description: "Default coding model.".into(),
                is_default: false,
                hidden: false,
                supported_reasoning_efforts: efforts(),
                default_reasoning_effort: Some("medium".into()),
                selection_kind: Some("model".into()),
                acp_agent: None,
            },
        ]
    }
}

fn efforts() -> Vec<ReasoningEffortOptionDto> {
    ["low", "medium", "high"]
        .into_iter()
        .map(|level| ReasoningEffortOptionDto {
            reasoning_effort: level.into(),
            description: level.to_string(),
        })
        .collect()
}

fn emit(bus: &EventBus, thread_id: &str, event_type: &str, payload: serde_json::Value) {
    bus.emit(ThreadEventEnvelope {
        event_type: event_type.into(),
        thread_id: thread_id.into(),
        timestamp: now_rfc3339(),
        payload,
    });
}

#[async_trait]
impl AgentRuntime for FakeRuntime {
    fn provider(&self) -> Provider {
        self.provider
    }

    fn descriptor(&self) -> AgentBackendDto {
        let started = self.started_at.lock().unwrap().clone();
        let caps = self.caps();
        let mut schema = AgentBackendManagementSchemaDto::default();
        schema.toolbox_items = toolbox_from_capabilities(&caps);
        AgentBackendDto {
            provider: self.provider,
            display_name: format!("Fake {}", self.provider.as_str()),
            description: "Deterministic runtime for local tests.".into(),
            enabled: true,
            is_default: self.provider == Provider::Codex,
            status: AgentRuntimeStatusDto {
                state: "ready".into(),
                transport: "none".into(),
                last_started_at: started,
                last_error: None,
                restart_count: 0,
            },
            capabilities: caps,
            management_schema: schema,
            installation: AgentBackendInstallationDto {
                package_name: Some("remote-codex-e2e-fake-runtime".into()),
                installed: true,
                installed_version: Some("test".into()),
                latest_version: None,
                install_command: None,
                update_command: None,
                busy: false,
                last_error: None,
            },
        }
    }

    fn negotiated_caps(&self, _agent_id: Option<&str>) -> AgentProviderCapabilitiesDto {
        self.caps()
    }

    async fn start(&self) -> Result<()> {
        *self.started_at.lock().unwrap() = Some(now_rfc3339());
        Ok(())
    }

    async fn list_models(
        &self,
        _agent_id: Option<&str>,
        _cwd: Option<&str>,
    ) -> Result<Vec<ModelOptionDto>> {
        Ok(Self::models())
    }

    async fn list_agents(&self) -> Result<Vec<ModelOptionDto>> {
        Ok(vec![])
    }

    async fn capabilities(&self, agent_id: Option<&str>) -> Result<AgentCapabilitySnapshotDto> {
        Ok(AgentCapabilitySnapshotDto {
            provider: self.provider,
            agent_id: agent_id.unwrap_or(self.agent_id()).into(),
            availability: "ready".into(),
            negotiated: None,
            effective_capabilities: Some(self.caps()),
            toolbox_items: self.toolbox(agent_id),
        })
    }

    async fn start_session(&self, input: StartSessionInput) -> Result<StartSessionResult> {
        let id = format!("e2e-session-{}", Uuid::new_v4());
        self.sessions.lock().unwrap().insert(id.clone(), input.cwd);
        Ok(StartSessionResult {
            provider_session_id: id,
            model: Some(input.model),
            reasoning_effort: input.reasoning_effort,
        })
    }

    async fn resume_session(
        &self,
        session_id: &str,
        cwd: Option<&str>,
    ) -> Result<StartSessionResult> {
        let mut sessions = self.sessions.lock().unwrap();
        if !sessions.contains_key(session_id) {
            sessions.insert(session_id.into(), cwd.unwrap_or(".").into());
        }
        Ok(StartSessionResult {
            provider_session_id: session_id.into(),
            model: None,
            reasoning_effort: None,
        })
    }

    async fn start_turn(
        &self,
        input: StartTurnInput,
        bus: EventBus,
        cancel: CancellationToken,
    ) -> Result<Vec<ThreadHistoryItemDto>> {
        if input.hidden {
            return Ok(vec![]);
        }
        let reply = reply_for(&input.prompt);
        let item_id = format!("{}:assistant", input.turn_id);
        emit(
            &bus,
            &input.thread_id,
            "thread.turn.started",
            json!({ "turnId": input.turn_id }),
        );
        let slow = input.prompt.len() > 180
            || input
                .prompt
                .to_lowercase()
                .contains("inspect this repository");
        if slow {
            tokio::select! {
                _ = cancel.cancelled() => {
                    emit(&bus, &input.thread_id, "thread.turn.completed", json!({
                        "turnId": input.turn_id,
                        "status": "interrupted",
                        "error": null
                    }));
                    return Ok(vec![item(&item_id, "", Some("interrupted"))]);
                }
                _ = sleep(Duration::from_secs(25)) => {}
            }
        } else {
            for (i, ch) in reply.chars().enumerate() {
                if cancel.is_cancelled() {
                    emit(
                        &bus,
                        &input.thread_id,
                        "thread.turn.completed",
                        json!({
                            "turnId": input.turn_id,
                            "status": "interrupted",
                            "error": null
                        }),
                    );
                    return Ok(vec![item(&item_id, "", Some("interrupted"))]);
                }
                emit(
                    &bus,
                    &input.thread_id,
                    "thread.output.delta",
                    json!({
                        "turnId": input.turn_id,
                        "itemId": item_id,
                        "sequence": i,
                        "delta": ch.to_string(),
                    }),
                );
                sleep(Duration::from_millis(4)).await;
            }
        }
        let final_item = item(&item_id, &reply, Some("completed"));
        emit(
            &bus,
            &input.thread_id,
            "thread.item.completed",
            json!({ "turnId": input.turn_id, "item": final_item }),
        );
        emit(
            &bus,
            &input.thread_id,
            "thread.turn.completed",
            json!({
                "turnId": input.turn_id,
                "status": "completed",
                "error": null
            }),
        );
        Ok(vec![final_item])
    }

    async fn interrupt(&self, _session_id: &str, _turn_id: &str) -> Result<()> {
        Ok(())
    }

    async fn respond_permission(
        &self,
        _request_id: &str,
        _allow: bool,
        _answer: Option<&str>,
    ) -> Result<()> {
        Ok(())
    }

    async fn compact_session(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _bus: EventBus,
    ) -> Result<()> {
        if adapter_for(self.agent_id()).compact_prompt().is_none() {
            bail!("this harness does not implement compact");
        }
        Ok(())
    }

    async fn fork_session(&self, session_id: &str) -> Result<StartSessionResult> {
        if !self.caps().branching.fork {
            bail!("this harness does not support session/fork");
        }
        let id = format!("{session_id}-fork-{}", Uuid::new_v4());
        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), "fork".into());
        Ok(StartSessionResult {
            provider_session_id: id,
            model: None,
            reasoning_effort: None,
        })
    }

    async fn get_goal(&self, _session_id: &str) -> Result<Option<GoalState>> {
        Ok(self.goal.lock().unwrap().clone())
    }

    async fn set_goal(
        &self,
        _session_id: &str,
        objective: Option<String>,
        status: Option<String>,
    ) -> Result<Option<GoalState>> {
        if !self.caps().controls.goals {
            bail!("this harness does not support goals");
        }
        let next = if objective.as_ref().map(|s| s.is_empty()).unwrap_or(true)
            && status.as_deref() == Some("clear")
        {
            None
        } else {
            Some(GoalState {
                objective: objective.unwrap_or_else(|| "goal".into()),
                status: status.unwrap_or_else(|| "active".into()),
                tokens_used: 0,
                time_used_seconds: 0,
            })
        };
        *self.goal.lock().unwrap() = next.clone();
        Ok(next)
    }

    async fn list_import_sessions(&self, agent_id: Option<&str>) -> Result<Vec<ImportSessionMeta>> {
        let wanted = agent_id.unwrap_or(self.agent_id());
        Ok(self
            .import_sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|session| session.agent_id == wanted || session.agent_id == self.agent_id())
            .cloned()
            .collect())
    }

    fn session_loaded(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().unwrap();
        sessions.contains_key(session_id)
            || sessions
                .keys()
                .any(|stored| session_ids_match(stored, session_id))
    }
}

fn reply_for(prompt: &str) -> String {
    let lower = prompt.to_lowercase();
    if lower.contains("hello") {
        "hello".into()
    } else if let Some(rest) = prompt.strip_prefix("Reply with exactly ") {
        rest.trim_end_matches('.').trim().to_string()
    } else {
        format!("ok: {}", prompt.chars().take(80).collect::<String>())
    }
}

fn item(id: &str, text: &str, status: Option<&str>) -> ThreadHistoryItemDto {
    ThreadHistoryItemDto {
        id: id.into(),
        created_at: Some(now_rfc3339()),
        kind: "agentMessage".into(),
        text: text.into(),
        preview_text: None,
        detail_text: None,
        status: status.map(str::to_string),
        sequence: None,
        source_turn_id: None,
        artifact: None,
    }
}
