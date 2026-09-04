use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use axum::http::StatusCode;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::{rngs::OsRng, RngCore};
use reqwest::{Client, Method};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use remote_codex_protocol::now_rfc3339;

#[derive(Clone, Debug)]
pub struct HostedConfig {
    pub provider: String,
    pub agent_url: Option<String>,
    pub agent_token: Option<String>,
    pub relay_server_url: Option<String>,
    pub request_timeout: Duration,
    pub idle_timeout: Duration,
    pub reconcile_interval: Duration,
}

impl HostedConfig {
    pub fn from_env() -> Self {
        Self {
            provider: nonempty_env("REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER")
                .unwrap_or_else(|| "disabled".into()),
            agent_url: nonempty_env("REMOTE_CODEX_INCUS_HOST_AGENT_URL")
                .map(|value| value.trim_end_matches('/').to_string()),
            agent_token: nonempty_env("REMOTE_CODEX_INCUS_HOST_AGENT_TOKEN"),
            relay_server_url: nonempty_env("REMOTE_CODEX_HOSTED_RELAY_SERVER_URL"),
            request_timeout: Duration::from_millis(env_u64(
                "REMOTE_CODEX_INCUS_HOST_AGENT_TIMEOUT_MS",
                1_500,
            )),
            idle_timeout: Duration::from_millis(env_u64(
                "REMOTE_CODEX_HOSTED_IDLE_TIMEOUT_MS",
                30 * 60_000,
            )),
            reconcile_interval: Duration::from_millis(env_u64(
                "REMOTE_CODEX_HOSTED_RECONCILE_INTERVAL_MS",
                5 * 60_000,
            )),
        }
    }

    pub fn enabled(&self) -> bool {
        self.provider == "incus"
    }

    fn provider_configured(&self) -> bool {
        self.enabled() && self.agent_url.is_some() && self.agent_token.is_some()
    }

    #[cfg(test)]
    pub fn disabled_for_test() -> Self {
        Self {
            provider: "disabled".into(),
            agent_url: None,
            agent_token: None,
            relay_server_url: None,
            request_timeout: Duration::from_millis(100),
            idle_timeout: Duration::from_secs(60),
            reconcile_interval: Duration::from_secs(60),
        }
    }
}

#[derive(Debug)]
pub struct HostedError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl HostedError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", message)
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, "conflict", message)
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "service_unavailable",
            message,
        )
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "hosted sandbox database operation failed");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Hosted sandbox operation failed.",
        )
    }
}

type HostedResult<T> = std::result::Result<T, HostedError>;

#[derive(Clone)]
struct HostedProvider {
    config: HostedConfig,
    client: Client,
}

