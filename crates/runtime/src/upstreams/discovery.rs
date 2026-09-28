use super::*;
use remote_codex_protocol::{ModelOptionDto, ReasoningEffortOptionDto};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub name: String,
    /// None means unknown, not unsupported. An explicit empty list is authoritative.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningCapabilities>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningCapabilities {
    pub efforts: Vec<ReasoningEffortOptionDto>,
    pub default: Option<String>,
}

impl DiscoveredModel {
    pub fn option(&self, profile: &Profile, fallback: Option<&ModelOptionDto>) -> ModelOptionDto {
        let (efforts, default) = match &self.reasoning {
            Some(cap) => (cap.efforts.clone(), cap.default.clone()),
            None => fallback
                .map(|m| {
                    (
                        m.supported_reasoning_efforts.clone(),
                        m.default_reasoning_effort.clone(),
                    )
                })
                .unwrap_or_default(),
        };
        ModelOptionDto {
            id: self.id.clone(),
            model: self.id.clone(),
            display_name: self.name.clone(),
            description: format!("{} · {}", profile.name, profile.harness),
            is_default: self.id == profile.model,
            hidden: false,
            supported_reasoning_efforts: efforts,
            default_reasoning_effort: default,
            selection_kind: Some("model".into()),
            acp_agent: None,
        }
    }
}

pub fn normalize_effort(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match value.as_str() {
        "none" | "off" => Some("none".into()),
        "minimal" | "low" | "medium" | "high" | "max" | "ultra" => Some(value),
        "xhigh" | "extra_high" => Some("xhigh".into()),
        _ => None,
    }
}

fn reasoning_capabilities(row: &Value) -> Option<ReasoningCapabilities> {
    let nested = row
        .pointer("/capabilities/reasoning_effort")
        .unwrap_or(&Value::Null);
    let supported = row
        .get("supportsReasoningEffort")
        .or_else(|| row.get("supports_reasoning_effort"))
        .and_then(Value::as_bool)
        .or_else(|| nested.as_bool())
        .or_else(|| nested.get("supported").and_then(Value::as_bool));
    if supported == Some(false) {
        return Some(ReasoningCapabilities {
            efforts: vec![],
            default: None,
        });
    }
    let rows = row
        .get("reasoningEfforts")
        .or_else(|| row.get("reasoning_efforts"))
        .or_else(|| nested.get("options"))
        .or_else(|| nested.get("values"))
        .or_else(|| nested.as_array().map(|_| nested))?
        .as_array()?;
    let mut efforts = Vec::new();
    let mut marked_default = None;
    for entry in rows {
        let Some(value) = entry
            .as_str()
            .or_else(|| entry.get("value").and_then(Value::as_str))
            .or_else(|| entry.get("id").and_then(Value::as_str))
            .and_then(normalize_effort)
        else {
            continue;
        };
        if entry.get("default").and_then(Value::as_bool) == Some(true) && marked_default.is_none() {
            marked_default = Some(value.clone());
        }
        if !efforts
            .iter()
            .any(|e: &ReasoningEffortOptionDto| e.reasoning_effort == value)
        {
            let description = entry
                .get("label")
                .or_else(|| entry.get("description"))
                .and_then(Value::as_str)
                .unwrap_or(&value)
                .chars()
                .filter(|c| !c.is_control())
                .take(200)
                .collect();
            efforts.push(ReasoningEffortOptionDto {
                reasoning_effort: value,
                description,
            });
        }
    }
    let declared = row
        .get("reasoningEffort")
        .or_else(|| row.get("reasoning_effort"))
        .or_else(|| nested.get("default"))
        .and_then(Value::as_str)
        .and_then(normalize_effort);
    let default = declared
        .filter(|v| efforts.iter().any(|e| e.reasoning_effort == *v))
        .or(marked_default);
    Some(ReasoningCapabilities { efforts, default })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryInput {
    #[serde(default)]
    pub id: String,
    pub harness: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "api_key_auth")]
    pub auth_type: String,
}

pub fn discovery_profile(dir: &Path, input: DiscoveryInput) -> Result<Profile> {
    let mut p = Profile {
        id: input.id,
        name: "Model discovery".into(),
        harness: input.harness,
        base_url: input.base_url,
        api_key: input.api_key,
        auth_type: input.auth_type,
        model: "discovery".into(),
        api_type: responses(),
        context_window: context_window(),
    };
    if p.api_key.is_empty() && !p.id.is_empty() {
        let saved = profile(dir, &p.id)?;
        if saved.base_url != p.base_url || saved.harness != p.harness {
            bail!("Enter an API key for the new upstream before loading models");
        }
        p.api_key = saved.api_key;
    }
    validate(&p, true)?;
    Ok(p)
}

