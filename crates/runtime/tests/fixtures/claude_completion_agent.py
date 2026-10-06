"""Reproduce Claude ACP's stale streamed-tool failure without executing tools."""
import json
import os
from pathlib import Path
import sys
import time
import uuid
from datetime import datetime, timezone

session = str(uuid.uuid4())
path = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects" / "fixture" / (session + ".jsonl")
path.parent.mkdir(parents=True, exist_ok=True)
path.touch()

def send(value):
    print(json.dumps({"jsonrpc": "2.0", **value}), flush=True)

def record(role, message):
    with path.open("a") as stream:
        stream.write(json.dumps({"type": role, "uuid": str(uuid.uuid4()),
            "sessionId": session, "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": message}) + "\n")

def update(value):
    send({"method": "session/update", "params": {"sessionId": session, "update": value}})

for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if "id" not in request:
        continue
    request_id = request["id"]
    if method == "initialize":
        send({"id": request_id, "result": {"protocolVersion": 1, "agentCapabilities": {}}})
    elif method == "session/new":
        send({"id": request_id, "result": {"sessionId": session}})
    elif method == "session/prompt":
        scenario = request["params"]["prompt"][0]["text"]
        record("user", {"content": "initial prompt"})
        if scenario == "background":
            record("assistant", {"content": [{"type": "tool_use", "id": "toolu_background", "name": "Agent",
                "input": {"description": "Independent review", "run_in_background": True}}]})
            update({"sessionUpdate": "tool_call", "toolCallId": "toolu_background", "name": "Agent",
                "kind": "think", "title": "Independent review", "status": "in_progress"})
            with path.open("a") as stream:
                stream.write(json.dumps({"type": "user", "sessionId": session,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "toolUseResult": {"isAsync": True, "status": "async_launched", "agentId": "background-agent"},
                    "message": {"content": [{"type": "tool_result", "tool_use_id": "toolu_background"}]}}) + "\n")
            update({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_background", "status": "completed"})
            record("assistant", {"stop_reason": "end_turn", "content": [{"type": "text", "text": "Main reply done"}]})
            update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Main reply done"}})
            deadline = time.monotonic() + 15
            while not path.with_suffix(".release").exists():
                if time.monotonic() > deadline:
                    raise RuntimeError("Test did not release background task")
                time.sleep(0.02)
            with path.open("a") as stream:
                stream.write(json.dumps({"type": "user", "sessionId": session,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "origin": {"kind": "task-notification", "producer": "session-task"},
                    "message": {"content": "<task-notification><task-id>background-agent</task-id><tool-use-id>toolu_background</tool-use-id><status>completed</status></task-notification>"}}) + "\n")
            record("assistant", {"stop_reason": "end_turn", "content": [{"type": "text", "text": "Review processed"}]})
            update({"sessionUpdate": "agent_message_chunk", "messageId": "follow-up", "content": {"type": "text", "text": "Review processed"}})
            send({"id": request_id, "result": {"stopReason": "end_turn"}})
            continue
        update({"sessionUpdate": "tool_call", "toolCallId": "toolu_orphan", "kind": "execute",
            "rawInput": {"command": "never-execute-this"}, "status": "pending"})
        if scenario == "real":
            record("assistant", {"content": [{"type": "tool_use", "id": "toolu_orphan", "name": "Bash"}]})
        if scenario != "missing":
            record("user", {"content": "steering prompt"})
            record("assistant", {"stop_reason": "end_turn", "content": [{"type": "text", "text": "done"}]})
        update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "done"}})
        update({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_orphan", "status": "failed"})
        send({"id": request_id, "error": {"code": -32603, "data": {"errorKind": "incomplete_tool_call"},
            "message": "Internal error: Claude ended the turn without returning results for tool calls: toolu_orphan"}})
    else:
        send({"id": request_id, "result": {}})
