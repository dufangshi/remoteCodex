use remote_codex_protocol::{ModelOptionDto, ReasoningEffortOptionDto};
use serde_json::{json, Value};

use super::adapter::{HarnessProjection, SessionSettingOp};

pub fn normalize_acp_effort(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match normalized.as_str() {
        "none" | "off" => Some("none".into()),
        "minimal" | "low" | "medium" | "high" | "max" | "ultra" => Some(normalized),
        "xhigh" | "extra_high" => Some("xhigh".into()),
        "auto" | "" => None,
        _ => None,
    }
}

pub fn project_session(response: &Value) -> Option<HarnessProjection> {
    let models = response.get("models")?;
    let available = models.get("availableModels")?.as_array()?;
    let current_id = models
        .get("currentModelId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut projected = Vec::new();
    for (index, model) in available.iter().enumerate() {
        let model_id = model.get("modelId").and_then(Value::as_str)?;
        let meta = model.get("_meta").cloned().unwrap_or(json!({}));
        let efforts = grok_efforts(&meta);
        let declared_default = meta
            .get("reasoningEfforts")
            .and_then(Value::as_array)
            .and_then(|entries| {
                entries.iter().find(|entry| {
                    entry
                        .get("default")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
            })
            .and_then(|entry| {
                normalize_acp_effort(
                    entry
                        .get("value")
                        .and_then(Value::as_str)
                        .or_else(|| entry.get("id").and_then(Value::as_str)),
                )
            });
        let default_effort =
            normalize_acp_effort(meta.get("reasoningEffort").and_then(Value::as_str))
                .or(declared_default);
        projected.push(ModelOptionDto {
            id: model_id.to_string(),
            model: model_id.to_string(),
            display_name: model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(model_id)
                .to_string(),
            description: model
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            is_default: current_id.as_deref() == Some(model_id)
                || (current_id.is_none() && index == 0),
            hidden: false,
            supported_reasoning_efforts: efforts,
            default_reasoning_effort: default_effort,
            selection_kind: Some("model".into()),
            acp_agent: None,
        });
    }
    if projected.is_empty() {
        return None;
    }
    let selected = projected
        .iter()
        .find(|model| current_id.as_deref() == Some(model.model.as_str()))
        .or(projected.first())?;
    Some(HarnessProjection {
        state: models.clone(),
        models: projected.clone(),
        model: current_id.or_else(|| Some(selected.model.clone())),
        reasoning_effort: selected.default_reasoning_effort.clone(),
    })
}

pub fn apply_model(model: &str) -> SessionSettingOp {
    SessionSettingOp::SetModel {
        model_id: model.to_string(),
    }
}

pub fn apply_reasoning(effort: &str, state: &Value) -> Option<SessionSettingOp> {
    let wanted = normalize_acp_effort(Some(effort))?;
    let current_id = state.get("currentModelId").and_then(Value::as_str);
    let models = state.get("availableModels")?.as_array()?;
    let model = models
        .iter()
        .find(|entry| entry.get("modelId").and_then(Value::as_str) == current_id)
        .or(models.first())?;
    let selected = model
        .get("_meta")
        .and_then(|meta| meta.get("reasoningEfforts"))
        .and_then(Value::as_array)?
        .iter()
        .find(|entry| {
            normalize_acp_effort(
                entry
                    .get("value")
                    .and_then(Value::as_str)
                    .or_else(|| entry.get("id").and_then(Value::as_str)),
            )
            .as_deref()
                == Some(wanted.as_str())
        })?;
    let value = selected
        .get("value")
        .and_then(Value::as_str)
        .or_else(|| selected.get("id").and_then(Value::as_str))?;
    Some(SessionSettingOp::LoadWithMeta {
        meta: json!({ "reasoningEffort": value }),
    })
}

fn grok_efforts(meta: &Value) -> Vec<ReasoningEffortOptionDto> {
    meta.get("reasoningEfforts")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let raw = entry
                        .get("value")
                        .and_then(Value::as_str)
                        .or_else(|| entry.get("id").and_then(Value::as_str))?;
                    Some(ReasoningEffortOptionDto {
                        reasoning_effort: normalize_acp_effort(Some(raw))?,
                        description: entry
                            .get("description")
                            .and_then(Value::as_str)
                            .or_else(|| entry.get("label").and_then(Value::as_str))
                            .unwrap_or(raw)
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_grok_legacy_model_metadata() {
        let projected = project_session(&json!({
            "models": {
                "currentModelId": "grok-4.6",
                "availableModels": [{
                    "modelId": "grok-4.6",
                    "name": "Grok 4.6",
                    "_meta": {
                        "reasoningEffort": "high",
                        "reasoningEfforts": [
                            { "value": "low", "label": "Low" },
                            { "value": "high", "label": "High", "default": true }
                        ]
                    }
                }]
            }
        }))
        .expect("projection");
        assert_eq!(projected.model.as_deref(), Some("grok-4.6"));
        assert_eq!(projected.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(
            projected.models[0]
                .supported_reasoning_efforts
                .iter()
                .map(|effort| effort.reasoning_effort.as_str())
                .collect::<Vec<_>>(),
            vec!["low", "high"]
        );
    }

    #[test]
    fn maps_reasoning_apply_to_session_load_meta() {
        let state = json!({
            "currentModelId": "grok-4.6",
            "availableModels": [{
                "modelId": "grok-4.6",
                "_meta": {
                    "reasoningEfforts": [
                        { "value": "low" },
                        { "value": "high" }
                    ]
                }
            }]
        });
        match apply_reasoning("high", &state) {
            Some(SessionSettingOp::LoadWithMeta { meta }) => {
                assert_eq!(meta["reasoningEffort"], "high");
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(apply_reasoning("auto", &state).is_none());
    }
}
