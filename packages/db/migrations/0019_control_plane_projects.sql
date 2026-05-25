ALTER TABLE control_users ADD COLUMN billing_customer_id TEXT;
ALTER TABLE control_users ADD COLUMN quota_profile TEXT NOT NULL DEFAULT 'developer';
ALTER TABLE control_sandboxes ADD COLUMN status_reason TEXT;

CREATE TABLE IF NOT EXISTS control_projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug),
  FOREIGN KEY(user_id) REFERENCES control_users(id)
);

ALTER TABLE control_workspaces ADD COLUMN project_id TEXT REFERENCES control_projects(id);

CREATE INDEX IF NOT EXISTS control_projects_user_idx ON control_projects(user_id);
