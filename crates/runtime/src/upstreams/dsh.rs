//! DSH upstream projection. Only the ACP profile's provider/default-model
//! overrides and a dedicated credential reference are changed.
use super::*;
use serde_yaml::Value as Yaml;
const KEY_REF: &str = "REMOTE_CODEX_DSH_API_KEY"; // Legacy managed reference remains importable.
fn credential_ref(p: &Profile) -> String {
    format!(
        "REMOTE_CODEX_DSH_{}",
        p.id.replace('-', "_").to_ascii_uppercase()
    )
}
fn profile_name(p: &Profile) -> Result<&str> {
    let name = p
        .settings_config
        .get("profile")
        .and_then(Value::as_str)
        .unwrap_or("acp");
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        bail!("Invalid DSH profile name");
    }
    Ok(name)
}
pub fn paths(p: &Profile, root: &Path) -> Result<Vec<PathBuf>> {
    Ok(vec![
        root.join(".credentials.yaml"),
        root.join("profiles")
            .join(profile_name(p)?)
            .join("cordis.patch.yml"),
    ])
}
fn yaml_doc(path: &Path, default: &str) -> Result<Yaml> {
    serde_yaml::from_str(&read(path)?.unwrap_or(default.into()))
        .map_err(|_| anyhow!("Existing DSH YAML is invalid; repair it before switching upstreams"))
}
/// The model list for an entry: the selected model first, then the models
/// written before. DSH threads keep their `["provider","model"]` value, so a
/// switched model must stay configured or those threads can no longer resume.
fn models_with(rows: &[Yaml], id: &str, path: &[&str], model: Value) -> Result<Value> {
    let selected = model["id"].clone();
    let mut models = vec![model];
    let existing = rows
        .iter()
        .rev()
        .find(|row| row.get("id").and_then(Yaml::as_str) == Some(id) && row.get("insert").is_none())
        .and_then(|row| {
            path.iter()
                .try_fold(row.get("config")?, |value, key| value.get(*key))
        })
        .and_then(Yaml::as_sequence);
    for entry in existing.into_iter().flatten() {
        let entry: Value = serde_json::to_value(entry)?;
        if entry["id"].is_string() && entry["id"] != selected {
            models.push(entry);
        }
    }
    Ok(Value::Array(models))
}

fn set_entry(rows: &mut Vec<Yaml>, id: &str, config: Value) -> Result<()> {
    let row = rows.iter_mut().rev().find(|row| {
        row.get("id").and_then(Yaml::as_str) == Some(id) && row.get("insert").is_none()
    });
    if let Some(row) = row {
        let map = row
            .as_mapping_mut()
            .ok_or_else(|| anyhow!("Invalid DSH patch entry"))?;
        let key = Yaml::String("config".into());
        let current = map.entry(key).or_insert(Yaml::Mapping(Default::default()));
        let current = current
            .as_mapping_mut()
            .ok_or_else(|| anyhow!("Invalid DSH provider configuration"))?;
        let incoming: Yaml = serde_yaml::to_value(config)?;
        for (key, value) in incoming.as_mapping().unwrap() {
            // Preserve other providers in the same pi-ai entry.
            if key.as_str() == Some("providers") {
                let providers = current
                    .entry(key.clone())
                    .or_insert(Yaml::Mapping(Default::default()));
                let providers = providers
                    .as_mapping_mut()
                    .ok_or_else(|| anyhow!("Invalid DSH provider map"))?;
                for (key, value) in value.as_mapping().unwrap() {
                    providers.insert(key.clone(), value.clone());
                }
            } else {
                current.insert(key.clone(), value.clone());
            }
        }
    } else {
        rows.push(serde_yaml::to_value(json!({"id":id,"config":config}))?);
    }
    Ok(())
}
/// Output cap for compatible models: room for long code edits, within what
/// OpenAI-style APIs accept.
const MAX_OUTPUT_TOKENS: i64 = 32_768;

