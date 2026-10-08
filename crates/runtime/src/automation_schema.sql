CREATE TABLE IF NOT EXISTS automations (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, definition_json TEXT NOT NULL,
 state TEXT NOT NULL, next_run_at TEXT, event_cursor INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT,
 request_id TEXT, request_definition TEXT, UNIQUE(thread_id,request_id)
);
CREATE INDEX IF NOT EXISTS automations_target ON automations(thread_id);
CREATE TABLE IF NOT EXISTS automation_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE NOT NULL,
 payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
 id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id),
 occurrence_key TEXT NOT NULL, state TEXT NOT NULL, scheduled_at TEXT NOT NULL,
 observed_at TEXT NOT NULL, missed_count INTEGER NOT NULL DEFAULT 0,
 definition_json TEXT NOT NULL, event_json TEXT NOT NULL,
 pending_id TEXT, turn_id TEXT, command_id TEXT, started_at TEXT, completed_at TEXT,
 receipt_json TEXT, error TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
 UNIQUE(automation_id,occurrence_key)
);
CREATE INDEX IF NOT EXISTS automation_runs_state ON automation_runs(state);
CREATE INDEX IF NOT EXISTS automation_runs_turn ON automation_runs(turn_id);
CREATE TABLE IF NOT EXISTS command_executions (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, command_key TEXT,
 request_id TEXT, input_json TEXT NOT NULL, state TEXT NOT NULL,
 automation_run_id TEXT, ancestry_json TEXT NOT NULL,
 started_at TEXT NOT NULL, completed_at TEXT, exit_code INTEGER,
 stdout TEXT, stderr TEXT, error TEXT, UNIQUE(thread_id,request_id)
);
