CREATE TABLE IF NOT EXISTS control_usage_import_state (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  source TEXT NOT NULL,
  cursor TEXT,
  last_started_at TEXT,
  last_succeeded_at TEXT,
  last_failed_at TEXT,
  last_failure_message TEXT,
  last_source_count INTEGER NOT NULL DEFAULT 0,
  last_imported_count INTEGER NOT NULL DEFAULT 0,
  last_duplicate_count INTEGER NOT NULL DEFAULT 0,
  last_failure_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS control_usage_import_state_provider_source_idx
  ON control_usage_import_state(provider, source);
