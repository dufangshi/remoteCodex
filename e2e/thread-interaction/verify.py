#!/usr/bin/env python3
"""Verify artifacts and persisted causal ordering from the real Docker scenarios.
No credentials or full transcripts are printed. Run after the agents have settled.
"""
import argparse
import json
from pathlib import Path
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument("--state-dir", type=Path, required=True)
parser.add_argument("--main-id", required=True)
parser.add_argument("--manual-id", required=True)
args = parser.parse_args()
state = args.state_dir.resolve()
workspace = state / "workspaces/compile-demo"
db = sqlite3.connect(f"file:{state / 'supervisor.sqlite'}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
main, manual = args.main_id, args.manual_id
auto = json.loads((workspace / "auto-peer.json").read_text())["threadId"]


def turns(thread):
    rows = db.execute("SELECT * FROM thread_turns WHERE thread_id=? ORDER BY ordinal", (thread,)).fetchall()
    return [dict(row) for row in rows]


def input_text(turn):
    return turn["display_prompt"] or ""


def thread(thread_id):
    row = db.execute("SELECT * FROM threads WHERE id=?", (thread_id,)).fetchone()
    assert row is not None, f"thread missing: {thread_id}"
    assert row["status"] == "idle", f"thread not settled: {thread_id} {row['status']}"
    return row


assert thread(main)["model"] == "gpt-6-astra"
for peer in (manual, auto):
    row = thread(peer)
    assert (row["provider"], row["agent_id"], row["model"], row["reasoning_effort"]) == ("acp", "grok", "grok-4.6", "xhigh")
assert len({main, manual, auto}) == 3
main_turns, auto_turns, manual_turns = turns(main), turns(auto), turns(manual)
assert all(t["status"] == "completed" for t in main_turns + auto_turns + manual_turns)

# Creation must appear in the main agent's actual recorded tool activity.
activity = "\n".join(r[0] for r in db.execute("SELECT item_json FROM thread_history_items WHERE thread_id=?", (main,)))
assert "remote-codex thread create" in activity and "Grok auto compiler" in activity
notify = [t for t in main_turns if input_text(t).startswith("[remoteCodex turn notification]") and auto_turns[0]["id"] in input_text(t)]
assert len(notify) == 1, "initial automatic completion notification must be unique"
assert notify[0]["started_at"] >= auto_turns[0]["completed_at"]
assert main_turns[0]["completed_at"] <= auto_turns[0]["completed_at"], "main should return before peer completion"
assert "AUTO_NOTIFY_FOLLOWUP_OK" in (workspace / "auto-followup.txt").read_text()
assert (workspace / "auto-build.txt").read_text().strip() == "thread-compile-ok"

manual_replies = [t for t in main_turns if input_text(t).startswith(f"[Message from remoteCodex thread {manual}]") and "MANUAL_COMPILE_REPLY_OK" in input_text(t)]
assert len(manual_replies) == 1
assert not any(input_text(t).startswith("[remoteCodex turn notification]") and f"Thread {manual}," in input_text(t) for t in main_turns)
assert "MANUAL_REPLY_FOLLOWUP_OK" in (workspace / "manual-followup.txt").read_text()
assert (workspace / "manual-build.txt").read_text().strip() == "thread-compile-ok"

first = next(t for t in manual_turns if "QUEUE_ONE_OK" in input_text(t))
second = next(t for t in manual_turns if "QUEUE_TWO_OK" in input_text(t))
second_receipt = json.loads((workspace / "queue-send-two.json").read_text())
busy = json.loads((workspace / "queue-state-before-second.json").read_text())
assert busy["status"] == "running" and busy["activeTurnId"] == first["id"]
assert first["started_at"] <= second_receipt["acceptedAt"] < first["completed_at"]
assert second["started_at"] >= first["completed_at"]
assert (workspace / "queue-one.txt").read_text().strip() == "QUEUE_ONE_OK"
assert (workspace / "queue-two.txt").read_text().strip() == "QUEUE_TWO_OK"
assert "QUEUED_MESSAGES_FOLLOWUP_OK" in (workspace / "queue-followup.txt").read_text()
assert db.execute("SELECT count(*) FROM kv WHERE key GLOB 'cli:notify:*'").fetchone()[0] == 0
assert db.execute("SELECT count(*) FROM thread_pending_steers").fetchone()[0] == 0

if (workspace / "final-version-followup.txt").exists():
    assert "FINAL_VERSION_NOTIFY_OK" in (workspace / "final-version-followup.txt").read_text()
    assert "FINAL_VERSION_PEER_OK" in (workspace / "final-version-peer.txt").read_text()
    final_notify = [t for t in main_turns if input_text(t).startswith("[remoteCodex turn notification]") and auto_turns[-1]["id"] in input_text(t)]
    assert len(final_notify) == 1
    assert final_notify[0]["started_at"] >= auto_turns[-1]["completed_at"]

print(json.dumps({"result": "passed", "mainThreadId": main, "autoPeerId": auto, "manualPeerId": manual,
                  "checks": ["main-created-peer", "automatic-turn-notification", "manual-peer-reply", "multiple-messages-while-busy", "ordered-continuations", "main-followup-artifacts"],
                  "turnCounts": {main: len(main_turns), auto: len(auto_turns), manual: len(manual_turns)}}, indent=2))
