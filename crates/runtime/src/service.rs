use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, bail, Result};
use base64::Engine;
use remote_codex_protocol::{
    now_rfc3339, truncate_title, AgentBackendDto, AgentCapabilitySnapshotDto, CreateThreadInput,
    CreateWorkspaceInput, ImportThreadCandidateDto, ImportThreadInput, ModelOptionDto, Provider,
    SendThreadPromptInput, ThreadDetailDto, ThreadDto, ThreadHistoryItemDto, ThreadPendingSteerDto,
    ThreadTurnDto, ThreadWorkspaceFilePreviewDto, ThreadWorkspaceTreeNodeDto,
    UpdateWorkspaceSettingsInput, WorkspaceDto, WorkspaceSettingsDto,
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::actor::{
    EventBus, ImportSessionMeta, PromptImage, SessionSettings, SharedRuntime, StartSessionInput,
    StartTurnInput,
};
use crate::config::RuntimeConfig;
use crate::db::Database;
use crate::files;
use crate::history::summarize_completed_turn;
use crate::import_id::{
    bind_import_target, parse_session_ref, scoped_session_id, session_ids_match,
};
use crate::local_sessions::{find_local_session, list_local_sessions, LocalSessionHomes};

struct LiveTurn {
    cancel: CancellationToken,
}

pub struct Supervisor {
    pub config: RuntimeConfig,
    pub db: Database,
    pub bus: EventBus,
    runtimes: HashMap<Provider, SharedRuntime>,
    live: Mutex<HashMap<String, LiveTurn>>,
    local_session_homes: LocalSessionHomes,
}

impl Supervisor {
    pub fn new(config: RuntimeConfig, db: Database, runtimes: Vec<SharedRuntime>) -> Self {
        let map = runtimes
            .into_iter()
            .map(|runtime| (runtime.provider(), runtime))
            .collect();
        Self {
            config,
            db,
            bus: EventBus::new(),
            runtimes: map,
            live: Mutex::new(HashMap::new()),
            local_session_homes: LocalSessionHomes::from_env(),
        }
    }

    pub fn with_local_session_homes(mut self, homes: LocalSessionHomes) -> Self {
        self.local_session_homes = homes;
        self
    }

    pub fn spawn_live_item_persister(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tokio::spawn(async move {
            let mut events = this.bus.subscribe();
            loop {
                match events.recv().await {
                    Ok(event)
                        if event.event_type == "thread.item.started"
                            || event.event_type == "thread.item.completed" =>
                    {
                        let Some(turn_id) = event.payload.get("turnId").and_then(Value::as_str)
                        else {
                            continue;
                        };
                        let Some(item) = event.payload.get("item").cloned() else {
                            continue;
                        };
                        let Ok(item) = serde_json::from_value::<ThreadHistoryItemDto>(item) else {
                            continue;
                        };
                        if let Err(err) = this.upsert_history_item(&event.thread_id, turn_id, &item)
                        {
                            tracing::warn!(error = %err, "failed to persist live history item");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    _ => {}
                }
            }
        });
    }

    fn upsert_history_item(
        &self,
        thread_id: &str,
        turn_id: &str,
        item: &ThreadHistoryItemDto,
    ) -> Result<()> {
        let now = item.created_at.clone().unwrap_or_else(now_rfc3339);
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?6)
                 ON CONFLICT(thread_id, turn_id, item_id) DO UPDATE SET
                    item_json=excluded.item_json,
                    updated_at=excluded.updated_at",
                params![
                    Uuid::new_v4().to_string(),
                    thread_id,
                    turn_id,
                    item.id,
                    serde_json::to_string(item)?,
                    now
                ],
            )?;
            Ok(())
        })
    }

    pub fn runtime(&self, provider: Provider) -> Result<&SharedRuntime> {
        self.runtimes
            .get(&provider)
            .ok_or_else(|| anyhow!("{} is not enabled", provider.as_str()))
    }

    pub fn backends(&self) -> Vec<AgentBackendDto> {
        let mut list: Vec<_> = self.runtimes.values().map(|r| r.descriptor()).collect();
        list.sort_by_key(|b| match b.provider {
            Provider::Codex => 0,
            Provider::Claude => 1,
            Provider::Opencode => 2,
            Provider::Acp => 3,
        });
        list
    }

    pub fn default_provider(&self) -> Provider {
        self.backends()
            .into_iter()
            .find(|b| b.enabled && b.capabilities.sessions.resume && b.capabilities.turns.start)
            .map(|b| b.provider)
            .unwrap_or(Provider::Codex)
    }

    pub fn workspace_settings(&self) -> WorkspaceSettingsDto {
        let stored = self
            .db
            .get_kv("workspace_settings")
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<WorkspaceSettingsDto>(&raw).ok());
        let workspace_root = self.config.workspace_root.to_string_lossy().into_owned();
        WorkspaceSettingsDto {
            workspace_root: workspace_root.clone(),
            dev_home: stored
                .as_ref()
                .map(|settings| settings.dev_home.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(workspace_root),
            default_backend: stored
                .as_ref()
                .map(|settings| settings.default_backend)
                .unwrap_or_else(|| self.default_provider()),
        }
    }

    pub fn update_workspace_settings(
        &self,
        input: UpdateWorkspaceSettingsInput,
    ) -> Result<WorkspaceSettingsDto> {
        let mut current = self.workspace_settings();
        if let Some(dev_home) = input.dev_home.filter(|value| !value.trim().is_empty()) {
            let path = PathBuf::from(dev_home.trim());
            if !path.is_dir() {
                bail!("dev home must be an existing directory");
            }
            current.dev_home = path.canonicalize()?.to_string_lossy().into();
        }
        if let Some(backend) = input.default_backend {
            current.default_backend = backend;
        }
        current.workspace_root = self.config.workspace_root.to_string_lossy().into();
        self.db
            .set_kv("workspace_settings", &serde_json::to_string(&current)?)?;
        Ok(current)
    }

    pub fn list_workspaces(&self) -> Result<Vec<WorkspaceDto>> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, host_id, label, abs_path, is_favorite, created_at, last_opened_at FROM workspaces ORDER BY created_at DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(WorkspaceDto {
                    id: row.get(0)?,
                    host_id: row.get(1)?,
                    label: row.get(2)?,
                    abs_path: row.get(3)?,
                    is_favorite: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                    last_opened_at: row.get(6)?,
                })
            })?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        })
    }

    pub fn get_workspace(&self, id: &str) -> Result<WorkspaceDto> {
        self.list_workspaces()?
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| anyhow!("workspace not found"))
    }

    pub fn create_workspace(&self, input: CreateWorkspaceInput) -> Result<WorkspaceDto> {
        std::fs::create_dir_all(&self.config.workspace_root)?;
        let settings = self.workspace_settings();
        let dev_home = PathBuf::from(&settings.dev_home);
        std::fs::create_dir_all(&dev_home)?;
        let abs_path = if let Some(git) = input.git_url.filter(|s| !s.is_empty()) {
            let dest = dev_home.join(infer_git_repo_name(&git));
            if dest.exists() {
                bail!("The Git clone target directory already exists.");
            }
            let status = std::process::Command::new("git")
                .args(["clone", "--depth", "1", &git, &dest.to_string_lossy()])
                .status()?;
            if !status.success() {
                bail!("git clone failed");
            }
            dest
        } else {
            let requested = input
                .abs_path
                .ok_or_else(|| anyhow!("absPath is required"))?;
            let requested = requested.trim();
            if requested.is_empty() {
                bail!("absPath is required");
            }
            let target = if is_workspace_name(requested) {
                dev_home.join(requested)
            } else {
                PathBuf::from(requested)
            };
            if !target.exists() {
                let parent = target.parent().filter(|path| !path.as_os_str().is_empty());
                if let Some(parent) = parent {
                    if !parent.exists() {
                        bail!("The parent directory for the workspace path does not exist.");
                    }
                }
                std::fs::create_dir_all(&target)?;
            }
            if !target.is_dir() {
                bail!("workspace path is not a directory");
            }
            target
        };
        let abs_path = abs_path.canonicalize()?;
        let already = self
            .list_workspaces()?
            .into_iter()
            .any(|workspace| PathBuf::from(&workspace.abs_path) == abs_path);
        if already {
            bail!("This workspace has already been added.");
        }
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let label = input
            .label
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| {
                abs_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "workspace".into())
            });
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO workspaces(id, host_id, label, abs_path, is_favorite, created_at, last_opened_at)
                 VALUES (?1,?2,?3,?4,0,?5,?5)",
                params![id, self.db.host_id, label, abs_path.to_string_lossy().to_string(), now],
            )?;
            Ok(())
        })?;
        self.get_workspace(&id)
    }

    pub fn update_workspace(&self, id: &str, label: &str) -> Result<WorkspaceDto> {
        self.db.with(|conn| {
            let n = conn.execute(
                "UPDATE workspaces SET label=?1 WHERE id=?2",
                params![label, id],
            )?;
            if n == 0 {
                bail!("workspace not found");
            }
            Ok(())
        })?;
        self.get_workspace(id)
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<WorkspaceDto> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE workspaces SET is_favorite=?1 WHERE id=?2",
                params![favorite as i64, id],
            )?;
            Ok(())
        })?;
        self.get_workspace(id)
    }

    pub fn open_workspace(&self, id: &str) -> Result<WorkspaceDto> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE workspaces SET last_opened_at=?1 WHERE id=?2",
                params![now_rfc3339(), id],
            )?;
            Ok(())
        })?;
        self.get_workspace(id)
    }

    pub fn delete_workspace(&self, id: &str) -> Result<()> {
        self.db.with(|conn| {
            conn.execute("DELETE FROM threads WHERE workspace_id=?1", params![id])?;
            conn.execute("DELETE FROM workspaces WHERE id=?1", params![id])?;
            Ok(())
        })
    }

    pub fn workspace_tree(&self, id: &str, rel: &str) -> Result<Vec<ThreadWorkspaceTreeNodeDto>> {
        let ws = self.get_workspace(id)?;
        files::list_tree(Path::new(&ws.abs_path), rel)
    }

    pub fn workspace_preview(&self, id: &str, rel: &str) -> Result<ThreadWorkspaceFilePreviewDto> {
        let ws = self.get_workspace(id)?;
        files::preview_file(Path::new(&ws.abs_path), rel, 64 * 1024)
    }

    pub fn workspace_write(&self, id: &str, rel: &str, content: &str) -> Result<()> {
        let ws = self.get_workspace(id)?;
        files::write_file(Path::new(&ws.abs_path), rel, content)
    }

    pub fn list_threads(&self, workspace_id: Option<&str>) -> Result<Vec<ThreadDto>> {
        let mut rows = self.db.with(|conn| {
            let mut sql = String::from(
                "SELECT id, workspace_id, provider, agent_id, provider_session_id, source, title, model,
                        reasoning_effort, fast_mode, collaboration_mode, approval_mode, sandbox_mode, status,
                        summary_text, last_error, created_at, updated_at, last_turn_started_at, last_turn_completed_at,
                        is_pinned FROM threads",
            );
            if workspace_id.is_some() {
                sql.push_str(" WHERE workspace_id=?1");
            }
            sql.push_str(" ORDER BY updated_at DESC");
            let mut stmt = conn.prepare(&sql)?;
            let map_row = |row: &rusqlite::Row| -> rusqlite::Result<ThreadDto> {
                Ok(thread_from_row(row))
            };
            let rows = if let Some(ws) = workspace_id {
                stmt.query_map(params![ws], map_row)?
                    .filter_map(|r| r.ok())
                    .collect()
            } else {
                stmt.query_map([], map_row)?.filter_map(|r| r.ok()).collect()
            };
            Ok(rows)
        })?;
        for thread in &mut rows {
            self.apply_loaded_flag(thread);
        }
        Ok(rows)
    }

    pub fn get_thread(&self, id: &str) -> Result<ThreadDto> {
        let mut thread = self
            .list_threads(None)?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| anyhow!("thread not found"))?;
        thread.active_turn_id = self.active_turn_id(id)?;
        if thread.active_turn_id.is_some() {
            thread.status = "running".into();
        }
        Ok(thread)
    }

    fn active_turn_id(&self, thread_id: &str) -> Result<Option<String>> {
        self.db.with(|conn| {
            let id: Option<String> = conn
                .query_row(
                    "SELECT id FROM thread_turns WHERE thread_id=?1 AND status='inProgress' ORDER BY ordinal DESC LIMIT 1",
                    params![thread_id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(id)
        })
    }

    pub async fn create_thread(&self, input: CreateThreadInput) -> Result<ThreadDto> {
        let workspace = self.get_workspace(&input.workspace_id)?;
        let provider = input.provider.unwrap_or_else(|| self.default_provider());
        let runtime = self.runtime(provider)?;
        let started = runtime
            .start_session(StartSessionInput {
                cwd: workspace.abs_path.clone(),
                agent_id: input.agent_id.clone(),
                model: input.model.clone(),
                reasoning_effort: input.reasoning_effort.clone(),
                approval_mode: input.approval_mode.clone(),
                sandbox_mode: None,
            })
            .await?;
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let title = input
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "New thread".into());
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO threads(id, workspace_id, provider, agent_id, provider_session_id, source, title, model,
                    reasoning_effort, collaboration_mode, approval_mode, status, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,'supervisor',?6,?7,?8,'default',?9,'idle',?10,?10)",
                params![
                    id,
                    input.workspace_id,
                    provider.as_str(),
                    input.agent_id,
                    started.provider_session_id,
                    title,
                    started.model.clone().unwrap_or(input.model.clone()),
                    started.reasoning_effort.clone(),
                    input.approval_mode,
                    now
                ],
            )?;
            Ok(())
        })?;
        self.get_thread(&id)
    }

    pub async fn list_import_candidates(
        &self,
        provider: Option<Provider>,
        agent_id: Option<&str>,
    ) -> Result<Vec<ImportThreadCandidateDto>> {
        let provider = provider.unwrap_or_else(|| self.default_provider());
        if provider == Provider::Acp
            && agent_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        {
            return Ok(Vec::new());
        }
        let agent = agent_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| crate::import_id::default_agent_for_provider(provider))
            .to_string();
        let mut sessions = list_local_sessions(&self.local_session_homes, &agent);
        if let Ok(runtime) = self.runtime(provider) {
            match runtime.list_import_sessions(Some(&agent)).await {
                Ok(listed) => sessions.extend(listed),
                Err(err) => tracing::warn!(error = %err, "import candidate listing failed"),
            }
        }
        let existing = self.list_threads(None).unwrap_or_default();
        let mut out = Vec::new();
        for session in sessions {
            if session.session_id.trim().is_empty() || !Path::new(&session.cwd).is_absolute() {
                continue;
            }
            if existing.iter().any(|thread| {
                thread
                    .provider_session_id
                    .as_deref()
                    .map(|stored| session_ids_match(stored, &session.session_id))
                    .unwrap_or(false)
            }) {
                continue;
            }
            if out.iter().any(|candidate: &ImportThreadCandidateDto| {
                session_ids_match(&candidate.session_id, &session.session_id)
            }) {
                continue;
            }
            out.push(ImportThreadCandidateDto {
                provider,
                agent_id: Some(session.agent_id.clone()),
                session_id: crate::import_id::raw_session_id(&session.session_id).to_string(),
                cwd: session.cwd,
                title: session.title,
                preview: session.preview,
                created_at: session.created_at,
                updated_at: session.updated_at,
                history_status: "unknown".into(),
            });
        }
        out.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.created_at.cmp(&left.created_at))
        });
        Ok(out)
    }

    pub async fn import_thread(&self, input: ImportThreadInput) -> Result<ThreadDetailDto> {
        let parsed = parse_session_ref(&input.session_id);
        if parsed.raw_id.is_empty() {
            bail!("Session id is required.");
        }
        let selected_provider = input.provider.unwrap_or_else(|| self.default_provider());
        let enabled: Vec<Provider> = self.runtimes.keys().copied().collect();
        let (provider, agent_id) = bind_import_target(
            selected_provider,
            input.agent_id.as_deref(),
            parsed.agent_id.as_deref(),
            &enabled,
        );
        if let Some(existing) = self.find_thread_by_session(&parsed.raw_id)? {
            return self.get_thread_detail(&existing.id, None).await;
        }

        let mut session = find_local_session(&self.local_session_homes, &agent_id, &parsed.raw_id);
        if session.is_none() {
            if let Ok(runtime) = self.runtime(provider) {
                session = runtime
                    .resolve_import_session(Some(&agent_id), &parsed.raw_id)
                    .await?;
            }
        }
        let Some(session) = session else {
            bail!("Session not found on this machine.");
        };
        if !Path::new(&session.cwd).is_absolute() {
            bail!("Imported session path must be absolute.");
        }

        let workspace = self.ensure_workspace_at(&session.cwd)?;
        let source = if agent_id == "codex" {
            "local_codex_import"
        } else {
            "local_provider_import"
        };
        let scoped = scoped_session_id(&agent_id, &parsed.raw_id);
        let now = now_rfc3339();
        let thread_id = Uuid::new_v4().to_string();
        let title = truncate_title(&session.title);
        let summary = session.preview.clone();
        let model = session
            .model
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "default".into());
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO threads(id, workspace_id, provider, agent_id, provider_session_id, source, title, model,
                    reasoning_effort, collaboration_mode, approval_mode, status, summary_text, created_at, updated_at, is_connected)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL,'default','yolo','idle',?9,?10,?10,0)",
                params![
                    thread_id,
                    workspace.id,
                    provider.as_str(),
                    agent_id,
                    scoped,
                    source,
                    title,
                    model,
                    summary,
                    now
                ],
            )?;
            Ok(())
        })?;
        self.persist_imported_turns(&thread_id, &session)?;
        self.get_thread_detail(&thread_id, None).await
    }

    fn find_thread_by_session(&self, session_id: &str) -> Result<Option<ThreadDto>> {
        Ok(self.list_threads(None)?.into_iter().find(|thread| {
            thread
                .provider_session_id
                .as_deref()
                .map(|stored| session_ids_match(stored, session_id))
                .unwrap_or(false)
        }))
    }

    fn ensure_workspace_at(&self, abs_path: &str) -> Result<WorkspaceDto> {
        let path = PathBuf::from(abs_path);
        if !path.is_absolute() {
            bail!("Imported session path must be absolute.");
        }
        let resolved = if path.exists() {
            path.canonicalize()?
        } else {
            path
        };
        if let Some(existing) = self
            .list_workspaces()?
            .into_iter()
            .find(|workspace| PathBuf::from(&workspace.abs_path) == resolved)
        {
            return Ok(existing);
        }
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let label = resolved
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "workspace".into());
        let stored = resolved.to_string_lossy().into_owned();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO workspaces(id, host_id, label, abs_path, is_favorite, created_at, last_opened_at)
                 VALUES (?1,?2,?3,?4,0,?5,?5)",
                params![id, self.db.host_id, label, stored, now],
            )?;
            Ok(())
        })?;
        self.get_workspace(&id)
    }

    fn persist_imported_turns(&self, thread_id: &str, session: &ImportSessionMeta) -> Result<()> {
        if session.turns.is_empty() {
            return Ok(());
        }
        let now = now_rfc3339();
        self.db.with(|conn| {
            for (index, turn) in session.turns.iter().enumerate() {
                let turn_id = if turn.id.trim().is_empty() {
                    format!("imported-{thread_id}-{}", index + 1)
                } else {
                    turn.id.clone()
                };
                conn.execute(
                    "INSERT INTO thread_turns(id, thread_id, status, error, model, reasoning_effort, started_at, ordinal)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        turn_id,
                        thread_id,
                        if turn.status.trim().is_empty() {
                            "completed".to_string()
                        } else {
                            turn.status.clone()
                        },
                        turn.error.clone(),
                        turn.model.clone(),
                        turn.reasoning_effort.clone(),
                        turn.started_at.clone(),
                        (index as i64) + 1
                    ],
                )?;
                for item in &turn.items {
                    conn.execute(
                        "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?6)
                         ON CONFLICT(thread_id, turn_id, item_id) DO UPDATE SET
                            item_json=excluded.item_json,
                            updated_at=excluded.updated_at",
                        params![
                            Uuid::new_v4().to_string(),
                            thread_id,
                            turn_id,
                            item.id,
                            serde_json::to_string(item)?,
                            item.created_at.clone().unwrap_or_else(|| now.clone())
                        ],
                    )?;
                }
            }
            Ok(())
        })
    }

    pub fn ensure_prompt_allowed(&self, thread: &ThreadDto) -> Result<()> {
        if thread.source != "local_codex_import" && thread.source != "local_provider_import" {
            return Ok(());
        }
        let loaded = thread
            .provider_session_id
            .as_deref()
            .and_then(|session| {
                self.runtime(thread.provider)
                    .ok()
                    .map(|runtime| runtime.session_loaded(session))
            })
            .unwrap_or(false);
        if loaded {
            Ok(())
        } else {
            bail!("Resume / Connect this imported session before sending a new prompt.")
        }
    }

    fn apply_loaded_flag(&self, thread: &mut ThreadDto) {
        if thread.source != "local_codex_import" && thread.source != "local_provider_import" {
            return;
        }
        thread.is_loaded = thread
            .provider_session_id
            .as_deref()
            .and_then(|session| {
                self.runtime(thread.provider)
                    .ok()
                    .map(|runtime| runtime.session_loaded(session))
            })
            .unwrap_or(false);
    }

    pub async fn get_thread_detail(&self, id: &str, limit: Option<u32>) -> Result<ThreadDetailDto> {
        self.get_thread_detail_view(id, limit, false).await
    }

    pub async fn get_thread_detail_view(
        &self,
        id: &str,
        limit: Option<u32>,
        summary_only: bool,
    ) -> Result<ThreadDetailDto> {
        let thread = self.get_thread(id)?;
        let workspace = self.get_workspace(&thread.workspace_id)?;
        let mut turns = if summary_only {
            self.load_turn_summaries(id)?
        } else {
            self.load_turns(id)?
        };
        let total = turns.len() as u32;
        if let Some(limit) = limit {
            if turns.len() > limit as usize {
                turns = turns.split_off(turns.len() - limit as usize);
            }
        }
        let pending_steers = self.load_steers(id)?;
        let present = Path::new(&workspace.abs_path).exists();
        let runtime = self.runtime(thread.provider).ok().cloned();
        let pending_requests = if let Some(runtime) = &runtime {
            runtime.pending_requests(id).await
        } else {
            vec![]
        };
        let goal = if summary_only && thread.status != "running" {
            None
        } else if let (Some(runtime), Some(session)) =
            (runtime.as_ref(), thread.provider_session_id.as_deref())
        {
            runtime.get_goal(session).await.ok().flatten().map(|g| {
                json!({
                    "objective": g.objective,
                    "status": g.status,
                    "tokensUsed": g.tokens_used,
                    "timeUsedSeconds": g.time_used_seconds
                })
            })
        } else {
            None
        };
        Ok(ThreadDetailDto {
            thread,
            workspace,
            workspace_path_status: if present { "present" } else { "missing" }.into(),
            turns,
            total_turn_count: Some(total),
            pending_requests,
            pending_steers,
            activity_notes: Some(vec![]),
            goal,
        })
    }

    fn load_turns(&self, thread_id: &str) -> Result<Vec<ThreadTurnDto>> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, status, error, model, reasoning_effort, started_at FROM thread_turns
                 WHERE thread_id=?1 ORDER BY ordinal ASC",
            )?;
            let turns: Vec<(String, String, Option<String>, Option<String>, Option<String>, Option<String>)> = stmt
                .query_map(params![thread_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                })?
                .filter_map(|r| r.ok())
                .collect();
            let mut out = Vec::new();
            for (id, status, error, model, effort, started_at) in turns {
                let mut item_stmt = conn.prepare(
                    "SELECT item_json FROM thread_history_items WHERE thread_id=?1 AND turn_id=?2 ORDER BY created_at ASC, rowid ASC",
                )?;
                let items = item_stmt
                    .query_map(params![thread_id, id], |row| row.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .filter_map(|raw| serde_json::from_str::<ThreadHistoryItemDto>(&raw).ok())
                    .collect();
                out.push(ThreadTurnDto {
                    id,
                    started_at,
                    status,
                    error,
                    model,
                    reasoning_effort: effort,
                    token_usage: None,
                    has_deferred_items: None,
                    deferred_item_count: None,
                    items,
                });
            }
            Ok(out)
        })
    }

    fn load_items_for_turn(
        &self,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Vec<ThreadHistoryItemDto>> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT item_json FROM thread_history_items
                 WHERE thread_id=?1 AND turn_id=?2
                 ORDER BY created_at ASC, rowid ASC",
            )?;
            let items = stmt
                .query_map(params![thread_id, turn_id], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .filter_map(|raw| serde_json::from_str::<ThreadHistoryItemDto>(&raw).ok())
                .collect();
            Ok(items)
        })
    }

    fn load_turn_summaries(&self, thread_id: &str) -> Result<Vec<ThreadTurnDto>> {
        let mut turns = self.load_turns_meta(thread_id)?;
        let counts = self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT turn_id, COUNT(*) FROM thread_history_items WHERE thread_id=?1 GROUP BY turn_id",
            )?;
            let rows: Vec<(String, i64)> = stmt
                .query_map(params![thread_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        })?;
        let count_by_turn: std::collections::HashMap<String, i64> = counts.into_iter().collect();
        let conversation = self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT turn_id, item_json FROM thread_history_items
                 WHERE thread_id=?1
                   AND json_extract(item_json, '$.kind') IN ('userMessage', 'agentMessage')
                 ORDER BY created_at ASC, rowid ASC",
            )?;
            let rows: Vec<(String, String)> = stmt
                .query_map(params![thread_id], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        })?;
        let mut conversation_by_turn: std::collections::HashMap<String, Vec<ThreadHistoryItemDto>> =
            std::collections::HashMap::new();
        for (turn_id, raw) in conversation {
            if let Ok(item) = serde_json::from_str::<ThreadHistoryItemDto>(&raw) {
                conversation_by_turn.entry(turn_id).or_default().push(item);
            }
        }
        for turn in &mut turns {
            if turn.status == "inProgress" {
                turn.items = self.load_items_for_turn(thread_id, &turn.id)?;
                continue;
            }
            let items = conversation_by_turn.remove(&turn.id).unwrap_or_default();
            let summarized = summarize_completed_turn(ThreadTurnDto {
                items,
                ..turn.clone()
            });
            let total = count_by_turn.get(&turn.id).copied().unwrap_or(0) as usize;
            let deferred = total.saturating_sub(summarized.items.len());
            turn.items = summarized.items;
            if deferred > 0 {
                turn.has_deferred_items = Some(true);
                turn.deferred_item_count = Some(deferred as u32);
            }
        }
        Ok(turns)
    }

    fn load_turns_meta(&self, thread_id: &str) -> Result<Vec<ThreadTurnDto>> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, status, error, model, reasoning_effort, started_at FROM thread_turns
                 WHERE thread_id=?1 ORDER BY ordinal ASC",
            )?;
            let turns = stmt
                .query_map(params![thread_id], |row| {
                    Ok(ThreadTurnDto {
                        id: row.get(0)?,
                        started_at: row.get(5)?,
                        status: row.get(1)?,
                        error: row.get(2)?,
                        model: row.get(3)?,
                        reasoning_effort: row.get(4)?,
                        token_usage: None,
                        has_deferred_items: None,
                        deferred_item_count: None,
                        items: Vec::new(),
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(turns)
        })
    }

    pub fn get_thread_turn_detail(&self, id: &str, turn_id: &str) -> Result<ThreadTurnDto> {
        let mut turns = self.load_turns_meta(id)?;
        let mut turn = turns
            .iter_mut()
            .find(|turn| turn.id == turn_id)
            .ok_or_else(|| anyhow!("turn not found"))?
            .clone();
        turn.items = self.load_items_for_turn(id, turn_id)?;
        turn.has_deferred_items = Some(false);
        turn.deferred_item_count = Some(0);
        Ok(turn)
    }

    pub fn get_history_item_detail(&self, id: &str, item_id: &str) -> Result<serde_json::Value> {
        let raw: Option<String> = self.db.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT item_json FROM thread_history_items WHERE thread_id=?1 AND item_id=?2 LIMIT 1",
                    params![id, item_id],
                    |row| row.get(0),
                )
                .optional()?)
        })?;
        let Some(raw) = raw else {
            bail!("history item not found");
        };
        let item: ThreadHistoryItemDto = serde_json::from_str(&raw)?;
        Ok(json!({
            "id": item.id,
            "kind": item.kind,
            "title": item.preview_text.unwrap_or_else(|| item.text.clone()),
            "text": item.text,
        }))
    }

    pub fn thread_image(&self, id: &str, rel: &str) -> Result<(Vec<u8>, &'static str)> {
        let thread = self.get_thread(id)?;
        let workspace = self.get_workspace(&thread.workspace_id)?;
        let (path, bytes) = files::read_bytes(Path::new(&workspace.abs_path), rel)?;
        Ok((bytes, files::image_mime(&path)))
    }

    fn load_steers(&self, thread_id: &str) -> Result<Vec<ThreadPendingSteerDto>> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, thread_id, turn_id, display_prompt, submitted_prompt, delivery, created_at
                 FROM thread_pending_steers WHERE thread_id=?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![thread_id], |row| {
                Ok(ThreadPendingSteerDto {
                    id: row.get(0)?,
                    thread_id: row.get(1)?,
                    turn_id: row.get(2)?,
                    display_prompt: row.get(3)?,
                    submitted_prompt: row.get(4)?,
                    delivery: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        })
    }

    pub async fn prompt(
        &self,
        thread_id: &str,
        input: SendThreadPromptInput,
    ) -> Result<ThreadDetailDto> {
        let thread = self.get_thread(thread_id)?;
        self.ensure_prompt_allowed(&thread)?;
        let images: Vec<PromptImage> = input
            .images
            .into_iter()
            .map(|image| PromptImage {
                mime_type: image.mime_type,
                data: image.data,
            })
            .collect();
        if thread.status == "running" {
            let runtime = self.runtime(thread.provider)?;
            let caps = runtime.negotiated_caps(thread.agent_id.as_deref());
            if caps.turns.steer {
                if let Some(session) = &thread.provider_session_id {
                    runtime
                        .send_input(
                            session,
                            thread.active_turn_id.as_deref().unwrap_or(""),
                            &input.prompt,
                        )
                        .await?;
                    return self.get_thread_detail(thread_id, None).await;
                }
            }
            self.enqueue_steer(
                thread_id,
                thread.active_turn_id.as_deref().unwrap_or(""),
                &input.prompt,
            )?;
            return self.get_thread_detail(thread_id, None).await;
        }
        self.run_turn(
            thread,
            input.prompt,
            input.model,
            input.reasoning_effort,
            images,
        )
        .await?;
        self.get_thread_detail(thread_id, None).await
    }

    fn enqueue_steer(&self, thread_id: &str, turn_id: &str, prompt: &str) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO thread_pending_steers(id, thread_id, turn_id, display_prompt, submitted_prompt, delivery, created_at)
                 VALUES (?1,?2,?3,?4,?4,'steer',?5)",
                params![id, thread_id, turn_id, prompt, now],
            )?;
            Ok(())
        })
    }

    async fn run_turn(
        &self,
        thread: ThreadDto,
        prompt: String,
        model: Option<String>,
        effort: Option<String>,
        images: Vec<PromptImage>,
    ) -> Result<()> {
        let provider = thread.provider;
        let runtime = self.runtime(provider)?.clone();
        let session_id = thread
            .provider_session_id
            .clone()
            .ok_or_else(|| anyhow!("thread has no provider session"))?;
        if !runtime.session_loaded(&session_id) {
            let cwd = self
                .get_workspace(&thread.workspace_id)
                .ok()
                .map(|ws| ws.abs_path);
            runtime.resume_session(&session_id, cwd.as_deref()).await?;
            let _ = runtime
                .apply_session_settings(
                    session_id.as_str(),
                    SessionSettings {
                        model: thread.model.clone(),
                        effort: thread.reasoning_effort.clone(),
                        sandbox_mode: thread.sandbox_mode.clone(),
                        collaboration_mode: Some(thread.collaboration_mode.clone()),
                        approval_mode: Some(thread.approval_mode.clone()),
                    },
                )
                .await;
        }
        let turn_id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let title = if thread.title == "New thread" {
            Some(truncate_title(&prompt))
        } else {
            None
        };
        self.db.with(|conn| {
            let ordinal: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(ordinal),0)+1 FROM thread_turns WHERE thread_id=?1",
                    params![thread.id],
                    |row| row.get(0),
                )?;
            conn.execute(
                "INSERT INTO thread_turns(id, thread_id, status, model, reasoning_effort, started_at, ordinal)
                 VALUES (?1,?2,'inProgress',?3,?4,?5,?6)",
                params![turn_id, thread.id, model.clone().or(thread.model.clone()), effort.clone(), now, ordinal],
            )?;
            let user_item = ThreadHistoryItemDto {
                id: format!("{turn_id}:user"),
                created_at: Some(now.clone()),
                kind: "userMessage".into(),
                text: prompt.clone(),
                preview_text: None,
                status: None,
                sequence: None,
                source_turn_id: Some(turn_id.clone()),
                artifact: None,
            };
            conn.execute(
                "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?6)",
                params![
                    Uuid::new_v4().to_string(),
                    thread.id,
                    turn_id,
                    user_item.id,
                    serde_json::to_string(&user_item)?,
                    now
                ],
            )?;
            conn.execute(
                "UPDATE threads SET status='running', updated_at=?1, last_turn_started_at=?1, title=COALESCE(?2,title) WHERE id=?3",
                params![now, title, thread.id],
            )?;
            Ok(())
        })?;
        self.bus.emit(remote_codex_protocol::ThreadEventEnvelope {
            event_type: "thread.updated".into(),
            thread_id: thread.id.clone(),
            timestamp: now.clone(),
            payload: json!({ "status": "running", "turnId": turn_id, "title": title }),
        });
        let cancel = CancellationToken::new();
        self.live.lock().await.insert(
            thread.id.clone(),
            LiveTurn {
                cancel: cancel.clone(),
            },
        );
        let bus = self.bus.clone();
        let result = runtime
            .start_turn(
                StartTurnInput {
                    provider_session_id: session_id,
                    prompt,
                    model,
                    reasoning_effort: effort,
                    sandbox_mode: thread.sandbox_mode.clone(),
                    collaboration_mode: Some(thread.collaboration_mode.clone()),
                    approval_mode: Some(thread.approval_mode.clone()),
                    thread_id: thread.id.clone(),
                    turn_id: turn_id.clone(),
                    hidden: false,
                    images,
                },
                bus,
                cancel.clone(),
            )
            .await;
        self.live.lock().await.remove(&thread.id);
        let completed_at = now_rfc3339();
        match result {
            Ok(items) => {
                let interrupted = cancel.is_cancelled();
                let status = if interrupted {
                    "interrupted"
                } else {
                    "completed"
                };
                self.persist_turn_result(
                    &thread.id,
                    &turn_id,
                    status,
                    None,
                    &items,
                    &completed_at,
                )?;
            }
            Err(err) => {
                self.persist_turn_result(
                    &thread.id,
                    &turn_id,
                    "failed",
                    Some(&err.to_string()),
                    &[],
                    &completed_at,
                )?;
            }
        }
        self.drain_steers(&thread.id).await?;
        Ok(())
    }

    fn persist_turn_result(
        &self,
        thread_id: &str,
        turn_id: &str,
        status: &str,
        error: Option<&str>,
        items: &[ThreadHistoryItemDto],
        now: &str,
    ) -> Result<()> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE thread_turns SET status=?1, error=?2, completed_at=?3 WHERE id=?4",
                params![status, error, now, turn_id],
            )?;
            for item in items {
                conn.execute(
                    "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?6)
                     ON CONFLICT(thread_id, turn_id, item_id) DO UPDATE SET
                        item_json=excluded.item_json,
                        updated_at=excluded.updated_at",
                    params![
                        Uuid::new_v4().to_string(),
                        thread_id,
                        turn_id,
                        item.id,
                        serde_json::to_string(item)?,
                        now
                    ],
                )?;
            }
            let thread_status = if status == "completed" { "idle" } else { status };
            conn.execute(
                "UPDATE threads SET status=?1, last_error=?2, updated_at=?3, last_turn_completed_at=?3 WHERE id=?4",
                params![thread_status, error, now, thread_id],
            )?;
            Ok(())
        })?;
        self.bus.emit(remote_codex_protocol::ThreadEventEnvelope {
            event_type: "thread.updated".into(),
            thread_id: thread_id.into(),
            timestamp: now.into(),
            payload: json!({ "status": if status == "completed" { "idle" } else { status }, "turnId": turn_id }),
        });
        Ok(())
    }

    async fn drain_steers(&self, thread_id: &str) -> Result<()> {
        let next = self.db.with(|conn| {
            let row: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, submitted_prompt FROM thread_pending_steers WHERE thread_id=?1 ORDER BY created_at ASC LIMIT 1",
                    params![thread_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((id, prompt)) = &row {
                conn.execute("DELETE FROM thread_pending_steers WHERE id=?1", params![id])?;
                Ok(Some(prompt.clone()))
            } else {
                Ok(None)
            }
        })?;
        if let Some(prompt) = next {
            let thread = self.get_thread(thread_id)?;
            Box::pin(self.run_turn(thread, prompt, None, None, Vec::new())).await?;
        }
        Ok(())
    }

    pub async fn interrupt(&self, thread_id: &str) -> Result<ThreadDetailDto> {
        if let Some(live) = self.live.lock().await.get(thread_id) {
            live.cancel.cancel();
        }
        if let Ok(thread) = self.get_thread(thread_id) {
            if let Some(session) = thread.provider_session_id {
                let _ = self
                    .runtime(thread.provider)?
                    .interrupt(&session, thread.active_turn_id.as_deref().unwrap_or(""))
                    .await;
            }
        }
        for _ in 0..100 {
            if self.active_turn_id(thread_id)?.is_none() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        self.get_thread_detail(thread_id, None).await
    }

    pub fn rename_thread(&self, id: &str, title: &str) -> Result<ThreadDto> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE threads SET title=?1, updated_at=?2 WHERE id=?3",
                params![title, now_rfc3339(), id],
            )?;
            Ok(())
        })?;
        self.get_thread(id)
    }

    pub fn delete_thread(&self, id: &str) -> Result<()> {
        self.db.with(|conn| {
            conn.execute(
                "DELETE FROM thread_history_items WHERE thread_id=?1",
                params![id],
            )?;
            conn.execute("DELETE FROM thread_turns WHERE thread_id=?1", params![id])?;
            conn.execute(
                "DELETE FROM thread_pending_steers WHERE thread_id=?1",
                params![id],
            )?;
            conn.execute("DELETE FROM threads WHERE id=?1", params![id])?;
            Ok(())
        })
    }

    pub async fn update_settings(
        &self,
        id: &str,
        model: Option<String>,
        effort: Option<String>,
        fast: Option<bool>,
        collab: Option<String>,
        sandbox: Option<String>,
    ) -> Result<ThreadDto> {
        let thread = self.get_thread(id)?;
        if let Some(session) = thread.provider_session_id.as_deref() {
            let _ = self
                .runtime(thread.provider)?
                .apply_session_settings(
                    session,
                    SessionSettings {
                        model: model.clone(),
                        effort: effort.clone(),
                        sandbox_mode: sandbox.clone(),
                        collaboration_mode: collab.clone(),
                        approval_mode: None,
                    },
                )
                .await;
        }
        self.db.with(|conn| {
            if let Some(model) = model {
                conn.execute(
                    "UPDATE threads SET model=?1 WHERE id=?2",
                    params![model, id],
                )?;
            }
            if let Some(effort) = effort {
                conn.execute(
                    "UPDATE threads SET reasoning_effort=?1 WHERE id=?2",
                    params![effort, id],
                )?;
            }
            if let Some(fast) = fast {
                conn.execute(
                    "UPDATE threads SET fast_mode=?1 WHERE id=?2",
                    params![fast as i64, id],
                )?;
            }
            if let Some(collab) = collab {
                conn.execute(
                    "UPDATE threads SET collaboration_mode=?1 WHERE id=?2",
                    params![collab, id],
                )?;
            }
            if let Some(sandbox) = sandbox {
                conn.execute(
                    "UPDATE threads SET sandbox_mode=?1 WHERE id=?2",
                    params![sandbox, id],
                )?;
            }
            conn.execute(
                "UPDATE threads SET updated_at=?1 WHERE id=?2",
                params![now_rfc3339(), id],
            )?;
            Ok(())
        })?;
        self.get_thread(id)
    }

    pub async fn fork_thread(&self, id: &str) -> Result<ThreadDto> {
        let detail = self.get_thread_detail(id, None).await?;
        if detail.thread.status == "running" {
            bail!("Cannot fork a thread while it is still running.");
        }
        let runtime = self.runtime(detail.thread.provider)?;
        let caps = runtime.negotiated_caps(detail.thread.agent_id.as_deref());
        if !caps.branching.fork {
            bail!("this harness does not support session/fork");
        }
        let session = detail
            .thread
            .provider_session_id
            .clone()
            .ok_or_else(|| anyhow!("thread has no provider session"))?;
        let forked = runtime.fork_session(&session).await?;
        let new_id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        let title = format!("{} / fork", detail.thread.title);
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO threads(id, workspace_id, provider, agent_id, provider_session_id, source, title, model,
                    reasoning_effort, collaboration_mode, approval_mode, status, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,'supervisor',?6,?7,?8,'default',?9,'idle',?10,?10)",
                params![
                    new_id,
                    detail.thread.workspace_id,
                    detail.thread.provider.as_str(),
                    detail.thread.agent_id,
                    forked.provider_session_id,
                    title,
                    detail.thread.model,
                    detail.thread.reasoning_effort,
                    detail.thread.approval_mode,
                    now
                ],
            )?;
            for (ordinal, turn) in detail.turns.iter().enumerate() {
                let new_turn_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO thread_turns(id, thread_id, status, error, model, reasoning_effort, started_at, ordinal)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        new_turn_id,
                        new_id,
                        turn.status,
                        turn.error,
                        turn.model,
                        turn.reasoning_effort,
                        turn.started_at,
                        ordinal as i64 + 1
                    ],
                )?;
                for item in &turn.items {
                    let mut copied = item.clone();
                    copied.source_turn_id = Some(new_turn_id.clone());
                    conn.execute(
                        "INSERT INTO thread_history_items(id, thread_id, turn_id, item_id, item_json, created_at, updated_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?6)",
                        params![
                            Uuid::new_v4().to_string(),
                            new_id,
                            new_turn_id,
                            copied.id,
                            serde_json::to_string(&copied)?,
                            now
                        ],
                    )?;
                }
            }
            Ok(())
        })?;
        Ok(self.get_thread(&new_id)?)
    }

    pub async fn compact_thread(&self, id: &str) -> Result<ThreadDetailDto> {
        let thread = self.get_thread(id)?;
        let session = thread
            .provider_session_id
            .clone()
            .ok_or_else(|| anyhow!("thread has no provider session"))?;
        self.runtime(thread.provider)?
            .compact_session(&session, id, self.bus.clone())
            .await?;
        self.get_thread_detail(id, None).await
    }

    pub async fn resume_thread(&self, id: &str) -> Result<ThreadDetailDto> {
        let thread = self.get_thread(id)?;
        let cwd = self
            .get_workspace(&thread.workspace_id)
            .ok()
            .map(|ws| ws.abs_path);
        if let Some(session) = &thread.provider_session_id {
            let runtime = self.runtime(thread.provider)?;
            let _ = runtime.resume_session(session, cwd.as_deref()).await;
            let _ = runtime
                .apply_session_settings(
                    session,
                    SessionSettings {
                        model: thread.model.clone(),
                        effort: thread.reasoning_effort.clone(),
                        sandbox_mode: thread.sandbox_mode.clone(),
                        collaboration_mode: Some(thread.collaboration_mode.clone()),
                        approval_mode: Some(thread.approval_mode.clone()),
                    },
                )
                .await;
        }
        self.get_thread_detail(id, None).await
    }

    pub fn prepare_prompt_attachments(
        &self,
        thread_id: &str,
        prompt: &str,
        files: Vec<(String, String, Vec<u8>)>,
    ) -> Result<(String, Vec<PromptImage>)> {
        if files.is_empty() {
            return Ok((prompt.to_string(), Vec::new()));
        }
        let thread = self.get_thread(thread_id)?;
        let workspace = self.get_workspace(&thread.workspace_id)?;
        let dir = PathBuf::from(&workspace.abs_path)
            .join(".temp")
            .join("threads")
            .join(thread_id);
        std::fs::create_dir_all(&dir)?;
        let mut rewritten = prompt.to_string();
        let mut images = Vec::new();
        for (name, mime, bytes) in files {
            let safe = sanitize_file_name(&name);
            std::fs::write(dir.join(&safe), &bytes)?;
            let rel = format!("./.temp/threads/{thread_id}/{safe}");
            let photo = mime.starts_with("image/");
            let token = if photo {
                format!("[PHOTO {rel}]")
            } else {
                format!("[FILE {rel}]")
            };
            if rewritten.contains(&name) {
                rewritten = rewritten.replace(&name, &token);
            } else if !rewritten.contains(&token) {
                if rewritten.is_empty() {
                    rewritten = token;
                } else {
                    rewritten = format!("{rewritten}\n{token}");
                }
            }
            if photo {
                images.push(PromptImage {
                    mime_type: mime,
                    data: base64::engine::general_purpose::STANDARD.encode(bytes),
                });
            }
        }
        Ok((rewritten, images))
    }

    pub async fn thread_goal(
        &self,
        id: &str,
        objective: Option<String>,
        status: Option<String>,
        clear: bool,
    ) -> Result<serde_json::Value> {
        let thread = self.get_thread(id)?;
        let session = thread
            .provider_session_id
            .clone()
            .ok_or_else(|| anyhow!("thread has no provider session"))?;
        let runtime = self.runtime(thread.provider)?;
        let goal = if clear {
            runtime
                .set_goal(&session, None, Some("clear".into()))
                .await?
        } else if objective.is_some() || status.is_some() {
            runtime.set_goal(&session, objective, status).await?
        } else {
            runtime.get_goal(&session).await?
        };
        Ok(json!({ "goal": goal.map(|g| json!({
            "objective": g.objective,
            "status": g.status,
            "tokensUsed": g.tokens_used,
            "timeUsedSeconds": g.time_used_seconds
        })) }))
    }

    pub async fn respond_request(
        &self,
        id: &str,
        request_id: &str,
        allow: bool,
        answer: Option<&str>,
    ) -> Result<()> {
        let thread = self.get_thread(id)?;
        self.runtime(thread.provider)?
            .respond_permission(request_id, allow, answer)
            .await?;
        self.bus.emit(remote_codex_protocol::ThreadEventEnvelope {
            event_type: "thread.request.resolved".into(),
            thread_id: id.into(),
            timestamp: now_rfc3339(),
            payload: json!({ "requestId": request_id }),
        });
        Ok(())
    }

    pub fn active_turn_count(&self) -> u32 {
        self.list_threads(None)
            .unwrap_or_default()
            .iter()
            .filter(|t| t.status == "running")
            .count() as u32
    }

    pub async fn list_models(
        &self,
        provider: Provider,
        agent_id: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<Vec<ModelOptionDto>> {
        self.runtime(provider)?.list_models(agent_id, cwd).await
    }

    pub async fn list_agents(&self, provider: Provider) -> Result<Vec<ModelOptionDto>> {
        self.runtime(provider)?.list_agents().await
    }

    pub async fn capabilities(
        &self,
        provider: Provider,
        agent_id: Option<&str>,
    ) -> Result<AgentCapabilitySnapshotDto> {
        self.runtime(provider)?.capabilities(agent_id).await
    }

    pub async fn install(
        &self,
        provider: Provider,
        agent_id: Option<&str>,
    ) -> Result<AgentBackendDto> {
        self.runtime(provider)?.install(agent_id).await
    }
}

