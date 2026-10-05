//! Claude ACP sends context occupancy while streaming, but billable usage often
//! arrives only at prompt completion. Read completed native assistant messages
//! during the turn, including the response which produced the first tool call.
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::usage::Tokens;

pub(super) struct ClaudeUsageReader {
    home: PathBuf,
    session: String,
    path: Option<PathBuf>,
    offset: u64,
    started: chrono::DateTime<chrono::Utc>,
    next_lookup: Instant,
    messages: HashMap<String, Tokens>,
    completion: super::claude_completion::ClaudeCompletion,
    complete_tail: bool,
}

impl ClaudeUsageReader {
    pub fn new(session: &str) -> Self {
        Self::with_home(
            crate::local_sessions::LocalSessionHomes::from_env().claude_home,
            session,
        )
    }

    fn with_home(home: PathBuf, session: &str) -> Self {
        let mut reader = Self {
            home,
            session: crate::import_id::parse_session_ref(session).raw_id,
            path: None,
            offset: 0,
            started: chrono::Utc::now(),
            next_lookup: Instant::now(),
            messages: HashMap::new(),
            completion: Default::default(),
            complete_tail: false,
        };
        reader.find_path();
        // Exclude old turns without reading their potentially huge tool output.
        if let Some(file) = reader.path.as_ref().and_then(|p| File::open(p).ok()) {
            reader.offset = file.metadata().map(|m| m.len()).unwrap_or(0);
        }
        reader
    }

    fn find_path(&mut self) {
        if self.path.is_some() || Instant::now() < self.next_lookup {
            return;
        }
        self.next_lookup = Instant::now() + Duration::from_secs(1);
        if uuid::Uuid::parse_str(&self.session).is_err() {
            return;
        }
        let name = format!("{}.jsonl", self.session);
        self.path = walkdir::WalkDir::new(self.home.join("projects"))
            .max_depth(2)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .find(|entry| entry.file_type().is_file() && entry.file_name() == name.as_str())
            .map(|entry| entry.into_path());
    }