impl HostedProvider {
    fn new(config: HostedConfig) -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        Ok(Self { config, client })
    }

    async fn capability(&self) -> HostedResult<Value> {
        tokio::time::timeout(
            self.config.request_timeout,
            self.request(Method::GET, "/v1/capability", None, None),
        )
        .await
        .map_err(|_| HostedError::unavailable("Incus host agent capability request timed out."))?
    }

    async fn inventory(&self) -> HostedResult<Value> {
        self.request(Method::GET, "/v1/inventory", None, None).await
    }

    async fn create_codex_credential(&self, files: &CodexFiles, key: &str) -> HostedResult<String> {
        let result = self
            .request(
                Method::POST,
                "/v1/credentials",
                Some(json!({ "codexFiles": files })),
                Some(key),
            )
            .await?;
        result
            .get("credentialRef")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| HostedError::unavailable("Host agent returned no credential reference."))
    }

    async fn create_api_credential(&self, api_key: &str, key: &str) -> HostedResult<String> {
        let result = self
            .request(
                Method::POST,
                "/v1/credentials",
                Some(json!({ "openaiApiKey": api_key })),
                Some(key),
            )
            .await?;
        result
            .get("credentialRef")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| HostedError::unavailable("Host agent returned no credential reference."))
    }

    async fn delete_credential(&self, credential_ref: &str, key: &str) -> HostedResult<()> {
        self.request(
            Method::DELETE,
            &format!("/v1/credentials/{}", path_segment(credential_ref)),
            None,
            Some(key),
        )
        .await?;
        Ok(())
    }

    async fn create_instance(&self, context: &ProvisionContext, key: &str) -> HostedResult<Value> {
        self.request(
            Method::POST,
            "/v1/instances",
            Some(json!({
                "id": context.id,
                "imageVersion": context.image_version,
                "resources": {
                    "cpuCount": context.cpu_count,
                    "memoryMiB": context.memory_mib,
                    "diskGiB": context.disk_gib
                }
            })),
            Some(key),
        )
        .await
    }

    async fn instance_action(&self, id: &str, action: &str, key: &str) -> HostedResult<Value> {
        self.request(
            Method::POST,
            &format!("/v1/instances/{}/{}", path_segment(id), action),
            None,
            Some(key),
        )
        .await
    }

    async fn snapshot(&self, id: &str, name: &str, key: &str) -> HostedResult<()> {
        self.request(
            Method::POST,
            &format!("/v1/instances/{}/snapshots", path_segment(id)),
            Some(json!({ "name": name })),
            Some(key),
        )
        .await?;
        Ok(())
    }

    async fn delete_instance(&self, id: &str, key: &str) -> HostedResult<()> {
        self.request(
            Method::DELETE,
            &format!("/v1/instances/{}", path_segment(id)),
            None,
            Some(key),
        )
        .await?;
        Ok(())
    }

    async fn provision(
        &self,
        context: &ProvisionContext,
        credential_ref: &str,
        key: &str,
    ) -> HostedResult<()> {
        let relay_url = self.config.relay_server_url.as_ref().ok_or_else(|| {
            HostedError::unavailable("Hosted relay server URL is not configured.")
        })?;
        self.request(
            Method::POST,
            &format!("/v1/instances/{}/provision", path_segment(&context.id)),
            Some(json!({
                "relayServerUrl": relay_url,
                "relayAgentToken": context.device_token,
                "credentialRef": credential_ref,
                "codexConfig": context.codex_config,
                "localAdminUsername": "admin"
            })),
            Some(key),
        )
        .await?;
        Ok(())
    }

    async fn read_codex_files(&self, id: &str) -> HostedResult<Value> {
        self.request(
            Method::GET,
            &format!("/v1/instances/{}/backends/codex/files", path_segment(id)),
            None,
            None,
        )
        .await
    }

    async fn write_codex_files(&self, id: &str, files: &CodexFiles, key: &str) -> HostedResult<()> {
        self.request(
            Method::PUT,
            &format!("/v1/instances/{}/backends/codex/files", path_segment(id)),
            Some(serde_json::to_value(files).map_err(HostedError::internal)?),
            Some(key),
        )
        .await?;
        Ok(())
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        idempotency_key: Option<&str>,
    ) -> HostedResult<Value> {
        let base =
            self.config.agent_url.as_ref().ok_or_else(|| {
                HostedError::unavailable("Incus host agent URL is not configured.")
            })?;
        let token =
            self.config.agent_token.as_ref().ok_or_else(|| {
                HostedError::unavailable("Incus host agent token is not configured.")
            })?;
        let mut request = self
            .client
            .request(method, format!("{base}{path}"))
            .bearer_auth(token);
        if let Some(key) = idempotency_key {
            request = request.header("idempotency-key", key);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|error| {
            HostedError::unavailable(format!("Incus host agent request failed: {error}"))
        })?;
        let status = response.status();
        let bytes = response.bytes().await.map_err(|error| {
            HostedError::unavailable(format!("Incus host agent response failed: {error}"))
        })?;
        let payload = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                json!({ "message": String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>() })
            })
        };
        if !status.is_success() {
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Incus host agent returned {status}."));
            return Err(HostedError::new(
                if status == StatusCode::CONFLICT {
                    StatusCode::CONFLICT
                } else {
                    StatusCode::BAD_GATEWAY
                },
                "service_unavailable",
                message,
            ));
        }
        Ok(payload)
    }
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexFiles {
    pub config_toml: String,
    pub auth_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHostedInput {
    pub assigned_user_ids: Vec<String>,
    pub device_name: String,
    pub image_version: String,
    pub resources: HostedResources,
    pub backends: Vec<String>,
    pub codex_files: CodexFiles,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedResources {
    pub cpu_count: i64,
    pub memory_mib: i64,
    pub disk_gib: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedMembersInput {
    pub assigned_user_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedSettingsInput {
    pub workspace_isolation_enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct HostedSnapshotInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateCredentialInput {
    pub openai_api_key: String,
}

#[derive(Clone)]
pub struct HostedService {
    conn: Arc<Mutex<Connection>>,
    config: HostedConfig,
    provider: HostedProvider,
    running: Arc<Mutex<HashSet<String>>>,
    latest_reconciliation: Arc<RwLock<Value>>,
    capability_failures: Arc<Mutex<CapabilityFailures>>,
}

#[derive(Default)]
struct CapabilityFailures {
    consecutive: u8,
    opened_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
struct ProvisionContext {
    id: String,
    device_id: String,
    device_token: String,
    image_version: String,
    cpu_count: i64,
    memory_mib: i64,
    disk_gib: i64,
    credential_ref: String,
    codex_config: Value,
}

#[derive(Clone, Copy)]
enum LifecycleAction {
    Create,
    Start,
    Stop,
    Delete,
    Snapshot,
    RotateCredential,
}

impl HostedService {
    pub fn new(conn: Arc<Mutex<Connection>>, config: HostedConfig) -> Result<Arc<Self>> {
        if !matches!(config.provider.as_str(), "disabled" | "incus") {
            return Err(anyhow!(
                "REMOTE_CODEX_HOSTED_SANDBOX_PROVIDER must be disabled or incus"
            ));
        }
        Ok(Arc::new(Self {
            conn,
            provider: HostedProvider::new(config.clone())?,
            config,
            running: Arc::new(Mutex::new(HashSet::new())),
            latest_reconciliation: Arc::new(RwLock::new(empty_reconciliation())),
            capability_failures: Arc::new(Mutex::new(CapabilityFailures::default())),
        }))
    }

    pub async fn capability(&self) -> Value {
        if !self.config.enabled() {
            return json!({
                "provider": "disabled", "configured": false, "reachable": false,
                "available": false, "reasonCode": "hosted_sandbox_disabled",
                "reason": "Hosted supervisor VMs are not configured on this relay.",
                "checkedAt": now_rfc3339()
            });
        }
        if !self.config.provider_configured() {
            return unavailable_capability(
                "hosted_provider_unconfigured",
                "The Incus host agent URL or token is not configured.",
            );
        }
        {
            let failures = self.capability_failures.lock().await;
            if failures
                .opened_at
                .is_some_and(|opened| Utc::now() - opened < chrono::Duration::seconds(30))
            {
                return unavailable_capability(
                    "hosted_provider_circuit_open",
                    "Hosted supervisor VM operations are temporarily unavailable after repeated provider failures.",
                );
            }
        }
        match self.provider.capability().await {
            Ok(mut payload) => {
                let mut failures = self.capability_failures.lock().await;
                failures.consecutive = 0;
                failures.opened_at = None;
                let available = payload.get("available").and_then(Value::as_bool) == Some(true)
                    && payload.get("credentialStoreReady").and_then(Value::as_bool) == Some(true);
                let Some(object) = payload.as_object_mut() else {
                    return unavailable_capability(
                        "hosted_provider_invalid_response",
                        "The hosted supervisor VM provider returned an invalid capability response.",
                    );
                };
                object.insert("provider".into(), Value::String("incus".into()));
                object.insert("configured".into(), Value::Bool(true));
                object.insert("reachable".into(), Value::Bool(true));
                object.insert("available".into(), Value::Bool(available));
                object.insert("checkedAt".into(), Value::String(now_rfc3339()));
                object.insert(
                    "reasonCode".into(),
                    if available {
                        Value::Null
                    } else {
                        Value::String("incus_host_agent_not_ready".into())
                    },
                );
                object.insert(
                    "reason".into(),
                    if available {
                        Value::Null
                    } else {
                        Value::String("Incus or encrypted credential storage is not ready.".into())
                    },
                );
                payload
            }
            Err(_) => {
                let mut failures = self.capability_failures.lock().await;
                failures.consecutive = failures.consecutive.saturating_add(1);
                if failures.consecutive >= 2 {
                    failures.opened_at = Some(Utc::now());
                }
                unavailable_capability(
                    "hosted_provider_unreachable",
                    "The hosted supervisor VM provider could not be reached.",
                )
            }
        }
    }

    pub async fn list(&self) -> HostedResult<Value> {
        let conn = self.conn.lock().await;
        let ids = hosted_ids(&conn).map_err(HostedError::internal)?;
        let values = ids
            .iter()
            .map(|id| sandbox_json(&conn, id, false))
            .collect::<Result<Vec<_>>>()
            .map_err(HostedError::internal)?;
        Ok(json!({ "sandboxes": values }))
    }

    pub async fn detail(&self, id: &str) -> HostedResult<Value> {
        let conn = self.conn.lock().await;
        require_sandbox_json(&conn, id, true)
    }

    pub async fn create(
        self: &Arc<Self>,
        admin_id: &str,
        input: CreateHostedInput,
    ) -> HostedResult<Value> {
        validate_create_input(&input)?;
        if self.config.relay_server_url.is_none() {
            return Err(HostedError::unavailable(
                "Hosted supervisor VM relay URL is not configured.",
            ));
        }
        if !self.config.provider_configured() {
            return Err(HostedError::unavailable(
                "Incus host agent is not configured.",
            ));
        }
        let request_id = Uuid::new_v4().to_string();
        let credential_ref = self
            .provider
            .create_codex_credential(
                &input.codex_files,
                &format!("relay-credential-{request_id}"),
            )
            .await?;
        let created = self
            .create_requested(admin_id, &input, &credential_ref)
            .await;
        let (sandbox_id, operation_id, response) = match created {
            Ok(value) => value,
            Err(error) => {
                let _ = self
                    .provider
                    .delete_credential(
                        &credential_ref,
                        &format!("relay-credential-compensate-{request_id}"),
                    )
                    .await;
                return Err(error);
            }
        };
        self.reserve(&sandbox_id).await?;
        self.spawn_action(sandbox_id, operation_id, LifecycleAction::Create, None);
        Ok(response)
    }

    async fn create_requested(
        &self,
        admin_id: &str,
        input: &CreateHostedInput,
        credential_ref: &str,
    ) -> HostedResult<(String, String, Value)> {
        let sandbox_id = Uuid::new_v4().to_string();
        let operation_id = Uuid::new_v4().to_string();
        let device_id = Uuid::new_v4().to_string();
        let token = new_device_token();
        let now = now_rfc3339();
        let conn = self.conn.lock().await;
        validate_admin(&conn, admin_id)?;
        validate_members(&conn, &input.assigned_user_ids)?;
        let tx = conn
            .unchecked_transaction()
            .map_err(HostedError::internal)?;
        tx.execute(
            "INSERT INTO relay_devices(id,owner_user_id,name,token,token_hash,token_preview,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                device_id,
                admin_id,
                input.device_name.trim(),
                token,
                token_hash(&token),
                preview_token(&token),
                now
            ],
        )
        .map_err(HostedError::internal)?;
        tx.execute(
            "INSERT INTO relay_hosted_sandboxes(
               id,device_id,assigned_user_id,created_by_admin_user_id,provider,provider_instance_id,
               image_version,cpu_count,memory_mib,disk_gib,status,credential_ref,codex_config_json,
               last_error_code,last_error_message,active_turn_count,last_user_activity_at,
               idle_deadline_at,lifecycle_generation,workspace_isolation_enabled,running_since,
               created_at,updated_at
             ) VALUES (?1,?2,?3,?3,'incus',NULL,?4,?5,?6,?7,'requested',?8,?9,
                       NULL,NULL,0,NULL,NULL,0,0,NULL,?10,?10)",
            params![
                sandbox_id,
                device_id,
                admin_id,
                input.image_version,
                input.resources.cpu_count,
                input.resources.memory_mib,
                input.resources.disk_gib,
                credential_ref,
                default_codex_config().to_string(),
                now
            ],
        )
        .map_err(HostedError::internal)?;
        for (position, user_id) in input.assigned_user_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO relay_hosted_sandbox_members(sandbox_id,user_id,position,created_at)
                 VALUES (?1,?2,?3,?4)",
                params![sandbox_id, user_id, position as i64, now],
            )
            .map_err(HostedError::internal)?;
        }
        insert_operation(&tx, &operation_id, &sandbox_id, "create", &now)
            .map_err(HostedError::internal)?;
        tx.commit().map_err(HostedError::internal)?;
        let sandbox = require_sandbox_json(&conn, &sandbox_id, true)?;
        let operation = operation_json(&conn, &operation_id)
            .map_err(HostedError::internal)?
            .ok_or_else(|| HostedError::internal("created operation is missing"))?;
        Ok((
            sandbox_id,
            operation_id,
            json!({ "sandbox": sandbox, "operation": operation }),
        ))
    }

    pub async fn update_members(&self, id: &str, user_ids: &[String]) -> HostedResult<Value> {
        let conn = self.conn.lock().await;
        require_sandbox_json(&conn, id, false)?;
        validate_members(&conn, user_ids)?;
        let now = now_rfc3339();
        let tx = conn
            .unchecked_transaction()
            .map_err(HostedError::internal)?;
        tx.execute(
            "DELETE FROM relay_hosted_sandbox_members WHERE sandbox_id=?1",
            params![id],
        )
        .map_err(HostedError::internal)?;
        for (position, user_id) in user_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO relay_hosted_sandbox_members(sandbox_id,user_id,position,created_at)
                 VALUES (?1,?2,?3,?4)",
                params![id, user_id, position as i64, now],
            )
            .map_err(HostedError::internal)?;
        }
        tx.execute(
            "UPDATE relay_hosted_sandboxes SET updated_at=?1 WHERE id=?2",
            params![now, id],
        )
        .map_err(HostedError::internal)?;
        tx.commit().map_err(HostedError::internal)?;
        require_sandbox_json(&conn, id, true)
    }

    pub async fn update_settings(&self, id: &str, enabled: bool) -> HostedResult<Value> {
        let conn = self.conn.lock().await;
        let changed = conn
            .execute(
                "UPDATE relay_hosted_sandboxes
                 SET workspace_isolation_enabled=?1,updated_at=?2 WHERE id=?3",
                params![i64::from(enabled), now_rfc3339(), id],
            )
            .map_err(HostedError::internal)?;
        if changed == 0 {
            return Err(HostedError::not_found("Hosted VM was not found."));
        }
        require_sandbox_json(&conn, id, true)
    }

    pub async fn retry(self: &Arc<Self>, id: &str) -> HostedResult<Value> {
        self.begin_operation(id, "create", LifecycleAction::Create, None)
            .await
    }

    pub async fn start(self: &Arc<Self>, id: &str) -> HostedResult<Value> {
        self.record_user_activity(id, true).await?;
        self.begin_operation(id, "start", LifecycleAction::Start, None)
            .await
    }

    pub async fn stop(self: &Arc<Self>, id: &str) -> HostedResult<Value> {
        self.begin_operation(id, "stop", LifecycleAction::Stop, None)
            .await
    }

    pub async fn snapshot(self: &Arc<Self>, id: &str, name: &str) -> HostedResult<Value> {
        if !valid_snapshot_name(name) {
            return Err(HostedError::bad_request("Invalid snapshot name."));
        }
        self.begin_operation(
            id,
            "snapshot",
            LifecycleAction::Snapshot,
            Some(name.to_string()),
        )
        .await
    }

    pub async fn delete(self: &Arc<Self>, id: &str) -> HostedResult<Value> {
        self.begin_operation(id, "delete", LifecycleAction::Delete, None)
            .await
    }

    pub async fn rotate_credential(
        self: &Arc<Self>,
        id: &str,
        api_key: &str,
    ) -> HostedResult<Value> {
        if !(20..=512).contains(&api_key.len()) {
            return Err(HostedError::bad_request(
                "OpenAI API key must contain 20 to 512 characters.",
            ));
        }
        self.reserve(id).await?;
        let operation_id = match self.create_operation(id, "rotate_credential").await {
            Ok(id) => id,
            Err(error) => {
                self.release(id).await;
                return Err(error);
            }
        };
        let credential_ref = match self
            .provider
            .create_api_credential(api_key, &format!("relay-credential-rotate-{operation_id}"))
            .await
        {
            Ok(value) => value,
            Err(error) => {
                self.fail_operation(
                    id,
                    &operation_id,
                    "hosted_sandbox_rotate_credential_failed",
                    "Hosted supervisor VM credential rotation failed.",
                )
                .await;
                self.release(id).await;
                return Err(error);
            }
        };
        let response = {
            let conn = self.conn.lock().await;
            operation_json(&conn, &operation_id)
                .map_err(HostedError::internal)?
                .ok_or_else(|| HostedError::internal("created operation is missing"))?
        };
        self.spawn_action(
            id.to_string(),
            operation_id,
            LifecycleAction::RotateCredential,
            Some(credential_ref),
        );
        Ok(json!({ "operation": response }))
    }

    pub async fn read_codex_files(&self, id: &str) -> HostedResult<Value> {
        self.ensure_exists(id).await?;
        self.provider.read_codex_files(id).await
    }

    pub async fn write_codex_files(&self, id: &str, files: &CodexFiles) -> HostedResult<Value> {
        self.ensure_exists(id).await?;
        validate_codex_files(files)?;
        self.provider
            .write_codex_files(id, files, &format!("relay-codex-files-{}", Uuid::new_v4()))
            .await?;
        Ok(json!({ "updated": true }))
    }

    async fn begin_operation(
        self: &Arc<Self>,
        id: &str,
        action_name: &str,
        action: LifecycleAction,
        detail: Option<String>,
    ) -> HostedResult<Value> {
        self.reserve(id).await?;
        let operation_id = match self.create_operation(id, action_name).await {
            Ok(value) => value,
            Err(error) => {
                self.release(id).await;
                return Err(error);
            }
        };
        let operation = {
            let conn = self.conn.lock().await;
            operation_json(&conn, &operation_id)
                .map_err(HostedError::internal)?
                .ok_or_else(|| HostedError::internal("created operation is missing"))?
        };
        if matches!(action, LifecycleAction::Create) {
            let conn = self.conn.lock().await;
            set_sandbox_status(&conn, id, "requested", None, None, None)
                .map_err(HostedError::internal)?;
        }
        self.spawn_action(id.to_string(), operation_id, action, detail);
        Ok(json!({ "operation": operation }))
    }

    async fn create_operation(&self, id: &str, action: &str) -> HostedResult<String> {
        let conn = self.conn.lock().await;
        require_sandbox_json(&conn, id, false)?;
        let operation_id = Uuid::new_v4().to_string();
        let now = now_rfc3339();
        insert_operation(&conn, &operation_id, id, action, &now).map_err(HostedError::internal)?;
        Ok(operation_id)
    }

    async fn ensure_exists(&self, id: &str) -> HostedResult<()> {
        let conn = self.conn.lock().await;
        require_sandbox_json(&conn, id, false).map(|_| ())
    }

    async fn reserve(&self, id: &str) -> HostedResult<()> {
        let mut running = self.running.lock().await;
        if !running.insert(id.to_string()) {
            return Err(HostedError::conflict(
                "Another Hosted supervisor VM operation is already running.",
            ));
        }
        Ok(())
    }

    async fn release(&self, id: &str) {
        self.running.lock().await.remove(id);
    }

    fn spawn_action(
        self: &Arc<Self>,
        sandbox_id: String,
        operation_id: String,
        action: LifecycleAction,
        detail: Option<String>,
    ) {
        let service = Arc::clone(self);
        tokio::spawn(async move {
            if let Err(error) = service
                .run_action(&sandbox_id, &operation_id, action, detail)
                .await
            {
                let action_name = action_name(action);
                service
                    .fail_operation(
                        &sandbox_id,
                        &operation_id,
                        &format!("hosted_sandbox_{action_name}_failed"),
                        &format!(
                            "Hosted supervisor VM {action_name} failed: {}",
                            error.message
                        ),
                    )
                    .await;
            }
            service.release(&sandbox_id).await;
        });
    }

    async fn run_action(
        &self,
        sandbox_id: &str,
        operation_id: &str,
        action: LifecycleAction,
        detail: Option<String>,
    ) -> HostedResult<()> {
        self.update_operation(operation_id, "running", None, None)
            .await?;
        match action {
            LifecycleAction::Create => self.run_create(sandbox_id, operation_id).await?,
            LifecycleAction::Start => {
                self.update_status(sandbox_id, "starting", None).await?;
                self.provider
                    .instance_action(
                        sandbox_id,
                        "start",
                        &format!("relay-sandbox-start-action-{operation_id}"),
                    )
                    .await?;
                let context = self.context(sandbox_id).await?;
                self.provision_if_needed(
                    &context,
                    &format!("relay-sandbox-reprovision-start-{operation_id}"),
                )
                .await?;
                self.update_status(sandbox_id, "starting", None).await?;
            }
            LifecycleAction::Stop => {
                self.update_status(sandbox_id, "stopping", None).await?;
                self.provider
                    .instance_action(
                        sandbox_id,
                        "stop",
                        &format!("relay-sandbox-stop-action-{operation_id}"),
                    )
                    .await?;
                self.update_status(sandbox_id, "stopped", None).await?;
            }
            LifecycleAction::Snapshot => {
                self.provider
                    .snapshot(
                        sandbox_id,
                        detail.as_deref().unwrap_or("snapshot"),
                        &format!("relay-sandbox-snapshot-{operation_id}"),
                    )
                    .await?;
            }
            LifecycleAction::Delete => {
                let context = self.context(sandbox_id).await?;
                self.update_status(sandbox_id, "deleting", None).await?;
                self.provider
                    .delete_instance(sandbox_id, &format!("relay-sandbox-delete-{operation_id}"))
                    .await?;
                self.provider
                    .delete_credential(
                        &context.credential_ref,
                        &format!("relay-credential-delete-{operation_id}"),
                    )
                    .await?;
                self.update_operation(operation_id, "succeeded", None, None)
                    .await?;
                let conn = self.conn.lock().await;
                let tx = conn
                    .unchecked_transaction()
                    .map_err(HostedError::internal)?;
                tx.execute(
                    "DELETE FROM relay_hosted_sandboxes WHERE id=?1",
                    params![sandbox_id],
                )
                .map_err(HostedError::internal)?;
                tx.execute(
                    "DELETE FROM relay_devices WHERE id=?1",
                    params![context.device_id],
                )
                .map_err(HostedError::internal)?;
                tx.commit().map_err(HostedError::internal)?;
                return Ok(());
            }
            LifecycleAction::RotateCredential => {
                let new_ref =
                    detail.ok_or_else(|| HostedError::internal("new credential is missing"))?;
                let context = self.context(sandbox_id).await?;
                self.provider
                    .provision(
                        &context,
                        &new_ref,
                        &format!("relay-sandbox-reprovision-{operation_id}"),
                    )
                    .await?;
                {
                    let conn = self.conn.lock().await;
                    conn.execute(
                        "UPDATE relay_hosted_sandboxes SET credential_ref=?1,updated_at=?2 WHERE id=?3",
                        params![new_ref, now_rfc3339(), sandbox_id],
                    )
                    .map_err(HostedError::internal)?;
                }
                self.record_provisioned_url(sandbox_id).await?;
                self.provider
                    .delete_credential(
                        &context.credential_ref,
                        &format!("relay-credential-retire-{operation_id}"),
                    )
                    .await?;
            }
        }
        self.update_operation(operation_id, "succeeded", None, None)
            .await
    }

    async fn run_create(&self, sandbox_id: &str, operation_id: &str) -> HostedResult<()> {
        let context = self.context(sandbox_id).await?;
        self.update_status(sandbox_id, "creating", None).await?;
        let instance = self
            .provider
            .create_instance(&context, &format!("relay-sandbox-create-{sandbox_id}"))
            .await?;
        let provider_instance = instance
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string);
        self.update_status(sandbox_id, "starting", provider_instance.as_deref())
            .await?;
        self.provider
            .instance_action(
                sandbox_id,
                "start",
                &format!("relay-sandbox-start-{sandbox_id}"),
            )
            .await?;
        self.update_status(sandbox_id, "provisioning", None).await?;
        self.provider
            .provision(
                &context,
                &context.credential_ref,
                &format!("relay-sandbox-provision-{sandbox_id}"),
            )
            .await?;
        self.record_provisioned_url(sandbox_id).await?;
        self.update_operation(operation_id, "succeeded", None, None)
            .await?;
        self.update_status(sandbox_id, "starting", None).await
    }

    async fn context(&self, id: &str) -> HostedResult<ProvisionContext> {
        let conn = self.conn.lock().await;
        provision_context(&conn, id)
            .map_err(HostedError::internal)?
            .ok_or_else(|| {
                HostedError::not_found("Hosted sandbox provision context is unavailable.")
            })
    }

    async fn provision_if_needed(
        &self,
        context: &ProvisionContext,
        idempotency_key: &str,
    ) -> HostedResult<()> {
        let Some(expected_url) = self.config.relay_server_url.as_deref() else {
            return Err(HostedError::unavailable(
                "Hosted supervisor VM relay URL is not configured.",
            ));
        };
        let key = format!("hostedProvisionedRelayUrl:{}", context.id);
        let current: Option<String> = {
            let conn = self.conn.lock().await;
            conn.query_row(
                "SELECT value FROM relay_settings WHERE key=?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(HostedError::internal)?
        };
        if current.as_deref() == Some(expected_url) {
            return Ok(());
        }
        self.provider
            .provision(context, &context.credential_ref, idempotency_key)
            .await?;
        self.record_provisioned_url(&context.id).await
    }

    async fn record_provisioned_url(&self, sandbox_id: &str) -> HostedResult<()> {
        let relay_url = self.config.relay_server_url.as_deref().ok_or_else(|| {
            HostedError::unavailable("Hosted supervisor VM relay URL is not configured.")
        })?;
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO relay_settings(key,value) VALUES (?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![format!("hostedProvisionedRelayUrl:{sandbox_id}"), relay_url],
        )
        .map_err(HostedError::internal)?;
        Ok(())
    }

    async fn update_status(
        &self,
        id: &str,
        status: &str,
        provider_instance: Option<&str>,
    ) -> HostedResult<()> {
        let conn = self.conn.lock().await;
        set_sandbox_status(&conn, id, status, provider_instance, None, None)
            .map_err(HostedError::internal)
    }

    async fn update_operation(
        &self,
        id: &str,
        status: &str,
        error_code: Option<&str>,
        error_message: Option<&str>,
    ) -> HostedResult<()> {
        let conn = self.conn.lock().await;
        let changed = conn
            .execute(
                "UPDATE relay_hosted_operations
                 SET status=?1,error_code=?2,error_message=?3,updated_at=?4 WHERE id=?5",
                params![status, error_code, error_message, now_rfc3339(), id],
            )
            .map_err(HostedError::internal)?;
        if changed == 0 {
            return Err(HostedError::not_found("Hosted operation was not found."));
        }
        Ok(())
    }

    async fn fail_operation(
        &self,
        sandbox_id: &str,
        operation_id: &str,
        code: &str,
        message: &str,
    ) {
        let _ = self
            .update_operation(operation_id, "failed", Some(code), Some(message))
            .await;
        let conn = self.conn.lock().await;
        let _ = set_sandbox_status(&conn, sandbox_id, "error", None, Some(code), Some(message));
    }

    pub async fn mark_online(self: &Arc<Self>, device_id: &str) {
        let scheduled = {
            let conn = self.conn.lock().await;
            let now = now_rfc3339();
            if conn
                .execute(
                    "UPDATE relay_hosted_sandboxes
                     SET status='online',last_error_code=NULL,last_error_message=NULL,
                         running_since=COALESCE(running_since,?1),updated_at=?1
                     WHERE device_id=?2 AND status<>'deleting'",
                    params![now, device_id],
                )
                .unwrap_or(0)
                == 0
            {
                None
            } else {
                arm_idle_deadline(&conn, device_id, self.config.idle_timeout)
                    .ok()
                    .flatten()
            }
        };
        if let Some((id, generation, deadline)) = scheduled {
            self.schedule_idle(id, generation, deadline);
        }
    }

    pub async fn wake_for_request(self: &Arc<Self>, device_id: &str, activity: bool) -> bool {
        let result = {
            let conn = self.conn.lock().await;
            if activity {
                record_activity(&conn, device_id, self.config.idle_timeout)
            } else {
                hosted_status(&conn, device_id)
            }
        };
        let Ok(Some((id, status, generation, deadline))) = result else {
            return false;
        };
        if let Some(deadline) = deadline {
            self.schedule_idle(id.clone(), generation, deadline);
        }
        if status == "stopped" {
            let _ = self.start(&id).await;
            return true;
        }
        matches!(
            status.as_str(),
            "requested" | "creating" | "starting" | "provisioning"
        )
    }

    pub async fn record_turn_activity(
        self: &Arc<Self>,
        device_id: &str,
        thread_id: &str,
        turn_id: &str,
        kind: &str,
    ) {
        let scheduled = {
            let conn = self.conn.lock().await;
            update_turn_activity(
                &conn,
                device_id,
                thread_id,
                turn_id,
                kind,
                self.config.idle_timeout,
            )
            .ok()
            .flatten()
        };
        if let Some((id, generation, deadline)) = scheduled {
            self.schedule_idle(id, generation, deadline);
        }
    }

    fn schedule_idle(self: &Arc<Self>, id: String, generation: i64, deadline: String) {
        let Ok(deadline) = DateTime::parse_from_rfc3339(&deadline) else {
            return;
        };
        let delay = (deadline.with_timezone(&Utc) - Utc::now())
            .to_std()
            .unwrap_or(Duration::ZERO);
        let service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            if service
                .claim_idle_stop(&id, generation)
                .await
                .unwrap_or(false)
                && service.reserve(&id).await.is_ok()
            {
                if let Ok(operation_id) = service.create_operation(&id, "stop").await {
                    service.spawn_action(id, operation_id, LifecycleAction::Stop, None);
                } else {
                    service.release(&id).await;
                }
            }
        });
    }

    async fn claim_idle_stop(&self, id: &str, generation: i64) -> HostedResult<bool> {
        let conn = self.conn.lock().await;
        let now = now_rfc3339();
        let changed = conn
            .execute(
                "UPDATE relay_hosted_sandboxes
                 SET status='stopping',idle_deadline_at=NULL,
                     lifecycle_generation=lifecycle_generation+1,updated_at=?1
                 WHERE id=?2 AND lifecycle_generation=?3 AND active_turn_count=0
                   AND status='online' AND idle_deadline_at<=?1",
                params![now, id, generation],
            )
            .map_err(HostedError::internal)?;
        Ok(changed == 1)
    }

    async fn record_user_activity(&self, id: &str, by_sandbox_id: bool) -> HostedResult<()> {
        let conn = self.conn.lock().await;
        let device_id: Option<String> = if by_sandbox_id {
            conn.query_row(
                "SELECT device_id FROM relay_hosted_sandboxes WHERE id=?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(HostedError::internal)?
        } else {
            Some(id.to_string())
        };
        let Some(device_id) = device_id else {
            return Err(HostedError::not_found("Hosted sandbox was not found."));
        };
        record_activity(&conn, &device_id, self.config.idle_timeout)
            .map_err(HostedError::internal)?;
        Ok(())
    }

    pub async fn reconciliation(&self) -> Value {
        self.latest_reconciliation.read().await.clone()
    }

    pub async fn run_reconciliation(&self) -> Value {
        let report = self.perform_reconciliation().await;
        *self.latest_reconciliation.write().await = report.clone();
        report
    }

    async fn perform_reconciliation(&self) -> Value {
        if !self.config.provider_configured() {
            return json!({
                "status": "unavailable", "checkedAt": now_rfc3339(),
                "errorCode": "hosted_inventory_unavailable",
                "missingInstanceSandboxIds": [], "missingCredentialSandboxIds": [],
                "orphanInstances": [], "orphanCredentials": [], "orphanSnapshotCount": 0
            });
        }
        let expected: Vec<(String, String)> = {
            let conn = self.conn.lock().await;
            let mut stmt = match conn
                .prepare("SELECT id,credential_ref FROM relay_hosted_sandboxes ORDER BY id")
            {
                Ok(stmt) => stmt,
                Err(_) => return unavailable_reconciliation(),
            };
            let values = match stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))) {
                Ok(rows) => rows.flatten().collect(),
                Err(_) => return unavailable_reconciliation(),
            };
            values
        };
        let inventory = match self.provider.inventory().await {
            Ok(value) => value,
            Err(_) => return unavailable_reconciliation(),
        };
        let instances = inventory
            .get("instances")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let credentials = inventory
            .get("credentials")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let expected_ids: HashSet<String> = expected.iter().map(|value| value.0.clone()).collect();
        let expected_credentials: HashSet<String> =
            expected.iter().map(|value| value.1.clone()).collect();
        let instance_ids: HashSet<String> = instances
            .iter()
            .filter_map(|value| value.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        let credential_ids: HashSet<String> = credentials
            .iter()
            .filter_map(|value| value.get("credentialRef").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        let orphan_instances: Vec<Value> = instances
            .into_iter()
            .filter(|value| {
                value
                    .get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !expected_ids.contains(id))
            })
            .collect();
        let orphan_credentials: Vec<Value> = credentials
            .into_iter()
            .filter(|value| {
                value
                    .get("credentialRef")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !expected_credentials.contains(id))
            })
            .collect();
        let missing_instances: Vec<&str> = expected
            .iter()
            .filter(|value| !instance_ids.contains(value.0.as_str()))
            .map(|value| value.0.as_str())
            .collect();
        let missing_credentials: Vec<&str> = expected
            .iter()
            .filter(|value| !credential_ids.contains(value.1.as_str()))
            .map(|value| value.0.as_str())
            .collect();
        let orphan_snapshot_count: usize = orphan_instances
            .iter()
            .filter_map(|value| value.get("snapshots").and_then(Value::as_array))
            .map(Vec::len)
            .sum();
        let issues = !orphan_instances.is_empty()
            || !orphan_credentials.is_empty()
            || !missing_instances.is_empty()
            || !missing_credentials.is_empty();
        json!({
            "status": if issues { "issues" } else { "healthy" },
            "checkedAt": inventory.get("checkedAt").cloned().unwrap_or_else(|| Value::String(now_rfc3339())),
            "errorCode": Value::Null,
            "missingInstanceSandboxIds": missing_instances,
            "missingCredentialSandboxIds": missing_credentials,
            "orphanInstances": orphan_instances,
            "orphanCredentials": orphan_credentials,
            "orphanSnapshotCount": orphan_snapshot_count
        })
    }

    pub async fn delete_orphan_instance(&self, id: &str) -> HostedResult<Value> {
        let report = self.run_reconciliation().await;
        let orphan = report
            .get("orphanInstances")
            .and_then(Value::as_array)
            .is_some_and(|values| {
                values
                    .iter()
                    .any(|value| value.get("id").and_then(Value::as_str) == Some(id))
            });
        if !orphan {
            return Err(HostedError::conflict(
                "The instance is no longer an orphan.",
            ));
        }
        self.provider
            .delete_instance(id, &format!("relay-orphan-instance-delete-{id}"))
            .await?;
        Ok(self.run_reconciliation().await)
    }

    pub async fn delete_orphan_credential(&self, credential_ref: &str) -> HostedResult<Value> {
        let report = self.run_reconciliation().await;
        let orphan = report
            .get("orphanCredentials")
            .and_then(Value::as_array)
            .is_some_and(|values| {
                values.iter().any(|value| {
                    value.get("credentialRef").and_then(Value::as_str) == Some(credential_ref)
                })
            });
        if !orphan {
            return Err(HostedError::conflict(
                "The credential is no longer an orphan.",
            ));
        }
        self.provider
            .delete_credential(
                credential_ref,
                &format!("relay-orphan-credential-delete-{credential_ref}"),
            )
            .await?;
        Ok(self.run_reconciliation().await)
    }

    pub async fn start_background(self: &Arc<Self>) {
        if !self.config.enabled() {
            return;
        }
        let ids = {
            let conn = self.conn.lock().await;
            conn.prepare(
                "SELECT id FROM relay_hosted_sandboxes
                 WHERE status IN ('requested','creating','starting','provisioning')
                 ORDER BY created_at",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(0))
                    .ok()
                    .map(|rows| rows.flatten().collect::<Vec<_>>())
            })
            .unwrap_or_default()
        };
        for id in ids {
            if self.reserve(&id).await.is_err() {
                continue;
            }
            let operation_id = {
                let conn = self.conn.lock().await;
                latest_create_operation(&conn, &id)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| {
                        let operation_id = Uuid::new_v4().to_string();
                        let now = now_rfc3339();
                        let _ = insert_operation(&conn, &operation_id, &id, "create", &now);
                        operation_id
                    })
            };
            self.spawn_action(id, operation_id, LifecycleAction::Create, None);
        }
        let idle_deadlines: Vec<(String, i64, String)> = {
            let conn = self.conn.lock().await;
            conn.prepare(
                "SELECT id,lifecycle_generation,idle_deadline_at
                 FROM relay_hosted_sandboxes
                 WHERE status='online' AND active_turn_count=0 AND idle_deadline_at IS NOT NULL",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                    .ok()
                    .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default()
        };
        for (id, generation, deadline) in idle_deadlines {
            self.schedule_idle(id, generation, deadline);
        }
        let service = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                service.run_reconciliation().await;
                tokio::time::sleep(service.config.reconcile_interval).await;
            }
        });
    }
}

