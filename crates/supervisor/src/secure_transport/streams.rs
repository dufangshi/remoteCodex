//! Pull-based, bounded encrypted downloads. Continuation IDs are secret and each
//! request is still authorized for the original thread/workspace by the relay.
use super::*;
use axum::body::{Body, BodyDataStream, Bytes};
use futures_util::StreamExt;
use std::time::{Duration, Instant};
const CHUNK: usize = 1024 * 1024;
#[derive(Default)]
pub(crate) struct Streams(Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<Entry>>>>>);
struct Entry {
    body: BodyDataStream,
    pending: Bytes,
    last: Option<(u64, Bytes, bool)>,
    next: u64,
    path: String,
    used: Instant,
}
fn scope(path: &str) -> String {
    let parts: Vec<_> = path.split('?').next().unwrap_or("").split('/').collect();
    if parts.len() > 3
        && matches!(parts[2], "threads" | "workspaces")
        && Uuid::parse_str(parts[3]).is_ok()
    {
        format!("/api/{}/{}", parts[2], parts[3])
    } else {
        "/api".into()
    }
}
impl Entry {
    async fn read(&mut self, index: u64) -> Result<(Bytes, bool)> {
        self.used = Instant::now();
        if let Some((previous, bytes, done)) = &self.last {
            if *previous == index {
                return Ok((bytes.clone(), *done));
            }
        }
        if index != self.next {
            bail!("invalid download sequence");
        }
        let mut out = Vec::with_capacity(CHUNK);
        let mut done = false;
        while out.len() < CHUNK {
            if !self.pending.is_empty() {
                let count = (CHUNK - out.len()).min(self.pending.len());
                out.extend_from_slice(&self.pending.split_to(count));
                continue;
            }
            match tokio::time::timeout(Duration::from_secs(30), self.body.next()).await? {
                Some(Ok(bytes)) => self.pending = bytes,
                Some(Err(error)) => return Err(error.into()),
                None => {
                    done = true;
                    break;
                }
            }
        }
        if !done && self.pending.is_empty() {
            match tokio::time::timeout(Duration::from_secs(30), self.body.next()).await? {
                Some(Ok(bytes)) => self.pending = bytes,
                Some(Err(error)) => return Err(error.into()),
                None => done = true,
            }
        }
        let bytes = Bytes::from(out);
        self.last = Some((index, bytes.clone(), done));
        self.next += 1;
        Ok((bytes, done))
    }
}
impl Streams {
    pub async fn begin(&self, path: &str, body: Body) -> Result<(Bytes, Option<String>)> {
        let mut entry = Entry {
            body: body.into_data_stream(),
            pending: Bytes::new(),
            last: None,
            next: 0,
            path: scope(path),
            used: Instant::now(),
        };
        let (bytes, done) = entry.read(0).await?;
        if done {
            return Ok((bytes, None));
        }
        let mut entries = self.0.lock().map_err(|_| anyhow!("download lock failed"))?;
        entries.retain(|_, entry| {
            entry
                .try_lock()
                .map_or(true, |e| e.used.elapsed() < Duration::from_secs(120))
        });
        if entries.len() >= 16 {
            bail!("too many active downloads");
        }
        let id = B64.encode(random());
        let next = format!("{}/transport/stream/{id}?chunk=1", entry.path);
        entries.insert(id.clone(), Arc::new(tokio::sync::Mutex::new(entry)));
        let weak = Arc::downgrade(&self.0);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(120)).await;
                let Some(map) = weak.upgrade() else {
                    break;
                };
                let Ok(mut entries) = map.lock() else {
                    break;
                };
                let expired = entries.get(&id).is_none_or(|entry| {
                    entry
                        .try_lock()
                        .is_ok_and(|e| e.used.elapsed() >= Duration::from_secs(120))
                });
                if expired {
                    entries.remove(&id);
                    break;
                }
            }
        });
        Ok((bytes, Some(next)))
    }
    pub async fn read(&self, path: &str) -> Result<Value> {
        let url = url::Url::parse(&format!("http://device{path}"))?;
        let id = url.path().rsplit('/').next().unwrap_or("");
        let index = url
            .query_pairs()
            .find(|(key, _)| key == "chunk")
            .ok_or_else(|| anyhow!("missing chunk"))?
            .1
            .parse::<u64>()?;
        let entry = {
            let entries = self.0.lock().map_err(|_| anyhow!("download lock failed"))?;
            entries
                .get(id)
                .cloned()
                .ok_or_else(|| anyhow!("download expired"))?
        };
        let mut entry = entry.lock().await;
        if entry.used.elapsed() > Duration::from_secs(120) || entry.path != scope(path) {
            bail!("download expired or wrong scope");
        }
        let (bytes, done) = entry.read(index).await?;
        let next =
            (!done).then(|| format!("{}/transport/stream/{id}?chunk={}", entry.path, index + 1));
        drop(entry);
        if done {
            self.0
                .lock()
                .map_err(|_| anyhow!("download lock failed"))?
                .remove(id);
        }
        // Intermediate reads are idempotent; after EOF the stream releases its file.
        Ok(
            json!({"statusCode":200,"headers":{"content-type":"application/octet-stream"},"body":base64::engine::general_purpose::STANDARD.encode(bytes),"bodyEncoding":"base64","streamNext":next}),
        )
    }
    pub fn expire(&self) {
        if let Ok(mut entries) = self.0.lock() {
            entries.retain(|_, entry| {
                entry
                    .try_lock()
                    .map_or(true, |e| e.used.elapsed() < Duration::from_secs(120))
            });
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn bounded_chunks_keep_scope_sequence_and_binary_bytes() {
        let streams = Streams::default();
        let scope = format!("/api/workspaces/{}", Uuid::new_v4());
        let bytes = (0..CHUNK * 2 + 9)
            .map(|n| (n % 251) as u8)
            .collect::<Vec<_>>();
        let (first, next) = streams
            .begin(
                &format!("{scope}/files/download"),
                Body::from(bytes.clone()),
            )
            .await
            .unwrap();
        assert_eq!(first.len(), CHUNK);
        let next = next.unwrap();
        assert!(streams.read(&next.replace(&scope, "/api")).await.is_err());
        assert!(streams
            .read(&next.replace("chunk=1", "chunk=2"))
            .await
            .is_err());
        let second = streams.read(&next).await.unwrap();
        assert_eq!(streams.read(&next).await.unwrap(), second);
        let third = streams
            .read(second["streamNext"].as_str().unwrap())
            .await
            .unwrap();
        assert!(third["streamNext"].is_null());
        let mut all = first.to_vec();
        all.extend(
            base64::engine::general_purpose::STANDARD
                .decode(second["body"].as_str().unwrap())
                .unwrap(),
        );
        all.extend(
            base64::engine::general_purpose::STANDARD
                .decode(third["body"].as_str().unwrap())
                .unwrap(),
        );
        assert_eq!(all, bytes);
        assert!(streams.0.lock().unwrap().is_empty());
        let (_, next) = streams
            .begin(&scope, Body::from(vec![0u8; CHUNK]))
            .await
            .unwrap();
        assert!(next.is_none());
    }
}
