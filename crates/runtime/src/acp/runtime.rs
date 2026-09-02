use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use async_trait::async_trait;
use remote_codex_protocol::{
    now_rfc3339, toolbox_from_capabilities, AgentBackendDto, AgentBackendInstallationDto,
    AgentBackendManagementSchemaDto, AgentCapabilitySnapshotDto, AgentProviderCapabilitiesDto,
    AgentRuntimeStatusDto, ModelOptionDto, Provider, ReasoningEffortOptionDto,
    ThreadActionRequestDto, ThreadEventEnvelope, ThreadHistoryItemDto, ToolboxItemDto,
};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::actor::{
    AgentRuntime, EventBus, GoalState, StartSessionInput, StartSessionResult, StartTurnInput,
};
use crate::files::write_file;

use super::adapter::adapter_for;
use super::capabilities::{negotiate, NegotiatedCaps};
use super::catalog::{builtin_agents, command_available, AcpAgentDef};
use super::mapper::TurnMapper;
use super::prompt::build_prompt_blocks;
use super::rpc::AcpProcess;
use super::terminal::AgentTerminals;

struct ActiveTurn {
    thread_id: String,
    turn_id: String,
    bus: EventBus,
}

struct LiveSession {
    process: Arc<AcpProcess>,
    session_id: String,
    cwd: PathBuf,
    yolo: bool,
    negotiated: NegotiatedCaps,
    adapter_id: String,
    goal: Option<GoalState>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    active: Option<ActiveTurn>,
}

struct Inner {
    sessions: Mutex<HashMap<String, LiveSession>>,
    pending_permissions: Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
    pending_dtos: Mutex<HashMap<String, Vec<ThreadActionRequestDto>>>,
    caps_by_agent: Mutex<HashMap<String, AgentProviderCapabilitiesDto>>,
    updates: broadcast::Sender<Value>,
    terminals: AgentTerminals,
}

pub struct AcpRuntime {
    provider: Provider,
    bound_agent: Option<String>,
    custom_command: Option<String>,
    startup_timeout: Duration,
    started_at: Mutex<Option<String>>,
    inner: Arc<Inner>,
}

impl AcpRuntime {
    pub fn catalog(custom: Option<String>, timeout_ms: u64) -> Self {
        Self::new(Provider::Acp, None, custom, timeout_ms)
    }

    pub fn bound(provider: Provider, agent_id: &str, timeout_ms: u64) -> Self {
        Self::new(provider, Some(agent_id.into()), None, timeout_ms)
    }

    fn new(
        provider: Provider,
        bound_agent: Option<String>,
        custom: Option<String>,
        timeout_ms: u64,
    ) -> Self {
        let (updates, _) = broadcast::channel(512);
        Self {
            provider,
            bound_agent,
            custom_command: custom,
            startup_timeout: Duration::from_millis(timeout_ms),
            started_at: Mutex::new(None),
            inner: Arc::new(Inner {
                sessions: Mutex::new(HashMap::new()),
                pending_permissions: Mutex::new(HashMap::new()),
                pending_dtos: Mutex::new(HashMap::new()),
                caps_by_agent: Mutex::new(HashMap::new()),
                updates,
                terminals: AgentTerminals::default(),
            }),
        }
    }

