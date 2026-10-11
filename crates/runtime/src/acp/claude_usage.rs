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
    background: super::claude_background::ClaudeBackgroundAgents,
    complete_tail: bool,
    tasks: super::claude_tasks::ClaudeNativeTasks,
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
            background: Default::default(),
            complete_tail: false,
            tasks: Default::default(),
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
            self.background = Default::default();
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

    pub fn background_subagents(&self) -> Vec<pockymoe_protocol::ThreadSubagentDto> {
        self.background.active()
    }

    pub fn background_pending(&self) -> bool {
        self.tasks.pending()
    }

    pub fn waiting_count(&self) -> usize {
        self.tasks.waiting_count()
    }

    pub fn take_task_notices(&mut self) -> Vec<Value> {
        self.tasks.take_notices()
    }

    pub fn annotate_background_reply_phases(
        &self,
        items: &mut [pockymoe_protocol::ThreadHistoryItemDto],
        completed: bool,
    ) {
        if !items.iter().any(|item| {
            matches!(
                item.extra.get("origin").and_then(Value::as_str),
                Some("nativeBackgroundWait" | "nativeTaskNotification")
            )
        }) {
            return;
        }
        let final_index = items.iter().rposition(|item| item.kind == "agentMessage");
        for (index, item) in items
            .iter_mut()
            .enumerate()
            .filter(|(_, item)| item.kind == "agentMessage")
        {
            let confirmed = completed
                && Some(index) == final_index
                && self.complete_tail
                && !self.background_pending()
                && self.background_subagents().is_empty()
                && self.completion.confirms_final_reply(&item.text);
            item.extra.insert(
                "responsePhase".into(),
                json!(if confirmed { "final" } else { "commentary" }),
            );
        }
    }

    pub fn record_sdk(&mut self, message: &Value) {
        self.tasks.record_sdk(message);
    }

    pub fn expect_prompt(&mut self, prompt: &str) {
        self.completion.expect_prompt(prompt);
    }

    pub fn completed_queued_command(&self, delivered_text: Option<&str>) -> Option<&str> {
        if !self.complete_tail || !self.background.active().is_empty() {
            return None;
        }
        self.completion.completed_queued_command(delivered_text)
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
        self.background.record(entry);
        self.tasks.record(entry);
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
    fn background_reply_phase_requires_native_end_turn_and_no_unfinished_work() {
        use pockymoe_protocol::ThreadHistoryItemDto;
        let home = tempfile::tempdir().unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        let mut reader = ClaudeUsageReader::with_home(home.path().into(), &session);
        let entry = |value: Value| {
            let mut value = value;
            value["sessionId"] = json!(session);
            value["timestamp"] = json!("2099-01-01T00:00:00Z");
            value
        };
        let item = |id: &str, kind: &str, text: &str| -> ThreadHistoryItemDto {
            serde_json::from_value(json!({"id":id,"kind":kind,"text":text})).unwrap()
        };
        let mut wake = item("wake", "generic", "Build finished");
        wake.extra
            .insert("origin".into(), json!("nativeTaskNotification"));
        let mut items = vec![
            wake,
            item("progress", "agentMessage", "Waiting on other platforms"),
            item("reply", "agentMessage", "Done"),
        ];
        let text = |text: &str, stop: &str| {
            entry(
                json!({"type":"assistant","message":{"stop_reason":stop,"content":[{"type":"text","text":text}]}}),
            )
        };
        reader.complete_tail = true;
        reader.record(&text("Done", "tool_use"));
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(items[2].extra["responsePhase"], "commentary");
        reader.record(&text("Done", "end_turn"));
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(items[1].extra["responsePhase"], "commentary");
        assert_eq!(items[2].extra["responsePhase"], "final");
        reader.annotate_background_reply_phases(&mut items, false);
        assert_eq!(items[2].extra["responsePhase"], "commentary");
        reader.complete_tail = false;
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(items[2].extra["responsePhase"], "commentary");
        reader.complete_tail = true;
        reader.record(&entry(json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"launch","name":"Bash"}]}})));
        reader.record(&entry(json!({"type":"user","toolUseResult":{"backgroundTaskId":"build"},"message":{"content":[{"type":"tool_result","tool_use_id":"launch"}]}})));
        reader.record(&text("Done", "end_turn"));
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(
            items[2].extra["responsePhase"], "commentary",
            "foreground end_turn while waiting is not the final report"
        );
        reader.record(&entry(json!({"type":"user","origin":{"kind":"task-notification"},"message":{"content":"<task-notification><task-id>build</task-id><status>completed</status></task-notification>"}})));
        reader.record(&text("Done", "end_turn"));
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(items[2].extra["responsePhase"], "final");
        items[2].text = "Unconfirmed text".into();
        reader.annotate_background_reply_phases(&mut items, true);
        assert_eq!(items[2].extra["responsePhase"], "commentary");
    }

    #[test]
    fn background_agents_exclude_history_foreign_sessions_and_sidechains() {
        let home = tempfile::tempdir().unwrap();
        let session = uuid::Uuid::new_v4().to_string();
        let project = home.path().join("projects/project");
        std::fs::create_dir_all(&project).unwrap();
        let file = project.join(format!("{session}.jsonl"));
        let launch = json!({"type":"assistant","timestamp":"2099-01-01T00:00:00Z","sessionId":session,
            "message":{"content":[{"type":"tool_use","id":"tool","name":"Agent","input":{"description":"Review"}}]}});
        let receipt = json!({"type":"user","timestamp":"2099-01-01T00:00:01Z","sessionId":session,
            "toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"agent"},
            "message":{"content":[{"type":"tool_result","tool_use_id":"tool"}]}});
        std::fs::write(&file, format!("{launch}\n{receipt}\n")).unwrap();
        let mut reader = ClaudeUsageReader::with_home(home.path().into(), &session);
        reader.poll();
        assert!(reader.background_subagents().is_empty());
        let mut out = std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap();
        for mut entry in [launch.clone(), receipt.clone()] {
            entry["sessionId"] = json!("foreign");
            writeln!(out, "{entry}").unwrap();
            entry["sessionId"] = json!(session);
            entry["isSidechain"] = json!(true);
            writeln!(out, "{entry}").unwrap();
        }
        reader.poll();
        assert!(reader.background_subagents().is_empty());
        writeln!(out, "{launch}\n{receipt}").unwrap();
        reader.poll();
        assert_eq!(reader.background_subagents().len(), 1);
        let mut finished = json!({"type":"user","timestamp":"2099-01-01T00:00:02Z","sessionId":session,
            "origin":{"kind":"task-notification"},"isSidechain":true,
            "message":{"content":"<task-notification><task-id>agent</task-id><status>completed</status></task-notification>"}});
        writeln!(out, "{finished}").unwrap();
        reader.poll();
        assert_eq!(reader.background_subagents().len(), 1);
        finished["isSidechain"] = json!(false);
        writeln!(out, "{finished}").unwrap();
        reader.poll();
        assert!(reader.background_subagents().is_empty());
    }

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
                "usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":200,"cache_creation_input_tokens":50,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":50}}}})
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
        assert_eq!(reports[0]["total"]["cacheWriteOneHourInputTokens"], 50);
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
