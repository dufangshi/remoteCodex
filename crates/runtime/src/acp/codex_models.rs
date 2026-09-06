use std::collections::HashMap;

use remote_codex_protocol::ReasoningEffortOptionDto;
use serde_json::{json, Value};

use super::adapter::HarnessProjection;

// Older Codex catalogs can omit a configured model that thread/start still accepts.
// Repair the catalog before ACP validates settings, using the same owned connection.
#[derive(Default)]
pub(super) struct ModelCatalogBridge {
    pending: HashMap<String, String>,
    current_model: Option<String>,
    catalog: Vec<Value>,
}

impl ModelCatalogBridge {
    pub fn observe_request(&mut self, message: &Value) {
        let Some(method) = message["method"].as_str() else {
            return;
        };
        if matches!(
            method,
            "thread/start" | "thread/resume" | "thread/fork" | "model/list"
        ) {
            if method == "model/list" && message["params"]["cursor"].is_null() {
                self.catalog.clear();
            }
            self.pending
                .insert(message["id"].to_string(), method.into());
        }
    }

    pub fn observe_response(&mut self, message: &mut Value) {
        let Some(method) = self.pending.remove(&message["id"].to_string()) else {
            return;
        };
        let Some(result) = message.get_mut("result") else {
            return;
        };
        if method != "model/list" {
            if let Some(model) = result["model"].as_str() {
                self.current_model = Some(model.into());
            }
            return;
        }
        let last_page = result["nextCursor"].is_null();
        let Some(data) = result["data"].as_array_mut() else {
            return;
        };
        self.catalog.extend(data.iter().cloned());
        let donor = self
            .catalog
            .iter()
            .filter(|model| has_efforts(model))
            .find(|model| model["id"] == "gpt-5.6-sol")
            .or_else(|| self.catalog.iter().find(|model| has_efforts(model)));
        let efforts = donor
            .map(|model| model["supportedReasoningEfforts"].clone())
            .unwrap_or_else(|| {
                json!([
                    {"reasoningEffort":"low","description":"Low"},
                    {"reasoningEffort":"medium","description":"Medium"},
                    {"reasoningEffort":"high","description":"High"}
                ])
            });
        let default = donor
            .and_then(|model| model["defaultReasoningEffort"].as_str())
            .filter(|value| {
                efforts
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|effort| effort["reasoningEffort"] == *value)
            })
            .or_else(|| {
                efforts
                    .as_array()?
                    .iter()
                    .find_map(|effort| (effort["reasoningEffort"] == "medium").then_some("medium"))
            })
            .or_else(|| efforts[0]["reasoningEffort"].as_str())
            .unwrap_or("medium")
            .to_string();
        for model in data.iter_mut().filter(|model| !has_efforts(model)) {
            model["supportedReasoningEfforts"] = efforts.clone();
            model["defaultReasoningEffort"] = json!(default);
        }
        if let Some(model) = self
            .current_model
            .as_deref()
            .filter(|id| last_page && !self.catalog.iter().any(|model| model["id"] == *id))
        {
            data.push(json!({
                "id": model, "model": model, "displayName": model,
                "description": "", "hidden": false, "isDefault": false,
                "supportedReasoningEfforts": efforts, "defaultReasoningEffort": default,
                "inputModalities": ["text", "image"], "supportsPersonality": false
            }));
        }
    }
}

fn has_efforts(model: &Value) -> bool {
    model["supportedReasoningEfforts"]
        .as_array()
        .is_some_and(|values| !values.is_empty())
}

pub(super) fn project_session(response: &Value) -> Option<HarnessProjection> {
    let model_state = response.get("models")?;
    let available = model_state["availableModels"].as_array()?;
    let mut models = super::runtime::models_from_config_options(&response["configOptions"]);
    for model in &mut models {
        model.supported_reasoning_efforts = available
            .iter()
            .filter_map(|entry| {
                let (id, effort) = split_model_id(entry["modelId"].as_str()?)?;
                (id == model.id).then(|| ReasoningEffortOptionDto {
                    reasoning_effort: effort.into(),
                    description: entry["description"].as_str().unwrap_or(effort).into(),
                })
            })
            .collect();
    }
    let fallback = models
        .iter()
        .filter(|model| !model.supported_reasoning_efforts.is_empty())
        .find(|model| model.id == "gpt-5.6-sol")
        .or_else(|| {
            models
                .iter()
                .find(|model| !model.supported_reasoning_efforts.is_empty())
        })
        .map(|model| model.supported_reasoning_efforts.clone())
        .unwrap_or_else(|| {
            ["low", "medium", "high"]
                .into_iter()
                .map(|effort| ReasoningEffortOptionDto {
                    reasoning_effort: effort.into(),
                    description: effort.into(),
                })
                .collect()
        });
    for model in &mut models {
        if model.supported_reasoning_efforts.is_empty() {
            model.supported_reasoning_efforts = fallback.clone();
        }
        model.default_reasoning_effort = model
            .supported_reasoning_efforts
            .iter()
            .find(|effort| effort.reasoning_effort == "medium")
            .or(model.supported_reasoning_efforts.first())
            .map(|effort| effort.reasoning_effort.clone());
    }
    let current = model_state["currentModelId"]
        .as_str()
        .and_then(split_model_id);
    Some(HarnessProjection {
        state: model_state.clone(),
        models,
        model: current.map(|(model, _)| model.into()),
        reasoning_effort: current.map(|(_, effort)| effort.into()),
    })
}

