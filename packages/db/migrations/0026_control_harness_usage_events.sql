CREATE TABLE IF NOT EXISTS control_harness_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  provider TEXT NOT NULL,
  module TEXT NOT NULL,
  tool TEXT,
  run_id TEXT,
  job_id TEXT,
  external_event_id TEXT,
  compute_units REAL NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id),
  FOREIGN KEY(workspace_id) REFERENCES control_workspaces(id),
  FOREIGN KEY(session_id) REFERENCES control_sessions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS control_harness_usage_provider_event_idx
  ON control_harness_usage_events(provider, external_event_id)
  WHERE external_event_id IS NOT NULL;
