"""Chat verification: a second agent (usually Claude or Gemini) audits a conversation when something looks wrong.

chat_transcript hands the auditor the full record of the chat it is in: every reply with its tool calls, arguments,
results, errors, stopped or failed turns and models. That's what history_messages leaves out. The bundled
`verify-chat` skill is the audit procedure, and the Verify button under each reply (MessageView) sends `/verify-chat`
to the chosen agent for one turn.
"""
import json
import time

import db
import skills
from tools import TOOLS, ToolResult, _fn

SKILL = "verify-chat"
SKILL_DESCRIPTION = ("Audit this chat when something may have gone wrong: a failed or stopped turn, a tool error, a wrong "
                     "or made-up answer, a claim that a file was saved or a search was run when it wasn't. Use when the "
                     "user says /verify-chat or asks you to check, verify, review or debug the conversation.")
SKILL_BODY = """# Verify a chat

You are auditing a conversation that other Shell:B agents (often small local models) had with the user. Be the careful
second pair of eyes: find what is wrong, prove it from the record, and say how to fix it.

## 1. Get the record
Call `chat_transcript` first. It lists every message, numbered `#1`, `#2` and so on. For each reply it shows the agent,
the model, the turn status, and every tool call with its arguments, status and result. If the user pointed at a reply
("check reply #7"), focus there but still read what led to it. Call `chat_transcript` with `message=<n>` to see a
message's tool results in full when an excerpt is not enough.

## 2. Check it
Work through these, most important first:
- **Failures:** turns with status `error` or `stopped`, tool calls with status `error`, errors in tool results (a
  traceback, a non-zero exit code, "not found", a timeout). Name the cause if the record shows it.
- **Claims against evidence:** every "I searched / saved / ran / generated / verified" must match a tool call that
  succeeded. Every fact taken from a tool must match that tool's result. Flag anything invented, misread or
  overstated, and quote the record.
- **Correctness:** check the maths, code, logic, units, dates and facts yourself. Re-run code with `run_code` or
  re-check a fact with `web_search` / `web_fetch` when you have those tools and it matters.
- **Coverage:** parts of the user's request that were skipped, misunderstood or quietly dropped.
- **Loops and waste:** the same tool call repeated with no progress, or an agent stuck or going in circles.

Don't nitpick style. When everything checks out, say so plainly: a clean bill of health is a valid result.

## 3. Report
Use this shape:

**Verdict:** ✅ Looks right / ⚠️ Problems found / ❌ Broken. Then one sentence on why.

**Findings:** ordered by severity. Give each one the message number, what is wrong, and the evidence (quote the tool
result or the claim).

**Fix:** what to do next. Give the corrected answer when you can produce it yourself. If an agent should retry,
write the prompt to send. If the problem is in Shell:B itself (a broken tool, a bad setting, a model that can't
handle tool calls), say which one and what to change. Don't claim you fixed anything you didn't.
"""

TOTAL_BUDGET = 60_000  # characters of transcript per call; older messages are summarized first


def _clip(s, n):
    s = str(s or "")
    return s if len(s) <= n else s[:n] + f" …[{len(s) - n:,} more chars]"


def _when(ms):
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(float(ms) / 1000))
    except (TypeError, ValueError):
        return ""


def _tool_line(b, result_chars):
    args = json.dumps(b.get("args", {}), ensure_ascii=False)
    dur = f", {b['durationMs'] / 1000:.1f}s" if b.get("durationMs") else ""
    out = [f"- TOOL `{b.get('name', '?')}` [{b.get('status', '?')}{dur}] args: {_clip(args, 600)}"]
    if b.get("approval"):
        out.append("  (needed the owner's approval)")
    if b.get("result"):
        out.append("  result: " + _clip(b["result"], result_chars).replace("\n", "\n  "))
    for k in b.get("children") or []:
        out.append(f"  - sub-agent tool `{k.get('name')}` [{k.get('status')}] {_clip(json.dumps(k.get('args', {}), ensure_ascii=False), 200)}")
    return "\n".join(out)


