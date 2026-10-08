#!/usr/bin/env python3
"""Real CLI/HTTP/restart regression against a PRIVATE fake Supervisor only.

python3 scripts/test-unified-hooks.py --binary target/debug/remote-codex --port 18237
No inherited connection/relay configuration is used. All scripts and schedules are
created inside a temporary directory, which is retained only with --keep.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import tempfile
import time
import urllib.request


def until(fn, timeout=8):
    deadline = time.monotonic() + timeout
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() >= deadline:
            raise AssertionError("fixture condition timed out")
        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", default="target/debug/remote-codex")
    parser.add_argument("--port", type=int, default=18237)
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    temp = tempfile.TemporaryDirectory(prefix="unified-hooks-cli-")
    root = Path(temp.name)
    base = f"http://127.0.0.1:{args.port}"
    clean = {k: v for k, v in os.environ.items() if not k.startswith("REMOTE_CODEX_") and k not in ("DATABASE_URL", "WORKSPACE_ROOT")}
    env = dict(clean, REMOTE_CODEX_MODE="local", REMOTE_CODEX_E2E_FAKE_RUNTIME="1", REMOTE_CODEX_DATABASE_PATH=str(root / "db.sqlite"), DATABASE_URL=str(root / "db.sqlite"), REMOTE_CODEX_WORKSPACE_ROOT=str(root), WORKSPACE_ROOT=str(root), HOST="127.0.0.1", PORT=str(args.port))
    process = None
    cli_process = None
    script_pid = None
    log = (root / "supervisor.log").open("w")

    def api(path, data=None):
        request = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.load(response)

    def start():
        nonlocal process
        process = subprocess.Popen([binary, "supervisor"], env=env, stdout=log, stderr=log)
        def ready():
            assert process.poll() is None, "private Supervisor exited; inspect fixture log"
            try:
                return api("/healthz")["processId"] == process.pid
            except (OSError, ValueError):
                return False
        until(ready)

    def stop(crash=False):
        if process is not None and process.poll() is None:
            process.kill() if crash else process.terminate()
            process.wait(timeout=5)

    def cli(*argv, expected=0):
        result = subprocess.run([binary, *argv], env=cli_env, capture_output=True, text=True, timeout=12)
        assert result.returncode == expected, f"CLI {argv[:2]} exit {result.returncode}: {result.stderr}"
        return json.loads(result.stdout)

    def create(definition, key):
        return cli("automation", "create", "--json", json.dumps(definition), "--request-id", key)

    def runs(automation):
        return cli("automation", "runs", automation["id"])["runs"]

    try:
        # Refuse to reuse any existing service, even if it is another fake fixture.
        import socket
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", args.port))
        start()
        workspace = api("/api/workspaces", {"absPath": str(root)})
        thread = api("/api/threads/start", {"workspaceId": workspace["id"], "provider": "codex", "model": "ios-e2e-stream", "approvalMode": "yolo"})
        thread_id = thread.get("id") or thread["thread"]["id"]
        cli_env = dict(clean, REMOTE_CODEX_CLI_CONFIG=str(root / "db.cli.json"), REMOTE_CODEX_THREAD_ID=thread_id)
        assert cli("thread", "self")["threadId"] == thread_id
        for argv in [("automation", "--help"), ("hooks", "create", "--help"), ("command", "run", "--help")]:
            help_result = subprocess.run([binary, *argv], env=clean, text=True, capture_output=True, check=True)
            assert "Usage:" in help_result.stdout
        print("PASS CLI help and protected-file connection / thread self")
        hourly = {"name": "CLI hourly", "trigger": {"kind": "interval", "everySeconds": 3600}, "action": {"kind": "prompt", "text": "hello"}}
        definition_file = root / "hourly.json"
        definition_file.write_text(json.dumps(hourly))
        a = cli("hooks", "create", "--file", str(definition_file), "--request-id", "hourly")
        assert create(hourly, "hourly")["id"] == a["id"]
        assert cli("automation", "pause", a["id"])["state"] == "paused"
        assert cli("automation", "resume", a["id"])["state"] == "enabled"
        assert cli("automation", "cancel", a["id"])["state"] == "cancelled"
        print("PASS CLI JSON/file create, lost ACK retry, pause/resume/cancel")
        at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        a = create({"name": "CLI wake", "trigger": {"kind": "at", "at": at}, "action": {"kind": "prompt", "text": "hello"}}, "wake")
        r = until(lambda: next((r for r in runs(a) if r["state"] == "completed"), None))
        assert r["turnId"] and r["deliveryReceipt"]["delivery"] == "queued"
        print("PASS CLI at prompt acceptance binds and completes a real fake-harness turn")
        hook = create({"name": "CLI command hook", "trigger": {"kind": "commandEnded", "sourceThreadId": thread_id, "commandKey": "build"}, "condition": {"kind": "all", "conditions": [{"kind": "exitCodeEquals", "value": 0}, {"kind": "not", "condition": {"kind": "statusIn", "values": ["failed"]}}]}, "action": {"kind": "runScript", "shell": "printf x >> effect; test -z \"$REMOTE_CODEX_TOKEN$REMOTE_CODEX_URL$REMOTE_CODEX_CLI_CONFIG\"", "cwd": ".", "timeoutSeconds": 3}}, "build-hook")
        command_args = ("command", "run", "--command-key", "build", "--request-id", "build", "--cwd", ".", "--", "/bin/sh", "-c", "printf controlled")
        command = cli(*command_args)
        assert command["exitCode"] == 0 and command["stdout"] == "controlled"
        assert cli(*command_args)["id"] == command["id"]
        until(lambda: next((r for r in runs(hook) if r["state"] == "completed"), None))
        assert (root / "effect").read_text() == "x"
        failed = cli("command", "run", "--command-key", "build", "--cwd", ".", "--shell", "exit 7", expected=7)
        assert failed["state"] == "failed"
        until(lambda: len(runs(hook)) == 2)
        assert sum(r["state"] == "conditionSkipped" for r in runs(hook)) == 1
        assert (root / "effect").read_text() == "x"
        print("PASS real command wrapper exit/output, typed script hook once, failure skip, no inherited credentials")
        task = cli("task", "add", "fixture task")
        number = task.get("number") or task["task"]["number"]
        notice = create({"name": "CLI task notice", "trigger": {"kind": "taskEnded", "rootThreadId": thread_id, "taskNumber": number}, "condition": {"kind": "statusIn", "values": ["completed"]}, "action": {"kind": "notifyInbox", "subject": "Task notice", "text": "ready"}}, "task-notice")
        cli("task", "done", str(number), "--result", "done")
        until(lambda: runs(notice))
        messages = cli("inbox", "list", "--kind", "result")["messages"]
        assert any(m["subject"] == "Task notice" for m in messages)
        detail = api(f"/api/threads/{thread_id}")
        assert detail["thread"]["status"] == "idle" and not detail["pendingSteers"]
        print("PASS task terminal reminder is passive inbox, never queued")
        interval = create({"name": "Restart merge", "trigger": {"kind": "interval", "everySeconds": 1}, "action": {"kind": "notifyInbox", "subject": "Tick", "text": "tick"}}, "restart")
        until(lambda: runs(interval))
        stop()
        time.sleep(2.6)
        start()
        merged = until(lambda: next((r for r in runs(interval) if r["missedCount"] >= 1), None))
        assert merged["state"] == "completed"
        cli("automation", "pause", interval["id"])
        print("PASS real Supervisor restart advances interval and coalesces missed ticks")
        crash_args = [binary, "command", "run", "--request-id", "crash", "--cwd", ".", "--timeout-seconds", "30", "--shell", "printf x >> crash-effect; echo $$ > childpid; sleep 30"]
        cli_process = subprocess.Popen(crash_args, env=cli_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        until(lambda: (root / "childpid").exists())
        script_pid = int((root / "childpid").read_text().strip())
        stop(crash=True)
        cli_process.communicate(timeout=5)
        start()
        uncertain = cli(*crash_args[1:], expected=1)
        assert uncertain["state"] == "uncertain" and (root / "crash-effect").read_text() == "x"
        with sqlite3.connect(root / "db.sqlite") as db:
            assert db.execute("SELECT count(*) FROM command_executions WHERE request_id='crash'").fetchone()[0] == 1
        assert not api(f"/api/threads/{thread_id}")["pendingSteers"]
        print("PASS real spawn → Supervisor SIGKILL → restart is uncertain; retry does not repeat effects")
        print("PASS unified hooks isolated CLI/HTTP integration")
    finally:
        stop()
        if cli_process is not None and cli_process.poll() is None:
            cli_process.kill()
            cli_process.wait()
        if script_pid is not None:
            try:
                os.killpg(script_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()
        if args.keep:
            temp._finalizer.detach()
            print(f"Fixture retained: {root}")
        else:
            temp.cleanup()


if __name__ == "__main__":
    main()