fn models_url(p: &Profile) -> Result<url::Url> {
    let base = p.base_url.trim_end_matches('/');
    let version = match p.harness.as_str() {
        "claude" if !base.ends_with("/v1") => "/v1",
        "gemini" if !base.ends_with("/v1") && !base.ends_with("/v1beta") => "/v1beta",
        _ => "",
    };
    Ok(url::Url::parse(&format!("{base}{version}/models"))?)
}

fn collect_models(
    body: &Value,
    gemini: bool,
    models: &mut BTreeMap<String, DiscoveredModel>,
) -> Result<()> {
    let rows = body
        .get(if gemini { "models" } else { "data" })
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Upstream did not return a supported model list"))?;
    for row in rows {
        if gemini
            && row
                .get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .is_some_and(|methods| !methods.iter().any(|m| m == "generateContent"))
        {
            continue;
        }
        let Some(id) = row
            .get(if gemini { "name" } else { "id" })
            .and_then(Value::as_str)
        else {
            continue;
        };
        let id = if gemini {
            id.strip_prefix("models/").unwrap_or(id)
        } else {
            id
        };
        // Wildcard route patterns are not selectable concrete models.
        if id.is_empty() || id.len() > 200 || id.contains('*') || id.chars().any(char::is_control) {
            continue;
        }
        let name = row
            .get("display_name")
            .or_else(|| row.get("displayName"))
            .and_then(Value::as_str)
            .unwrap_or(id)
            .chars()
            .take(200)
            .collect();
        if models.len() >= 2000 && !models.contains_key(id) {
            bail!("Upstream returned too many models (maximum 2000)");
        }
        models.insert(
            id.into(),
            DiscoveredModel {
                id: id.into(),
                name,
                reasoning: reasoning_capabilities(row),
            },
        );
    }
    Ok(())
}

