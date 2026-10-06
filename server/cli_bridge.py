#!/usr/bin/env python3
"""Stdio MCP server that hands a CLI agent (Claude Code, Antigravity, Codex) Shell:B's tools for one turn.

The CLI spawns this with SHELLB_BRIDGE set to `http://127.0.0.1:8200/api/cli-bridge/<turn token>`. Tool listing
and every call are forwarded there, so the running turn in shellb-web executes them with its own approvals,
Stop button and chat cards. Standard library only: any python3 can run it.
"""
import json
import os
import sys
import urllib.request

BASE = os.environ.get("SHELLB_BRIDGE", "").rstrip("/")


def _http(path, body=None, timeout=3600):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _reply(mid, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": mid}
    if error:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(req):
    method, params = req.get("method"), req.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion", "2025-06-18"), "capabilities": {"tools": {}},
                "serverInfo": {"name": "shellb", "version": "1.0"},
                "instructions": "Shell:B's tools. They run on Shell:B's machine, inside the user's workspace."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": _http("/tools", timeout=60)["tools"]}
    if method == "tools/call":
        try:
            return _http("/call", {"name": params.get("name", ""), "arguments": params.get("arguments") or {}})
        except Exception as e:  # the turn ended or shellb-web is gone: tell the model instead of hanging up
            return {"content": [{"type": "text", "text": f"Shell:B could not run the tool: {e}"}], "isError": True}
    raise LookupError(method)


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "id" not in req:  # notifications (initialized, cancelled) need no answer
            continue
        try:
            _reply(req["id"], handle(req))
        except LookupError as e:
            _reply(req["id"], error={"code": -32601, "message": f"Method not found: {e}"})
        except Exception as e:
            _reply(req["id"], error={"code": -32603, "message": str(e)})


if __name__ == "__main__":
    main()
