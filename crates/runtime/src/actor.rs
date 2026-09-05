use std::sync::{Arc, RwLock};

use anyhow::Result;
use async_trait::async_trait;
use remote_codex_protocol::{
    AgentBackendDto, AgentCapabilitySnapshotDto, AgentProviderCapabilitiesDto, ModelOptionDto,
    Provider, ThreadActionRequestDto, ThreadEventEnvelope, ThreadHistoryItemDto, ThreadTurnDto,
    ToolboxItemDto,
};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<ThreadEventEnvelope>,
    persister: Arc<RwLock<Option<Arc<EventPersister>>>>,
}

type EventPersister = dyn Fn(&mut ThreadEventEnvelope) -> Result<()> + Send + Sync;

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(2048);
        Self {
            tx,
            persister: Arc::new(RwLock::new(None)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ThreadEventEnvelope> {
        self.tx.subscribe()
    }

    pub fn emit(&self, mut event: ThreadEventEnvelope) {
        // Persistence must finish before a websocket can expose the update. The
        // callback may emit a derived event (token usage), so release the lock first.
        let persister = self.persister.read().unwrap().clone();
        if let Some(persist) = persister {
            if let Err(error) = persist(&mut event) {
                tracing::error!(
                    %error,
                    event_type = %event.event_type,
                    thread_id = %event.thread_id,
                    "failed to persist runtime event before broadcast"
                );
            }
        }
        let _ = self.tx.send(event);
    }

    pub(crate) fn set_persister(&self, persister: Arc<EventPersister>) {
        *self.persister.write().unwrap() = Some(persister);
    }
}

#[derive(Debug, Clone)]
pub struct StartSessionInput {
    pub cwd: String,
    pub agent_id: Option<String>,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub approval_mode: String,
    pub sandbox_mode: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StartSessionResult {
    pub provider_session_id: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StartTurnInput {
    pub provider_session_id: String,
    pub prompt: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub sandbox_mode: Option<String>,
    pub collaboration_mode: Option<String>,
    pub approval_mode: Option<String>,
    pub performance_mode: Option<bool>,
    pub thread_id: String,
    pub turn_id: String,
    pub hidden: bool,
    pub images: Vec<PromptImage>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionSettings {
    pub model: Option<String>,
    pub effort: Option<String>,
    pub sandbox_mode: Option<String>,
    pub collaboration_mode: Option<String>,
    pub approval_mode: Option<String>,
    pub performance_mode: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct PromptImage {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Default)]
pub struct GoalState {
    pub objective: String,
    pub status: String,
    pub tokens_used: u32,
    pub time_used_seconds: u32,
}

#[derive(Debug, Clone, Default)]
pub struct ImportSessionMeta {
    pub session_id: String,
    pub agent_id: String,
    pub cwd: String,
    pub title: String,
    pub preview: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub model: Option<String>,
    pub turns: Vec<ThreadTurnDto>,
}

#[async_trait]
pub trait AgentRuntime: Send + Sync {
    fn provider(&self) -> Provider;
    fn descriptor(&self) -> AgentBackendDto;
    async fn start(&self) -> Result<()>;
    async fn list_models(
        &self,
        agent_id: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<Vec<ModelOptionDto>>;
    async fn list_agents(&self) -> Result<Vec<ModelOptionDto>>;
    async fn capabilities(&self, agent_id: Option<&str>) -> Result<AgentCapabilitySnapshotDto>;
    fn negotiated_caps(&self, _agent_id: Option<&str>) -> AgentProviderCapabilitiesDto {
        AgentProviderCapabilitiesDto::conversational()
    }
    async fn start_session(&self, input: StartSessionInput) -> Result<StartSessionResult>;
    async fn resume_session(
        &self,
        session_id: &str,
        cwd: Option<&str>,
    ) -> Result<StartSessionResult>;
    async fn start_turn(
        &self,
        input: StartTurnInput,
        bus: EventBus,
        cancel: CancellationToken,
    ) -> Result<Vec<ThreadHistoryItemDto>>;
    async fn interrupt(&self, session_id: &str, turn_id: &str) -> Result<()>;
    async fn respond_permission(
        &self,
        request_id: &str,
        allow: bool,
        answer: Option<&str>,
    ) -> Result<()>;
    async fn pending_requests(&self, _thread_id: &str) -> Vec<ThreadActionRequestDto> {
        Vec::new()
    }
    async fn compact_session(
        &self,
        _session_id: &str,
        _thread_id: &str,
        _bus: EventBus,
    ) -> Result<()> {
        anyhow::bail!("compact is not supported by this harness");
    }
    async fn fork_session(&self, _session_id: &str) -> Result<StartSessionResult> {
        anyhow::bail!("fork is not supported by this harness");
    }
    async fn send_input(&self, _session_id: &str, _turn_id: &str, _prompt: &str) -> Result<()> {
        anyhow::bail!("steering is not supported by this harness");
    }
    async fn get_goal(&self, _session_id: &str) -> Result<Option<GoalState>> {
        Ok(None)
    }
    async fn set_goal(
        &self,
        _session_id: &str,
        _objective: Option<String>,
        _status: Option<String>,
    ) -> Result<Option<GoalState>> {
        anyhow::bail!("goals are not supported by this harness");
    }
    fn toolbox(&self, agent_id: Option<&str>) -> Vec<ToolboxItemDto> {
        remote_codex_protocol::toolbox_from_capabilities(&self.negotiated_caps(agent_id))
    }
    async fn apply_session_settings(
        &self,
        _session_id: &str,
        _settings: SessionSettings,
    ) -> Result<()> {
        Ok(())
    }
    async fn install(&self, _agent_id: Option<&str>) -> Result<AgentBackendDto> {
        Ok(self.descriptor())
    }
    async fn list_import_sessions(
        &self,
        _agent_id: Option<&str>,
    ) -> Result<Vec<ImportSessionMeta>> {
        Ok(Vec::new())
    }
    async fn resolve_import_session(
        &self,
        agent_id: Option<&str>,
        session_id: &str,
    ) -> Result<Option<ImportSessionMeta>> {
        Ok(self
            .list_import_sessions(agent_id)
            .await?
            .into_iter()
            .find(|session| crate::import_id::session_ids_match(&session.session_id, session_id)))
    }
    fn session_loaded(&self, _session_id: &str) -> bool {
        false
    }
}

pub type SharedRuntime = Arc<dyn AgentRuntime>;
