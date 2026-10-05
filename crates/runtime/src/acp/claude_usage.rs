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
        self.find_path();
        let Some(mut file) = self.path.as_ref().and_then(|p| File::open(p).ok()) else {
            return Vec::new();
        };
        if file.metadata().is_ok_and(|m| m.len() < self.offset) {
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
            if count == 0 || !line.ends_with('\n') {
                break;
            }
            self.offset += count as u64;
            if let Some(report) = serde_json::from_str(&line)
                .ok()
                .and_then(|entry| self.record(&entry))
            {
                reports.push(report);
            }
        }
        reports
    }

    pub fn poll_final(&mut self) -> Vec<Value> {
        self.next_lookup = Instant::now();
        self.poll()
    }

    fn record(&mut self, entry: &Value) -> Option<Value> {
        let at = entry["timestamp"].as_str()?;
        if entry["type"] != "assistant"
            || entry["sessionId"] != self.session
            || entry["isSidechain"] == true
            || chrono::DateTime::parse_from_rfc3339(at).ok()? < self.started
        {
            return None;
        }
        let message = &entry["message"];
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
}
