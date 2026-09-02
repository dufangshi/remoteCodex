use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use remote_codex_protocol::{
    AgentBackendDto, AgentCapabilitySnapshotDto, AgentProviderCapabilitiesDto, ModelOptionDto,
    Provider, ThreadActionRequestDto, ThreadEventEnvelope, ThreadHistoryItemDto, ToolboxItemDto,
};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<ThreadEventEnvelope>,
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ThreadEventEnvelope> {
        self.tx.subscribe()
    }

    pub fn emit(&self, event: ThreadEventEnvelope) {
        let _ = self.tx.send(event);
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
    pub thread_id: String,
    pub turn_id: String,
    pub hidden: bool,
    pub images: Vec<PromptImage>,
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
    async fn respond_permission(&self, request_id: &str, allow: bool) -> Result<()>;
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
        _model: Option<&str>,
        _effort: Option<&str>,
    ) -> Result<()> {
        Ok(())
    }
    async fn install(&self, _agent_id: Option<&str>) -> Result<AgentBackendDto> {
        Ok(self.descriptor())
    }
}

pub type SharedRuntime = Arc<dyn AgentRuntime>;