    fn agent_def(&self, agent_id: Option<&str>) -> Result<AcpAgentDef> {
        let id = agent_id
            .map(str::to_string)
            .or_else(|| self.bound_agent.clone())
            .unwrap_or_else(|| "codex".into());
        builtin_agents(self.custom_command.as_deref())
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| anyhow!("unknown ACP agent {id}"))
    }

    fn scoped_id(agent_id: &str, session_id: &str) -> String {
        format!("{agent_id}::{session_id}")
    }

    async fn spawn_session(
        &self,
        def: &AcpAgentDef,
        cwd: &str,
        yolo: bool,
        load_id: Option<&str>,
    ) -> Result<(String, LiveSession)> {
        if !command_available(&def.server_command) && !command_available(&def.base_command) {
            bail!("{} is not installed", def.display_name);
        }
        let adapter = adapter_for(&def.id);
        let mut extra_env = Vec::new();
        if def.id == "codex" {
            if let Ok(home) = std::env::var("CODEX_HOME") {
                extra_env.push(("CODEX_HOME", home));
            }
        }
        let (process, updates_rx, requests_rx) = tokio::time::timeout(
            self.startup_timeout,
            AcpProcess::spawn(&def.server_command, cwd, &extra_env),
        )
        .await
        .map_err(|_| anyhow!("ACP spawn timeout"))??;
        let process = Arc::new(process);
        let init = process
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientInfo": {
                        "name": "remote-codex",
                        "title": "Remote Codex",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "clientCapabilities": {
                        "fs": { "readTextFile": true, "writeTextFile": true },
                        "terminal": true,
                        "session": { "compaction": {}, "configOptions": { "boolean": {} } },
                        "plan": {},
                        "_meta": adapter.initialize_client_meta()
                    }
                }),
            )
            .await?;
        let mut negotiated = negotiate(&init);
        let mut caps = AgentProviderCapabilitiesDto::conversational();
        adapter.patch_capabilities(&mut caps, &negotiated);
        negotiated.compact = caps.turns.compact;
        negotiated.fork = caps.branching.fork;
        negotiated.goals = caps.controls.goals;
        negotiated.steer = caps.turns.steer;
        self.inner
            .caps_by_agent
            .lock()
            .await
            .insert(def.id.clone(), caps);
        spawn_mux(self.inner.clone(), process.clone(), updates_rx, requests_rx);
        let raw_session = if let Some(existing) = load_id {
            if negotiated.load_session {
                process
                    .request(
                        "session/load",
                        json!({ "sessionId": existing, "cwd": cwd, "mcpServers": [] }),
                    )
                    .await?
            } else if negotiated.resume {
                process
                    .request(
                        "session/resume",
                        json!({ "sessionId": existing, "cwd": cwd, "mcpServers": [] }),
                    )
                    .await?
            } else {
                bail!("ACP agent does not support session/load or session/resume");
            }
        } else {
            process
                .request("session/new", json!({ "cwd": cwd, "mcpServers": [] }))
                .await?
        };
        let session_id = raw_session
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or(load_id.unwrap_or(""))
            .to_string();
        if session_id.is_empty() {
            bail!("ACP session id missing");
        }
        if let Some(options) = raw_session.get("configOptions") {
            if let Some(caps) = self.inner.caps_by_agent.lock().await.get_mut(&def.id) {
                apply_config_option_caps(caps, options);
            }
        }
        let scoped = Self::scoped_id(&def.id, &session_id);
        Ok((
            scoped,
            LiveSession {
                process,
                session_id,
                cwd: PathBuf::from(cwd),
                yolo,
                negotiated,
                adapter_id: def.id.clone(),
                goal: None,
                model: None,
                reasoning_effort: None,
                active: None,
            },
        ))
    }

    async fn caps_for(&self, agent_id: Option<&str>) -> AgentProviderCapabilitiesDto {
        let id = agent_id
            .map(str::to_string)
            .or_else(|| self.bound_agent.clone())
            .unwrap_or_else(|| "acp".into());
        self.inner
            .caps_by_agent
            .lock()
            .await
            .get(&id)
            .cloned()
            .unwrap_or_else(|| {
                let mut caps = AgentProviderCapabilitiesDto::conversational();
                adapter_for(&id).patch_capabilities(&mut caps, &NegotiatedCaps::default());
                caps
            })
    }
}

#[async_trait]
impl AgentRuntime for AcpRuntime {
    fn provider(&self) -> Provider {
        self.provider
    }

    fn descriptor(&self) -> AgentBackendDto {
        let started = self.started_at.try_lock().ok().and_then(|g| g.clone());
        let bound = self.bound_agent.clone().unwrap_or_else(|| "acp".into());
        let def = self.agent_def(Some(&bound)).ok();
        let installed = def
            .as_ref()
            .map(|d| command_available(&d.server_command) || command_available(&d.base_command))
            .unwrap_or(false);
        let caps = self
            .inner
            .caps_by_agent
            .try_lock()
            .ok()
            .and_then(|g| g.get(&bound).cloned())
            .unwrap_or_else(|| {
                let mut caps = AgentProviderCapabilitiesDto::conversational();
                adapter_for(&bound).patch_capabilities(&mut caps, &NegotiatedCaps::default());
                caps
            });
        let mut schema = AgentBackendManagementSchemaDto::default();
        schema.toolbox_items = toolbox_from_capabilities(&caps);
        AgentBackendDto {
            provider: self.provider,
            display_name: def
                .as_ref()
                .map(|d| d.display_name.clone())
                .unwrap_or_else(|| "ACP Agent".into()),
            description: "Generic ACP runtime with per-harness adapters.".into(),
            enabled: installed || self.provider == Provider::Acp,
            is_default: self.provider == Provider::Codex || self.provider == Provider::Acp,
            status: AgentRuntimeStatusDto {
                state: if installed { "ready" } else { "stopped" }.into(),
                transport: "stdio".into(),
                last_started_at: started,
                last_error: None,
                restart_count: 0,
            },
            capabilities: caps,
            management_schema: schema,
            installation: AgentBackendInstallationDto {
                package_name: def.as_ref().map(|d| d.base_command.clone()),
                installed,
                installed_version: None,
                latest_version: None,
                install_command: def.and_then(|d| d.install_command),
                update_command: None,
                busy: false,
                last_error: None,
            },
        }
    }

