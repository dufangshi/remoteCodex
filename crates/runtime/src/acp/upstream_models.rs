use crate::upstreams::{self, Profile};
use anyhow::Result;
use remote_codex_protocol::ModelOptionDto;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

type Cached = (Vec<u8>, Instant, Vec<ModelOptionDto>);
pub(super) struct UpstreamModels {
    directory: PathBuf,
    cache: Mutex<HashMap<String, Cached>>,
}
impl UpstreamModels {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            cache: Mutex::new(HashMap::new()),
        }
    }
    pub async fn catalog(&self, harness: &str) -> Result<Option<(Profile, Vec<ModelOptionDto>)>> {
        let Some(profile) = upstreams::active_profile(&self.directory, harness)? else {
            return Ok(None);
        };
        let fingerprint = Sha256::digest(serde_json::to_vec(&profile)?).to_vec();
        let mut cache = self.cache.lock().await;
        if let Some((key, time, models)) = cache.get(harness) {
            if *key == fingerprint && time.elapsed() < Duration::from_secs(60) {
                return Ok(Some((profile, models.clone())));
            }
        }
        let result = tokio::time::timeout(
            Duration::from_secs(25),
            upstreams::discover_models(&profile),
        )
        .await??;
        let models = result["models"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| {
                let id = row["id"].as_str()?;
                Some(ModelOptionDto {
                    id: id.into(),
                    model: id.into(),
                    display_name: row["name"].as_str().unwrap_or(id).into(),
                    description: format!("{} · {}", profile.name, profile.harness),
                    is_default: id == profile.model,
                    hidden: false,
                    supported_reasoning_efforts: vec![],
                    default_reasoning_effort: None,
                    selection_kind: Some("model".into()),
                    acp_agent: None,
                })
            })
            .collect::<Vec<_>>();
        cache.insert(
            harness.into(),
            (fingerprint, Instant::now(), models.clone()),
        );
        Ok(Some((profile, models)))
    }
}