    pub fn poll(&mut self) -> Vec<Value> {
        self.complete_tail = false;
        self.find_path();
        let Some(mut file) = self.path.as_ref().and_then(|p| File::open(p).ok()) else {
            return Vec::new();
        };
        if file.metadata().is_ok_and(|m| m.len() < self.offset) {
            self.completion.invalidate();
            self.offset = 0;
        }
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return Vec::new();
        }
        let mut reader = BufReader::new(file);
        let mut reports = Vec::new();
        loop {
            let mut line = String::new();
            let Ok(count) = reader.read_line(&mut line) else {
                break;
            };
            // Do not consume a partially written JSONL record.
            if count == 0 {
                self.complete_tail = true;
                break;
            }
            if !line.ends_with('\n') {
                break;
            }
            self.offset += count as u64;
            match serde_json::from_str(&line) {
                Ok(entry) => {
                    if let Some(report) = self.record(&entry) {
                        reports.push(report);
                    }
                }
                Err(_) => self.completion.invalidate(),
            }
        }
        reports
    }

    pub fn poll_final(&mut self) -> Vec<Value> {
        self.next_lookup = Instant::now();
        self.poll()
    }

    pub fn abandoned_tools(
        &self,
        error: &str,
        delivered_text: Option<&str>,
    ) -> Option<Vec<String>> {
        if !self.complete_tail {
            return None;
        }
        self.completion.abandoned_tools(error, delivered_text)
    }

    fn record(&mut self, entry: &Value) -> Option<Value> {
        let at = entry["timestamp"].as_str()?;
        if entry["sessionId"] != self.session
            || entry["isSidechain"] == true
            || chrono::DateTime::parse_from_rfc3339(at).ok()? < self.started
        {
            return None;
        }
        let message = &entry["message"];
        self.completion.record(entry);
        if entry["type"] != "assistant" {
            return None;
        }
        let id = message["id"].as_str()?.to_owned();
        let tokens = Tokens::parse(&message["usage"])?;
        // One API response may produce multiple JSONL content records with the
        // same message ID. They are snapshots, never additive usage deltas.
        if self.messages.get(&id).is_some_and(|previous| {
            previous == &tokens || previous.output_tokens > tokens.output_tokens
        }) {
            return None;
        }
        self.messages.insert(id, tokens.clone());
        let total = self
            .messages
            .values()
            .fold(Tokens::default(), |sum, tokens| sum.add(tokens));
        Some(
            json!({"total":total,"last":tokens,"cumulative":false,"source":"claudeRollout",
            "model":message["model"],"observedAt":at}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn first_tool_response_is_visible_before_turn_completion_without_rebilling_history_or_blocks() {
        let home = tempfile::tempdir().unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        let project = home.path().join("projects/project");
        std::fs::create_dir_all(&project).unwrap();
        let file = project.join(format!("{session}.jsonl"));
        let record = |id: &str, output: u64| {
            json!({"type":"assistant","sessionId":session,"timestamp":"2099-01-01T00:00:00Z",
            "message":{"id":id,"model":"claude-sonnet-4-5","content":[{"type":"tool_use","name":"Bash"}],
                "usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":200,"cache_creation_input_tokens":50}}})
        };
        std::fs::write(&file, format!("{}\n", record("old", 900))).unwrap();
        let mut reader = ClaudeUsageReader::with_home(home.path().into(), &session);
        assert!(reader.poll().is_empty());
        let mut out = std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap();
        writeln!(out, "{}", record("first", 40)).unwrap();
        let reports = reader.poll();
        assert_eq!(reports[0]["total"]["outputTokens"], 40);
        assert_eq!(reports[0]["total"]["inputTokens"], 350);
        assert_eq!(reports[0]["total"]["cacheWriteInputTokens"], 50);
        writeln!(out, "{}", record("first", 40)).unwrap();
        assert!(reader.poll().is_empty());
        writeln!(out, "{}", record("first", 60)).unwrap();
        assert_eq!(reader.poll()[0]["total"]["outputTokens"], 60);
        let mut unrelated = record("nested", 2000);
        unrelated["isSidechain"] = json!(true);
        writeln!(out, "{unrelated}").unwrap();
        unrelated["isSidechain"] = json!(false);
        unrelated["sessionId"] = json!("other");
        writeln!(out, "{unrelated}").unwrap();
        assert!(reader.poll().is_empty());
        write!(out, "{}", record("second", 140)).unwrap();
        assert!(reader.poll().is_empty());
        writeln!(out).unwrap();
        assert_eq!(reader.poll_final()[0]["total"]["outputTokens"], 200);
    }

    #[test]
    fn short_first_turn_discovers_its_new_file_on_final_poll() {
        let home = tempfile::tempdir().unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        let mut reader = ClaudeUsageReader::with_home(home.path().into(), &session);
        let project = home.path().join("projects/project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            project.join(format!("{session}.jsonl")),
            format!(
                "{}\n",
                json!({"type":"assistant","sessionId":session,"timestamp":"2099-01-01T00:00:00Z",
            "message":{"id":"m","usage":{"input_tokens":1,"output_tokens":2}}})
            ),
        )
        .unwrap();
        assert_eq!(reader.poll_final()[0]["total"]["outputTokens"], 2);
    }

    #[test]
    fn steered_streamed_bash_is_interrupted_without_failing_the_completed_reply() {
        use super::super::mapper::TurnMapper;
        let home = tempfile::tempdir().unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        let project = home.path().join("projects/project");
        std::fs::create_dir_all(&project).unwrap();
        let path = project.join(format!("{session}.jsonl"));
        // Old history must not supply steering or completion evidence.
        let entry = |value: Value| {
            let mut value = value;
            value["sessionId"] = json!(session);
            value["timestamp"] = json!("2099-01-01T00:00:00Z");
            value
        };
        let initial = entry(json!({"type":"user","uuid":"initial","message":{"content":"start"}}));
        let steer =
            entry(json!({"type":"user","uuid":"steer","message":{"content":"change direction"}}));
        let final_reply = entry(
            json!({"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}}),
        );
        std::fs::write(&path, format!("{initial}\n{steer}\n{final_reply}\n")).unwrap();
        let mut reader = ClaudeUsageReader::with_home(home.path().into(), &session);
        let error = json!({"code":-32603,"data":{"errorKind":"incomplete_tool_call"},
            "message":"Internal error: Claude ended the turn without returning results for tool calls: toolu_orphan"}).to_string();
        reader.poll_final();
        assert!(reader.abandoned_tools(&error, Some("done")).is_none());

        let mut out = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(out, "{initial}").unwrap();
        // Matches the incident: a complete-looking streamed input was never
        // committed as a native tool_use before the next user prompt.
        let mut mapper = TurnMapper::new("turn");
        mapper.apply(
            &json!({"sessionUpdate":"tool_call","toolCallId":"toolu_orphan",
            "kind":"execute","rawInput":{"command":"do-something-with-side-effects"}}),
        );
        mapper.apply(
            &json!({"sessionUpdate":"tool_call","toolCallId":"toolu_done",
            "kind":"execute","rawInput":{"command":"read-results"}}),
        );
        mapper.apply(&json!({"sessionUpdate":"tool_call_update","toolCallId":"toolu_done","status":"completed"}));
        writeln!(out, "{steer}").unwrap();
        reader.poll();
        assert!(reader.abandoned_tools(&error, Some("done")).is_none());
        writeln!(out, "{final_reply}").unwrap();
        reader.poll_final();
        // The late adapter failure is drained before reconciliation.
        mapper.apply(
            &json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"done"}}),
        );
        mapper.apply(&json!({"sessionUpdate":"tool_call_update","toolCallId":"toolu_orphan","status":"failed",
            "content":[{"type":"content","content":{"type":"text","text":"Claude ended without a result"}}]}));
        let ids = reader
            .abandoned_tools(&error, mapper.final_agent_text())
            .unwrap();
        mapper.reconcile_abandoned_tools(&ids);
        let items = mapper.finish(false);
        let orphan = items.iter().find(|item| item.id == "toolu_orphan").unwrap();
        assert_eq!(orphan.status.as_deref(), Some("interrupted"));
        assert!(orphan
            .detail_text
            .as_deref()
            .unwrap()
            .contains("no execution recorded"));
        assert!(!orphan
            .detail_text
            .as_deref()
            .unwrap()
            .contains("ended without a result"));
        assert!(items.iter().any(|item| item.kind == "agentMessage"
            && item.text == "done"
            && item.status.as_deref() == Some("completed")));
        assert_eq!(
            items
                .iter()
                .find(|item| item.id == "toolu_done")
                .unwrap()
                .status
                .as_deref(),
            Some("completed")
        );
        // A partial/corrupt tail must not make absence of a committed ID proof.
        write!(out, "{{").unwrap();
        reader.poll_final();
        assert!(reader.abandoned_tools(&error, Some("done")).is_none());
        writeln!(out).unwrap();
        reader.poll_final();
        assert!(reader.abandoned_tools(&error, Some("done")).is_none());
    }
}