    fn negotiated_caps(&self, agent_id: Option<&str>) -> AgentProviderCapabilitiesDto {
        let id = agent_id
            .map(str::to_string)
            .or_else(|| self.bound_agent.clone())
            .unwrap_or_else(|| "acp".into());
        self.inner
            .caps_by_agent
            .try_lock()
            .ok()
            .and_then(|g| g.get(&id).cloned())
            .unwrap_or_else(|| {
                let mut caps = AgentProviderCapabilitiesDto::conversational();
                adapter_for(&id).patch_capabilities(&mut caps, &NegotiatedCaps::default());
                caps
            })
    }

    fn toolbox(&self, agent_id: Option<&str>) -> Vec<ToolboxItemDto> {
        toolbox_from_capabilities(&self.negotiated_caps(agent_id))
    }

    async fn start(&self) -> Result<()> {
        *self.started_at.lock().await = Some(now_rfc3339());
        Ok(())
    }

    async fn list_models(&self, agent_id: Option<&str>) -> Result<Vec<ModelOptionDto>> {
        Ok(vec![ModelOptionDto {
            id: "default".into(),
            model: agent_id
                .or(self.bound_agent.as_deref())
                .unwrap_or("default")
                .into(),
            display_name: "Default".into(),
            description: "Harness default model.".into(),
            is_default: true,
            hidden: false,
            supported_reasoning_efforts: vec![
                ReasoningEffortOptionDto {
                    reasoning_effort: "low".into(),
                    description: "Low".into(),
                },
                ReasoningEffortOptionDto {
                    reasoning_effort: "medium".into(),
                    description: "Medium".into(),
                },
                ReasoningEffortOptionDto {
                    reasoning_effort: "high".into(),
                    description: "High".into(),
                },
            ],
            default_reasoning_effort: Some("medium".into()),
            selection_kind: Some("model".into()),
            acp_agent: None,
        }])
    }

    async fn list_agents(&self) -> Result<Vec<ModelOptionDto>> {
        if self.bound_agent.is_some() {
            return Ok(vec![]);
        }
        Ok(builtin_agents(self.custom_command.as_deref())
            .into_iter()
            .map(|entry| {
                let available = command_available(&entry.server_command)
                    || command_available(&entry.base_command);
                ModelOptionDto {
                    id: entry.id.clone(),
                    model: entry.id.clone(),
                    display_name: entry.display_name.clone(),
                    description: entry.description.clone(),
                    is_default: entry.id == "codex" || entry.id == "grok",
                    hidden: false,
                    supported_reasoning_efforts: vec![],
                    default_reasoning_effort: None,
                    selection_kind: Some("agent".into()),
                    acp_agent: Some(json!({
                        "id": entry.id,
                        "displayName": entry.display_name,
                        "availability": if available { "ready" } else { "missing" },
                        "transport": entry.transport,
                        "installCommand": entry.install_command,
                    })),
                }
            })
            .collect())
    }

    async fn capabilities(&self, agent_id: Option<&str>) -> Result<AgentCapabilitySnapshotDto> {
        let id = agent_id
            .map(str::to_string)
            .or_else(|| self.bound_agent.clone())
            .unwrap_or_else(|| "acp".into());
        let installed = self
            .agent_def(Some(&id))
            .ok()
            .map(|d| command_available(&d.server_command) || command_available(&d.base_command))
            .unwrap_or(false);
        let availability = if installed {
            "ready"
        } else {
            "adapter_missing"
        };
        let effective = if installed {
            Some(self.caps_for(Some(&id)).await)
        } else {
            None
        };
        Ok(AgentCapabilitySnapshotDto {
            provider: self.provider,
            agent_id: id,
            availability: availability.into(),
            negotiated: None,
            effective_capabilities: effective,
        })
    }

