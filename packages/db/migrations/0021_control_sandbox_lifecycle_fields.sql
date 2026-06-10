ALTER TABLE control_sandboxes ADD COLUMN startup_progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE control_sandboxes ADD COLUMN last_failure_code TEXT;
ALTER TABLE control_sandboxes ADD COLUMN last_failure_message TEXT;