fn is_workspace_name(value: &str) -> bool {
    !Path::new(value).is_absolute()
        && value != "."
        && value != ".."
        && value.chars().enumerate().all(|(index, ch)| {
            if index == 0 {
                ch.is_ascii_alphanumeric()
            } else {
                ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')
            }
        })
        && (1..=128).contains(&value.len())
}

fn infer_git_repo_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let name = trimmed
        .rsplit(['/', ':'])
        .find(|part| !part.is_empty())
        .unwrap_or("repo");
    if name.is_empty() {
        "repo".into()
    } else {
        name.into()
    }
}

fn sanitize_file_name(name: &str) -> String {
    let basename = std::path::Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "attachment".into());
    let cleaned: String = basename
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    format!(
        "{}-{}",
        cleaned.trim_matches('-'),
        &Uuid::new_v4().to_string()[..8]
    )
}

fn thread_from_row(row: &rusqlite::Row<'_>) -> ThreadDto {
    let provider: String = row.get(2).unwrap_or_else(|_| "codex".into());
    let provider = match provider.as_str() {
        "claude" => Provider::Claude,
        "opencode" => Provider::Opencode,
        "acp" => Provider::Acp,
        _ => Provider::Codex,
    };
    ThreadDto {
        id: row.get(0).unwrap_or_default(),
        workspace_id: row.get(1).unwrap_or_default(),
        provider,
        agent_id: row.get(3).unwrap_or(None),
        provider_session_id: row.get(4).unwrap_or(None),
        source: row.get(5).unwrap_or_else(|_| "supervisor".into()),
        title: row.get(6).unwrap_or_default(),
        model: row.get(7).unwrap_or(None),
        reasoning_effort: row.get(8).unwrap_or(None),
        fast_mode: row.get::<_, i64>(9).unwrap_or(0) != 0,
        collaboration_mode: row.get(10).unwrap_or_else(|_| "default".into()),
        approval_mode: row.get(11).unwrap_or_else(|_| "yolo".into()),
        sandbox_mode: row.get(12).unwrap_or(None),
        status: row
            .get::<_, Option<String>>(13)
            .ok()
            .flatten()
            .unwrap_or_else(|| "idle".into()),
        summary_text: row.get(14).unwrap_or(None),
        last_error: row.get(15).unwrap_or(None),
        active_turn_id: None,
        is_loaded: true,
        is_pinned: row.get::<_, i64>(20).unwrap_or(0) != 0,
        created_at: row.get(16).unwrap_or_default(),
        updated_at: row.get(17).unwrap_or_default(),
        last_turn_started_at: row.get(18).unwrap_or(None),
        last_turn_completed_at: row.get(19).unwrap_or(None),
        context_usage: None,
    }
}