pub fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS relay_hosted_sandboxes (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL UNIQUE REFERENCES relay_devices(id) ON DELETE CASCADE,
          assigned_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE RESTRICT,
          created_by_admin_user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE RESTRICT,
          provider TEXT NOT NULL CHECK (provider IN ('incus')),
          provider_instance_id TEXT,
          image_version TEXT NOT NULL,
          cpu_count INTEGER NOT NULL,
          memory_mib INTEGER NOT NULL,
          disk_gib INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'requested','creating','starting','provisioning','stopped','online','stopping','error','deleting'
          )),
          credential_ref TEXT NOT NULL,
          codex_config_json TEXT,
          last_error_code TEXT,
          last_error_message TEXT,
          active_turn_count INTEGER NOT NULL DEFAULT 0,
          last_user_activity_at TEXT,
          idle_deadline_at TEXT,
          lifecycle_generation INTEGER NOT NULL DEFAULT 0,
          workspace_isolation_enabled INTEGER NOT NULL DEFAULT 0,
          running_since TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS relay_hosted_sandboxes_assigned_idx
          ON relay_hosted_sandboxes(assigned_user_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS relay_hosted_sandboxes_status_idx
          ON relay_hosted_sandboxes(status,updated_at);
        CREATE TABLE IF NOT EXISTS relay_hosted_sandbox_members (
          sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(sandbox_id,user_id)
        );
        CREATE INDEX IF NOT EXISTS relay_hosted_sandbox_members_user_idx
          ON relay_hosted_sandbox_members(user_id,sandbox_id);
        CREATE TABLE IF NOT EXISTS relay_hosted_user_workspaces (
          sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          initial_workspace INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY(sandbox_id,workspace_id)
        );
        CREATE INDEX IF NOT EXISTS relay_hosted_user_workspaces_user_idx
          ON relay_hosted_user_workspaces(sandbox_id,user_id,created_at);
        CREATE TABLE IF NOT EXISTS relay_hosted_user_threads (
          sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(sandbox_id,thread_id)
        );
        CREATE INDEX IF NOT EXISTS relay_hosted_user_threads_user_idx
          ON relay_hosted_user_threads(sandbox_id,user_id,created_at);
        CREATE TABLE IF NOT EXISTS relay_hosted_operations (
          id TEXT PRIMARY KEY,
          sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
          action TEXT NOT NULL CHECK (action IN ('create','start','stop','snapshot','delete','rotate_credential')),
          status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed')),
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS relay_hosted_operations_sandbox_idx
          ON relay_hosted_operations(sandbox_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS relay_hosted_active_turns (
          sandbox_id TEXT NOT NULL REFERENCES relay_hosted_sandboxes(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          PRIMARY KEY(sandbox_id,thread_id,turn_id)
        );
        CREATE TABLE IF NOT EXISTS relay_pending_registrations (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          username TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          reviewed_at TEXT,
          reviewed_by_user_id TEXT,
          provider TEXT NOT NULL DEFAULT 'password',
          provider_subject TEXT
        );
        CREATE INDEX IF NOT EXISTS relay_pending_registrations_status_idx
          ON relay_pending_registrations(status,created_at DESC);
        CREATE TABLE IF NOT EXISTS relay_user_identities (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES relay_users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('google','github')),
          provider_subject TEXT NOT NULL,
          provider_email TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(provider,provider_subject)
        );
        ",
    )?;
    for (table, column, definition) in [
        (
            "relay_hosted_sandboxes",
            "active_turn_count",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("relay_hosted_sandboxes", "last_user_activity_at", "TEXT"),
        ("relay_hosted_sandboxes", "idle_deadline_at", "TEXT"),
        (
            "relay_hosted_sandboxes",
            "lifecycle_generation",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("relay_hosted_sandboxes", "codex_config_json", "TEXT"),
        (
            "relay_hosted_sandboxes",
            "workspace_isolation_enabled",
            "INTEGER NOT NULL DEFAULT 0",
        ),
        ("relay_hosted_sandboxes", "running_since", "TEXT"),
        (
            "relay_pending_registrations",
            "provider",
            "TEXT NOT NULL DEFAULT 'password'",
        ),
        ("relay_pending_registrations", "provider_subject", "TEXT"),
    ] {
        ensure_column(conn, table, column, definition)?;
    }
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let exists = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .flatten()
        .any(|value| value == column);
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))?;
    }
    Ok(())
}

