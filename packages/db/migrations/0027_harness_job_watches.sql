CREATE TABLE harness_notify_registrations (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  hook_token TEXT NOT NULL,
  secret TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE harness_job_watches (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_job_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE UNIQUE INDEX harness_job_watches_job_id_idx ON harness_job_watches (job_id);
