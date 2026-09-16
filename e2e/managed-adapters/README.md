# Managed ACP dependencies regression

Build `remote-codex-thread-e2e:local` as described in `../thread-interaction/README.md`; it supplies pinned real Codex 0.154.0 and Node/npm. Build the candidate Linux binary into a Docker volume (for example `remote-codex-thread-cargo`, at `/target/debug/remote-codex`). Then:

```sh
docker build -f e2e/managed-adapters/Dockerfile -t remote-codex-managed-adapters:ubuntu .
docker run -d --name rc-managed-ubuntu \
  -v "$PWD:/src:ro" -v remote-codex-thread-cargo:/build:ro \
  remote-codex-managed-adapters:ubuntu
docker exec rc-managed-ubuntu python3 /src/e2e/managed-adapters/verify.py
docker rm -f rc-managed-ubuntu
```

Use a fresh disposable container for each run. Its ordinary user cannot write the system npm prefix. No host credentials, home directory, Supervisor database, or running service are mounted. The test installs the real adapter from npm into the managed user prefix and uses real Codex for model discovery, creation, and session recovery. A loopback Responses fixture answers inference; no real account or model request is needed. Network access is required for npm installation.

The single regression covers missing-adapter inventory, shared executable/version discovery, unchanged system prefix, a failed automatic install with 60-second backoff, durable queued input, installation into a previously absent PATH directory, recovery without Supervisor restart, and preference for the managed copy when multiple prefixes exist. Codex's native rollout is initialized with one fixture turn before disconnecting: its empty sessions have no persisted rollout to resume. There is exactly one further turn for the queued task.
