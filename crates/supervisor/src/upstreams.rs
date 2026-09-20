use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use remote_codex_runtime::{management, upstreams as profiles, Supervisor};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
type Failure = (StatusCode, Json<Value>);
fn failure(e: impl std::fmt::Display) -> Failure {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"code":"upstream_error","message":e.to_string()})),
    )
}
fn conflict() -> Failure {
    (
        StatusCode::CONFLICT,
        Json(
            json!({"code":"conflict","message":"This harness is busy. Wait for its tasks to finish before changing configuration."}),
        ),
    )
}
pub async fn list(State(s): State<Arc<Supervisor>>) -> Result<Json<Value>, Failure> {
    let _g = s.upstream_gate.lock().await;
    profiles::inventory(&profiles::directory(&s.config.database_url))
        .map(Json)
        .map_err(failure)
}
pub async fn save(
    State(s): State<Arc<Supervisor>>,
    Json(p): Json<profiles::Profile>,
) -> Result<Json<Value>, Failure> {
    let _g = s.upstream_gate.lock().await;
    profiles::upsert(&profiles::directory(&s.config.database_url), p)
        .map(Json)
        .map_err(failure)
}
pub async fn models(
    State(s): State<Arc<Supervisor>>,
    Json(input): Json<profiles::DiscoveryInput>,
) -> Result<Json<Value>, Failure> {
    let p = {
        let _g = s.upstream_gate.lock().await;
        profiles::discovery_profile(&profiles::directory(&s.config.database_url), input)
            .map_err(failure)?
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(25),
        profiles::discover_models(&p),
    )
    .await
    .map_err(|_| failure("Model discovery timed out. Try loading models again."))?
    .map(Json)
    .map_err(failure)
}
pub async fn delete(
    State(s): State<Arc<Supervisor>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, Failure> {
    let _g = s.upstream_gate.lock().await;
    profiles::remove(&profiles::directory(&s.config.database_url), &id).map_err(failure)?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Action {
    action: String,
}
pub async fn action(
    State(s): State<Arc<Supervisor>>,
    Path(id): Path<String>,
    Json(input): Json<Action>,
) -> Result<Json<Value>, Failure> {
    let _g = s.upstream_gate.lock().await;
    let dir = profiles::directory(&s.config.database_url);
    if input.action == "restore" {
        let harness = profiles::backup_harness(&dir, &id).map_err(failure)?;
        let _maintenance = s
            .maintenance_gate
            .clone()
            .try_read_owned()
            .map_err(|_| conflict())?;
        let _guard = s
            .harness_gate(&harness)
            .try_write_owned()
            .map_err(|_| conflict())?;
        s.restart_harness(&harness).await.map_err(failure)?;
        profiles::restore(&dir, &id).map_err(failure)?;
        return Ok(Json(json!({"ok":true,"restartRequired":false})));
    }
    let p = profiles::profile(&dir, &id).map_err(failure)?;
    if input.action == "test" {
        return profiles::test_connection(&p)
            .await
            .map(Json)
            .map_err(failure);
    }
    if input.action != "activate" {
        return Err(failure("Unknown upstream action"));
    }
    let _maintenance = s
        .maintenance_gate
        .clone()
        .try_read_owned()
        .map_err(|_| conflict())?;
    let _guard = s
        .harness_gate(&p.harness)
        .try_write_owned()
        .map_err(|_| conflict())?;
    // Stop idle sessions before changing their configuration, so the next turn
    // always starts with one complete configuration. Active turns are gated.
    let restarted = s.restart_harness(&p.harness).await.map_err(failure)?;
    let backup = profiles::activate(&dir, &id).map_err(failure)?;
    Ok(Json(
        json!({"ok":true,"backupId":backup,"restartedSessions":restarted,"restartRequired":false}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Import {
    template: Value,
    #[serde(default)]
    apply: bool,
}
pub async fn template(
    State(s): State<Arc<Supervisor>>,
    Json(input): Json<Import>,
) -> Result<Response, Failure> {
    let template = profiles::parse_template(input.template).map_err(failure)?;
    let preview = json!({"harnesses":template.harnesses,"profiles":template.profiles.iter().map(|p|json!({"name":p.name,"harness":p.harness,"baseUrl":p.base_url,"model":p.model})).collect::<Vec<_>>()});
    if !input.apply {
        return Ok(Json(preview).into_response());
    }
    let gate = s
        .upstream_gate
        .clone()
        .try_lock_owned()
        .map_err(|_| conflict())?;
    let maintenance = s
        .maintenance_gate
        .clone()
        .try_read_owned()
        .map_err(|_| conflict())?;
    let mut ids = template.harnesses.clone();
    ids.extend(template.profiles.iter().map(|p| p.harness.clone()));
    ids.sort();
    ids.dedup();
    let mut guards = vec![];
    for id in ids {
        guards.push(
            s.harness_gate(&id)
                .try_write_owned()
                .map_err(|_| conflict())?,
        );
    }
    s.management_jobs.lock().unwrap().insert(
        "template".into(),
        json!({"state":"running","action":"configure"}),
    );
    tokio::spawn(async move {
        let (_gate, _maintenance, _guards) = (gate, maintenance, guards);
        let dir = profiles::directory(&s.config.database_url);
        let mut completed = vec![];
        let result = async {
            for id in template.harnesses {
                let def =
                    remote_codex_runtime::acp::builtin_agents(s.config.acp_command.as_deref())
                        .into_iter()
                        .find(|d| d.id == id)
                        .ok_or_else(|| anyhow::anyhow!("Unknown harness"))?;
                if management::resolve(&def.base_command).is_err() {
                    management::install_harness(&s, &id).await?;
                } else {
                    management::ensure_adapter(&def).await?;
                }
                completed.push(format!("Installed or already available: {id}"));
            }
            for mut p in template.profiles {
                p.id.clear();
                let saved = profiles::upsert(&dir, p.clone())?;
                s.restart_harness(&p.harness).await?;
                profiles::activate(&dir, saved["id"].as_str().unwrap())?;
                completed.push(format!("Configured: {}", p.harness));
            }
            Ok::<_, anyhow::Error>(())
        }
        .await;
        let job = match result {
            Ok(()) => json!({"state":"completed","action":"configure","completed":completed}),
            Err(e) => {
                json!({"state":"failed","action":"configure","error":e.to_string(),"completed":completed})
            }
        };
        s.management_jobs
            .lock()
            .unwrap()
            .insert("template".into(), job);
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"state":"running","preview":preview})),
    )
        .into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigImport {
    harness: String,
    name: String,
    config: String,
    #[serde(default)]
    api_key: String,
}
pub async fn import_config(
    State(s): State<Arc<Supervisor>>,
    Json(i): Json<ConfigImport>,
) -> Result<Json<Value>, Failure> {
    let p = profiles::import_config(&i.harness, &i.name, &i.config, &i.api_key).map_err(failure)?;
    let _g = s.upstream_gate.lock().await;
    profiles::upsert(&profiles::directory(&s.config.database_url), p)
        .map(Json)
        .map_err(failure)
}
