use remote_codex_protocol::{ModelOptionDto, ReasoningEffortOptionDto};
use serde_json::{json, Value};

/// Grok's completion is a per-prompt snapshot. Its input already includes cache
/// reads and its output already includes reasoning, unlike ACP Usage counters.
pub fn billing_usage(update: &Value) -> Option<Value> {
    let body = update.get("update").unwrap_or(update);
    if body["sessionUpdate"] == "response_completed" {
        let usage = body.get("usage")?;
        let mut tokens = crate::usage::Tokens::parse(usage)?;
        tokens.reasoning_output_tokens = usage["reasoning_tokens"].as_u64().unwrap_or(0);
        return Some(
            json!({"total":tokens,"last":tokens,"reportKind":"delta","reportId":body.get("signature"),"source":"grokTurn"}),
        );
    }
    let usage = if body["sessionUpdate"] == "turn_completed" {
        body.get("usage")?
    } else {
        update.pointer("/_meta/usage")?
    };
    let input = usage["inputTokens"].as_u64()?;
    let output = usage["outputTokens"].as_u64()?;
    let tokens = json!({
        "inputTokens": input, "outputTokens": output,
        "totalTokens": input.saturating_add(output),
        "cachedInputTokens": usage["cachedReadTokens"].as_u64().unwrap_or(0),
        "cacheWriteInputTokens": usage["cacheCreationTokens"].as_u64().unwrap_or(0),
        "reasoningOutputTokens": usage["reasoningTokens"].as_u64().unwrap_or(0),
    });
    Some(
        json!({"total": tokens, "last": tokens, "cumulative": false, "source": "grokTurn", "model": update.pointer("/_meta/modelId")}),
    )
}

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

/// Grok Build reports current context occupancy on session/update's outer
/// metadata. Nested `_meta.usage.totalTokens` is cumulative billing, not context.
pub fn context_usage(update: &Value, state: &Value) -> Option<Value> {
    let used = update.pointer("/_meta/totalTokens")?.as_u64()?;
    let model_id = state.get("currentModelId")?.as_str()?;
    let model = state
        .get("availableModels")?
        .as_array()?
        .iter()
        .find(|model| model.get("modelId").and_then(Value::as_str) == Some(model_id))?;
    let size = model.pointer("/_meta/totalContextTokens")?.as_u64()?;
    (size > 0).then(|| json!({"used":used,"size":size}))
}

#[cfg(test)]
mod context_tests {
    use super::*;
    #[test]
    fn uses_selected_model_and_occupancy_not_cumulative_billing() {
        let state = json!({"currentModelId":"grok-build", "availableModels":[
            {"modelId":"other","_meta":{"totalContextTokens":100000}},
            {"modelId":"grok-build","_meta":{"totalContextTokens":500000}}]});
        let update = json!({"_meta":{"totalTokens":15515,"usage":{"totalTokens":9000000}}});
        assert_eq!(
            context_usage(&update, &state),
            Some(json!({"used":15515,"size":500000}))
        );
        assert!(
            context_usage(&json!({"_meta":{"usage":{"totalTokens":9000000}}}), &state).is_none()
        );
    }
}

#[cfg(test)]
mod billing_tests {
    use super::*;
    #[test]
    fn live_reports_and_final_snapshot_do_not_double_bill() {
        let mut accumulator = super::super::usage::AdapterUsageAccumulator::default();
        let report = |signature: &str, input: u64, cache: u64| {
            billing_usage(&json!({"update":{"sessionUpdate":"response_completed","signature":signature,"usage":{"input_tokens":input,"cache_read_input_tokens":cache,"output_tokens":30,"reasoning_tokens":25}}})).unwrap()
        };
        let first = report("one", 2842, 11776);
        assert_eq!(
            accumulator.apply(first.clone()).unwrap()["total"]["inputTokens"],
            14618
        );
        assert!(accumulator.apply(first).is_none());
        let second = report("two", 84, 14592);
        assert_eq!(
            accumulator.apply(second.clone()).unwrap()["total"]["inputTokens"],
            29294
        );
        let final_report = billing_usage(&json!({"_meta":{"usage":{"inputTokens":29294,"cachedReadTokens":26368,"outputTokens":60,"reasoningTokens":50}}})).unwrap();
        let completed = accumulator.apply(final_report.clone()).unwrap();
        assert_eq!(completed["total"]["inputTokens"], 29294);
        assert_eq!(completed["last"]["inputTokens"], 14676);
        assert_eq!(accumulator.apply(final_report).unwrap(), completed);
        assert!(
            accumulator.apply(second).is_none(),
            "late deltas cannot overwrite a final snapshot"
        );
    }

    #[test]
    fn native_completion_preserves_cache_and_reasoning_without_counting_twice() {
        let update = json!({"update":{"sessionUpdate":"turn_completed", "usage":{
            "inputTokens":15642,"outputTokens":39,"cachedReadTokens":6144,"cacheCreationTokens":0,"reasoningTokens":18
        }}});
        let raw = billing_usage(&update).unwrap();
        let usage = crate::usage::normalize_usage(&raw).unwrap();
        assert_eq!(usage["total"]["inputTokens"], 15642);
        assert_eq!(usage["total"]["cachedInputTokens"], 6144);
        assert_eq!(usage["total"]["outputTokens"], 39);
        assert_eq!(usage["total"]["reasoningOutputTokens"], 18);
        assert_eq!(usage["total"]["totalTokens"], 15681);
        assert_eq!(usage["cumulative"], false);
        let price = crate::usage::estimate_price(&usage, Some("grok-4.6"), None).unwrap();
        assert!(price["totalUsd"].as_f64().unwrap() > 0.0);
        assert!(billing_usage(&json!({"_meta":{"totalTokens":1607}})).is_none());
    }
}