pub async fn discover_models(p: &Profile) -> Result<Value> {
    validate(p, true)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let base = models_url(p)?;
    let mut next = base.clone();
    let mut models = BTreeMap::new();
    let mut cursors = std::collections::HashSet::new();
    for _ in 0..10 {
        let body = response_json(authenticated(p, client.get(next))).await?;
        collect_models(&body, p.harness == "gemini", &mut models)?;
        let cursor = if p.harness == "gemini" {
            body.get("nextPageToken").and_then(Value::as_str)
        } else if p.harness == "claude" && body.get("has_more") == Some(&Value::Bool(true)) {
            Some(
                body.get("last_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Upstream model pagination is missing its cursor"))?,
            )
        } else {
            None
        };
        let Some(cursor) = cursor.filter(|c| !c.is_empty()) else {
            return Ok(
                json!({"models":models.into_values().collect::<Vec<_>>(),"truncated":false}),
            );
        };
        if !cursors.insert(cursor.to_owned()) {
            bail!("Upstream returned a repeated model page");
        }
        next = base.clone();
        next.query_pairs_mut().append_pair(
            if p.harness == "gemini" {
                "pageToken"
            } else {
                "after_id"
            },
            cursor,
        );
    }
    Ok(json!({"models":models.into_values().collect::<Vec<_>>(),"truncated":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn reasoning_metadata_is_validated_and_authoritative_per_model() {
        let mut models = BTreeMap::new();
        collect_models(&json!({"data": [
            {"id":"grok-build-0.1","supportsReasoningEffort":true,"reasoningEffort":"high","reasoningEfforts":[
                {"value":"low","label":"Low"},{"value":"medium"},{"value":"high","default":true}]},
            {"id":"grok-4.6","reasoning_efforts":["LOW","high","extra-high","HIGH","invalid"],"reasoning_effort":"XHIGH"},
            {"id":"unknown"},
            {"id":"disabled","supportsReasoningEffort":false,"reasoningEfforts":["high"]},
            {"id":"nested","capabilities":{"reasoning_effort":{"options":[{"id":"medium","default":true}],"default":"bogus"}}},
            {"id":"no-default","reasoningEfforts":["low","high"],"reasoningEffort":"xhigh"}
        ]}), false, &mut models).unwrap();
        let profile = super::super::tests::fixture("grok");
        let fallback = models["grok-4.6"].option(&profile, None);
        let build = models["grok-build-0.1"].option(&profile, Some(&fallback));
        assert_eq!(
            build
                .supported_reasoning_efforts
                .iter()
                .map(|e| e.reasoning_effort.as_str())
                .collect::<Vec<_>>(),
            ["low", "medium", "high"]
        );
        assert_eq!(build.default_reasoning_effort.as_deref(), Some("high"));
        assert_eq!(fallback.supported_reasoning_efforts.len(), 3);
        assert_eq!(fallback.default_reasoning_effort.as_deref(), Some("xhigh"));
        assert!(models["unknown"].reasoning.is_none());
        assert_eq!(
            models["unknown"]
                .option(&profile, Some(&fallback))
                .supported_reasoning_efforts
                .len(),
            3
        );
        assert!(models["disabled"]
            .option(&profile, Some(&fallback))
            .supported_reasoning_efforts
            .is_empty());
        assert_eq!(
            models["nested"]
                .reasoning
                .as_ref()
                .unwrap()
                .default
                .as_deref(),
            Some("medium")
        );
        assert!(models["no-default"]
            .reasoning
            .as_ref()
            .unwrap()
            .default
            .is_none());
        let roundtrip: Vec<DiscoveredModel> = serde_json::from_value(
            serde_json::to_value(models.into_values().collect::<Vec<_>>()).unwrap(),
        )
        .unwrap();
        assert_eq!(roundtrip.len(), 6);
    }

    #[test]
    fn discovery_secret_is_bound_to_saved_destination() {
        let dir = tempfile::tempdir().unwrap();
        let p = super::super::tests::fixture("grok");
        upsert(dir.path(), p.clone()).unwrap();
        let input = |harness: &str, base_url: &str| DiscoveryInput {
            id: p.id.clone(),
            harness: harness.into(),
            base_url: base_url.into(),
            api_key: String::new(),
            auth_type: api_key_auth(),
        };
        assert_eq!(
            discovery_profile(dir.path(), input("grok", &p.base_url))
                .unwrap()
                .api_key,
            p.api_key
        );
        assert!(discovery_profile(dir.path(), input("grok", "https://other.example/v1")).is_err());
        assert!(discovery_profile(dir.path(), input("codex", &p.base_url)).is_err());
    }

    #[test]
    fn catalogs_filter_patterns_and_non_generative_gemini_models() {
        let mut models = BTreeMap::new();
        collect_models(
            &json!({"data":[{"id":"gpt-*"},{"id":"grok-4.6"},{"id":"grok-4.6"},{"id":""}]}),
            false,
            &mut models,
        )
        .unwrap();
        assert_eq!(models.keys().collect::<Vec<_>>(), ["grok-4.6"]);
        models.clear();
        collect_models(&json!({"models":[
            {"name":"models/gemini-test","displayName":"Gemini Test","supportedGenerationMethods":["generateContent"]},
            {"name":"models/embedding","supportedGenerationMethods":["embedContent"]}
        ]}), true, &mut models).unwrap();
        assert_eq!(models.get("gemini-test").unwrap().name, "Gemini Test");
        assert_eq!(models.len(), 1);
        assert!(collect_models(&json!({"unexpected":[]}), false, &mut models).is_err());
    }

    #[tokio::test]
    async fn discovery_authenticates_and_paginates_without_following_external_urls() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for page in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0; 1024];
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&chunk[..n]);
                    if request.windows(4).any(|v| v == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8(request).unwrap().to_lowercase();
                assert!(request.contains("x-api-key: secret-fixture"));
                assert!(request.contains("anthropic-version: 2023-06-01"));
                assert!(request.starts_with(if page == 0 {
                    "get /v1/models http"
                } else {
                    "get /v1/models?after_id=first http"
                }));
                let body = if page == 0 { json!({"data":[{"id":"first"}],"has_more":true,"last_id":"first","next":"https://external.invalid/steal","error":null}) }
                    else { json!({"data":[{"id":"second"}],"has_more":false}) }.to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
        });
        let mut p = super::super::tests::fixture("claude");
        p.base_url = format!("http://{address}");
        let result = discover_models(&p).await.unwrap();
        assert_eq!(result["models"].as_array().unwrap().len(), 2);
        assert_eq!(result["truncated"], false);
        server.join().unwrap();
    }
}
