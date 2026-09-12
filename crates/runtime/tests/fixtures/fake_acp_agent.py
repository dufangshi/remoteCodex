#!/usr/bin/env python3
"""Minimal ACP stdio agent for runtime turn-streaming tests."""

import json
import os
import sys
import time
import threading


# Model the private native control connection used by Codex-backed ACP sessions.
if os.environ.get("REMOTE_CODEX_APP_SERVER_BRIDGE"):
    def bridge_loop():
        import socket
        config = json.loads(os.environ["REMOTE_CODEX_APP_SERVER_BRIDGE"])
        host, port = config["address"].rsplit(":", 1)
        sock = socket.create_connection((host, int(port)))
        stream = sock.makefile("rw")
        stream.write(config["token"] + "\n")
        stream.flush()
        for line in stream:
            request = json.loads(line)
            if request.get("method") == "thread/settings/update":
                with open("native-policy.json", "w") as f:
                    json.dump(request["params"], f)
            stream.write(json.dumps({"id": request["id"], "result": {}}) + "\n")
            stream.flush()
    threading.Thread(target=bridge_loop, daemon=True).start()

fast_enabled = False
steering_prompt_id = None
reasoning_effort = "medium"
write_lock = threading.Lock()


def config_options():
    if "--no-fast" in sys.argv:
        return []
    return [
        {"id": "reasoning_effort", "category": "thought_level", "type": "select",
         "currentValue": reasoning_effort, "options": [{"value": v, "name": v} for v in ["medium", "high"]]},
        {
            "id": "fast-mode",
            "type": "boolean",
            "currentValue": fast_enabled,
        }
    ]


def send(obj):
    with write_lock:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def prompt_text(params):
    blocks = params.get("prompt") or []
    return "".join(
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    )


def handle(msg):
    global fast_enabled, steering_prompt_id, reasoning_effort
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}
    if method == "initialize":
        send(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": 1,
                    "agentCapabilities": {"promptCapabilities": {}, "loadSession": True},
                    "agentInfo": {"name": "fake-acp"},
                    "_meta": {"steering": {"supported": True}},
                },
            }
        )
        return
    if method in ("session/new", "session/load"):
        result = {"sessionId": "fake-session", "configOptions": config_options()}
        send({"jsonrpc":"2.0", "method":"session/update", "params":{"sessionId":"fake-session", "update":{"sessionUpdate":"available_commands_update", "availableCommands":[{"name":"status", "description":"Session status"}]}}})
        send(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": result,
            }
        )
        return
    if method == "session/prompt" and prompt_text(params) in {"wait-for-cancel-ack", "wait-for-fast-cancel-ack", "wait-for-stalled-cancel"}:
        cancel_delay = {"wait-for-cancel-ack": 2.4, "wait-for-fast-cancel-ack": 0.05, "wait-for-stalled-cancel": None}[prompt_text(params)]
        cancellable_prompt = req_id
        send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"fake-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"waiting for cancellation"}}}})
        return
    if method == "session/set_config_option":
        if params.get("configId") == "reasoning_effort" and params.get("value") in ("medium", "high"):
            reasoning_effort = params["value"]
            send({"jsonrpc": "2.0", "id": req_id, "result": {"configOptions": config_options()}})
            return
        if params.get("configId") == "fast-mode" and "--no-fast" not in sys.argv:
            fast_enabled = params.get("value") is True
            send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"configOptions": config_options()},
                }
            )
        else:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": "unsupported config"},
                }
            )
        return
    if method == "_session/steering":
        # Match codex-acp: this extension is a request and prompt is ContentBlock[].
        if req_id is None:
            return
        if not isinstance(params.get("prompt"), list):
            send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32602, "message": "prompt must be blocks"}})
            return
        text = prompt_text(params)
        if text == "reject-steer":
            send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32602, "message": "steer rejected"}})
            return
        if text == "fail-steer":
            send({"jsonrpc": "2.0", "id": req_id, "result": {"outcome": "failed"}})
            return
        if text == "unknown-steer":
            send({"jsonrpc": "2.0", "id": req_id, "result": {}})
            return
        send({"jsonrpc": "2.0", "method": "session/update", "params": {
            "sessionId": "fake-session", "update": {"sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": "handled steer: " + text}}}})
        send({"jsonrpc": "2.0", "id": req_id, "result": {"outcome": "injected"}})
        send({"jsonrpc": "2.0", "id": steering_prompt_id, "result": {"stopReason": "end_turn"}})
        steering_prompt_id = None
        return
    if method == "session/prompt":
        sid = params.get("sessionId") or "fake-session"
        text = prompt_text(params)
        if text == "report-effort":
            text = "effort=" + reasoning_effort
        if text == "wait-for-steer":
            steering_prompt_id = req_id
            send({"jsonrpc": "2.0", "method": "session/update", "params": {
                "sessionId": sid, "update": {"sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "waiting"}}}})
            return
        if "rpc-error" in text:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32001, "message": "forced prompt failure"},
                }
            )
            return
        if "exit-before-response" in text:
            sys.exit(17)
        response_text = text if text.startswith("effort=") else ("fast=true" if text == "check-fast" and fast_enabled else "done")
        send(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "agent_thought_chunk",
                        "content": {"type": "text", "text": "working"},
                    },
                },
            }
        )
        send(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "call-1",
                        "title": "ls",
                        "kind": "execute",
                        "status": "in_progress",
                        "rawInput": {"command": "ls"},
                    },
                },
            }
        )
        default_delay_ms = "3500" if text == "slow-queued" else "1500" if text in {"hello", "slow-cancel"} else "20"
        time.sleep(int(os.environ.get("FAKE_ACP_PROMPT_DELAY_MS", default_delay_ms)) / 1000.0)
        send(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": "call-1",
                        "status": "completed",
                    },
                },
            }
        )
        send(
            {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": response_text},
                    },
                },
            }
        )
        send({"jsonrpc": "2.0", "id": req_id, "result": {"stopReason": "end_turn"}})
        return
    if req_id is not None:
        send(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        )


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        handle(json.loads(line))


if __name__ == "__main__":
    main()