    async fn start_session(&self, input: StartSessionInput) -> Result<StartSessionResult> {
        let def = self.agent_def(input.agent_id.as_deref())?;
        let (scoped, mut live) = self
            .spawn_session(&def, &input.cwd, input.approval_mode == "yolo", None)
            .await?;
        if !input.model.is_empty() && input.model != "default" {
            let _ = live
                .process
                .notify(
                    "session/set_config_option",
                    json!({ "sessionId": live.session_id, "configId": "model", "value": input.model }),
                )
                .await;
            live.model = Some(input.model.clone());
        }
        if let Some(effort) = &input.reasoning_effort {
            let _ = live
                .process
                .notify(
                    "session/set_config_option",
                    json!({ "sessionId": live.session_id, "configId": "thought-level", "value": effort }),
                )
                .await;
            live.reasoning_effort = Some(effort.clone());
        }
        let model = input.model.clone();
        let effort = input.reasoning_effort.clone();
        self.inner
            .sessions
            .lock()
            .await
            .insert(scoped.clone(), live);
        Ok(StartSessionResult {
            provider_session_id: scoped,
            model: Some(model),
            reasoning_effort: effort,
        })
    }

    async fn resume_session(
        &self,
        session_id: &str,
        cwd: Option<&str>,
    ) -> Result<StartSessionResult> {
        if self.inner.sessions.lock().await.contains_key(session_id) {
            return Ok(StartSessionResult {
                provider_session_id: session_id.into(),
                model: None,
                reasoning_effort: None,
            });
        }
        let (agent_id, raw) = session_id
            .split_once("::")
            .ok_or_else(|| anyhow!("malformed ACP session id"))?;
        let def = self.agent_def(Some(agent_id))?;
        let cwd = cwd
            .map(str::to_string)
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| ".".into());
        let (scoped, live) = self.spawn_session(&def, &cwd, true, Some(raw)).await?;
        self.inner
            .sessions
            .lock()
            .await
            .insert(scoped.clone(), live);
        Ok(StartSessionResult {
            provider_session_id: scoped,
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
        let (process, session_id, cwd, image_capable) = {
            let mut sessions = self.inner.sessions.lock().await;
            let live = sessions
                .get_mut(&input.provider_session_id)
                .ok_or_else(|| anyhow!("ACP session is not running"))?;
            live.active = Some(ActiveTurn {
                thread_id: input.thread_id.clone(),
                turn_id: input.turn_id.clone(),
                bus: bus.clone(),
            });
            (
                live.process.clone(),
                live.session_id.clone(),
                live.cwd.clone(),
                live.negotiated.image,
            )
        };
        let prompt_blocks = build_prompt_blocks(&input.prompt, &cwd, image_capable, &input.images)?;
        let mut updates = self.inner.updates.subscribe();
        let prompt_rpc = process.request(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": prompt_blocks
            }),
        );
        let mut mapper = TurnMapper::new(&input.turn_id);
        if !input.hidden {
            bus.emit(ThreadEventEnvelope {
                event_type: "thread.turn.started".into(),
                thread_id: input.thread_id.clone(),
                timestamp: now_rfc3339(),
                payload: json!({ "turnId": input.turn_id }),
            });
        }
        tokio::pin!(prompt_rpc);
        let mut prompt_done = false;
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    let _ = process.notify("session/cancel", json!({ "sessionId": session_id })).await;
                    break;
                }
                result = &mut prompt_rpc, if !prompt_done => {
                    prompt_done = true;
                    if result.is_err() && mapper_empty(&mapper) {
                        break;
                    }
                }
                Ok(update) = updates.recv() => {
                    if let Some(sid) = update.get("sessionId").and_then(Value::as_str) {
                        if sid != session_id {
                            continue;
                        }
                    }
                    let mapped = mapper.apply(&update);
                    if let Some(goal) = mapped.goal {
                        if let Some(live) = self.inner.sessions.lock().await.get_mut(&input.provider_session_id) {
                            live.goal = goal;
                        }
                    }
                    if !input.hidden {
                        for (item_id, delta) in mapped.deltas {
                            bus.emit(ThreadEventEnvelope {
                                event_type: "thread.output.delta".into(),
                                thread_id: input.thread_id.clone(),
                                timestamp: now_rfc3339(),
                                payload: json!({
                                    "turnId": input.turn_id,
                                    "itemId": item_id,
                                    "delta": delta
                                }),
                            });
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(80)) => {
                    if prompt_done {
                        tokio::select! {
                            Ok(update) = updates.recv() => {
                                let _ = mapper.apply(&update);
                            }
                            _ = tokio::time::sleep(Duration::from_millis(400)) => { break; }
                        }
                    }
                }
            }
            if process.exited().await.unwrap_or(false) {
                break;
            }
        }
        if let Some(live) = self
            .inner
            .sessions
            .lock()
            .await
            .get_mut(&input.provider_session_id)
        {
            live.active = None;
        }
        let interrupted = cancel.is_cancelled();
        let items = mapper.finish(interrupted);
        if !input.hidden {
            for item in &items {
                bus.emit(ThreadEventEnvelope {
                    event_type: "thread.item.completed".into(),
                    thread_id: input.thread_id.clone(),
                    timestamp: now_rfc3339(),
                    payload: json!({ "turnId": input.turn_id, "item": item }),
                });
            }
            bus.emit(ThreadEventEnvelope {
                event_type: "thread.turn.completed".into(),
                thread_id: input.thread_id,
                timestamp: now_rfc3339(),
                payload: json!({
                    "turnId": input.turn_id,
                    "status": if interrupted { "interrupted" } else { "completed" },
                    "error": null
                }),
            });
        }
        Ok(items)
    }

    async fn interrupt(&self, session_id: &str, _turn_id: &str) -> Result<()> {
        if let Some(live) = self.inner.sessions.lock().await.get(session_id) {
            live.process
                .notify("session/cancel", json!({ "sessionId": live.session_id }))
                .await?;
        }
        Ok(())
    }

    async fn respond_permission(&self, request_id: &str, allow: bool) -> Result<()> {
        if let Some(tx) = self
            .inner
            .pending_permissions
            .lock()
            .await
            .remove(request_id)
        {
            let _ = tx.send(allow);
        }
        for list in self.inner.pending_dtos.lock().await.values_mut() {
            list.retain(|item| item.id != request_id);
        }
        Ok(())
    }

    async fn pending_requests(&self, thread_id: &str) -> Vec<ThreadActionRequestDto> {
        self.inner
            .pending_dtos
            .lock()
            .await
            .get(thread_id)
            .cloned()
            .unwrap_or_default()
    }

    async fn compact_session(
        &self,
        session_id: &str,
        thread_id: &str,
        bus: EventBus,
    ) -> Result<()> {
        let agent_id = session_id.split("::").next().unwrap_or("codex");
        let adapter = adapter_for(agent_id);
        let Some(prompt) = adapter.compact_prompt() else {
            bail!("this harness does not implement compact");
        };
        let cancel = CancellationToken::new();
        let _items = self
            .start_turn(
                StartTurnInput {
                    provider_session_id: session_id.into(),
                    prompt: prompt.into(),
                    model: None,
                    reasoning_effort: None,
                    thread_id: thread_id.into(),
                    turn_id: format!("compact-{}", Uuid::new_v4()),
                    hidden: true,
                    images: Vec::new(),
                },
                bus,
                cancel,
            )
            .await?;
        Ok(())
    }

    async fn fork_session(&self, session_id: &str) -> Result<StartSessionResult> {
        let (process, raw_session, cwd, yolo, negotiated, adapter_id, goal, model, effort) = {
            let sessions = self.inner.sessions.lock().await;
            let live = sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("ACP session is not running"))?;
            if !live.negotiated.fork {
                bail!("this harness does not support session/fork");
            }
            (
                live.process.clone(),
                live.session_id.clone(),
                live.cwd.clone(),
                live.yolo,
                live.negotiated.clone(),
                live.adapter_id.clone(),
                live.goal.clone(),
                live.model.clone(),
                live.reasoning_effort.clone(),
            )
        };
        let response = process
            .request(
                "session/fork",
                json!({
                    "sessionId": raw_session,
                    "cwd": cwd,
                    "mcpServers": []
                }),
            )
            .await?;
        let new_id = response
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("fork did not return sessionId"))?
            .to_string();
        let scoped = Self::scoped_id(&adapter_id, &new_id);
        self.inner.sessions.lock().await.insert(
            scoped.clone(),
            LiveSession {
                process,
                session_id: new_id,
                cwd,
                yolo,
                negotiated,
                adapter_id,
                goal,
                model: model.clone(),
                reasoning_effort: effort.clone(),
                active: None,
            },
        );
        Ok(StartSessionResult {
            provider_session_id: scoped,
            model,
            reasoning_effort: effort,
        })
    }

    async fn send_input(&self, session_id: &str, _turn_id: &str, prompt: &str) -> Result<()> {
        let sessions = self.inner.sessions.lock().await;
        let live = sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("ACP session is not running"))?;
        if !live.negotiated.steer {
            bail!("this harness does not support steering");
        }
        let params = json!({
            "sessionId": live.session_id,
            "prompt": prompt
        });
        if live
            .process
            .notify("_session/steering", params.clone())
            .await
            .is_err()
        {
            live.process
                .notify(
                    "session/prompt",
                    json!({
                        "sessionId": live.session_id,
                        "prompt": [{ "type": "text", "text": prompt }]
                    }),
                )
                .await?;
        }
        Ok(())
    }

    async fn get_goal(&self, session_id: &str) -> Result<Option<GoalState>> {
        Ok(self
            .inner
            .sessions
            .lock()
            .await
            .get(session_id)
            .and_then(|s| s.goal.clone()))
    }

    async fn set_goal(
        &self,
        session_id: &str,
        objective: Option<String>,
        status: Option<String>,
    ) -> Result<Option<GoalState>> {
        let mut sessions = self.inner.sessions.lock().await;
        let live = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("ACP session is not running"))?;
        if !live.negotiated.goals {
            bail!("this harness does not support goals");
        }
        let method = live
            .negotiated
            .goal_method
            .clone()
            .unwrap_or_else(|| "session/set_goal".into());
        let action = if objective
            .as_ref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        {
            "set"
        } else if status.as_deref() == Some("paused") {
            "pause"
        } else if status.as_deref() == Some("active") {
            "resume"
        } else {
            "clear"
        };
        live.process
            .request(
                &method,
                json!({
                    "sessionId": live.session_id,
                    "action": action,
                    "objective": objective
                }),
            )
            .await?;
        if action == "set" {
            live.goal = Some(GoalState {
                objective: objective.unwrap_or_default(),
                status: "active".into(),
                tokens_used: 0,
                time_used_seconds: 0,
            });
        } else if action == "clear" {
            live.goal = None;
        } else if let Some(goal) = live.goal.as_mut() {
            goal.status = if action == "pause" {
                "paused"
            } else {
                "active"
            }
            .into();
        }
        Ok(live.goal.clone())
    }

    async fn install(&self, agent_id: Option<&str>) -> Result<AgentBackendDto> {
        let def = self.agent_def(agent_id)?;
        if let Some(cmd) = def.install_command.clone() {
            let mut parts = cmd.split_whitespace();
            let exe = parts.next().unwrap();
            let args: Vec<&str> = parts.collect();
            let status = tokio::process::Command::new(exe)
                .args(args)
                .status()
                .await?;
            if !status.success() {
                bail!("install failed for {}", def.display_name);
            }
        }
        Ok(self.descriptor())
    }
}

