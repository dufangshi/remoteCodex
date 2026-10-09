# remote-codex guide connection

Credentials, connection discovery and failure handling.

## Local connection and failures

Managed sessions receive `REMOTE_CODEX_THREAD_ID`, `REMOTE_CODEX_URL`, and credentials. Use them as supplied. Do not dump environment variables, print tokens, or send credentials in a prompt. `--from` overrides attribution for a known remoteCodex caller; it does not grant permission.

A normal shell may use `--cli-config PATH` / `REMOTE_CODEX_CLI_CONFIG`; otherwise the CLI discovers a protected `.cli.json` sibling of the configured Supervisor database. `--url` / `REMOTE_CODEX_URL` and `--token` / `REMOTE_CODEX_TOKEN` override connection fields. Prefer the environment or protected file over a command-line token. Managed credentials identify the parent for restricted child deletion; the machine connection file cannot grant that right. Agents sharing a user account and workspace still do not have filesystem isolation.

Only loopback HTTP is accepted; redirects are refused. Run on the sending device and select another device explicitly when needed. A missing connection is a configuration issue, not a reason to copy credentials into a prompt. After Supervisor restart use the current connection file if inherited credentials are stale. Invalid model, unknown thread, missing caller, and unsupported steering need corrected input, not repeated dispatch. `idle` is not task success: inspect errors, pending input, unread mail, and the relevant result.