#[derive(Clone)]
struct HostedRow {
    id: String,
    device_id: String,
    assigned_user_id: String,
    created_by_admin_user_id: String,
    provider_instance_id: Option<String>,
    image_version: String,
    cpu_count: i64,
    memory_mib: i64,
    disk_gib: i64,
    status: String,
    _credential_ref: String,
    last_error_code: Option<String>,
    last_error_message: Option<String>,
    active_turn_count: i64,
    last_user_activity_at: Option<String>,
    idle_deadline_at: Option<String>,
    _lifecycle_generation: i64,
    workspace_isolation_enabled: i64,
    running_since: Option<String>,
    created_at: String,
    updated_at: String,
}

impl HostedRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            device_id: row.get(1)?,
            assigned_user_id: row.get(2)?,
            created_by_admin_user_id: row.get(3)?,
            provider_instance_id: row.get(4)?,
            image_version: row.get(5)?,
            cpu_count: row.get(6)?,
            memory_mib: row.get(7)?,
            disk_gib: row.get(8)?,
            status: row.get(9)?,
            _credential_ref: row.get(10)?,
            last_error_code: row.get(11)?,
            last_error_message: row.get(12)?,
            active_turn_count: row.get(13)?,
            last_user_activity_at: row.get(14)?,
            idle_deadline_at: row.get(15)?,
            _lifecycle_generation: row.get(16)?,
            workspace_isolation_enabled: row.get(17)?,
            running_since: row.get(18)?,
            created_at: row.get(19)?,
            updated_at: row.get(20)?,
        })
    }
}

