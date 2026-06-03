CREATE TABLE IF NOT EXISTS control_harness_users (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, external_user_id),
  UNIQUE(user_id, provider),
  FOREIGN KEY(user_id) REFERENCES control_users(id)
);

CREATE TABLE IF NOT EXISTS control_harness_keys (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_key_id TEXT NOT NULL,
  key_ciphertext TEXT,
  secret_name TEXT,
  secret_key TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  revoked_at TEXT,
  UNIQUE(provider, external_key_id),
  UNIQUE(sandbox_id, provider),
  FOREIGN KEY(user_id) REFERENCES control_users(id),
  FOREIGN KEY(sandbox_id) REFERENCES control_sandboxes(id)
);
