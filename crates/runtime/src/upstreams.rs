//! Device-local upstream profiles. Only provider-owned fields are changed; no
//! imported commands, plugins, or arbitrary filesystem paths are executed.
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use toml_edit::{value, DocumentMut};
mod discovery;
pub use discovery::{discover_models, discovery_profile, DiscoveryInput};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub harness: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "api_key_auth")]
    pub auth_type: String,
    pub model: String,
    #[serde(default = "responses")]
    pub api_type: String,
    #[serde(default = "context_window")]
    pub context_window: i64,
}
fn responses() -> String {
    "responses".into()
}
fn context_window() -> i64 {
    500_000
}
fn api_key_auth() -> String {
    "api_key".into()
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    profiles: Vec<Profile>,
    active: BTreeMap<String, String>,
    backups: Vec<Backup>,
    /// Original native model entries, retained until managed configuration is removed.
    #[serde(default)]
    grok_models: BTreeMap<String, Option<String>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    id: String,
    harness: String,
    created_at: String,
    active: Option<String>,
    files: Vec<FileSnapshot>,
}
#[derive(Clone, Serialize, Deserialize)]
struct FileSnapshot {
    path: PathBuf,
    content: Option<String>,
}

pub fn directory(database: &Path) -> PathBuf {
    database.with_extension("upstreams")
}
fn load(dir: &Path) -> Result<Store> {
    match std::fs::read(dir.join("profiles.json")) {
        Ok(data) => serde_json::from_slice(&data).context("Unable to read saved upstream profiles"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(e) => Err(e.into()),
    }
}
pub fn private_write(path: &Path, data: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Invalid configuration path"))?;
    std::fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    use std::io::Write;
    tmp.write_all(data)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
fn save(dir: &Path, store: &Store) -> Result<()> {
    private_write(
        &dir.join("profiles.json"),
        &serde_json::to_vec_pretty(store)?,
    )
}
fn redacted(p: &Profile) -> Value {
    let mut v = serde_json::to_value(p).unwrap();
    v.as_object_mut().unwrap().remove("apiKey");
    v["hasApiKey"] = json!(!p.api_key.is_empty());
    v
}
pub fn inventory(dir: &Path) -> Result<Value> {
    let s = load(dir)?;
    Ok(
        json!({"profiles":s.profiles.iter().map(redacted).collect::<Vec<_>>(),"active":s.active,
        "backups":s.backups.iter().map(|b| json!({"id":b.id,"harness":b.harness,"createdAt":b.created_at})).collect::<Vec<_>>() }),
    )
}
pub fn validate(p: &Profile, require_key: bool) -> Result<()> {
    if !["api_key", "bearer"].contains(&p.auth_type.as_str()) {
        bail!("Invalid authentication type");
    }
    if !["codex", "claude", "gemini", "grok"].contains(&p.harness.as_str()) {
        bail!("Upstream configuration supports Codex, Claude Code, Gemini CLI and Grok Build");
    }
    if p.name.trim().is_empty()
        || p.name.len() > 120
        || p.model.trim().is_empty()
        || p.model.len() > 200
    {
        bail!("A name and model are required (maximum 120/200 characters)");
    }
    if p.api_key.len() > 8192
        || p.api_key.contains(['\r', '\n'])
        || (require_key && p.api_key.trim().is_empty())
    {
        bail!("Provide a valid API key");
    }
    let url = url::Url::parse(&p.base_url).map_err(|_| anyhow!("Invalid upstream URL"))?;
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    {
        bail!("Use HTTPS for upstreams (HTTP is allowed for local services)");
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("Upstream URL must not contain credentials, query parameters or fragments");
    }
    if !["responses", "chat_completions"].contains(&p.api_type.as_str())
        || p.context_window < 1
        || p.context_window > 100_000_000
    {
        bail!("Invalid API type or context window");
    }
    if p.harness == "codex" && p.api_type != "responses" {
        bail!("Codex requires a Responses API upstream");
    }
    Ok(())
}
pub fn upsert(dir: &Path, mut p: Profile) -> Result<Value> {
    let mut s = load(dir)?;
    if p.id.is_empty() {
        p.id = uuid::Uuid::new_v4().to_string();
    } else if uuid::Uuid::parse_str(&p.id).is_err() {
        bail!("Invalid profile ID");
    }
    if let Some(old) = s.profiles.iter().find(|old| old.id == p.id) {
        if s.active.values().any(|id| id == &p.id) {
            bail!("Duplicate the active profile or switch away before editing it");
        }
        if p.api_key.is_empty() && old.base_url == p.base_url && old.harness == p.harness {
            p.api_key = old.api_key.clone();
        }
    }
    validate(&p, true)?;
    s.profiles.retain(|old| old.id != p.id);
    s.profiles.push(p.clone());
    save(dir, &s)?;
    Ok(redacted(&p))
}
pub fn remove(dir: &Path, id: &str) -> Result<()> {
    let mut s = load(dir)?;
    if let Some(harness) = s
        .active
        .iter()
        .find(|(_, v)| *v == id)
        .map(|(h, _)| h.clone())
    {
        let baseline = s.backups.iter().find(|b| b.harness == harness && b.active.is_none())
            .cloned().ok_or_else(|| anyhow!("No original configuration backup is available. Switch to another upstream before deleting this one."))?;
        let mut rollback = baseline.clone();
        for file in &mut rollback.files {
            file.content = read(&file.path)?;
        }
        if let Err(error) = restore_files(&baseline) {
            restore_files(&rollback)?;
            return Err(error);
        }
        s.active.remove(&harness);
        s.backups.retain(|b| b.harness != harness);
        if harness == "grok" {
            s.grok_models.clear();
        }
        s.profiles.retain(|p| p.id != id);
        if let Err(error) = save(dir, &s) {
            restore_files(&rollback)?;
            return Err(error);
        }
        return Ok(());
    }
    s.profiles.retain(|p| p.id != id);
    save(dir, &s)
}
pub fn active_profile(dir: &Path, harness: &str) -> Result<Option<Profile>> {
    let s = load(dir)?;
    Ok(s.active
        .get(harness)
        .and_then(|id| s.profiles.iter().find(|p| &p.id == id))
        .cloned())
}

pub(crate) fn prepare_grok_models(
    dir: &Path,
    p: &Profile,
    models: &[remote_codex_protocol::ModelOptionDto],
) -> Result<()> {
    prepare_grok_models_at(dir, p, models, &home("grok"))
}
fn prepare_grok_models_at(
    dir: &Path,
    p: &Profile,
    models: &[remote_codex_protocol::ModelOptionDto],
    root: &Path,
) -> Result<()> {
    let path = root.join("config.toml");
    let mut doc = toml_doc(&path)?;
    let mut store = load(dir)?;
    configure_grok_models(
        &mut doc,
        p,
        models.iter().map(|m| m.model.as_str()),
        &mut store.grok_models,
    )?;
    // Retain the union of original entries before writing, including across
    // switches. A crash between these atomic writes cannot lose an original.
    save(dir, &store)?;
    private_write(&path, doc.to_string().as_bytes())
}

fn configure_grok_models<'a>(
    doc: &mut DocumentMut,
    p: &'a Profile,
    models: impl Iterator<Item = &'a str>,
    originals: &mut BTreeMap<String, Option<String>>,
) -> Result<()> {
    for section in ["model", "models"] {
        if doc.get(section).is_some_and(|v| !v.is_table_like()) {
            bail!("Invalid Grok {section} configuration section");
        }
    }
    for (id, original) in originals.iter() {
        if let Some(original) = original {
            let snapshot = original.parse::<DocumentMut>()?;
            let entry = snapshot
                .get("model")
                .and_then(|m| m.get(id))
                .ok_or_else(|| anyhow!("Invalid saved Grok model configuration"))?;
            doc["model"][id] = entry.clone();
        } else if let Some(table) = doc.get_mut("model").and_then(|v| v.as_table_like_mut()) {
            table.remove(id);
        }
    }
    // Legacy aliases remain loadable, but selection uses the actual ID. Grok
    // canonicalizes aliases to their wire model and otherwise falls back to
    // built-in authentication when that ID also exists in its built-in catalog.
    if let Some(table) = doc.get_mut("model").and_then(|v| v.as_table_like_mut()) {
        let owned = table
            .iter()
            .filter(|(key, _)| key.starts_with("remote-codex/"))
            .map(|(key, _)| key.to_owned())
            .collect::<Vec<_>>();
        for key in owned {
            table.remove(&key);
        }
    }
    for model in std::iter::once(p.model.as_str()).chain(models) {
        if doc
            .get("model")
            .and_then(|m| m.get(model))
            .is_some_and(|v| !v.is_table_like())
        {
            bail!("Invalid Grok model configuration entry");
        }
        originals.entry(model.to_owned()).or_insert_with(|| {
            doc.get("model").and_then(|m| m.get(model)).map(|entry| {
                let mut snapshot = DocumentMut::new();
                snapshot["model"] = toml_edit::Item::Table(toml_edit::Table::new());
                snapshot["model"][model] = entry.clone();
                snapshot.to_string()
            })
        });
        let alias = format!("remote-codex/{model}");
        for id in [model, alias.as_str()] {
            for (key, text) in [
                ("name", model),
                ("model", model),
                ("base_url", p.base_url.as_str()),
                ("api_key", p.api_key.as_str()),
                ("api_backend", p.api_type.as_str()),
            ] {
                doc["model"][id][key] = value(text);
            }
            // Explicit inline credentials must not compete with an existing helper,
            // provider, environment key, or custom Authorization header.
            for key in [
                "auth_provider",
                "env_key",
                "model_provider",
                "api_base_url",
                "extra_headers",
                "env_http_headers",
                "query_params",
                "mtls_cert_dir",
            ] {
                doc["model"][id].as_table_like_mut().unwrap().remove(key);
            }
            doc["model"][id]["context_window"] = value(p.context_window);
        }
    }
    if doc
        .get("model")
        .and_then(|m| m.get("remote-codex"))
        .is_some()
    {
        doc["model"]["remote-codex"]["name"] = value(&p.model);
    }
    doc["models"]["default"] = value(&p.model);
    Ok(())
}
pub fn profile(dir: &Path, id: &str) -> Result<Profile> {
    load(dir)?
        .profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| anyhow!("Profile not found"))
}
fn home(harness: &str) -> PathBuf {
    let (key, suffix) = match harness {
        "codex" => ("CODEX_HOME", ".codex"),
        "claude" => ("CLAUDE_CONFIG_DIR", ".claude"),
        "grok" => ("GROK_HOME", ".grok"),
        _ => ("GEMINI_CLI_HOME", ".gemini"),
    };
    let explicit = std::env::var_os(key)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if harness == "gemini" {
        explicit
            .unwrap_or_else(crate::config::home_dir)
            .join(".gemini")
    } else {
        explicit.unwrap_or_else(|| crate::config::home_dir().join(suffix))
    }
}
fn read(path: &Path) -> Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
// Re-read native credentials for every new ACP process. An inherited shell key
// must not silently override the upstream selected in device settings.
pub(crate) fn launch_environment(harness: &str) -> Vec<(&'static str, String)> {
    let root = home(harness);
    let mut env = vec![];
    if harness == "claude" {
        if let Ok(doc) = json_doc(&root.join("settings.json")) {
            for key in [
                "ANTHROPIC_BASE_URL",
                "ANTHROPIC_AUTH_TOKEN",
                "ANTHROPIC_API_KEY",
                "ANTHROPIC_MODEL",
            ] {
                if let Some(v) = doc
                    .get("env")
                    .and_then(|e| e.get(key))
                    .and_then(Value::as_str)
                {
                    env.push((key, v.into()));
                }
            }
            if env.iter().any(|(key, _)| *key == "ANTHROPIC_AUTH_TOKEN") {
                env.push(("ANTHROPIC_API_KEY", String::new()));
            } else if env.iter().any(|(key, _)| *key == "ANTHROPIC_API_KEY") {
                env.push(("ANTHROPIC_AUTH_TOKEN", String::new()));
            }
        }
    } else if harness == "gemini" {
        if let Ok(Some(content)) = read(&root.join(".env")) {
            for key in ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "GEMINI_MODEL"] {
                if let Some(v) = content
                    .lines()
                    .rev()
                    .find_map(|l| l.strip_prefix(&format!("{key}=")))
                {
                    // Managed values are JSON-quoted to preserve punctuation.
                    if let Ok(v) = serde_json::from_str::<String>(v) {
                        env.push((key, v));
                    }
                }
            }
        }
    }
    env
}
fn toml_doc(path: &Path) -> Result<DocumentMut> {
    let doc: DocumentMut = read(path)?
        .unwrap_or_default()
        .parse()
        .map_err(|_| anyhow!("Existing TOML is invalid; repair it before switching upstreams"))?;
    for key in ["model_providers", "models", "model"] {
        if key == "model" && doc.get(key).is_some_and(|v| v.is_str()) {
            continue;
        }
        if let Some(section) = doc.get(key) {
            if !section.is_table_like() {
                bail!("Invalid {key} configuration section");
            }
            for child in ["remote_codex", "remote-codex"] {
                if section.get(child).is_some_and(|v| !v.is_table_like()) {
                    bail!("Invalid managed provider section");
                }
            }
        }
    }
    Ok(doc)
}
fn json_doc(path: &Path) -> Result<Value> {
    let v = serde_json::from_str::<Value>(&read(path)?.unwrap_or_else(|| "{}".into()))
        .map_err(|_| anyhow!("Existing JSON is invalid; repair it before switching upstreams"))?;
    if !v.is_object() {
        bail!("Existing configuration must be an object");
    }
    Ok(v)
}
fn put_json(v: &mut Value, key: &str, field: &str, content: Value) -> Result<()> {
    if v.get(key).is_none() {
        v[key] = json!({});
    }
    if !v[key].is_object() {
        bail!("Existing configuration section {key} must be an object");
    }
    v[key][field] = content;
    Ok(())
}
fn changes(p: &Profile, root: &Path) -> Result<Vec<(PathBuf, String)>> {
    let mut output = vec![];
    match p.harness.as_str() {
        "codex" => {
            let path = root.join("config.toml");
            let mut doc = toml_doc(&path)?;
            doc["model_provider"] = value("remote_codex");
            doc["model"] = value(&p.model);
            doc["model_providers"]["remote_codex"]["name"] = value(&p.name);
            doc["model_providers"]["remote_codex"]["base_url"] = value(&p.base_url);
            doc["model_providers"]["remote_codex"]["wire_api"] = value("responses");
            doc["model_providers"]["remote_codex"]["requires_openai_auth"] = value(true);
            output.push((path, doc.to_string()));
            let path = root.join("auth.json");
            let mut auth = json_doc(&path)?;
            auth["OPENAI_API_KEY"] = json!(p.api_key);
            auth["auth_mode"] = json!("apikey");
            auth.as_object_mut().unwrap().remove("tokens");
            output.push((path, serde_json::to_string_pretty(&auth)?));
        }
        "claude" => {
            let path = root.join("settings.json");
            let mut doc = json_doc(&path)?;
            let (auth, other) = if p.auth_type == "bearer" {
                ("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
            } else {
                ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
            };
            for (key, v) in [
                ("ANTHROPIC_BASE_URL", &p.base_url),
                (auth, &p.api_key),
                ("ANTHROPIC_MODEL", &p.model),
            ] {
                put_json(&mut doc, "env", key, json!(v))?;
            }
            doc["env"].as_object_mut().unwrap().remove(other);
            output.push((path, serde_json::to_string_pretty(&doc)?));
        }
        "gemini" => {
            let path = root.join("settings.json");
            let mut doc = json_doc(&path)?;
            if doc.get("security").is_none() {
                doc["security"] = json!({});
            }
            if !doc["security"].is_object() {
                bail!("Invalid Gemini security settings");
            }
            put_json(
                &mut doc["security"],
                "auth",
                "selectedType",
                json!("gemini-api-key"),
            )?;
            put_json(&mut doc, "model", "name", json!(p.model))?;
            output.push((path, serde_json::to_string_pretty(&doc)?));
            let path = root.join(".env");
            let old = read(&path)?.unwrap_or_default();
            let mut lines: Vec<String> = old
                .lines()
                .filter(|line| {
                    !["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL", "GEMINI_MODEL"]
                        .iter()
                        .any(|key| {
                            line.trim_start()
                                .strip_prefix(key)
                                .is_some_and(|s| s.trim_start().starts_with('='))
                        })
                })
                .map(str::to_owned)
                .collect();
            for (k, v) in [
                ("GEMINI_API_KEY", &p.api_key),
                ("GOOGLE_GEMINI_BASE_URL", &p.base_url),
                ("GEMINI_MODEL", &p.model),
            ] {
                lines.push(format!("{k}={}", serde_json::to_string(v)?));
            }
            output.push((path, format!("{}\n", lines.join("\n"))));
        }
        "grok" => {
            let path = root.join("config.toml");
            let mut doc = toml_doc(&path)?;
            configure_grok_models(&mut doc, p, std::iter::empty(), &mut BTreeMap::new())?;
            output.push((path, doc.to_string()));
        }
        _ => bail!("Unsupported harness"),
    }
    Ok(output)
}
pub fn activate(dir: &Path, id: &str) -> Result<String> {
    let p = profile(dir, id)?;
    activate_at(dir, &p, &home(&p.harness))
}
fn activate_at(dir: &Path, p: &Profile, root: &Path) -> Result<String> {
    validate(p, true)?;
    let mut s = load(dir)?;
    let edits = if p.harness == "grok" {
        let path = root.join("config.toml");
        let mut doc = toml_doc(&path)?;
        configure_grok_models(&mut doc, p, std::iter::empty(), &mut s.grok_models)?;
        vec![(path, doc.to_string())]
    } else {
        changes(p, root)?
    };
    let files = edits
        .iter()
        .map(|(path, _)| {
            Ok(FileSnapshot {
                path: path.clone(),
                content: read(path)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let backup = Backup {
        id: uuid::Uuid::new_v4().to_string(),
        harness: p.harness.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        active: s.active.get(&p.harness).cloned(),
        files,
    };
    // Persist the recovery snapshot before touching live files.
    s.backups.push(backup.clone());
    save(dir, &s)?;
    let result = (|| -> Result<()> {
        for (path, text) in &edits {
            private_write(path, text.as_bytes())?;
        }
        s.active.insert(p.harness.clone(), p.id.clone());
        save(dir, &s)
    })();
    if let Err(error) = result {
        restore_files(&backup)?;
        return Err(error.context("Switch failed; previous configuration restored"));
    }
    Ok(backup.id)
}
fn restore_files(backup: &Backup) -> Result<()> {
    for f in &backup.files {
        if let Some(text) = &f.content {
            private_write(&f.path, text.as_bytes())?;
        } else if f.path.exists() {
            std::fs::remove_file(&f.path)?;
        }
    }
    Ok(())
}
pub fn backup_harness(dir: &Path, id: &str) -> Result<String> {
    load(dir)?
        .backups
        .into_iter()
        .find(|b| b.id == id)
        .map(|b| b.harness)
        .ok_or_else(|| anyhow!("Backup not found"))
}
pub fn restore(dir: &Path, id: &str) -> Result<()> {
    let mut s = load(dir)?;
    let b = s
        .backups
        .iter()
        .find(|b| b.id == id)
        .cloned()
        .ok_or_else(|| anyhow!("Backup not found"))?;
    // Only the latest snapshot for a harness can be restored, avoiding stale rollback.
    if s.backups
        .iter()
        .rev()
        .find(|v| v.harness == b.harness)
        .map(|v| &v.id)
        != Some(&b.id)
    {
        bail!("Restore the latest backup for this harness first");
    }
    restore_files(&b)?;
    if let Some(active) = b.active {
        s.active.insert(b.harness.clone(), active);
    } else {
        s.active.remove(&b.harness);
        if b.harness == "grok" {
            s.grok_models.clear();
        }
    }
    s.backups.retain(|v| v.id != id);
    save(dir, &s)
}

pub async fn test_connection(p: &Profile) -> Result<Value> {
    validate(p, true)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let base = p.base_url.trim_end_matches('/');
    let (url, body) = match p.harness.as_str() {
        "claude" => (
            format!(
                "{base}/{}messages",
                if base.ends_with("/v1") { "" } else { "v1/" }
            ),
            json!({"model":p.model,"max_tokens":1,"messages":[{"role":"user","content":"Reply OK"}]}),
        ),
        "gemini" => (
            format!(
                "{base}/{}models/{}:generateContent",
                if base.ends_with("/v1beta") || base.ends_with("/v1") {
                    ""
                } else {
                    "v1beta/"
                },
                url::form_urlencoded::byte_serialize(p.model.as_bytes()).collect::<String>()
            ),
            json!({"contents":[{"parts":[{"text":"Reply OK"}]}],"generationConfig":{"maxOutputTokens":1}}),
        ),
        _ if p.api_type == "chat_completions" => (
            format!("{base}/chat/completions"),
            json!({"model":p.model,"messages":[{"role":"user","content":"Reply OK"}],"max_tokens":1}),
        ),
        _ => (
            format!("{base}/responses"),
            json!({"model":p.model,"input":"Reply OK","max_output_tokens":16}),
        ),
    };
    let request = authenticated(p, client.post(url).json(&body));
    let start = std::time::Instant::now();
    let body = response_json(request).await?;
    validate_model_response(p, &body)?;
    Ok(json!({"ok":true,"latencyMs":start.elapsed().as_millis(),"model":p.model}))
}

fn authenticated(p: &Profile, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match p.harness.as_str() {
        "claude" if p.auth_type == "bearer" => request
            .bearer_auth(&p.api_key)
            .header("anthropic-version", "2023-06-01"),
        "claude" => request
            .header("x-api-key", &p.api_key)
            .header("anthropic-version", "2023-06-01"),
        "gemini" => request.header("x-goog-api-key", &p.api_key),
        _ => request.bearer_auth(&p.api_key),
    }
}

async fn response_json(request: reqwest::RequestBuilder) -> Result<Value> {
    let mut response = request.send().await.map_err(|_| {
        anyhow!("Connection failed or timed out. Check the URL and device network.")
    })?;
    let status = response.status();
    // Never echo an upstream response: it can contain credentials or HTML.
    if !status.is_success() {
        bail!(
            "Upstream returned HTTP {}. Check credentials, model and API compatibility.",
            status.as_u16()
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow!("Unable to read upstream response"))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            bail!("Unexpectedly large test response");
        }
        bytes.extend_from_slice(&chunk);
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow!("Upstream did not return a JSON model response"))?;
    if body.get("error").is_some_and(|v| !v.is_null()) {
        bail!("Upstream returned an API error. Check credentials, model and API compatibility.");
    }
    Ok(body)
}

fn validate_model_response(p: &Profile, body: &Value) -> Result<()> {
    let expected = match p.harness.as_str() {
        "claude" => "content",
        "gemini" => "candidates",
        _ if p.api_type == "chat_completions" => "choices",
        _ => "output",
    };
    if body.get("error").is_some_and(|v| !v.is_null())
        || matches!(
            body.get("status").and_then(Value::as_str),
            Some("failed" | "cancelled")
        )
    {
        bail!("Upstream returned an API error. Check credentials, model and API compatibility.");
    }
    if !body.get(expected).is_some_and(Value::is_array) {
        bail!("Upstream response does not match the selected API format");
    }
    Ok(())
}

pub fn import_config(harness: &str, name: &str, text: &str, key: &str) -> Result<Profile> {
    // Accept native provider configuration or a CC Switch settingsConfig object.
    let parsed = serde_json::from_str::<Value>(text).ok();
    let wrapper = parsed
        .as_ref()
        .and_then(|v| v.get("settingsConfig"))
        .or(parsed.as_ref());
    let native = wrapper
        .and_then(|v| v.get("config"))
        .and_then(Value::as_str)
        .unwrap_or(text);
    let mut p = Profile {
        id: String::new(),
        name: name.into(),
        harness: harness.into(),
        base_url: String::new(),
        api_key: key.into(),
        auth_type: api_key_auth(),
        model: String::new(),
        api_type: responses(),
        context_window: context_window(),
    };
    if matches!(harness, "codex" | "grok") {
        let doc = native
            .parse::<toml::Value>()
            .map_err(|_| anyhow!("Invalid TOML configuration"))?;
        let section = if harness == "codex" {
            let selected = doc
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| anyhow!("Missing model_provider"))?;
            doc.get("model_providers").and_then(|v| v.get(selected))
        } else {
            let selected = doc
                .get("models")
                .and_then(|v| v.get("default"))
                .and_then(toml::Value::as_str)
                .ok_or_else(|| anyhow!("Missing default model"))?;
            doc.get("model").and_then(|v| v.get(selected))
        }
        .ok_or_else(|| anyhow!("Missing provider configuration"))?;
        p.base_url = section
            .get("base_url")
            .and_then(toml::Value::as_str)
            .unwrap_or_default()
            .into();
        p.model = if harness == "codex" {
            doc.get("model")
        } else {
            section.get("model")
        }
        .and_then(toml::Value::as_str)
        .unwrap_or_default()
        .into();
        if p.api_key.is_empty() {
            p.api_key = section
                .get("api_key")
                .and_then(toml::Value::as_str)
                .or_else(|| {
                    wrapper
                        .and_then(|v| v.pointer("/auth/OPENAI_API_KEY"))
                        .and_then(Value::as_str)
                })
                .unwrap_or_default()
                .into();
        }
        if harness == "grok" {
            p.api_type = section
                .get("api_backend")
                .and_then(toml::Value::as_str)
                .unwrap_or("responses")
                .into();
            p.context_window = section
                .get("context_window")
                .and_then(toml::Value::as_integer)
                .unwrap_or(context_window());
        }
    } else {
        let doc = wrapper.ok_or_else(|| anyhow!("Expected a JSON settings object"))?;
        let env = doc.get("env").unwrap_or(doc);
        if harness == "claude"
            && env
                .get("ANTHROPIC_AUTH_TOKEN")
                .and_then(Value::as_str)
                .is_some_and(|v| !v.is_empty())
        {
            p.auth_type = "bearer".into();
        }
        let (url, secret, model) = if harness == "claude" {
            (
                "ANTHROPIC_BASE_URL",
                "ANTHROPIC_AUTH_TOKEN",
                "ANTHROPIC_MODEL",
            )
        } else {
            ("GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL")
        };
        p.base_url = env[url]
            .as_str()
            .unwrap_or(if harness == "gemini" {
                "https://generativelanguage.googleapis.com"
            } else {
                "https://api.anthropic.com"
            })
            .into();
        p.model = env[model]
            .as_str()
            .or_else(|| doc.pointer("/model/name").and_then(Value::as_str))
            .unwrap_or_default()
            .into();
        if p.api_key.is_empty() {
            p.api_key = env[secret]
                .as_str()
                .or_else(|| env["ANTHROPIC_API_KEY"].as_str())
                .unwrap_or_default()
                .into();
        }
    }
    validate(&p, true)?;
    Ok(p)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Template {
    pub schema_version: u32,
    #[serde(default)]
    pub harnesses: Vec<String>,
    pub profiles: Vec<Profile>,
}
pub fn parse_template(value: Value) -> Result<Template> {
    let t: Template = serde_json::from_value(value).map_err(|_| {
        anyhow!("Expected a Remote Codex template with schemaVersion, harnesses and profiles")
    })?;
    if t.schema_version != 1 || t.profiles.len() > 50 || t.harnesses.len() > 10 {
        bail!("Unsupported template version or too many entries");
    }
    let mut active = std::collections::HashSet::new();
    for p in &t.profiles {
        validate(p, true)?;
        if !active.insert(&p.harness) {
            bail!("A template may activate only one profile per harness");
        }
    }
    for id in &t.harnesses {
        if !crate::management::can_install(id) {
            bail!("Unsupported harness installation: {id}");
        }
    }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deleting_active_upstream_restores_original_config_and_keeps_other_profiles() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("grok");
        let store = temp.path().join("profiles");
        let original = "# original\n[ui]\ncolor = 'blue'\n";
        private_write(&root.join("config.toml"), original.as_bytes()).unwrap();
        let first = fixture("grok");
        let second = fixture("grok");
        for p in [&first, &second] {
            upsert(&store, p.clone()).unwrap();
            activate_at(&store, p, &root).unwrap();
        }
        remove(&store, &second.id).unwrap();
        assert_eq!(read(&root.join("config.toml")).unwrap().unwrap(), original);
        assert!(active_profile(&store, "grok").unwrap().is_none());
        assert!(profile(&store, &first.id).is_ok());
        assert!(profile(&store, &second.id).is_err());
        assert!(load(&store).unwrap().backups.is_empty());
        assert!(load(&store).unwrap().grok_models.is_empty());
    }

    #[test]
    fn grok_catalog_maps_every_model_to_the_same_upstream_without_overwriting_native_entries() {
        let temp = tempfile::tempdir().unwrap();
        private_write(
            &temp.path().join("config.toml"),
            b"[model.personal]\nmodel='keep'\n[model.'remote-codex/obsolete']\nmodel='obsolete'\n",
        )
        .unwrap();
        let p = fixture("grok");
        let models = ["model-a", "model-b"].map(|id| remote_codex_protocol::ModelOptionDto {
            id: id.into(),
            model: id.into(),
            display_name: id.into(),
            description: String::new(),
            is_default: false,
            hidden: false,
            supported_reasoning_efforts: vec![],
            default_reasoning_effort: None,
            selection_kind: Some("model".into()),
            acp_agent: None,
        });
        prepare_grok_models_at(&temp.path().join("store"), &p, &models, temp.path()).unwrap();
        let doc = toml_doc(&temp.path().join("config.toml")).unwrap();
        assert_eq!(doc["model"]["personal"]["model"].as_str(), Some("keep"));
        assert!(doc["model"].get("remote-codex/obsolete").is_none());
        for id in ["model-a", "model-b"] {
            assert_eq!(
                doc["model"][id]["api_key"].as_str(),
                Some(p.api_key.as_str())
            );
            let configured = &doc["model"][&format!("remote-codex/{id}")];
            assert_eq!(configured["model"].as_str(), Some(id));
            assert_eq!(configured["name"].as_str(), Some(id));
            assert_eq!(configured["base_url"].as_str(), Some(p.base_url.as_str()));
            assert_eq!(configured["api_key"].as_str(), Some(p.api_key.as_str()));
        }
    }
    #[test]
    fn grok_native_overrides_restore_originals_across_refreshes_and_switches() {
        let original = "[model.'grok-4.6']\napi_key='original'\nenv_key='XAI_API_KEY'\nauth_provider='native'\nextra_headers={Authorization='old'}\nreasoning_efforts=[{value='high',default=true}]\n[model.personal]\nmodel='keep'\n";
        let mut doc: DocumentMut = original.parse().unwrap();
        let mut originals = BTreeMap::new();
        let mut p = fixture("grok");
        p.model = "grok-4.6".into();
        configure_grok_models(&mut doc, &p, ["grok-4.5"].into_iter(), &mut originals).unwrap();
        // Exercise the persisted representation, not just an in-memory table.
        let saved: BTreeMap<String, Option<String>> =
            serde_json::from_str(&serde_json::to_string(&originals).unwrap()).unwrap();
        originals = saved;
        doc = doc.to_string().parse().unwrap();
        for _ in 0..2 {
            configure_grok_models(&mut doc, &p, ["grok-4.5"].into_iter(), &mut originals).unwrap();
            let model = &doc["model"]["grok-4.6"];
            assert_eq!(model["api_key"].as_str(), Some(p.api_key.as_str()));
            assert!(model.get("env_key").is_none());
            assert!(model.get("auth_provider").is_none());
            assert!(model.get("extra_headers").is_none());
            assert!(model.get("reasoning_efforts").is_some());
        }
        p.model = "grok-4.5".into();
        p.api_key = "second-key".into();
        configure_grok_models(&mut doc, &p, std::iter::empty(), &mut originals).unwrap();
        assert_eq!(
            doc["model"]["grok-4.6"]["api_key"].as_str(),
            Some("original")
        );
        assert_eq!(
            doc["model"]["grok-4.6"]["env_key"].as_str(),
            Some("XAI_API_KEY")
        );
        assert!(doc["model"].get("remote-codex/grok-4.6").is_none());
        assert_eq!(
            doc["model"]["grok-4.5"]["api_key"].as_str(),
            Some("second-key")
        );
        p.model = "new-model".into();
        configure_grok_models(&mut doc, &p, std::iter::empty(), &mut originals).unwrap();
        assert!(doc["model"].get("grok-4.5").is_none());
        assert_eq!(doc["model"]["personal"]["model"].as_str(), Some("keep"));
        assert_eq!(doc["models"]["default"].as_str(), Some("new-model"));
    }
    #[test]
    fn connection_accepts_null_error_but_rejects_errors_and_wrong_protocol() {
        let p = fixture("grok");
        assert!(validate_model_response(
            &p,
            &json!({"status":"completed","error":null,"output":[]})
        )
        .is_ok());
        for body in [
            json!({"output":[],"error":{"message":"failed"}}),
            json!({"output":[],"status":"failed"}),
            json!({"output":[],"status":"cancelled"}),
            json!({"choices":[]}),
        ] {
            assert!(validate_model_response(&p, &body).is_err());
        }
    }
    pub(super) fn fixture(harness: &str) -> Profile {
        Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Test".into(),
            harness: harness.into(),
            base_url: "https://example.com/v1".into(),
            api_key: "secret-fixture".into(),
            auth_type: api_key_auth(),
            model: "test-model".into(),
            api_type: responses(),
            context_window: context_window(),
        }
    }
    #[test]
    fn switch_preserves_other_settings_and_restores_exact_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("codex");
        let store = dir.path().join("profiles");
        let original="# Keep comment\n[projects.test]\ntrust_level = 'trusted'\n[mcp_servers.example]\ncommand = 'example'\n";
        private_write(&root.join("config.toml"), original.as_bytes()).unwrap();
        let p = fixture("codex");
        upsert(&store, p.clone()).unwrap();
        let backup = activate_at(&store, &p, &root).unwrap();
        let text = read(&root.join("config.toml")).unwrap().unwrap();
        assert!(text.contains("# Keep comment"));
        assert!(text.contains("mcp_servers.example"));
        assert!(!inventory(&store)
            .unwrap()
            .to_string()
            .contains("secret-fixture"));
        restore(&store, &backup).unwrap();
        assert_eq!(read(&root.join("config.toml")).unwrap().unwrap(), original);
        assert!(!root.join("auth.json").exists());
    }
    #[test]
    fn changed_destination_never_reuses_saved_secret() {
        let dir = tempfile::tempdir().unwrap();
        let p = fixture("codex");
        upsert(dir.path(), p.clone()).unwrap();
        let mut edited = p;
        edited.api_key.clear();
        edited.base_url = "https://different.example/v1".into();
        assert!(upsert(dir.path(), edited).is_err());
    }
    #[test]
    fn provider_files_are_scoped_and_invalid_config_is_preserved() {
        for id in ["claude", "gemini", "grok"] {
            let dir = tempfile::tempdir().unwrap();
            let p = fixture(id);
            let edits = changes(&p, dir.path()).unwrap();
            assert!(!edits.is_empty());
            assert!(edits.iter().all(|(path, _)| path.starts_with(dir.path())));
        }
        let dir = tempfile::tempdir().unwrap();
        private_write(&dir.path().join("config.toml"), b"broken = [").unwrap();
        assert!(changes(&fixture("codex"), dir.path()).is_err());
        for (harness, content) in [
            ("grok", "model = 'bad'"),
            ("codex", "model_providers = 5"),
            ("codex", "model_providers = {remote_codex = 5}"),
        ] {
            private_write(&dir.path().join("config.toml"), content.as_bytes()).unwrap();
            assert!(changes(&fixture(harness), dir.path()).is_err());
            assert_eq!(
                read(&dir.path().join("config.toml")).unwrap().unwrap(),
                content
            );
        }
    }
    #[test]
    fn claude_import_preserves_authentication_mode_and_unrelated_settings() {
        for (key, mode, other) in [
            ("ANTHROPIC_API_KEY", "api_key", "ANTHROPIC_AUTH_TOKEN"),
            ("ANTHROPIC_AUTH_TOKEN", "bearer", "ANTHROPIC_API_KEY"),
        ] {
            let text =
                json!({"settingsConfig":{"env":{key:"synthetic", "ANTHROPIC_MODEL":"test"}}})
                    .to_string();
            let p = import_config("claude", "Imported", &text, "").unwrap();
            assert_eq!(p.auth_type, mode);
            let dir = tempfile::tempdir().unwrap();
            private_write(
                &dir.path().join("settings.json"),
                json!({"env":{other:"old"},"permissions":{"allow":["Read"]}})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
            let edits = changes(&p, dir.path()).unwrap();
            let doc: Value = serde_json::from_str(&edits[0].1).unwrap();
            assert_eq!(doc["env"][key], "synthetic");
            assert!(doc["env"].get(other).is_none());
            assert_eq!(doc["permissions"]["allow"][0], "Read");
        }
    }
    #[test]
    fn templates_reject_commands_and_insecure_destinations() {
        let mut p = fixture("codex");
        p.base_url = "http://remote.example/v1".into();
        assert!(validate(&p, true).is_err());
        assert!(
            parse_template(json!({"schemaVersion":1,"profiles":[],"commands":["echo bad"]}))
                .is_err()
        );
    }
}
