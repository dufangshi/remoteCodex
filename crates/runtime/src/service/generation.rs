//! Output throughput from actual usage counters, not text length. Tool and user
//! waits are excluded; request-level counters are apportioned over their LLM time
//! for the trailing wall-clock minute. Old turns without timing remain unavailable.
use super::*;
use std::collections::VecDeque;

#[derive(Default)]
pub(super) struct GenerationCache(std::sync::Mutex<HashMap<(String, String), Tracker>>);

#[derive(Clone)]
struct Span {
    start: i64,
    end: i64,
    tokens: f64,
}

struct Tracker {
    at: i64,
    llm_ms: i64,
    output: u64,
    tools: HashSet<String>,
    pending: Vec<Span>,
    samples: VecDeque<Span>,
}

impl Tracker {
    fn new(at: i64) -> Self {
        Self {
            at,
            llm_ms: 0,
            output: 0,
            tools: HashSet::new(),
            pending: vec![],
            samples: VecDeque::new(),
        }
    }

    fn advance(&mut self, at: i64) {
        let at = at.max(self.at);
        if self.tools.is_empty() && at > self.at {
            self.llm_ms += at - self.at;
            if let Some(last) = self.pending.last_mut().filter(|s| s.end == self.at) {
                last.end = at;
            } else {
                self.pending.push(Span {
                    start: self.at,
                    end: at,
                    tokens: 0.0,
                });
            }
        }
        self.at = at;
        while self.samples.front().is_some_and(|s| s.end <= at - 60000) {
            self.samples.pop_front();
        }
    }

    fn tool(&mut self, at: i64, id: &str, running: bool) {
        self.advance(at);
        if running {
            self.tools.insert(id.into());
        } else {
            self.tools.remove(id);
        }
    }

    fn usage(&mut self, at: i64, output: u64) {
        self.advance(at);
        if output <= self.output {
            return;
        }
        let elapsed: i64 = self.pending.iter().map(|s| s.end - s.start).sum();
        let delta = output - self.output;
        self.output = output;
        if elapsed > 0 {
            for mut span in self.pending.drain(..) {
                span.tokens = delta as f64 * (span.end - span.start) as f64 / elapsed as f64;
                if span.end > self.at - 60000 {
                    self.samples.push_back(span);
                }
            }
        }
    }

    fn snapshot(&mut self, at: i64, active: bool) -> Value {
        self.advance(at);
        let mut recent_ms = 0;
        let mut recent_tokens = 0.0;
        for span in self.samples.iter().chain(self.pending.iter()) {
            let ms = (span.end - span.start.max(self.at - 60000)).max(0);
            recent_ms += ms;
            recent_tokens += span.tokens * ms as f64 / (span.end - span.start) as f64;
        }
        json!({"outputTokens":self.output,"llmTimeMs":self.llm_ms,
            "averageTokensPerSecond":(self.llm_ms > 0 && self.output > 0).then(||self.output as f64 * 1000.0 / self.llm_ms as f64),
            "recentTokensPerSecond":(recent_ms > 0 && recent_tokens > 0.0).then(||recent_tokens * 1000.0 / recent_ms as f64),
            "windowSeconds":60,"active":active,"state":if self.tools.is_empty() {"llm"} else {"tool"},
            "measurement":"usageIntervals","updatedAt":chrono::DateTime::from_timestamp_millis(self.at).map(|at|at.to_rfc3339())})
    }
}

fn millis(at: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|at| at.timestamp_millis())
}