fn split_model_id(value: &str) -> Option<(&str, &str)> {
    let (model, effort) = value.strip_suffix(']')?.rsplit_once('[')?;
    (!model.is_empty() && !effort.is_empty()).then_some((model, effort))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, efforts: &[&str]) -> Value {
        json!({"id":id, "model":id, "defaultReasoningEffort":"high",
            "supportedReasoningEfforts": efforts.iter().map(|effort| json!({"reasoningEffort":effort})).collect::<Vec<_>>()})
    }

    #[test]
    fn missing_catalog_model_inherits_sol_efforts_before_acp_validation() {
        let mut bridge = ModelCatalogBridge::default();
        bridge.observe_request(&json!({"id":1,"method":"thread/start"}));
        bridge.observe_response(&mut json!({"id":1,"result":{"model":"gpt-6-astra"}}));
        bridge.observe_request(&json!({"id":2,"method":"model/list"}));
        let sol = model(
            "gpt-5.6-sol",
            &["low", "medium", "high", "xhigh", "max", "ultra"],
        );
        let old = model("gpt-5.2", &["low", "high"]);
        let mut response = json!({"id":2,"result":{"data":[old.clone(), sol.clone(), model("empty", &[])],"nextCursor":null}});
        bridge.observe_response(&mut response);
        let data = response["result"]["data"].as_array().unwrap();
        assert_eq!(data[0], old);
        assert_eq!(data[1], sol);
        for entry in &data[2..] {
            assert_eq!(
                entry["supportedReasoningEfforts"],
                sol["supportedReasoningEfforts"]
            );
            assert_eq!(entry["defaultReasoningEffort"], "high");
        }
        assert_eq!(data[3]["id"], "gpt-6-astra");
        assert_eq!(data[3]["model"], "gpt-6-astra");
    }

    #[test]
    fn paginated_catalog_keeps_astras_own_efforts_when_present() {
        let mut bridge = ModelCatalogBridge::default();
        bridge.observe_request(&json!({"id":"load","method":"thread/resume"}));
        bridge.observe_response(&mut json!({"id":"load","result":{"model":"gpt-6-astra"}}));
        bridge.observe_request(&json!({"id":1,"method":"model/list"}));
        let mut first = json!({"id":1,"result":{"data":[model("gpt-5.6-sol", &["low","high"])],"nextCursor":"next"}});
        bridge.observe_response(&mut first);
        assert_eq!(first["result"]["data"].as_array().unwrap().len(), 1);
        bridge.observe_request(&json!({"id":2,"method":"model/list","params":{"cursor":"next"}}));
        let mut last = json!({"id":2,"result":{"data":[model("gpt-6-astra", &["high","ultra"])],"nextCursor":null}});
        let expected = last.clone();
        bridge.observe_response(&mut last);
        assert_eq!(last, expected);
    }

    #[test]
    fn session_projection_uses_each_models_efforts_and_falls_back_for_astra() {
        let response = json!({"configOptions":[{"id":"model","category":"model","currentValue":"gpt-6-astra","options":[
            {"value":"gpt-6-astra"},{"value":"gpt-5.6-sol"},{"value":"gpt-5.2"}
        ]}],"models":{"currentModelId":"gpt-6-astra[high]","availableModels":[
            {"modelId":"gpt-5.6-sol[low]"},{"modelId":"gpt-5.6-sol[medium]"},{"modelId":"gpt-5.6-sol[ultra]"},
            {"modelId":"gpt-5.2[low]"},{"modelId":"gpt-5.2[high]"}
        ]}});
        let projection = project_session(&response).unwrap();
        assert_eq!(projection.model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(projection.reasoning_effort.as_deref(), Some("high"));
        let efforts: Vec<Vec<_>> = projection
            .models
            .iter()
            .map(|model| {
                model
                    .supported_reasoning_efforts
                    .iter()
                    .map(|effort| effort.reasoning_effort.as_str())
                    .collect()
            })
            .collect();
        assert_eq!(
            efforts,
            vec![
                vec!["low", "medium", "ultra"],
                vec!["low", "medium", "ultra"],
                vec!["low", "high"]
            ]
        );
    }
}