pub fn changes(p: &Profile, root: &Path) -> Result<Vec<(PathBuf, String)>> {
    let paths = paths(p, root)?;
    let key_ref = credential_ref(p);
    let mut credentials = yaml_doc(&paths[0], "version: 1\nrefs: {}\n")?;
    let map = credentials
        .as_mapping_mut()
        .ok_or_else(|| anyhow!("Invalid DSH credentials document"))?;
    map.entry(Yaml::String("version".into()))
        .or_insert(Yaml::Number(1.into()));
    let refs = map
        .entry(Yaml::String("refs".into()))
        .or_insert(Yaml::Mapping(Default::default()));
    refs.as_mapping_mut()
        .ok_or_else(|| anyhow!("Invalid DSH credential references"))?
        .insert(
            Yaml::String(key_ref.clone()),
            Yaml::String(p.api_key.clone()),
        );
    let mut patch = yaml_doc(&paths[1], "[]\n")?;
    let rows = patch
        .as_sequence_mut()
        .ok_or_else(|| anyhow!("DSH profile patch must be a YAML sequence"))?;
    let provider = if p.api_type == "anthropic" {
        let models = models_with(
            rows,
            "llm-deepseek",
            &["models"],
            json!({"id":p.model,"contextWindow":p.context_window}),
        )?;
        set_entry(
            rows,
            "llm-deepseek",
            json!({"baseURL":p.base_url,"apiKeyEnv":key_ref,"models":models}),
        )?;
        "deepseek-official"
    } else {
        let models = models_with(
            rows,
            "llm-pi-ai",
            &["providers", "remote-codex", "models"],
            json!({"id":p.model,"name":p.model,"contextWindow":p.context_window,"maxTokens":p.context_window.min(MAX_OUTPUT_TOKENS)}),
        )?;
        set_entry(
            rows,
            "llm-pi-ai",
            json!({"providers":{"remote-codex":{
                "displayName":p.name, "baseURL":p.base_url,"apiKeyEnv":key_ref,
                "api":if p.api_type == "responses" {"openai-responses"} else {"openai-completions"},
                "models":models,
                "headers":p.settings_config.get("headers").cloned().unwrap_or(json!({}))
            }}}),
        )?;
        "remote-codex"
    };
    for id in ["acp", "agent-default-model"] {
        set_entry(rows, id, json!({"provider":provider,"model":p.model}))?;
    }
    Ok(vec![
        (paths[0].clone(), serde_yaml::to_string(&credentials)?),
        (paths[1].clone(), serde_yaml::to_string(&patch)?),
    ])
}
pub fn capture(root: &Path) -> Result<Value> {
    let patch = yaml_doc(&root.join("profiles/acp/cordis.patch.yml"), "[]\n")?;
    let rows = patch
        .as_sequence()
        .ok_or_else(|| anyhow!("DSH profile patch must be a sequence"))?;
    let config = |id: &str| {
        rows.iter()
            .rev()
            .find(|row| row.get("id").and_then(Yaml::as_str) == Some(id))
            .and_then(|row| row.get("config"))
    };
    let selected = config("acp")
        .and_then(|v| v.get("provider"))
        .and_then(Yaml::as_str)
        .unwrap_or("deepseek-official");
    let mut fragment = json!({"profile":"acp"});
    if selected != "deepseek-official" {
        if let Some(headers) = config("llm-pi-ai")
            .and_then(|v| v.get("providers"))
            .and_then(|v| v.get(selected))
            .and_then(|v| v.get("headers"))
        {
            fragment["headers"] = serde_json::to_value(headers)?;
        }
    }
    Ok(fragment)
}

