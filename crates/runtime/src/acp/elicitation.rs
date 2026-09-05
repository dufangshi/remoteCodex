//! Translate Codex native questions and ACP form elicitations without losing
//! question ids, options, free-text answers, or multi-question submissions.
use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

pub(super) fn questions(params: &Value, native: bool) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    if native {
        for q in params["questions"].as_array().into_iter().flatten() {
            out.push(serde_json::from_value(json!({
                "id":q["id"], "header":q.get("header").and_then(Value::as_str).unwrap_or("Question"),
                "question":q["question"],"isOther":q.get("isOther").and_then(Value::as_bool).unwrap_or(true),
                "isSecret":q.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
                "multiSelect":q.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                "options":q.get("options").cloned().unwrap_or(Value::Null)
            }))?);
        }
    } else {
        if params["mode"].as_str().unwrap_or("form") != "form" {
            bail!("Only form elicitation is supported");
        }
        let properties = params
            .pointer("/requestedSchema/properties")
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow::anyhow!("Elicitation form has no properties"))?;
        for (id, field) in properties {
            if field.pointer("/_meta/codex/isOtherAnswer") == Some(&Value::Bool(true)) {
                continue;
            }
            let schema = if field["type"] == "array" {
                &field["items"]
            } else {
                field
            };
            let options: Vec<Value> = if let Some(choices) = schema["oneOf"].as_array() {
                choices.iter().map(|choice| json!({"label":choice["const"],"description":choice.get("description").and_then(Value::as_str).unwrap_or("")})).collect()
            } else {
                schema["enum"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|v| json!({"label":v,"description":""}))
                    .collect()
            };
            out.push(serde_json::from_value(json!({
                "id":id,"header":field.get("title").and_then(Value::as_str).unwrap_or("Question"),
                "question":field.get("description").or_else(||field.get("title")).and_then(Value::as_str).unwrap_or(id),
                "isOther":field.pointer("/_meta/codex/isOther").and_then(Value::as_bool).unwrap_or(options.is_empty()),
                "isSecret":field.pointer("/_meta/codex/isSecret").and_then(Value::as_bool).unwrap_or(false),
                "multiSelect":field["type"] == "array", "options":if options.is_empty() {Value::Null} else {json!(options)}
            }))?);
        }
    }
    if out.is_empty() {
        bail!("User input request contains no questions");
    }
    Ok(out)
}

pub(super) fn response(
    params: &Value,
    native: bool,
    allow: bool,
    answers: Option<&str>,
) -> Result<Value> {
    if !allow {
        return Ok(if native {
            json!({"answers":{}})
        } else {
            json!({"action":"cancel"})
        });
    }
    let answers: Value = serde_json::from_str(answers.unwrap_or("{}"))?;
    let mut content = Map::new();
    let mut normalized = Map::new();
    for q in questions(params, native)? {
        let id = q["id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing question id"))?;
        let values: Vec<String> = answers[id]["answers"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if values.is_empty() || values.iter().all(|v| v.trim().is_empty()) {
            bail!("Answer required for {}", q["header"]);
        }
        normalized.insert(id.to_string(), json!({"answers":values}));
        let value = if q["multiSelect"].as_bool().unwrap_or(false) {
            json!(values)
        } else {
            json!(values[0])
        };
        let custom = q["options"].as_array().is_some_and(|opts| {
            values
                .iter()
                .any(|v| !opts.iter().any(|o| o["label"] == *v))
        });
        if custom && q["isOther"].as_bool().unwrap_or(false) {
            let other = params
                .pointer("/requestedSchema/properties")
                .and_then(Value::as_object)
                .and_then(|props| {
                    props.iter().find(|(_, field)| {
                        field.pointer("/_meta/codex/isOtherAnswer") == Some(&Value::Bool(true))
                            && field.pointer("/_meta/codex/questionId") == Some(&json!(id))
                    })
                });
            if let Some((other_id, _)) = other {
                content.insert(other_id.clone(), value);
                continue;
            }
        } else if custom {
            bail!("Invalid option for {}", q["header"]);
        }
        content.insert(id.to_string(), value);
    }
    Ok(if native {
        json!({"answers":normalized})
    } else {
        json!({"action":"accept","content":content})
    })
}