const HOSTED_SELECT: &str =
    "SELECT id,device_id,assigned_user_id,created_by_admin_user_id,provider_instance_id,
            image_version,cpu_count,memory_mib,disk_gib,status,credential_ref,
            last_error_code,last_error_message,active_turn_count,last_user_activity_at,
            idle_deadline_at,lifecycle_generation,workspace_isolation_enabled,running_since,
            created_at,updated_at FROM relay_hosted_sandboxes";

fn hosted_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT id FROM relay_hosted_sandboxes ORDER BY created_at DESC")?;
    let values = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn sandbox_json(conn: &Connection, id: &str, include_operations: bool) -> Result<Value> {
    let row = conn
        .query_row(
            &format!("{HOSTED_SELECT} WHERE id=?1"),
            params![id],
            HostedRow::from_row,
        )
        .optional()?
        .ok_or_else(|| anyhow!("Hosted sandbox was not found"))?;
    let members = members_json(conn, id)?;
    let primary = members.first();
    let device_name: String = conn
        .query_row(
            "SELECT name FROM relay_devices WHERE id=?1",
            params![row.device_id],
            |value| value.get(0),
        )
        .unwrap_or_else(|_| "Hosted supervisor VM".into());
    let assigned_user_id = primary
        .and_then(|value| value.get("userId"))
        .and_then(Value::as_str)
        .unwrap_or(&row.assigned_user_id);
    let assigned_username = primary
        .and_then(|value| value.get("username"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let mut value = json!({
        "id": row.id,
        "deviceId": row.device_id,
        "deviceName": device_name,
        "assignedUserId": assigned_user_id,
        "assignedUsername": assigned_username,
        "assignedUsers": members,
        "workspaceIsolationEnabled": row.workspace_isolation_enabled != 0,
        "createdByAdminUserId": row.created_by_admin_user_id,
        "provider": "incus",
        "providerInstanceId": row.provider_instance_id,
        "imageVersion": row.image_version,
        "resources": {
            "cpuCount": row.cpu_count,
            "memoryMiB": row.memory_mib,
            "diskGiB": row.disk_gib
        },
        "status": row.status,
        "lastErrorCode": row.last_error_code,
        "lastErrorMessage": row.last_error_message,
        "activeTurnCount": row.active_turn_count,
        "lastUserActivityAt": row.last_user_activity_at,
        "idleDeadlineAt": row.idle_deadline_at,
        "runningSince": row.running_since,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at
    });
    if include_operations {
        value["operations"] = Value::Array(operations_json(conn, id)?);
    }
    Ok(value)
}

fn require_sandbox_json(conn: &Connection, id: &str, detail: bool) -> HostedResult<Value> {
    sandbox_json(conn, id, detail).map_err(|error| {
        if error.to_string().contains("not found") {
            HostedError::not_found("Hosted sandbox was not found.")
        } else {
            HostedError::internal(error)
        }
    })
}

fn members_json(conn: &Connection, id: &str) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT u.id,u.username,u.email
         FROM relay_hosted_sandbox_members m JOIN relay_users u ON u.id=m.user_id
         WHERE m.sandbox_id=?1 ORDER BY m.position,m.created_at",
    )?;
    let values = stmt
        .query_map(params![id], |row| {
            Ok(json!({
                "userId": row.get::<_, String>(0)?,
                "username": row.get::<_, String>(1)?,
                "email": row.get::<_, String>(2)?
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn operations_json(conn: &Connection, id: &str) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id,sandbox_id,action,status,error_code,error_message,created_at,updated_at
         FROM relay_hosted_operations WHERE sandbox_id=?1 ORDER BY created_at DESC",
    )?;
    let values = stmt
        .query_map(params![id], operation_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn operation_json(conn: &Connection, id: &str) -> Result<Option<Value>> {
    Ok(conn
        .query_row(
            "SELECT id,sandbox_id,action,status,error_code,error_message,created_at,updated_at
             FROM relay_hosted_operations WHERE id=?1",
            params![id],
            operation_from_row,
        )
        .optional()?)
}

fn operation_from_row(row: &Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "sandboxId": row.get::<_, String>(1)?,
        "action": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(3)?,
        "errorCode": row.get::<_, Option<String>>(4)?,
        "errorMessage": row.get::<_, Option<String>>(5)?,
        "createdAt": row.get::<_, String>(6)?,
        "updatedAt": row.get::<_, String>(7)?
    }))
}

fn insert_operation(
    conn: &Connection,
    id: &str,
    sandbox_id: &str,
    action: &str,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO relay_hosted_operations
         (id,sandbox_id,action,status,error_code,error_message,created_at,updated_at)
         VALUES (?1,?2,?3,'pending',NULL,NULL,?4,?4)",
        params![id, sandbox_id, action, now],
    )?;
    Ok(())
}

fn latest_create_operation(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM relay_hosted_operations
             WHERE sandbox_id=?1 AND action='create' ORDER BY created_at DESC LIMIT 1",
            params![id],
            |row| row.get(0),
        )
        .optional()?)
}

