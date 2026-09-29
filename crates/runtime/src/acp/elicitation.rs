//! Translate Codex native questions and ACP form elicitations without losing
//! question ids, options, free-text answers, or multi-question submissions.
use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

fn custom_question_id(field: &Value) -> Option<&str> {
    if field.pointer("/_meta/codex/isOtherAnswer") == Some(&Value::Bool(true)) {
        field.pointer("/_meta/codex/questionId")?.as_str()
    } else if field.pointer("/_meta/_askUserQuestionCustomAnswer/isCustomAnswer")
        == Some(&Value::Bool(true))
    {
        field
            .pointer("/_meta/_askUserQuestionCustomAnswer/questionId")?
            .as_str()
    } else {
        None
    }
}

pub(super) fn questions(params: &Value, native: bool) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    if native {
        for q in params["questions"].as_array().into_iter().flatten() {
            out.push(serde_json::from_value(json!({
                "id":q["id"], "header":q.get("header").and_then(Value::as_str).unwrap_or("Question"),
                "question":q["question"],"isOther":q.get("isOther").and_then(Value::as_bool).unwrap_or(true),
                "isSecret":q.get("isSecret").and_then(Value::as_bool).unwrap_or(false),
                "multiSelect":q.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                "required":q.get("required").and_then(Value::as_bool).unwrap_or(true),
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
            if custom_question_id(field).is_some_and(|parent| properties.contains_key(parent)) {
                continue;
            }
            let schema = if field["type"] == "array" {
                &field["items"]
            } else {
                field
            };
            let options: Vec<Value> = if let Some(choices) = schema["oneOf"]
                .as_array()
                .or_else(|| schema["anyOf"].as_array())
            {
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
                "isOther":properties.values().any(|field| custom_question_id(field) == Some(id.as_str()))
                    || field.pointer("/_meta/codex/isOther").and_then(Value::as_bool).unwrap_or(options.is_empty()),
                "required":params.pointer("/requestedSchema/required").and_then(Value::as_array).is_some_and(|required| required.iter().any(|value| value.as_str() == Some(id))),
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
            if q["required"].as_bool().unwrap_or(true) {
                bail!("Answer required for {}", q["header"]);
            }
            continue;
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
                    props
                        .iter()
                        .find(|(_, field)| custom_question_id(field) == Some(id))
                });
            if let Some((other_id, field)) = other {
                // Claude's companion is a string even for multi-select questions.
                let custom_value = if field["type"] == "string" {
                    json!(values.join(", "))
                } else {
                    value
                };
                content.insert(other_id.clone(), custom_value);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn claude_form() -> Value {
        json!({"mode":"form","requestedSchema":{"type":"object","properties":{
            "question_0":{"type":"string","title":"Scope","oneOf":[{"const":"All"},{"const":"Minimal"}]},
            "question_0_custom":{"type":"string","title":"Other","_meta":{
                "_askUserQuestionCustomAnswer":{"questionId":"question_0","isCustomAnswer":true}
            }},
            "question_1":{"type":"array","title":"Style","items":{"anyOf":[{"const":"Glass"},{"const":"Compact"}]}},
            "question_1_custom":{"type":"string","title":"Other","_meta":{
                "_askUserQuestionCustomAnswer":{"questionId":"question_1","isCustomAnswer":true}
            }}
        }}})
    }

    #[test]
    fn claude_optional_companions_do_not_block_selected_answers() {
        let params = claude_form();
        let qs = questions(&params, false).unwrap();
        assert_eq!(qs.len(), 2);
        assert_eq!(qs[0]["required"], false);
        assert_eq!(qs[0]["isOther"], true);
        assert_eq!(qs[1]["options"][0]["label"], "Glass");
        let answers =
            json!({"question_0":{"answers":["All"]},"question_1":{"answers":["Glass","Compact"]}})
                .to_string();
        assert_eq!(
            response(&params, false, true, Some(&answers)).unwrap(),
            json!({
                "action":"accept","content":{"question_0":"All","question_1":["Glass","Compact"]}
            })
        );
        assert_eq!(
            response(&params, false, true, Some("{}")).unwrap(),
            json!({"action":"accept","content":{}})
        );
    }

    #[test]
    fn claude_custom_answers_are_scoped_and_use_string_companions() {
        let answers = json!({"question_0":{"answers":["Something else"]},"question_1":{"answers":["Glass","My style"]}}).to_string();
        assert_eq!(
            response(&claude_form(), false, true, Some(&answers)).unwrap(),
            json!({
                "action":"accept","content":{"question_0_custom":"Something else","question_1_custom":"Glass, My style"}
            })
        );
    }

    #[test]
    fn required_fields_still_block_but_optional_blanks_are_omitted() {
        let params = json!({"requestedSchema":{"properties":{
            "name":{"type":"string"},"note":{"type":"string"}
        },"required":["name"]}});
        assert!(response(&params, false, true, Some("{}")).is_err());
        let answers = json!({"name":{"answers":["Alice"]},"note":{"answers":["  "]}}).to_string();
        assert_eq!(
            response(&params, false, true, Some(&answers)).unwrap(),
            json!({"action":"accept","content":{"name":"Alice"}})
        );
    }

    #[test]
    fn native_questions_remain_required_and_codex_custom_marker_still_works() {
        let native = json!({"questions":[{"id":"q","question":"Choose","options":null}]});
        assert_eq!(questions(&native, true).unwrap()[0]["required"], true);
        assert!(response(&native, true, true, Some("{}")).is_err());
        let params = json!({"requestedSchema":{"properties":{
            "q":{"type":"string","enum":["A"]},
            "other":{"type":"string","_meta":{"codex":{"isOtherAnswer":true,"questionId":"q"}}}
        },"required":["q"]}});
        assert_eq!(questions(&params, false).unwrap().len(), 1);
        let answers = json!({"q":{"answers":["B"]}}).to_string();
        assert_eq!(
            response(&params, false, true, Some(&answers)).unwrap(),
            json!({"action":"accept","content":{"other":"B"}})
        );
    }
}
