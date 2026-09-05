#!/usr/bin/env python3
"""Minimal ACP stdio agent for runtime turn-streaming tests."""

import json
import os
import sys
import time


fast_enabled = False
steering_prompt_id = None
reasoning_effort = "medium"
question_turn = None
form_capability = False


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
    global fast_enabled, steering_prompt_id, reasoning_effort, question_turn, form_capability
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}
    if req_id == 900 and "result" in msg:
        sid, prompt_id = question_turn
        send({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":sid,"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ANSWERS=" + json.dumps(msg["result"], sort_keys=True)}}}})
        send({"jsonrpc":"2.0","id":prompt_id,"result":{"stopReason":"end_turn"}})
        question_turn = None
        return
    if method == "initialize":
        form_capability = "form" in params.get("clientCapabilities", {}).get("elicitation", {})
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
        send(
            {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "sessionId": "fake-session",
                    "configOptions": config_options(),
                },
            }
        )
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
        if text in ["ask-native-questions", "ask-acp-questions"]:
            assert form_capability, "client must advertise form elicitation"
            question_turn = (sid, req_id)
            questions = [{"id":"choice","header":"Choice","question":"Choose one","isOther":True,"isSecret":False,"options":[{"label":"A","description":"first"},{"label":"B","description":"second"}]}, {"id":"detail","header":"Detail","question":"Explain","isOther":True,"isSecret":False,"options":None}]
            native = text == "ask-native-questions"
            request = {"threadId":sid,"itemId":"ask-tool","questions":questions} if native else {"sessionId":sid,"toolCallId":"ask-tool","mode":"form","message":"Input requested","requestedSchema":{"type":"object","properties":{"choice":{"type":"string","title":"Choice","description":"Choose one","oneOf":[{"const":"A"},{"const":"B"}],"_meta":{"codex":{"isOther":True}}},"detail":{"type":"string","title":"Detail","description":"Explain"},"choice_other":{"type":"string","_meta":{"codex":{"isOtherAnswer":True,"questionId":"choice"}}}},"required":["detail"]}}
            send({"jsonrpc":"2.0","id":900,"method":"item/tool/requestUserInput" if native else "elicitation/create","params":request})
            return
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
        if "cancelled-response" in text:
            send({"jsonrpc": "2.0", "id": req_id, "result": {"stopReason": "cancelled"}})
            return
        if text == "interleaved-order":
            updates = [
                {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "Before tools."},
                },
                {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "interleaved-call-1",
                    "title": "first command",
                    "kind": "execute",
                    "status": "completed",
                },
                {
                    "sessionUpdate": "agent_thought_chunk",
                    "content": {"type": "text", "text": "Checking the result."},
                },
                {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "interleaved-call-2",
                    "title": "second command",
                    "kind": "execute",
                    "status": "completed",
                },
                {
                    "sessionUpdate": "agent_message_chunk",
                    "content": {"type": "text", "text": "After tools."},
                },
            ]
            for update in updates:
                send(
                    {
                        "jsonrpc": "2.0",
                        "method": "session/update",
                        "params": {"sessionId": sid, "update": update},
                    }
                )
            send({"jsonrpc": "2.0", "id": req_id, "result": {"stopReason": "end_turn"}})
            return
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
        default_delay_ms = "1500" if text in {"hello", "slow-cancel"} else "20"
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