fn provision_context(conn: &Connection, id: &str) -> Result<Option<ProvisionContext>> {
    Ok(conn
        .query_row(
            "SELECT s.id,s.device_id,d.token,s.image_version,s.cpu_count,s.memory_mib,s.disk_gib,
                    s.credential_ref,s.codex_config_json
             FROM relay_hosted_sandboxes s JOIN relay_devices d ON d.id=s.device_id
             WHERE s.id=?1",
            params![id],
            |row| {
                let token: Option<String> = row.get(2)?;
                Ok(ProvisionContext {
                    id: row.get(0)?,
                    device_id: row.get(1)?,
                    device_token: token.unwrap_or_default(),
                    image_version: row.get(3)?,
                    cpu_count: row.get(4)?,
                    memory_mib: row.get(5)?,
                    disk_gib: row.get(6)?,
                    credential_ref: row.get(7)?,
                    codex_config: row
                        .get::<_, Option<String>>(8)?
                        .and_then(|value| serde_json::from_str(&value).ok())
                        .unwrap_or_else(default_codex_config),
                })
            },
        )
        .optional()?
        .filter(|context| !context.device_token.is_empty()))
}

fn set_sandbox_status(
    conn: &Connection,
    id: &str,
    status: &str,
    provider_instance: Option<&str>,
    error_code: Option<&str>,
    error_message: Option<&str>,
) -> Result<()> {
    let now = now_rfc3339();
    let changed = conn.execute(
        "UPDATE relay_hosted_sandboxes SET
           status=?1,provider_instance_id=COALESCE(?2,provider_instance_id),
           last_error_code=?3,last_error_message=?4,
           running_since=CASE
             WHEN ?1='stopped' THEN NULL
             WHEN ?1='starting' AND running_since IS NULL THEN ?5
             ELSE running_since END,
           updated_at=?5 WHERE id=?6",
        params![
            status,
            provider_instance,
            error_code,
            error_message,
            now,
            id
        ],
    )?;
    if changed == 0 {
        return Err(anyhow!("Hosted sandbox was not found"));
    }
    Ok(())
}

