//! Codex ACP currently forwards context occupancy live and only the final API
//! request's tokens at completion. Tail its local rollout for complete turn usage.
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::local_sessions::LocalSessionHomes;
use crate::usage::Tokens;

/// Adapter deltas and final snapshots describe the same prompt. Reconcile them
/// before persistence so retries and final reports never bill an API call twice.
#[derive(Default)]
pub(super) struct AdapterUsageAccumulator {
    total: Tokens,
    last: Option<Tokens>,
    final_received: bool,
    reports: std::collections::HashSet<String>,
}

impl AdapterUsageAccumulator {
    pub fn apply(&mut self, mut report: Value) -> Option<Value> {
        let tokens = report.get("total").and_then(Tokens::parse)?;
        if report["reportKind"] == "delta" {
            if self.final_received {
                return None;
            }
            if let Some(id) = report["reportId"].as_str() {
                if !self.reports.insert(id.to_string()) {
                    return None;
                }
            }
            self.total = self.total.add(&tokens);
            self.last = Some(tokens);
        } else {
            self.final_received = true;
            self.total = tokens;
        }
        report["total"] = json!(self.total);
        report["last"] = json!(self.last.as_ref().unwrap_or(&self.total));
        report["cumulative"] = json!(false);
        if let Some(object) = report.as_object_mut() {
            object.remove("reportId");
            object.remove("reportKind");
        }
        Some(report)
    }
}

#[derive(Default)]
struct RolloutBaseline {
    offset: u64,
    tokens: Option<Tokens>,
    context: Option<Value>,
}

fn usage_record(line: &str) -> Option<Value> {
    if !line.contains("\"token_count\"") && !line.contains("\"turn_context\"") {
        return None;
    }
    serde_json::from_str(line).ok()
}

// Read backwards only as far as the latest usage and model context. Long-lived
// sessions can contain hundreds of megabytes of older tool output.
fn read_baseline_tail(reader: &mut (impl Read + Seek)) -> std::io::Result<RolloutBaseline> {
    let mut result = RolloutBaseline::default();
    let mut position = reader.seek(SeekFrom::End(0))?;
    let mut block = [0; 64 * 1024];
    let mut reversed_line = Vec::new();
    let mut found_complete_end = false;
    let inspect = |line: &mut Vec<u8>, result: &mut RolloutBaseline| {
        line.reverse();
        if let Some(entry) = std::str::from_utf8(line).ok().and_then(usage_record) {
            if result.context.is_none() && entry["type"] == "turn_context" {
                result.context = Some(entry);
            } else if result.tokens.is_none()
                && entry["type"] == "event_msg"
                && entry["payload"]["type"] == "token_count"
            {
                result.tokens = entry["payload"]["info"]["total_token_usage"]
                    .as_object()
                    .and_then(|_| Tokens::parse(&entry["payload"]["info"]["total_token_usage"]));
            }
        }
        line.clear();
    };
    while position > 0 {
        let count = usize::try_from(position.min(block.len() as u64)).unwrap();
        position -= count as u64;
        reader.seek(SeekFrom::Start(position))?;
        reader.read_exact(&mut block[..count])?;
        for index in (0..count).rev() {
            if block[index] != b'\n' {
                reversed_line.push(block[index]);
                continue;
            }
            if !found_complete_end {
                // The bytes after the last newline may still be in flight. Keep
                // the offset before them so the next live poll reads them whole.
                result.offset = position + index as u64 + 1;
                reversed_line.clear();
                found_complete_end = true;
            } else {
                inspect(&mut reversed_line, &mut result);
                if result.tokens.is_some() && result.context.is_some() {
                    return Ok(result);
                }
            }
        }
        // Model context from the previous turn is optional; the next turn emits
        // its own context. Do not scan a huge previous turn just to recover it.
        if result.tokens.is_some() {
            return Ok(result);
        }
    }
    if found_complete_end && !reversed_line.is_empty() {
        inspect(&mut reversed_line, &mut result);
    }
    Ok(result)
}

