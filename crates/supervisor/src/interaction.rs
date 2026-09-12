use super::http::{map_err, ApiErr};
use axum::{extract::State, Json};
use remote_codex_protocol::{CreateThreadInput, Provider};
use remote_codex_runtime::{
    interaction::{SendInput, TranscriptQuery},
    Supervisor,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub(crate) async fn command(
    State(state): State<Arc<Supervisor>>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiErr> {
    async fn run(state: &Supervisor, input: Value) -> anyhow::Result<Value> {
        let id = input.get("threadId").and_then(Value::as_str).unwrap_or("");
        match input.get("operation").and_then(Value::as_str).unwrap_or("") {
            "info" => Ok(json!({"deviceId":state.db.host_id})),
            "list" => {
                let threads =
                    state.list_threads(input.get("workspaceId").and_then(Value::as_str))?;
                let limit = input["limit"].as_u64().unwrap_or(20).clamp(1, 100) as usize;
                Ok(
                    json!({"threads":threads.iter().take(limit).map(|t|json!({"id":t.id,"title":t.title,"workspaceId":t.workspace_id,"provider":t.provider,"agentId":t.agent_id,"model":t.model,"status":t.status,"updatedAt":t.updated_at})).collect::<Vec<_>>(),"totalCount":threads.len()}),
                )
            }
            "show" | "status" => state.interaction_status(id).await,
            "send" => {
                let body = serde_json::from_value::<SendInput>(input.clone())?;
                let mut receipt = state.send_to_thread(id, body)?;
                if receipt["delivery"] == "steer" {
                    let pending = receipt["pendingSteerId"].as_str().unwrap();
                    match state.steer_pending_prompt(id, pending).await {
                        Ok(_) => receipt["delivery"] = json!("steered"),
                        Err(error) => {
                            // Kept as an explicitly held pending message; the
                            // background continuation worker never runs it.
                            receipt["delivery"] = json!("held");
                            receipt["error"] = json!(error.to_string());
                        }
                    }
                }
                Ok(receipt)
            }
            "inbox" => state.inbox_list(id, &input),
            "inboxRead" => state.inbox_read(id, &input),
            "inboxAck" => state.inbox_ack(id, &input),
            "transcript" => state.transcript(
                id,
                &serde_json::from_value::<TranscriptQuery>(input.clone())?,
            ),
            "backends" => Ok(serde_json::to_value(state.backends())?),
            "models" => {
                let provider = serde_json::from_value::<Provider>(
                    input.get("provider").cloned().unwrap_or(json!("acp")),
                )?;
                let cwd = if let Some(from) = input["fromThreadId"].as_str() {
                    state
                        .get_workspace(&state.get_thread(from)?.workspace_id)?
                        .abs_path
                } else {
                    state.config.workspace_root.to_string_lossy().into_owned()
                };
                Ok(serde_json::to_value(
                    state
                        .list_models(provider, input["agentId"].as_str(), Some(&cwd))
                        .await?,
                )?)
            }
            "create" => {
                let mut input = input;
                let from = input["fromThreadId"].as_str().map(str::to_owned);
                if let Some(from) = from {
                    let caller = state.get_thread(&from)?;
                    if input.get("workspaceId").is_none() {
                        input["workspaceId"] = json!(caller.workspace_id);
                    }
                    if input.get("approvalMode").is_none() {
                        input["approvalMode"] = json!(caller.approval_mode);
                    }
                }
                let create: CreateThreadInput = serde_json::from_value(input)?;
                let provider = create.provider.unwrap_or_else(|| state.default_provider());
                let cwd = state.get_workspace(&create.workspace_id)?.abs_path;
                let models = state
                    .list_models(provider, create.agent_id.as_deref(), Some(&cwd))
                    .await?;
                let model = models
                    .iter()
                    .find(|m| m.id == create.model || m.model == create.model);
                anyhow::ensure!(
                    create.model == "default" || model.is_some(),
                    "model not available; use thread models for this provider/agent"
                );
                if let Some(effort) = create.reasoning_effort.as_deref() {
                    anyhow::ensure!(
                        model.is_some_and(|m| m
                            .supported_reasoning_efforts
                            .iter()
                            .any(|e| e.reasoning_effort == effort)),
                        "reasoning effort not available for this model"
                    );
                }
                let t = state.create_thread(create).await?;
                Ok(
                    json!({"threadId":t.id,"workspaceId":t.workspace_id,"provider":t.provider,"agentId":t.agent_id,"model":t.model,"reasoningEffort":t.reasoning_effort,"status":t.status}),
                )
            }
            _ => anyhow::bail!("unknown CLI operation"),
        }
    }
    Ok(Json(run(&state, input).await.map_err(map_err)?))
}