fn validate_admin(conn: &Connection, id: &str) -> HostedResult<()> {
    let role: Option<String> = conn
        .query_row(
            "SELECT role FROM relay_users WHERE id=?1 AND enabled=1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(HostedError::internal)?;
    if role.as_deref() != Some("admin") {
        return Err(HostedError::bad_request(
            "An enabled admin account is required.",
        ));
    }
    Ok(())
}

fn validate_members(conn: &Connection, ids: &[String]) -> HostedResult<()> {
    let unique: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if !(1..=20).contains(&ids.len()) || unique.len() != ids.len() {
        return Err(HostedError::bad_request(
            "A hosted VM requires between 1 and 20 unique assigned users.",
        ));
    }
    for id in ids {
        let valid = conn
            .query_row(
                "SELECT 1 FROM relay_users WHERE id=?1 AND role='user' AND enabled=1",
                params![id],
                |_| Ok(()),
            )
            .optional()
            .map_err(HostedError::internal)?
            .is_some();
        if !valid {
            return Err(HostedError::bad_request(
                "Hosted VMs can only be assigned to enabled user accounts.",
            ));
        }
    }
    Ok(())
}

fn validate_create_input(input: &CreateHostedInput) -> HostedResult<()> {
    if input.device_name.trim().is_empty() || input.device_name.len() > 120 {
        return Err(HostedError::bad_request("Device name is required."));
    }
    if !matches!(
        input.image_version.as_str(),
        "ubuntu-24.04-v1"
            | "ubuntu-24.04-v2"
            | "ubuntu-24.04-v3"
            | "ubuntu-24.04-v4"
            | "ubuntu-24.04-v5"
    ) {
        return Err(HostedError::bad_request(
            "Unsupported hosted image version.",
        ));
    }
    if input.backends.as_slice() != ["codex"] {
        return Err(HostedError::bad_request(
            "Only the Codex backend is supported.",
        ));
    }
    if !(1..=2).contains(&input.resources.cpu_count)
        || !(1024..=2048).contains(&input.resources.memory_mib)
        || !(10..=12).contains(&input.resources.disk_gib)
    {
        return Err(HostedError::bad_request(
            "Hosted VM resources are outside the allowed range.",
        ));
    }
    validate_codex_files(&input.codex_files)
}

fn validate_codex_files(files: &CodexFiles) -> HostedResult<()> {
    if files.config_toml.is_empty()
        || files.config_toml.len() > 128 * 1024
        || files.auth_json.len() < 2
        || files.auth_json.len() > 128 * 1024
    {
        return Err(HostedError::bad_request("Invalid Codex credential files."));
    }
    Ok(())
}

fn valid_snapshot_name(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= 63
        && first.is_ascii_alphanumeric()
        && chars.all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
}

fn default_codex_config() -> Value {
    json!({
        "modelProvider": "OpenAI",
        "model": "gpt-5.4",
        "reviewModel": "gpt-5.4",
        "reasoningEffort": "medium",
        "baseUrl": "https://api.openai.com/v1",
        "wireApi": "responses",
        "requiresOpenaiAuth": true,
        "disableResponseStorage": true,
        "networkAccess": "enabled",
        "goals": true
    })
}

fn action_name(action: LifecycleAction) -> &'static str {
    match action {
        LifecycleAction::Create => "create",
        LifecycleAction::Start => "start",
        LifecycleAction::Stop => "stop",
        LifecycleAction::Delete => "delete",
        LifecycleAction::Snapshot => "snapshot",
        LifecycleAction::RotateCredential => "rotate_credential",
    }
}

fn unavailable_capability(code: &str, reason: &str) -> Value {
    json!({
        "provider": "incus", "configured": true, "reachable": false,
        "available": false, "reasonCode": code, "reason": reason,
        "checkedAt": now_rfc3339()
    })
}

fn empty_reconciliation() -> Value {
    json!({
        "status": "never_run", "checkedAt": Value::Null, "errorCode": Value::Null,
        "missingInstanceSandboxIds": [], "missingCredentialSandboxIds": [],
        "orphanInstances": [], "orphanCredentials": [], "orphanSnapshotCount": 0
    })
}

fn unavailable_reconciliation() -> Value {
    json!({
        "status": "unavailable", "checkedAt": now_rfc3339(),
        "errorCode": "hosted_inventory_unavailable",
        "missingInstanceSandboxIds": [], "missingCredentialSandboxIds": [],
        "orphanInstances": [], "orphanCredentials": [], "orphanSnapshotCount": 0
    })
}

fn new_device_token() -> String {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    format!(
        "rcd_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

fn path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn token_hash(token: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))
}

fn preview_token(token: &str) -> String {
    if token.len() <= 12 {
        return token.to_string();
    }
    format!("{}...{}", &token[..7], &token[token.len() - 4..])
}

