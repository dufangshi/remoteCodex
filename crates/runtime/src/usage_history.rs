use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use remote_codex_protocol::ThreadTurnDto;
use tokio::sync::Mutex;

type Fingerprint = Option<(PathBuf, u64, Option<SystemTime>)>;
type CachedHistory = (Fingerprint, Option<Arc<Vec<ThreadTurnDto>>>);

/// Cache successful and unavailable usage scans. Large existing rollouts are read
/// off the async executor and unchanged files are never reparsed on page refresh.
#[derive(Default)]
pub(crate) struct UsageHistoryCache {
    entries: Mutex<HashMap<(PathBuf, String), CachedHistory>>,
}

impl UsageHistoryCache {
    pub(crate) async fn get(
        &self,
        home: &Path,
        session_id: &str,
    ) -> Option<Arc<Vec<ThreadTurnDto>>> {
        let key = (
            home.to_path_buf(),
            crate::import_id::parse_session_ref(session_id).raw_id,
        );
        let search = key.clone();
        let fingerprint = tokio::task::spawn_blocking(move || {
            let path = crate::local_sessions::find_codex_rollout(&search.0, &search.1)?;
            let meta = std::fs::metadata(&path).ok()?;
            Some((path, meta.len(), meta.modified().ok()))
        })
        .await
        .ok()?;
        let mut entries = self.entries.lock().await;
        if let Some((cached_fingerprint, history)) = entries.get(&key) {
            if cached_fingerprint == &fingerprint {
                return history.clone();
            }
        }
        let history = if let Some((path, _, _)) = &fingerprint {
            let path = path.clone();
            tokio::task::spawn_blocking(move || {
                crate::local_sessions::read_codex_usage_history(&path).map(Arc::new)
            })
            .await
            .ok()
            .flatten()
        } else {
            None
        };
        if entries.len() >= 32 {
            entries.clear();
        }
        entries.insert(key, (fingerprint, history.clone()));
        history
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn repeated_reads_reuse_history_until_the_rollout_changes() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("sessions")).unwrap();
        let path = root.path().join("sessions/rollout-session.jsonl");
        let rows = [
            json!({"type":"session_meta","payload":{"id":"session","cwd":root.path()}}),
            json!({"type":"event_msg","payload":{"type":"task_started","turn_id":"one"}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"prompt"}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10}}}}),
        ];
        let content = rows
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, &content).unwrap();
        let cache = UsageHistoryCache::default();
        let first = cache.get(root.path(), "session").await.unwrap();
        let second = cache.get(root.path(), "session").await.unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        std::fs::write(&path, format!("{content}\n")).unwrap();
        let changed = cache.get(root.path(), "session").await.unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_eq!(
            changed[0].token_usage.as_ref().unwrap()["total"]["inputTokens"],
            100
        );
    }
}