def _render(i, m, agents, result_chars, text_chars):
    head = f"### #{i} {m['role']}"
    if m["role"] == "assistant":
        a = agents.get(m.get("agentId"), {})
        head += f" · {a.get('name', m.get('agentId', '?'))} · model {m.get('model', '?')} · status {m.get('status', '?')}"
        if m.get("durationMs"):
            head += f" · {m['durationMs'] / 1000:.0f}s"
    head += f" · {_when(m.get('timestamp'))}"
    if m.get("mode") == "plan":
        head += " · plan mode"
    lines = [head]
    if m["role"] == "user":
        lines.append(_clip(m.get("content", ""), text_chars))
        for att in m.get("attachments") or []:
            lines.append(f"[attachment: {att.get('name')} ({att.get('kind', 'file')})]")
        return "\n".join(lines)
    if m.get("error"):
        lines.append(f"TURN ERROR: {m['error']}")
    blocks = m.get("blocks") or []
    if not blocks and m.get("content"):
        lines.append(_clip(m["content"], text_chars))
    for b in blocks:
        t = b.get("type")
        if t == "text" and b.get("text", "").strip():
            lines.append(_clip(b["text"], text_chars))
        elif t == "tool":
            lines.append(_tool_line(b, result_chars))
        elif t == "thinking":
            lines.append(f"[thinking: {len(b.get('text', '')):,} chars, not shown]")
    return "\n".join(lines)


async def chat_transcript(args, ctx):
    msgs = [m for m in db.list_messages(ctx.conv_id) if m["id"] != ctx.message_id]
    if msgs and msgs[-1]["role"] == "user":  # the request that started this audit
        msgs = msgs[:-1]
    if not msgs:
        return ToolResult("This chat has no earlier messages to verify.")
    from roster import get_agents
    agents = {a["id"]: a for a in get_agents()}
    one = args.get("message")
    if one not in (None, "", 0):
        try:
            i = int(one)
            m = msgs[i - 1]
        except (ValueError, IndexError):
            return ToolResult(f"No message #{one}; the chat has #1–#{len(msgs)}.", error=True)
        return ToolResult(_render(i, m, agents, 12_000, 40_000))
    last = int(args.get("last") or 0)
    start = max(0, len(msgs) - last) if last > 0 else 0
    rendered = [_render(i + 1, m, agents, 1_500, 6_000) for i, m in enumerate(msgs) if i >= start]
    # over budget: the oldest messages shrink to their headline first, so the recent ones keep their detail
    j = 0
    while sum(len(r) for r in rendered) > TOTAL_BUDGET and j < len(rendered) - 1:
        rendered[j] = rendered[j].split("\n", 1)[0] + " …[details omitted: call with message=<n>]"
        j += 1
    conv = db.get_conversation(ctx.conv_id) or {}
    head = (f"Chat \"{conv.get('title', '')}\": {len(msgs)} messages"
            + (f", showing #{start + 1}–#{len(msgs)}" if start else "") + ". Tool results are excerpts.\n\n")
    return ToolResult(head + "\n\n".join(rendered))


def init():
    """Ship the verify-chat skill; a copy the owner has edited is left alone."""
    if not (skills.SKILLS / SKILL / "SKILL.md").exists():
        skills.save(skills.compose(SKILL, SKILL_DESCRIPTION, SKILL_BODY), SKILL, source="builtin")


def register():
    TOOLS["chat_transcript"] = {
        "fn": chat_transcript, "service": None,
        "ui": {"displayName": "Chat Transcript", "icon": "ListChecks", "category": "memory",
               "description": "Reads this chat's full record (tool calls, results, errors) so an agent can verify it."},
        "schema": _fn("chat_transcript", "The full record of the chat you are in: every message numbered #1…#n, with each "
                      "reply's agent, model, status, errors and tool calls (arguments, status, result excerpts). Use it "
                      "to verify or debug the conversation.",
                      {"last": {"type": "integer", "description": "Only the last N messages (default: all)"},
                       "message": {"type": "integer", "description": "One message number, shown in full detail"}}, []),
    }
