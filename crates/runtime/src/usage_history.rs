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
        self.get_for(home, session_id, false).await
    }

    pub(crate) async fn get_grok(
        &self,
        home: &Path,
        session_id: &str,
    ) -> Option<Arc<Vec<ThreadTurnDto>>> {
        self.get_for(home, session_id, true).await
    }

    async fn get_for(
        &self,
        home: &Path,
        session_id: &str,
        grok: bool,
    ) -> Option<Arc<Vec<ThreadTurnDto>>> {
        let key = (
            home.to_path_buf(),
            crate::import_id::parse_session_ref(session_id).raw_id,
        );
        let search = key.clone();
        let fingerprint = tokio::task::spawn_blocking(move || {
            let path = if grok {
                crate::local_sessions::find_grok_updates(&search.0, &search.1)
            } else {
                crate::local_sessions::find_codex_rollout(&search.0, &search.1)
            }?;
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
                if grok {
                    crate::local_sessions::read_grok_usage_history(&path).map(Arc::new)
                } else {
                    crate::local_sessions::read_codex_usage_history(&path).map(Arc::new)
                }
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