pub(super) struct CodexUsageReader {
    home: PathBuf,
    session_id: String,
    path: Option<PathBuf>,
    offset: u64,
    baseline: Tokens,
    latest: Option<Value>,
    start_time: String,
    next_lookup: std::time::Instant,
    model: Option<String>,
    effort: Option<String>,
    tier: Option<String>,
}

impl CodexUsageReader {
    pub(super) fn new(session_id: &str) -> Self {
        let mut reader = Self {
            home: LocalSessionHomes::from_env().codex_home,
            session_id: crate::import_id::parse_session_ref(session_id).raw_id,
            path: None,
            offset: 0,
            baseline: Tokens::default(),
            latest: None,
            start_time: remote_codex_protocol::now_rfc3339(),
            next_lookup: std::time::Instant::now(),
            model: None,
            effort: None,
            tier: None,
        };
        // Snapshot existing cumulative totals before session/prompt starts.
        reader.read(true);
        reader
    }

    pub(super) fn poll(&mut self) -> Vec<Value> {
        self.read(false)
    }

    pub(super) fn poll_final(&mut self) -> Vec<Value> {
        // A short first turn can finish before the periodic missing-file retry.
        self.next_lookup = std::time::Instant::now();
        self.read(false)
    }

    fn read(&mut self, baseline_only: bool) -> Vec<Value> {
        let mut updates = Vec::new();
        if self.path.is_none() && self.next_lookup <= std::time::Instant::now() {
            self.next_lookup = std::time::Instant::now() + std::time::Duration::from_secs(5);
            self.path = crate::local_sessions::find_codex_rollout(&self.home, &self.session_id);
        }
        let Some(path) = &self.path else {
            return updates;
        };
        let Ok(mut file) = File::open(path) else {
            return updates;
        };
        if baseline_only {
            if let Ok(baseline) = read_baseline_tail(&mut file) {
                self.offset = baseline.offset;
                self.baseline = baseline.tokens.unwrap_or_default();
                if let Some(context) = baseline.context {
                    self.update_context(&context);
                }
            }
            return updates;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return updates;
        }
        let mut reader = BufReader::new(file);
        loop {
            let mut line = String::new();
            let Ok(count) = reader.read_line(&mut line) else {
                break;
            };
            if count == 0 || !line.ends_with('\n') {
                break;
            }
            self.offset += count as u64;
            let Some(entry) = usage_record(&line) else {
                continue;
            };
            if entry["type"] == "turn_context" {
                self.update_context(&entry);
            }
            if entry["type"] != "event_msg" || entry["payload"]["type"] != "token_count" {
                continue;
            }
            let info = &entry["payload"]["info"];
            let Some(total) = info.get("total_token_usage").and_then(Tokens::parse) else {
                continue;
            };
            if entry
                .get("timestamp")
                .and_then(Value::as_str)
                .is_some_and(|t| t < self.start_time.as_str())
            {
                self.baseline = total;
                continue;
            }
            let last = info
                .get("last_token_usage")
                .and_then(Tokens::parse)
                .unwrap_or_else(|| total.clone());
            let update = json!({"total":total,"last":last,"modelContextWindow":info.get("model_context_window"),"cumulative":true,"baselineTotal":self.baseline,"source":"codexRollout","model":self.model,"reasoningEffort":self.effort,"pricingTierKey":self.tier});
            if self.latest.as_ref() != Some(&update) {
                self.latest = Some(update.clone());
                updates.push(update);
            }
        }
        updates
    }

    fn update_context(&mut self, entry: &Value) {
        self.model = entry["payload"]["model"].as_str().map(str::to_string);
        self.effort = entry["payload"]
            .get("effort")
            .or_else(|| entry["payload"].get("reasoning_effort"))
            .and_then(Value::as_str)
            .map(str::to_string);
        self.tier = entry["payload"]["service_tier"].as_str().map(|tier| {
            if matches!(tier, "fast" | "priority") {
                "fast"
            } else {
                "standard"
            }
            .into()
        });
    }
}
