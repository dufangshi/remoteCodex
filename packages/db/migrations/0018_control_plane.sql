CREATE TABLE IF NOT EXISTS control_users (
  id TEXT PRIMARY KEY NOT NULL,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  plan TEXT NOT NULL DEFAULT 'developer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  UNIQUE(auth_provider, auth_subject)
);

CREATE TABLE IF NOT EXISTS control_sandboxes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  image TEXT NOT NULL,
  region TEXT NOT NULL,
  k8s_namespace TEXT,
  k8s_pod_name TEXT,
  router_base_url TEXT,
  worker_service_name TEXT,
  s3_prefix TEXT NOT NULL,
  gateway_key_id TEXT,
  last_started_at TEXT,
  last_seen_at TEXT,
  idle_timeout_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES control_users(id)
);

CREATE TABLE IF NOT EXISTS control_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  source_type TEXT NOT NULL,
  git_url TEXT,
  default_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sandbox_id, slug),
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id)
);

CREATE TABLE IF NOT EXISTS control_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  worker_session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id),
  FOREIGN KEY(workspace_id) REFERENCES control_workspaces(id)
);

CREATE TABLE IF NOT EXISTS control_gateway_users (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, external_user_id),
  UNIQUE(user_id, provider),
  FOREIGN KEY(user_id) REFERENCES control_users(id)
);

CREATE TABLE IF NOT EXISTS control_gateway_keys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_key_id TEXT NOT NULL,
  key_ciphertext TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  UNIQUE(provider, external_key_id),
  UNIQUE(sandbox_id, provider),
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id)
);

CREATE TABLE IF NOT EXISTS control_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  gateway_key_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  external_request_id TEXT,
  occurred_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id)
);

CREATE TABLE IF NOT EXISTS control_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS control_workspaces_user_idx ON control_workspaces(user_id);
CREATE INDEX IF NOT EXISTS control_sessions_workspace_idx ON control_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS control_usage_user_occurred_idx ON control_usage_events(user_id, occurred_at);