fn nonempty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_u64(name: &str, default: u64) -> u64 {
    nonempty_env(name)
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

type HostedStatus = (String, String, i64, Option<String>);

fn hosted_status(conn: &Connection, device_id: &str) -> Result<Option<HostedStatus>> {
    Ok(conn
        .query_row(
            "SELECT id,status,lifecycle_generation,idle_deadline_at
             FROM relay_hosted_sandboxes WHERE device_id=?1",
            params![device_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?)
}

fn record_activity(
    conn: &Connection,
    device_id: &str,
    idle_timeout: Duration,
) -> Result<Option<HostedStatus>> {
    let Some((id, status, _, _)) = hosted_status(conn, device_id)? else {
        return Ok(None);
    };
    let active: i64 = conn.query_row(
        "SELECT active_turn_count FROM relay_hosted_sandboxes WHERE id=?1",
        params![id],
        |row| row.get(0),
    )?;
    let now = Utc::now();
    let deadline = (active == 0)
        .then(|| (now + chrono::Duration::from_std(idle_timeout).unwrap_or_default()).to_rfc3339());
    conn.execute(
        "UPDATE relay_hosted_sandboxes
         SET last_user_activity_at=?1,idle_deadline_at=?2,
             lifecycle_generation=lifecycle_generation+1,updated_at=?1 WHERE id=?3",
        params![now.to_rfc3339(), deadline, id],
    )?;
    let generation: i64 = conn.query_row(
        "SELECT lifecycle_generation FROM relay_hosted_sandboxes WHERE id=?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(Some((id, status, generation, deadline)))
}

fn arm_idle_deadline(
    conn: &Connection,
    device_id: &str,
    idle_timeout: Duration,
) -> Result<Option<(String, i64, String)>> {
    let Some((id, status, _, existing)) = hosted_status(conn, device_id)? else {
        return Ok(None);
    };
    if status != "online" {
        return Ok(None);
    }
    let active: i64 = conn.query_row(
        "SELECT active_turn_count FROM relay_hosted_sandboxes WHERE id=?1",
        params![id],
        |row| row.get(0),
    )?;
    if active > 0 {
        return Ok(None);
    }
    let deadline = existing.unwrap_or_else(|| {
        (Utc::now() + chrono::Duration::from_std(idle_timeout).unwrap_or_default()).to_rfc3339()
    });
    conn.execute(
        "UPDATE relay_hosted_sandboxes
         SET idle_deadline_at=?1,lifecycle_generation=lifecycle_generation+1,updated_at=?2
         WHERE id=?3 AND active_turn_count=0",
        params![deadline, now_rfc3339(), id],
    )?;
    let generation: i64 = conn.query_row(
        "SELECT lifecycle_generation FROM relay_hosted_sandboxes WHERE id=?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(Some((id, generation, deadline)))
}

fn update_turn_activity(
    conn: &Connection,
    device_id: &str,
    thread_id: &str,
    turn_id: &str,
    kind: &str,
    idle_timeout: Duration,
) -> Result<Option<(String, i64, String)>> {
    let Some((id, status, _, _)) = hosted_status(conn, device_id)? else {
        return Ok(None);
    };
    let tx = conn.unchecked_transaction()?;
    if kind == "turn_started" {
        tx.execute(
            "INSERT OR IGNORE INTO relay_hosted_active_turns
             (sandbox_id,thread_id,turn_id,started_at) VALUES (?1,?2,?3,?4)",
            params![id, thread_id, turn_id, now_rfc3339()],
        )?;
    } else if kind == "turn_terminal" {
        tx.execute(
            "DELETE FROM relay_hosted_active_turns
             WHERE sandbox_id=?1 AND thread_id=?2 AND turn_id=?3",
            params![id, thread_id, turn_id],
        )?;
    } else {
        return Ok(None);
    }
    let active: i64 = tx.query_row(
        "SELECT COUNT(*) FROM relay_hosted_active_turns WHERE sandbox_id=?1",
        params![id],
        |row| row.get(0),
    )?;
    let deadline = (active == 0 && status == "online").then(|| {
        (Utc::now() + chrono::Duration::from_std(idle_timeout).unwrap_or_default()).to_rfc3339()
    });
    tx.execute(
        "UPDATE relay_hosted_sandboxes SET active_turn_count=?1,idle_deadline_at=?2,
         lifecycle_generation=lifecycle_generation+1,updated_at=?3 WHERE id=?4",
        params![active, deadline, now_rfc3339(), id],
    )?;
    tx.commit()?;
    if let Some(deadline) = deadline {
        let generation: i64 = conn.query_row(
            "SELECT lifecycle_generation FROM relay_hosted_sandboxes WHERE id=?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(Some((id, generation, deadline)))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    use axum::extract::{Request, State};
    use axum::{Json, Router};

    async fn fake_host_agent(
        State(calls): State<Arc<StdMutex<Vec<String>>>>,
        request: Request,
    ) -> Json<Value> {
        let path = request.uri().path().to_string();
        if path.ends_with("/start") {
            tokio::time::sleep(Duration::from_millis(75)).await;
        }
        calls.lock().unwrap().push(format!(
            "{} {} {}",
            request.method(),
            path,
            request
                .headers()
                .get("idempotency-key")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
        ));
        let value = match (request.method().as_str(), path.as_str()) {
            ("GET", "/v1/capability") => json!({
                "available": true,
                "credentialStoreReady": true,
                "limits": { "maxInstances": 4, "maxRunningInstances": 2 },
                "capacity": { "totalInstances": 0, "runningInstances": 0 }
            }),
            ("GET", "/v1/inventory") => json!({
                "instances": [], "credentials": [], "checkedAt": now_rfc3339()
            }),
            ("POST", "/v1/credentials") => json!({ "credentialRef": "credential-1" }),
            ("POST", "/v1/instances") => json!({
                "id": "sandbox", "name": "rcd-sandbox", "status": "stopped", "statusCode": 102
            }),
            ("GET", value) if value.ends_with("/backends/codex/files") => json!({
                "configToml": "model = \"gpt-5.4\"", "authJson": "{}"
            }),
            _ => json!({}),
        };
        Json(value)
    }

    async fn fake_host() -> (String, Arc<StdMutex<Vec<String>>>) {
        let calls = Arc::new(StdMutex::new(Vec::new()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .fallback(fake_host_agent)
            .with_state(calls.clone());
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), calls)
    }

    fn service_database() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE relay_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             CREATE TABLE relay_users(
               id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,username TEXT NOT NULL UNIQUE,
               role TEXT NOT NULL,enabled INTEGER NOT NULL,last_seen_at TEXT,created_at TEXT NOT NULL,
               password_salt TEXT NOT NULL,password_hash TEXT NOT NULL
             );
             CREATE TABLE relay_devices(
               id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL REFERENCES relay_users(id),
               name TEXT NOT NULL,token TEXT,token_hash TEXT NOT NULL UNIQUE,
               token_preview TEXT NOT NULL,created_at TEXT NOT NULL
             );
             INSERT INTO relay_users VALUES
               ('admin','admin@example.test','admin','admin',1,NULL,'2026-01-01T00:00:00Z','salt','hash'),
               ('user','user@example.test','user','user',1,NULL,'2026-01-01T00:00:00Z','salt','hash');",
        )
        .unwrap();
        ensure_schema(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    async fn wait_for_status(service: &HostedService, id: &str, status: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let detail = service.detail(id).await.unwrap();
                if detail["status"] == status {
                    return detail;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }

    async fn wait_for_operation(service: &HostedService, id: &str, operation_id: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let detail = service.detail(id).await.unwrap();
                let operation = detail["operations"].as_array().and_then(|operations| {
                    operations
                        .iter()
                        .find(|operation| operation["id"].as_str() == Some(operation_id))
                });
                if let Some(operation) = operation {
                    if operation["status"] == "succeeded" {
                        return detail;
                    }
                    assert_ne!(operation["status"], "failed", "{operation}");
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }

    #[test]
    fn schema_creates_hosted_and_oauth_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE relay_users(id TEXT PRIMARY KEY);
             CREATE TABLE relay_devices(id TEXT PRIMARY KEY);",
        )
        .unwrap();
        ensure_schema(&conn).unwrap();
        for table in [
            "relay_hosted_sandboxes",
            "relay_hosted_sandbox_members",
            "relay_hosted_operations",
            "relay_pending_registrations",
            "relay_user_identities",
        ] {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "{table}");
        }
    }

    #[test]
    fn snapshot_names_match_node_policy() {
        assert!(valid_snapshot_name("before-update_1.2"));
        assert!(!valid_snapshot_name(""));
        assert!(!valid_snapshot_name("bad name"));
        assert!(!valid_snapshot_name("-bad"));
    }

    #[tokio::test]
    async fn create_and_stop_saga_uses_the_incus_host_agent_contract() {
        let (agent_url, calls) = fake_host().await;
        let conn = service_database();
        let service = HostedService::new(
            conn,
            HostedConfig {
                provider: "incus".into(),
                agent_url: Some(agent_url),
                agent_token: Some("test-host-agent-token".into()),
                relay_server_url: Some("wss://relay.example.test".into()),
                request_timeout: Duration::from_millis(20),
                idle_timeout: Duration::from_secs(60),
                reconcile_interval: Duration::from_secs(60),
            },
        )
        .unwrap();
        let created = service
            .create(
                "admin",
                CreateHostedInput {
                    assigned_user_ids: vec!["user".into()],
                    device_name: "Hosted test".into(),
                    image_version: "ubuntu-24.04-v5".into(),
                    resources: HostedResources {
                        cpu_count: 1,
                        memory_mib: 1536,
                        disk_gib: 10,
                    },
                    backends: vec!["codex".into()],
                    codex_files: CodexFiles {
                        config_toml: "model = \"gpt-5.4\"".into(),
                        auth_json: "{}".into(),
                    },
                },
            )
            .await
            .unwrap();
        let id = created["sandbox"]["id"].as_str().unwrap().to_string();
        let create_operation_id = created["operation"]["id"].as_str().unwrap();
        let detail = wait_for_operation(&service, &id, create_operation_id).await;
        assert_eq!(detail["status"], "starting");
        assert_eq!(detail["assignedUsers"][0]["userId"], "user");
        assert_eq!(detail["operations"][0]["status"], "succeeded");
        let device_id = detail["deviceId"].as_str().unwrap();
        service.mark_online(device_id).await;
        wait_for_status(&service, &id, "online").await;
        service
            .record_turn_activity(device_id, "thread-1", "turn-1", "turn_started")
            .await;
        let active = service.detail(&id).await.unwrap();
        assert_eq!(active["activeTurnCount"], 1);
        assert!(active["idleDeadlineAt"].is_null());
        service
            .record_turn_activity(device_id, "thread-1", "turn-1", "turn_terminal")
            .await;
        let inactive = service.detail(&id).await.unwrap();
        assert_eq!(inactive["activeTurnCount"], 0);
        assert!(inactive["idleDeadlineAt"].is_string());

        let files = service.read_codex_files(&id).await.unwrap();
        assert_eq!(files["authJson"], "{}");
        service
            .write_codex_files(
                &id,
                &CodexFiles {
                    config_toml: "model = \"gpt-5.6-sol\"".into(),
                    auth_json: "{}".into(),
                },
            )
            .await
            .unwrap();
        let snapshot = service.snapshot(&id, "before-upgrade").await.unwrap();
        let snapshot_operation_id = snapshot["operation"]["id"].as_str().unwrap();
        wait_for_operation(&service, &id, snapshot_operation_id).await;
        let stop = service.stop(&id).await.unwrap();
        let stop_operation_id = stop["operation"]["id"].as_str().unwrap();
        let stopped = wait_for_operation(&service, &id, stop_operation_id).await;
        assert_eq!(stopped["status"], "stopped");
        {
            let conn = service.conn.lock().await;
            conn.execute(
                "DELETE FROM relay_settings WHERE key=?1",
                params![format!("hostedProvisionedRelayUrl:{id}")],
            )
            .unwrap();
        }
        let restarted = service.start(&id).await.unwrap();
        let restart_operation_id = restarted["operation"]["id"].as_str().unwrap();
        wait_for_operation(&service, &id, restart_operation_id).await;
        let rotated = service
            .rotate_credential(&id, "sk-test-credential-value-with-enough-characters")
            .await
            .unwrap();
        let rotate_operation_id = rotated["operation"]["id"].as_str().unwrap();
        wait_for_operation(&service, &id, rotate_operation_id).await;
        service.delete(&id).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if service.detail(&id).await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();

        let calls = calls.lock().unwrap().clone();
        assert!(calls
            .iter()
            .any(|call| call.starts_with("POST /v1/credentials relay-credential-")));
        assert!(calls
            .iter()
            .any(|call| call.contains("POST /v1/instances relay-sandbox-create-")));
        assert!(calls
            .iter()
            .any(|call| call.contains("/start relay-sandbox-start-")));
        assert!(calls
            .iter()
            .any(|call| call.contains("/provision relay-sandbox-provision-")));
        assert!(calls
            .iter()
            .any(|call| call.contains("/stop relay-sandbox-stop-action-")));
        assert!(calls
            .iter()
            .any(|call| call.contains("/snapshots relay-sandbox-snapshot-")));
        assert!(calls.iter().any(|call| {
            call.starts_with("PUT ") && call.contains("/backends/codex/files relay-codex-files-")
        }));
        assert!(calls
            .iter()
            .any(|call| { call.starts_with("DELETE ") && call.contains("/v1/instances/") }));
        assert_eq!(
            calls
                .iter()
                .filter(|call| call.contains("/provision relay-sandbox-"))
                .count(),
            3,
            "create, historical URL migration, and credential rotation must provision the VM"
        );
    }
}