pub fn bootstrap_runtimes(config: &RuntimeConfig) -> Vec<SharedRuntime> {
    use crate::acp::AcpRuntime;
    use crate::fake::FakeRuntime;
    let mut out: Vec<SharedRuntime> = Vec::new();
    if config.fake_runtime {
        for provider in [
            Provider::Codex,
            Provider::Claude,
            Provider::Opencode,
            Provider::Acp,
        ] {
            if config.enabled_providers.contains(&provider) {
                out.push(Arc::new(FakeRuntime::new(provider)));
            }
        }
        return out;
    }
    for provider in &config.enabled_providers {
        match provider {
            Provider::Acp => out.push(Arc::new(AcpRuntime::catalog(
                config.acp_command.clone(),
                config.acp_startup_timeout_ms,
            ))),
            Provider::Codex => out.push(Arc::new(AcpRuntime::bound(
                Provider::Codex,
                "codex",
                config.acp_startup_timeout_ms,
            ))),
            Provider::Claude => out.push(Arc::new(AcpRuntime::bound(
                Provider::Claude,
                "claude",
                config.acp_startup_timeout_ms,
            ))),
            Provider::Opencode => out.push(Arc::new(AcpRuntime::bound(
                Provider::Opencode,
                "opencode",
                config.acp_startup_timeout_ms,
            ))),
        }
    }
    out
}