impl Supervisor {
    pub(super) fn observe_generation_event(
        &self,
        event: &remote_codex_protocol::ThreadEventEnvelope,
    ) -> Result<()> {
        let Some(at) = millis(&event.timestamp) else {
            return Ok(());
        };
        let turn = event.payload["turnId"]
            .as_str()
            .or_else(|| {
                event
                    .payload
                    .pointer("/request/turnId")
                    .and_then(Value::as_str)
            })
            .map(str::to_owned)
            .or_else(|| {
                if event.event_type != "thread.request.resolved" {
                    return None;
                }
                let request = format!("request:{}", event.payload["requestId"].as_str()?);
                self.generation
                    .0
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|(key, tracker)| {
                        key.0 == event.thread_id && tracker.tools.contains(&request)
                    })
                    .map(|(key, _)| key.1.clone())
            });
        let Some(turn) = turn else {
            return Ok(());
        };
        let key = (event.thread_id.clone(), turn.clone());
        if event.event_type == "thread.turn.started" {
            self.generation
                .0
                .lock()
                .unwrap()
                .entry(key)
                .or_insert_with(|| Tracker::new(at));
            return Ok(());
        }
        let output = if event.event_type == "runtime.usage.updated" {
            self.db.with(|conn| Ok(conn.query_row("SELECT json_extract(token_usage_json,'$.total.outputTokens') FROM thread_turns WHERE thread_id=?1 AND id=?2", params![event.thread_id,turn], |row| row.get::<_,Option<u64>>(0)).optional()?.flatten()))?
        } else {
            None
        };
        let speed = {
            let mut cache = self.generation.0.lock().unwrap();
            let Some(tracker) = cache.get_mut(&key) else {
                return Ok(());
            };
            match event.event_type.as_str() {
                "thread.request.created" => {
                    let Some(id) = event.payload.pointer("/request/id").and_then(Value::as_str)
                    else {
                        return Ok(());
                    };
                    tracker.tool(at, &format!("request:{id}"), true);
                }
                "thread.request.resolved" => {
                    let Some(id) = event.payload["requestId"].as_str() else {
                        return Ok(());
                    };
                    tracker.tool(at, &format!("request:{id}"), false);
                }
                "thread.item.started" | "thread.item.completed" => {
                    let item = &event.payload["item"];
                    if !matches!(
                        item["kind"].as_str(),
                        Some(
                            "commandExecution"
                                | "fileChange"
                                | "fileRead"
                                | "webSearch"
                                | "toolCall"
                                | "agentToolCall"
                                | "skillToolCall"
                        )
                    ) {
                        return Ok(());
                    }
                    let Some(id) = item["id"].as_str() else {
                        return Ok(());
                    };
                    let running = !matches!(
                        item["status"].as_str(),
                        Some("completed" | "failed" | "interrupted")
                    );
                    tracker.tool(at, id, running);
                }
                "runtime.usage.updated" => {
                    if let Some(output) = output {
                        tracker.usage(at, output);
                    }
                }
                "thread.turn.completed" => {
                    let mut tracker = cache.remove(&key).unwrap();
                    let speed = tracker.snapshot(at, false);
                    drop(cache);
                    return self.save_generation_speed(&key, speed);
                }
                _ => return Ok(()),
            }
            tracker.snapshot(at, true)
        };
        self.save_generation_speed(&key, speed)
    }

    pub(super) fn refresh_generation_speeds(&self) -> Result<()> {
        let now = millis(&now_rfc3339()).unwrap();
        let snapshots: Vec<_> = self
            .generation
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .map(|(key, tracker)| (key.clone(), tracker.snapshot(now, true)))
            .collect();
        for (key, speed) in snapshots {
            self.save_generation_speed(&key, speed)?;
        }
        Ok(())
    }

    fn save_generation_speed(&self, key: &(String, String), speed: Value) -> Result<()> {
        let payload = self.db.with(|conn| {
            let row = conn.query_row("SELECT token_usage_json,model,reasoning_effort FROM thread_turns WHERE thread_id=?1 AND id=?2", params![key.0,key.1], |r| Ok((r.get::<_,Option<String>>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?))).optional()?;
            let Some((Some(raw),model,effort)) = row else { return Ok(None); };
            let mut usage: Value = serde_json::from_str(&raw)?;
            // An observer snapshot taken before completion must not overwrite the
            // final timing after another callback has removed the tracker.
            if usage["generationSpeed"]["active"] == false && speed["active"] == true { return Ok(None); }
            if usage["generationSpeed"]["updatedAt"].as_str().and_then(millis) > speed["updatedAt"].as_str().and_then(millis)
                || usage["generationSpeed"]["outputTokens"].as_u64() > speed["outputTokens"].as_u64() { return Ok(None); }
            usage["generationSpeed"] = speed;
            conn.execute("UPDATE thread_turns SET token_usage_json=?1 WHERE thread_id=?2 AND id=?3", params![usage.to_string(),key.0,key.1])?;
            Ok(Some(json!({"turnId":key.1,"model":model,"reasoningEffort":effort,"tokenUsage":crate::usage::public_usage(&usage),"priceEstimate":usage["priceEstimate"]})))
        })?;
        if let Some(payload) = payload {
            self.bus.emit(remote_codex_protocol::ThreadEventEnvelope {
                event_type: "thread.turn.token.updated".into(),
                thread_id: key.0.clone(),
                timestamp: now_rfc3339(),
                payload,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_minute_is_not_llm_time_and_parallel_tools_pause_only_once() {
        let mut t = Tracker::new(0);
        t.usage(10000, 1000);
        t.tool(10000, "a", true);
        t.tool(20000, "b", true);
        t.tool(40000, "a", false);
        t.tool(70000, "b", false);
        t.usage(80000, 2000);
        let s = t.snapshot(80000, false);
        assert_eq!(s["llmTimeMs"], 20000);
        assert_eq!(s["averageTokensPerSecond"], 100.0);
        assert_eq!(s["recentTokensPerSecond"], 100.0);
        t.usage(80000, 2000);
        assert_eq!(
            t.snapshot(80000, false),
            s,
            "duplicate usage must not count twice"
        );
    }
    #[test]
    fn rolling_window_clips_old_requests_and_never_invents_tokens() {
        let mut t = Tracker::new(0);
        assert_eq!(t.snapshot(5000, true)["recentTokensPerSecond"], Value::Null);
        t.usage(10000, 1000);
        t.usage(70000, 4000);
        assert_eq!(t.snapshot(70000, true)["recentTokensPerSecond"], 50.0);
        t.tool(70000, "wait", true);
        assert_eq!(
            t.snapshot(140000, true)["recentTokensPerSecond"],
            Value::Null
        );
        assert!(
            (t.snapshot(140000, true)["averageTokensPerSecond"]
                .as_f64()
                .unwrap()
                - 4000.0 / 70.0)
                .abs()
                < 1e-8
        );
    }
}