fn spawn_mux(
    inner: Arc<Inner>,
    process: Arc<AcpProcess>,
    mut updates: mpsc::UnboundedReceiver<Value>,
    mut requests: mpsc::UnboundedReceiver<(i64, String, Value)>,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(update) = updates.recv() => {
                    let _ = inner.updates.send(update);
                }
                Some((req_id, method, params)) = requests.recv() => {
                    if let Err(err) = handle_agent_request(&inner, &process, req_id, &method, params).await {
                        tracing::warn!(error = %err, "ACP client request failed");
                    }
                }
                else => break,
            }
        }
    });
}

async fn handle_agent_request(
    inner: &Inner,
    process: &AcpProcess,
    req_id: i64,
    method: &str,
    params: Value,
) -> Result<()> {
    let raw_session = params
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let (cwd, yolo, active) = {
        let sessions = inner.sessions.lock().await;
        let live = sessions.values().find(|s| s.session_id == raw_session);
        match live {
            Some(live) => (
                live.cwd.clone(),
                live.yolo,
                live.active
                    .as_ref()
                    .map(|a| (a.thread_id.clone(), a.turn_id.clone(), a.bus.clone())),
            ),
            None => (PathBuf::from("."), true, None),
        }
    };
    match method {
        "session/request_permission" => {
            if yolo {
                process
                    .respond(
                        req_id,
                        json!({ "outcome": { "outcome": "selected", "optionId": "allow-once" } }),
                    )
                    .await?;
                return Ok(());
            }
            let request_id = format!("perm-{req_id}");
            let (tx, rx) = tokio::sync::oneshot::channel();
            inner
                .pending_permissions
                .lock()
                .await
                .insert(request_id.clone(), tx);
            if let Some((thread_id, turn_id, bus)) = &active {
                let dto = ThreadActionRequestDto {
                    id: request_id.clone(),
                    kind: "requestUserInput".into(),
                    title: "Permission required".into(),
                    description: Some(params.to_string()),
                    turn_id: Some(turn_id.clone()),
                    item_id: None,
                    created_at: now_rfc3339(),
                    questions: vec![],
                };
                inner
                    .pending_dtos
                    .lock()
                    .await
                    .entry(thread_id.clone())
                    .or_default()
                    .push(dto.clone());
                bus.emit(ThreadEventEnvelope {
                    event_type: "thread.request.created".into(),
                    thread_id: thread_id.clone(),
                    timestamp: now_rfc3339(),
                    payload: json!({ "request": dto }),
                });
            }
            let allow = tokio::time::timeout(Duration::from_secs(300), rx)
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or(false);
            let option = if allow { "allow-once" } else { "reject" };
            process
                .respond(
                    req_id,
                    json!({ "outcome": { "outcome": "selected", "optionId": option } }),
                )
                .await?;
        }
        "fs/read_text_file" => {
            let path = params.get("path").and_then(Value::as_str).unwrap_or("");
            let content = tokio::fs::read_to_string(cwd.join(path))
                .await
                .unwrap_or_default();
            process
                .respond(req_id, json!({ "content": content }))
                .await?;
        }
        "fs/write_text_file" => {
            let path = params.get("path").and_then(Value::as_str).unwrap_or("");
            let content = params.get("content").and_then(Value::as_str).unwrap_or("");
            let _ = write_file(&cwd, path, content);
            process.respond(req_id, json!({})).await?;
        }
        "terminal/create" => {
            let command = params
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("sh");
            let args = params
                .get("args")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let term_cwd = params
                .get("cwd")
                .and_then(Value::as_str)
                .map(PathBuf::from)
                .unwrap_or(cwd);
            let id = inner.terminals.create(command, &args, term_cwd).await?;
            process.respond(req_id, json!({ "terminalId": id })).await?;
        }
        "terminal/output" => {
            let id = params
                .get("terminalId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let output = inner
                .terminals
                .output(id)
                .unwrap_or(json!({ "output": "" }));
            process.respond(req_id, output).await?;
        }
        "terminal/wait_for_exit" => {
            process
                .respond(req_id, json!({ "exitCode": 0, "signal": null }))
                .await?;
        }
        "terminal/kill" => {
            let id = params
                .get("terminalId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let _ = inner.terminals.kill(id);
            process.respond(req_id, json!({})).await?;
        }
        "terminal/release" => {
            let id = params
                .get("terminalId")
                .and_then(Value::as_str)
                .unwrap_or("");
            inner.terminals.release(id);
            process.respond(req_id, json!({})).await?;
        }
        _ => {
            process
                .respond(req_id, json!({ "error": "unsupported" }))
                .await
                .ok();
        }
    }
    Ok(())
}

fn apply_config_option_caps(caps: &mut AgentProviderCapabilitiesDto, options: &Value) {
    let Some(arr) = options.as_array() else {
        return;
    };
    if arr.iter().any(|opt| {
        matches!(
            opt.get("id").and_then(Value::as_str),
            Some("fast-mode" | "fast")
        )
    }) {
        caps.controls.performance_mode = true;
    }
}

fn mapper_empty(mapper: &TurnMapper) -> bool {
    let _ = mapper;
    false
}
