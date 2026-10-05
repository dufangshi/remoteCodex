"""Reproduce Claude ACP's stale streamed-tool failure without executing tools."""
import json
import os
from pathlib import Path
import sys
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