pub fn import_live(root: &Path, name: &str) -> Result<Profile> {
    let patch = yaml_doc(&root.join("profiles/acp/cordis.patch.yml"), "[]\n")?;
    let rows = patch
        .as_sequence()
        .ok_or_else(|| anyhow!("DSH profile patch must be a sequence"))?;
    let config = |id: &str| {
        rows.iter()
            .rev()
            .find(|row| row.get("id").and_then(Yaml::as_str) == Some(id))
            .and_then(|row| row.get("config"))
    };
    let selected = config("acp")
        .and_then(|v| v.get("provider"))
        .and_then(Yaml::as_str)
        .unwrap_or("deepseek-official");
    let official = selected == "deepseek-official";
    let endpoint = if official {
        config("llm-deepseek")
    } else {
        config("llm-pi-ai")
            .and_then(|v| v.get("providers"))
            .and_then(|v| v.get(selected))
    };
    if !official && endpoint.is_none() {
        bail!("The current DSH provider is not an OpenAI compatible pi-ai route");
    }
    if !official
        && !matches!(
            endpoint.and_then(|v| v.get("api")).and_then(Yaml::as_str),
            Some("openai-responses" | "openai-completions")
        )
    {
        bail!("Import supports DSH official and explicit OpenAI-compatible routes");
    }
    if !official
        && endpoint
            .and_then(|v| v.get("baseURL"))
            .and_then(Yaml::as_str)
            .is_none()
    {
        bail!("The DSH provider needs an explicit base URL for import");
    }
    let model = config("acp")
        .and_then(|v| v.get("model"))
        .and_then(Yaml::as_str)
        .unwrap_or("deepseek-v4-flash");
    let window = endpoint
        .and_then(|v| v.get("models"))
        .and_then(Yaml::as_sequence)
        .and_then(|models| {
            models
                .iter()
                .find(|v| v.get("id").and_then(Yaml::as_str) == Some(model))
        })
        .and_then(|v| v.get("contextWindow"))
        .and_then(Yaml::as_i64)
        .unwrap_or(context_window());
    let credentials = yaml_doc(&root.join(".credentials.yaml"), "version: 1\nrefs: {}\n")?;
    let key_ref = endpoint
        .and_then(|v| v.get("apiKeyEnv"))
        .and_then(Yaml::as_str)
        .unwrap_or(if official {
            "DEEPSEEK_API_KEY"
        } else {
            KEY_REF
        });
    let key = credentials
        .get("refs")
        .and_then(|v| v.get(key_ref))
        .and_then(Yaml::as_str)
        .ok_or_else(|| anyhow!("No API key is stored in the DSH credentials file"))?;
    Ok(Profile {
        id: String::new(),
        name: name.into(),
        harness: "deepseek".into(),
        base_url: endpoint
            .and_then(|v| v.get("baseURL"))
            .and_then(Yaml::as_str)
            .unwrap_or("https://api.deepseek.com/anthropic")
            .into(),
        api_key: key.into(),
        auth_type: api_key_auth(),
        model: model.into(),
        api_type: if official {
            "anthropic"
        } else if endpoint.and_then(|v| v.get("api")).and_then(Yaml::as_str)
            == Some("openai-responses")
        {
            "responses"
        } else {
            "chat_completions"
        }
        .into(),
        context_window: window,
        settings_config: capture(root)?,
        sort_index: 0,
        revision: None,
        live_revision: None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dsh_home_environment_is_isolated_and_live_import_tracks_the_selected_protocol() {
        const FLAG: &str = "REMOTE_CODEX_UPSTREAM_DSH_TEST_CHILD";
        if std::env::var_os(FLAG).is_some() {
            let root = PathBuf::from(std::env::var_os("DSH_HOME").unwrap());
            assert_eq!(home("deepseek"), root);
            let store = root.join("store");
            let mut p = super::super::tests::fixture("deepseek");
            p.api_type = "responses".into();
            p.settings_config = json!({"profile":"acp","headers":{"X-Test":"private-header"}});
            upsert(&store, p.clone()).unwrap();
            activate(&store, &p.id).unwrap();
            let imported = import_live(&root, "Live DSH").unwrap();
            assert_eq!(imported.api_type, "responses");
            assert_eq!(imported.api_key, p.api_key);
            assert_eq!(
                capture(&root).unwrap()["headers"]["X-Test"],
                "private-header"
            );
            let mut editor = super::super::inspect_profile(&store, &p.id).unwrap();
            editor.as_object_mut().unwrap().remove("hasApiKey");
            let mut editor: Profile = serde_json::from_value(editor).unwrap();
            editor.name = "Edited DSH".into();
            save_and_apply(&store, editor).unwrap();
            assert_eq!(
                capture(&root).unwrap()["headers"]["X-Test"],
                "private-header"
            );
            let path = root.join("profiles/acp/cordis.patch.yml");
            let mut doc = yaml_doc(&path, "").unwrap();
            let rows = doc.as_sequence_mut().unwrap();
            for row in rows.iter_mut() {
                if row["id"].as_str() == Some("llm-pi-ai") {
                    let providers = row["config"]["providers"].as_mapping_mut().unwrap();
                    let entry = providers
                        .remove(Yaml::String("remote-codex".into()))
                        .unwrap();
                    providers.insert(Yaml::String("existing-gateway".into()), entry);
                }
                if row["id"].as_str() == Some("acp") {
                    row["config"]["provider"] = Yaml::String("existing-gateway".into());
                }
            }
            private_write(&path, serde_yaml::to_string(&doc).unwrap().as_bytes()).unwrap();
            let imported = import_live(&root, "Existing gateway").unwrap();
            assert_eq!(imported.base_url, p.base_url);
            assert_eq!(imported.api_key, p.api_key);
            assert_eq!(
                imported.settings_config["headers"]["X-Test"],
                "private-header"
            );
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("dsh-home");
        let output=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","upstreams::dsh::tests::dsh_home_environment_is_isolated_and_live_import_tracks_the_selected_protocol"])
            .env(FLAG,"1").env("DSH_HOME",&root).env("HOME",temp.path()).env("CODEX_HOME",temp.path().join("codex")).env("CLAUDE_CONFIG_DIR",temp.path().join("claude")).output().unwrap();
        assert!(
            output.status.success(),
            "Isolated DSH child test failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[test]
    fn switching_the_model_keeps_earlier_models_for_existing_threads() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("isolated-dsh-home");
        let store = temp.path().join("store");
        let mut p = super::super::tests::fixture("deepseek");
        p.api_type = "responses".into();
        p.model = "first".into();
        upsert(&store, p.clone()).unwrap();
        activate_at(&store, &p, &root).unwrap();
        p.model = "second".into();
        upsert(&store, p.clone()).unwrap();
        activate_at(&store, &p, &root).unwrap();
        let rows = yaml_doc(&root.join("profiles/acp/cordis.patch.yml"), "").unwrap();
        let rows = rows.as_sequence().unwrap();
        let pi = rows
            .iter()
            .find(|v| v["id"].as_str() == Some("llm-pi-ai"))
            .unwrap();
        let ids: Vec<_> = pi["config"]["providers"]["remote-codex"]["models"]
            .as_sequence()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids, ["second", "first"]);
        let acp = rows
            .iter()
            .find(|v| v["id"].as_str() == Some("acp"))
            .unwrap();
        assert_eq!(acp["config"]["model"].as_str(), Some("second"));
    }

    #[test]
    fn dsh_official_and_openai_upstreams_preserve_other_routes_and_restore_private_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("isolated-dsh-home");
        let store = temp.path().join("store");
        let credentials =
            "version: 1\nrefs:\n  DEEPSEEK_API_KEY: original\n  OTHER_TOOL_KEY: preserve\n";
        let patch = "- id: unrelated\n  disabled: true\n- id: llm-pi-ai\n  config:\n    providers:\n      personal: {apiKeyEnv: OTHER_TOOL_KEY}\n";
        private_write(&root.join(".credentials.yaml"), credentials.as_bytes()).unwrap();
        private_write(
            &root.join("profiles/acp/cordis.patch.yml"),
            patch.as_bytes(),
        )
        .unwrap();
        let mut official = super::super::tests::fixture("deepseek");
        official.api_type = "anthropic".into();
        official.api_key = "synthetic-official-key".into();
        official.base_url = "https://api.deepseek.com/anthropic".into();
        let mut compatible = super::super::tests::fixture("deepseek");
        compatible.api_type = "chat_completions".into();
        compatible.api_key = "synthetic-compatible-key".into();
        for p in [&official, &compatible] {
            upsert(&store, p.clone()).unwrap();
            activate_at(&store, p, &root).unwrap();
        }
        let refs = yaml_doc(&root.join(".credentials.yaml"), "").unwrap();
        assert_eq!(refs["refs"]["OTHER_TOOL_KEY"].as_str(), Some("preserve"));
        assert_eq!(
            refs["refs"][credential_ref(&official)].as_str(),
            Some(official.api_key.as_str())
        );
        assert_eq!(
            refs["refs"][credential_ref(&compatible)].as_str(),
            Some(compatible.api_key.as_str())
        );
        let rows = yaml_doc(&root.join("profiles/acp/cordis.patch.yml"), "").unwrap();
        assert!(rows
            .as_sequence()
            .unwrap()
            .iter()
            .any(|v| v["id"].as_str() == Some("unrelated")));
        let pi = rows
            .as_sequence()
            .unwrap()
            .iter()
            .find(|v| v["id"].as_str() == Some("llm-pi-ai"))
            .unwrap();
        assert!(pi["config"]["providers"].get("personal").is_some());
        assert_eq!(
            pi["config"]["providers"]["remote-codex"]["baseURL"].as_str(),
            Some(compatible.base_url.as_str())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for path in paths(&compatible, &root).unwrap() {
                assert_eq!(
                    std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
        }
        remove(&store, &compatible.id).unwrap();
        assert_eq!(
            read(&root.join(".credentials.yaml")).unwrap().unwrap(),
            credentials
        );
        assert_eq!(
            read(&root.join("profiles/acp/cordis.patch.yml"))
                .unwrap()
                .unwrap(),
            patch
        );
    }
}
