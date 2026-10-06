"""Mega Plans: big jobs broken into steps that different agents carry out one after another, with an orchestrator
agent checking each step before the next one starts. Shown at #/plans/<id>.

A plan has a goal, an ordered list of steps (each with a brief, acceptance criteria and the agent that should do it),
an orchestrator agent and, usually, a Code workspace that every step works in, so step 4 sees the files steps 1-3 made.
The driver below runs plans on its own:

    pending ──worker turn──▶ review ──orchestrator──▶ done        (accept: a handoff summary later steps see)
       ▲                                        └──▶ revising ──▶ worker turn again, with the feedback
       └────────────────────────────────────────└──▶ failed      (or out of attempts: the plan pauses for the user)

Each step runs in its own chat, so the user can open it and see exactly what the worker did. The orchestrator works
in one chat of its own: it plans there, reviews every step there (with the step's report and git diff in front of
it, and the project's tools to inspect files and run tests), and writes the final report there. Like scheduled
tasks, only one agent turn runs at a time: this is one GPU box.
"""
import asyncio
import json
import re
import time

from fastapi import APIRouter, HTTPException, Request

import db
from tools import TOOLS, ToolResult, _fn

router = APIRouter()
PLAN_STATUSES = ("planning", "draft", "running", "paused", "complete", "failed")
STEP_STATUSES = ("pending", "running", "review", "revising", "done", "failed", "skipped")
FINISHED = ("done", "skipped")
MAX_STEPS = 60
DEFAULT_ATTEMPTS = 3
DIFF_LIMIT = 14_000
CHECK_OUTPUT = 5_000          # characters of check output kept (the tail, where test summaries are)
ERROR_RETRIES = (30, 120)     # seconds to wait before retrying a turn that errored (model crash, out of memory…)

# How hard each kind of turn works. "thorough" trades time for quality: deep reasoning everywhere, a large tool
# budget so workers iterate until it's right, and reviews that start from a clean slate so a long plan's history
# never crowds the evidence out of the context window. Nudges ("you didn't call the tool") keep the history.
QUALITY = {
    "thorough": {"work": {"effort": "high", "maxToolRounds": 48},
                 "review": {"effort": "high", "maxToolRounds": 28, "freshContext": True},
                 "plan": {"effort": "high", "maxToolRounds": 28},
                 "phase": {"effort": "high", "maxToolRounds": 28, "freshContext": True},
                 "final": {"effort": "high", "maxToolRounds": 28, "freshContext": True}},
    "standard": {"work": {}, "review": {"freshContext": True}, "plan": {}, "phase": {"freshContext": True},
                 "final": {"freshContext": True}},
}


def _profile(p, kind) -> dict:
    return dict(QUALITY.get(p["options"].get("quality") or "thorough", QUALITY["thorough"])[kind])

# set by app.py
# run_turn(conv_id, content, note) -> final assistant message dict (awaits the whole turn)
run_turn = None
# abort(conv_id) -> bool: stop the turn running in that chat, if any
abort_turn = None
# find_agent(agent_id) -> (agent, agents); get_settings() -> settings
find_agent = None
get_settings = None

_wake_event: asyncio.Event | None = None
_running: dict | None = None     # {"plan": id, "step": id | None, "conv": id, "phase": "work" | "review" | "plan" | "final"}
_TASKS: set = set()


def init():
    with db.conn() as c:
        c.executescript("""
CREATE TABLE IF NOT EXISTS mega_plans(
  id TEXT PRIMARY KEY, title TEXT, goal TEXT, status TEXT, note TEXT DEFAULT '', orchestrator TEXT, project_id TEXT,
  orch_conv TEXT, summary TEXT DEFAULT '', options TEXT DEFAULT '{}', created_by TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS mega_steps(
  id TEXT PRIMARY KEY, plan_id TEXT, ord REAL, phase TEXT, title TEXT, brief TEXT, criteria TEXT, agent_id TEXT,
  status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, conv_id TEXT, report TEXT DEFAULT '', feedback TEXT DEFAULT '',
  handoff TEXT DEFAULT '', checkpoint INTEGER DEFAULT 0, base_sha TEXT, started REAL, finished REAL, created REAL, updated REAL);
CREATE INDEX IF NOT EXISTS mega_steps_plan ON mega_steps(plan_id, ord);
CREATE TABLE IF NOT EXISTS mega_events(id TEXT PRIMARY KEY, plan_id TEXT, step_id TEXT, kind TEXT, text TEXT, at REAL);
CREATE INDEX IF NOT EXISTS mega_events_plan ON mega_events(plan_id, at);
CREATE TABLE IF NOT EXISTS mega_links(conv_id TEXT PRIMARY KEY, plan_id TEXT, role TEXT, step_id TEXT);
""")
        cols = {r["name"] for r in c.execute("PRAGMA table_info(mega_steps)")}
        for col in ("check_cmd", "check_result"):
            if col not in cols:
                c.execute(f"ALTER TABLE mega_steps ADD COLUMN {col} TEXT DEFAULT ''")



def _recover():
    """Turns in flight when the server stopped never finished: put their steps back and pause the plans. Runs only in
    the server process, at startup (not on import: other tools and sessions import the app to test it, and that must
    not touch plans the live server is running)."""
    with db.conn() as c:
        now = time.time()
        c.execute("UPDATE mega_steps SET status=CASE WHEN attempts>1 THEN 'revising' ELSE 'pending' END, updated=? "
                  "WHERE status='running'", (now,))
        for r in c.execute("SELECT id FROM mega_plans WHERE status IN ('running','planning')").fetchall():
            c.execute("UPDATE mega_plans SET status=CASE status WHEN 'planning' THEN 'draft' ELSE 'paused' END, "
                      "note=CASE status WHEN 'planning' THEN 'The server restarted while the steps were being planned. "
                      "Plan again, or add steps yourself.' ELSE 'The server restarted while this plan was running. "
                      "Resume to carry on.' END, updated=? WHERE id=?", (now, r["id"]))


# ── storage ─────────────────────────────────────────────────────────────────

def _plan(r, counts=None):
    p = {"id": r["id"], "title": r["title"], "goal": r["goal"] or "", "status": r["status"], "note": r["note"] or "",
         "orchestrator": r["orchestrator"], "projectId": r["project_id"], "orchConv": r["orch_conv"],
         "summary": r["summary"] or "", "options": json.loads(r["options"] or "{}"), "createdBy": r["created_by"] or "",
         "createdAt": r["created"] * 1000, "updatedAt": r["updated"] * 1000}
    if counts is not None:
        p["counts"] = counts
    return p


def _step(r, n=None):
    s = {"id": r["id"], "n": n, "phase": r["phase"] or "", "title": r["title"], "brief": r["brief"] or "",
         "criteria": r["criteria"] or "", "agentId": r["agent_id"], "status": r["status"], "attempts": r["attempts"],
         "convId": r["conv_id"], "report": r["report"] or "", "feedback": r["feedback"] or "", "handoff": r["handoff"] or "",
         "checkpoint": bool(r["checkpoint"]), "check": r["check_cmd"] or "",
         "checkResult": json.loads(r["check_result"]) if r["check_result"] else None,
         "startedAt": r["started"] and r["started"] * 1000,
         "finishedAt": r["finished"] and r["finished"] * 1000, "updatedAt": r["updated"] * 1000}
    return s


def _counts(c, pid):
    counts = {k: 0 for k in STEP_STATUSES}
    for r in c.execute("SELECT status, COUNT(*) n FROM mega_steps WHERE plan_id=? GROUP BY status", (pid,)):
        counts[r["status"]] = r["n"]
    counts["total"] = sum(counts[k] for k in STEP_STATUSES)
    return counts


def get(pid) -> dict | None:
    with db.conn() as c:
        r = c.execute("SELECT * FROM mega_plans WHERE id=?", (pid,)).fetchone()
        return _plan(r, _counts(c, pid)) if r else None


def list_plans():
    with db.conn() as c:
        rows = c.execute("SELECT * FROM mega_plans ORDER BY updated DESC").fetchall()
        out = []
        for r in rows:
            p = _plan(r, _counts(c, r["id"]))
            cur = c.execute("SELECT title, status FROM mega_steps WHERE plan_id=? AND status NOT IN ('done','skipped') "
                            "ORDER BY ord LIMIT 1", (r["id"],)).fetchone()
            p["current"] = {"title": cur["title"], "status": cur["status"]} if cur else None
            out.append(p)
    return out


def steps(pid) -> list[dict]:
    with db.conn() as c:
        rows = c.execute("SELECT * FROM mega_steps WHERE plan_id=? ORDER BY ord", (pid,)).fetchall()
    return [_step(r, i) for i, r in enumerate(rows, 1)]


def get_step(sid) -> dict | None:
    with db.conn() as c:
        r = c.execute("SELECT * FROM mega_steps WHERE id=?", (sid,)).fetchone()
    if not r:
        return None
    n = next((s["n"] for s in steps(r["plan_id"]) if s["id"] == sid), None)
    return {**_step(r, n), "planId": r["plan_id"]}


def events(pid, limit=200):
    with db.conn() as c:
        rows = c.execute("SELECT * FROM mega_events WHERE plan_id=? ORDER BY at DESC LIMIT ?", (pid, limit)).fetchall()
    return [{"id": r["id"], "stepId": r["step_id"], "kind": r["kind"], "text": r["text"], "at": r["at"] * 1000} for r in rows]


def detail(pid):
    p = get(pid)
    if not p:
        return None
    p["steps"] = steps(pid)
    p["events"] = events(pid)
    p["live"] = dict(_running) if _running and _running["plan"] == pid else None
    if p["projectId"]:
        proj = db.get_project(p["projectId"])
        p["project"] = {"id": proj["id"], "name": proj["name"], "kind": proj["kind"]} if proj else None
    return p


def log(pid, text, kind="info", step_id=None):
    with db.conn() as c:
        c.execute("INSERT INTO mega_events VALUES(?,?,?,?,?,?)", (db.new_id("mev"), pid, step_id, kind, text[:2000], time.time()))
        c.execute("UPDATE mega_plans SET updated=? WHERE id=?", (time.time(), pid))


def update_plan(pid, **fields):
    cols = {"title": "title", "goal": "goal", "status": "status", "note": "note", "orchestrator": "orchestrator",
            "summary": "summary", "orch_conv": "orch_conv", "project_id": "project_id"}
    if fields.get("status") not in (None, *PLAN_STATUSES):
        raise ValueError(f"status must be one of {', '.join(PLAN_STATUSES)}")
    if "options" in fields:
        fields["options"] = json.dumps({**get(pid)["options"], **(fields["options"] or {})})
        cols["options"] = "options"
    sets = [(cols[k], v) for k, v in fields.items() if k in cols and v is not None]
    before = (get(pid) or {}).get("status") if fields.get("status") else None
    with db.conn() as c:
        if sets:
            c.execute(f"UPDATE mega_plans SET {', '.join(k + '=?' for k, _ in sets)}, updated=? WHERE id=?",
                      (*[v for _, v in sets], time.time(), pid))
    p = get(pid)
    if p and before and before != p["status"]:
        _announce(p, before)
    return p


def _announce(p, before):
    """Tell the Activity inbox about the transitions that happen while nobody is watching."""
    import activity
    st, link = p["status"], f"#/plans/{p['id']}"
    if st == "complete":
        activity.post("plan", "done", f"Mega Plan complete: {p['title']}", activity.excerpt(p["summary"]), link)
    elif st == "failed":
        activity.post("plan", "failed", f"Mega Plan failed: {p['title']}", p["note"], link)
    elif before == "planning" and st == "draft":
        n = p["counts"]["total"]
        activity.post("plan", "review" if n else "failed", f"Mega Plan {'drafted' if n else 'planning failed'}: {p['title']}",
                      f"{n} steps are ready for you to review and start." if n else p["note"], link)


def _step_fields(d: dict, agents_ok) -> dict:
    """Clean step fields from an agent or the UI. Accepts a few spellings models like to use."""
    out = {}
    if "title" in d or "name" in d:
        out["title"] = str(d.get("title") or d.get("name") or "").strip()[:160]
    for key, names in (("brief", ("brief", "description", "instructions", "task")),
                       ("criteria", ("criteria", "acceptance", "acceptance_criteria", "done_when")),
                       ("phase", ("phase", "stage", "milestone"))):
        for n in names:
            if n in d and d[n] is not None:
                v = d[n]
                out[key] = ("\n".join(f"- {x}" for x in v) if isinstance(v, list) else str(v)).strip()[:8000 if key != "phase" else 60]
                break
    agent = d.get("agent") or d.get("agent_id") or d.get("agentId")
    if agent:
        agent = str(agent).strip().lower()
        if not agents_ok(agent):
            raise ValueError(f"no agent named {agent!r}")
        out["agent_id"] = agent
    if "checkpoint" in d:
        out["checkpoint"] = 1 if d["checkpoint"] in (True, 1, "true", "yes") else 0
    for n in ("check", "check_command", "verify", "test_command"):
        if n in d and d[n] is not None:
            out["check_cmd"] = str(d[n]).strip()[:2000]
            break
    return out


def _agent_exists(aid):
    _, agents = find_agent(aid)
    return any(a["id"] == aid for a in agents)


def add_steps(pid, items: list[dict], after: str | None = None, default_agent="hephaestus") -> list[dict]:
    existing = steps(pid)
    if len(existing) + len(items) > MAX_STEPS:
        raise ValueError(f"a plan holds at most {MAX_STEPS} steps")
    cleaned = []
    for n, it in enumerate(items, 1):
        if not isinstance(it, dict):
            raise ValueError(f"step #{n} is not an object")
        f = _step_fields(it, _agent_exists)
        if not f.get("title"):
            raise ValueError(f"step #{n} needs a title")
        cleaned.append(f)
    # place them after `after` (an id or a step number), or at the end
    ords = [s_["id"] for s_ in existing]
    with db.conn() as c:
        all_ord = {r["id"]: r["ord"] for r in c.execute("SELECT id, ord FROM mega_steps WHERE plan_id=?", (pid,))}
    anchor = _resolve(existing, after) if after else None
    if anchor:
        i = ords.index(anchor["id"])
        lo = all_ord[anchor["id"]]
        hi = all_ord[ords[i + 1]] if i + 1 < len(ords) else lo + len(cleaned) + 1
    else:
        lo = max(all_ord.values(), default=0)
        hi = lo + len(cleaned) + 1
    gap = (hi - lo) / (len(cleaned) + 1)
    now = time.time()
    made = []
    with db.conn() as c:
        for k, f in enumerate(cleaned, 1):
            sid = db.new_id("ms")
            c.execute("INSERT INTO mega_steps(id, plan_id, ord, phase, title, brief, criteria, agent_id, status, attempts, "
                      "checkpoint, check_cmd, created, updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (sid, pid, lo + gap * k, f.get("phase", ""), f["title"], f.get("brief", ""), f.get("criteria", ""),
                       f.get("agent_id") or default_agent, "pending", 0, f.get("checkpoint", 0), f.get("check_cmd", ""),
                       now, now))
            made.append(sid)
        c.execute("UPDATE mega_plans SET updated=? WHERE id=?", (now, pid))
    return [s_ for s_ in steps(pid) if s_["id"] in made]


def _resolve(all_steps, key) -> dict | None:
    """A step by id or by its number in the plan ("3", 3, "#3", "step 3")."""
    if key is None:
        return None
    k = str(key).strip()
    m = re.fullmatch(r"(?:step\s*)?#?(\d+)", k, re.I)
    if m:
        n = int(m.group(1))
        return next((s_ for s_ in all_steps if s_["n"] == n), None)
    return next((s_ for s_ in all_steps if s_["id"] == k), None)


def update_step(pid, key, patch: dict, by_user=False) -> dict:
    s = _resolve(steps(pid), key)
    if not s:
        raise KeyError(key)
    f = _step_fields(patch, _agent_exists)
    if not by_user and s["status"] in ("running",) and set(f) - {"checkpoint"}:
        raise ValueError(f"step {s['n']} is running right now; change it after it finishes")
    if "status" in patch and by_user:
        st = patch["status"]
        if st not in STEP_STATUSES or st in ("running", "review"):
            raise ValueError("status can be set to pending, done, failed or skipped")
        f["status"] = st
        if st == "pending":
            f |= {"attempts": 0, "feedback": ""}
    if "handoff" in patch:
        f["handoff"] = str(patch["handoff"] or "")[:4000]
    if not f:
        return s
    with db.conn() as c:
        c.execute(f"UPDATE mega_steps SET {', '.join(k + '=?' for k in f)}, updated=? WHERE id=?",
                  (*f.values(), time.time(), s["id"]))
    return get_step(s["id"])


def move_step(pid, key, direction: int):
    all_steps = steps(pid)
    s = _resolve(all_steps, key)
    if not s:
        raise KeyError(key)
    i = s["n"] - 1
    j = i + direction
    if not 0 <= j < len(all_steps):
        return
    other = all_steps[j]
    with db.conn() as c:
        a = c.execute("SELECT ord FROM mega_steps WHERE id=?", (s["id"],)).fetchone()["ord"]
        b = c.execute("SELECT ord FROM mega_steps WHERE id=?", (other["id"],)).fetchone()["ord"]
        c.execute("UPDATE mega_steps SET ord=? WHERE id=?", (b, s["id"]))
        c.execute("UPDATE mega_steps SET ord=? WHERE id=?", (a, other["id"]))


def delete_step(pid, key):
    s = _resolve(steps(pid), key)
    if not s:
        raise KeyError(key)
    if s["status"] == "running":
        raise ValueError("that step is running; pause the plan first")
    with db.conn() as c:
        c.execute("DELETE FROM mega_steps WHERE id=?", (s["id"],))
    return s


def create_plan(title, goal, orchestrator="shellb", project_id=None, created_by="user", options=None):
    title = (title or "").strip() or (goal or "").strip().split("\n")[0][:80] or "Untitled plan"
    now = time.time()
    pid = db.new_id("mp")
    opts = {"maxAttempts": DEFAULT_ATTEMPTS, "autoRun": False, "quality": "thorough", "phaseReviews": True,
            "check": "", **(options or {})}
    with db.conn() as c:
        c.execute("INSERT INTO mega_plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (pid, title[:160], (goal or "").strip(), "draft", "", orchestrator, project_id, None, "", json.dumps(opts),
                   created_by, now, now))
    log(pid, f"Plan created by {'you' if created_by == 'user' else created_by.removeprefix('agent:')}.", "create")
    return get(pid)


def delete_plan(pid):
    _stop_live(pid)
    with db.conn() as c:
        for t in ("mega_steps", "mega_events", "mega_links"):
            c.execute(f"DELETE FROM {t} WHERE plan_id=?", (pid,))
        c.execute("DELETE FROM mega_plans WHERE id=?", (pid,))


def link(conv_id, pid, role, step_id=None):
    with db.conn() as c:
        c.execute("INSERT OR REPLACE INTO mega_links VALUES(?,?,?,?)", (conv_id, pid, role, step_id))


def link_of(conv_id) -> dict | None:
    with db.conn() as c:
        r = c.execute("SELECT * FROM mega_links WHERE conv_id=?", (conv_id,)).fetchone()
    return {"planId": r["plan_id"], "role": r["role"], "stepId": r["step_id"]} if r else None


def plan_brief(conv_id):
    """For the chat header: which plan this chat belongs to."""
    lk = link_of(conv_id)
    p = get(lk["planId"]) if lk else None
    return {"id": p["id"], "title": p["title"], "role": lk["role"], "status": p["status"]} if p else None


# ── workspace helpers ───────────────────────────────────────────────────────

def _git(pid_project, *args) -> str:
    import projects
    try:
        return projects.git(pid_project, *args)
    except Exception:
        return ""


def _head(project_id) -> str | None:
    if not project_id:
        return None
    return _git(project_id, "rev-parse", "HEAD").strip() or None


def _changes(project_id, base) -> str:
    """What the step changed in the workspace, for the reviewer: stat plus a trimmed diff."""
    if not project_id or not base:
        return ""
    stat = _git(project_id, "diff", "--stat", base, "HEAD").strip()
    if not stat:
        return "(no files changed)"
    diff = _git(project_id, "diff", base, "HEAD")
    if len(diff) > DIFF_LIMIT:
        diff = diff[:DIFF_LIMIT] + f"\n…[diff truncated; {len(diff):,} chars total — read the files to see the rest]"
    return f"{stat}\n\n```diff\n{diff}\n```"


def ensure_workspace(p) -> str | None:
    """Plans with workspace mode 'new' get a Code workspace the first time they need one."""
    if p["projectId"] or p["options"].get("workspace") == "none":
        return p["projectId"]
    import projects
    proj = db.create_project(p["title"][:80], "code", "README.md", p["goal"][:400])
    projects.create_project_files(proj["id"], p["title"][:80], p["goal"], "code")
    update_plan(p["id"], project_id=proj["id"])
    log(p["id"], f"Created the Code workspace \"{proj['name']}\" for this plan; every step works in it.", "workspace")
    return proj["id"]


def _orch_conv(p) -> str:
    if p["orchConv"] and db.get_conversation(p["orchConv"]):
        link(p["orchConv"], p["id"], "orchestrator")  # keep the link, whatever happened to it in the chat
        return p["orchConv"]
    conv = db.create_conversation(p["orchestrator"], title=f"{p['title']} · Orchestrator", project_id=p["projectId"])
    update_plan(p["id"], orch_conv=conv["id"])
    link(conv["id"], p["id"], "orchestrator")
    return conv["id"]


# ── prompts ─────────────────────────────────────────────────────────────────

def _agent_name(aid):
    a, _ = find_agent(aid)
    return a["name"] if a["id"] == aid else aid


def outline(p, all_steps, mark=None, full=False) -> str:
    lines = []
    phase = None
    for s in all_steps:
        if s["phase"] and s["phase"] != phase:
            phase = s["phase"]
            lines.append(f"Phase: {phase}")
        here = "  ← this step" if s["id"] == mark else ""
        lines.append(f"{s['n']}. [{s['status']}] {s['title']} — {_agent_name(s['agentId'])} (id {s['id']}){here}")
        if full:
            if s["brief"]:
                lines.append("   Brief: " + s["brief"].replace("\n", "\n   ")[:1500])
            if s["criteria"]:
                lines.append("   Done when: " + s["criteria"].replace("\n", "\n   ")[:800])
            if s["check"]:
                lines.append(f"   Check: `{s['check']}`")
        if s["handoff"] and s["status"] in FINISHED:
            lines.append("   Handoff: " + s["handoff"].replace("\n", " ")[:600])
        elif s["feedback"] and s["status"] in ("revising", "failed"):
            lines.append("   Last review: " + s["feedback"].replace("\n", " ")[:400])
    return "\n".join(lines) or "(no steps yet)"


def roster(exclude=()):
    import providers
    settings = get_settings()
    _, agents = find_agent("shellb")
    return "; ".join(f"`{a['id']}` ({a['title']}: {a.get('description', '')[:90]})" for a in agents
                     if a["id"] not in exclude and providers.available(a["model"], settings)[0])


WORKER_NOTE = """## Mega Plan step
You are carrying out one step of the Mega Plan "{title}". This turn was started by the plan's orchestrator, not by a
person typing: nobody is watching live, so don't ask questions or wait for confirmation. Make reasonable assumptions,
do the whole step, and verify it.

Overall goal of the plan:
{goal}

The plan (steps marked done have finished; their handoff notes say what they produced):
{outline}

Rules:
- Do this step only. Build on what earlier steps produced{ws}; don't redo or undo their work unless this step says to.
- Meet every acceptance criterion and check each one yourself (run it, test it, read it back). Never claim something
  works unless a tool call this turn showed it.
- Take the time to do it well: quality matters far more than speed here. Read the relevant existing work first,
  make the change, then test it properly, including edge cases, and fix what you find before you report.{checks}
- When you finish, end your reply with a handoff report under the heading "## Handoff":
  what you did, the files or artifacts you produced (with paths), how you verified each criterion, and anything left
  open or that a later step must know. The orchestrator reviews the step from this report and the actual changes."""

REVIEW_NOTE = """## Orchestrating the Mega Plan "{title}"
You are this plan's orchestrator. The steps are carried out by worker agents in their own chats; your job is to check
every step's work against its brief and acceptance criteria before the plan moves on, and to keep the plan sound.
Nobody is watching live: don't ask the user anything, decide.
- Inspect the real work, not just the report: read the changed files{tools}. A report that claims more than the
  changes show is a reason to ask for a revision.
- Use it the way its user would: run the program or call the API yourself, including with bad input, edge cases and
  the unhappy paths the tests might not cover. Unclear error messages, crashes, tracebacks shown to users and
  confusing output are defects too.
- Then call mega_plan action=review exactly once for the step, with verdict:
  accept (the criteria are met; give `summary`, a 2-5 sentence handoff that later steps will rely on: what exists now
  and where), revise (something is missing or wrong; give `feedback`: specific, actionable fixes, which go to the
  worker), or fail (the step can't be done as briefed; explain why in `feedback`).
- Do not do the step's work yourself, and don't fix what you find: never edit files during a review. Describe
  the fix in `feedback` and let the worker make it, so the work and its handoff stay with the step. If the plan itself needs to change (a missing step, a wrong order, a step that's no
  longer needed), use add_steps / update_step / remove_step, then still give your verdict.
- Hold a high bar: accept only work you'd be glad to build the rest of the plan on. Missing edge cases, untested
  claims, sloppy structure or a criterion met only on paper are reasons to revise. The plan's automated checks
  (results below, when the plan has any) already passed, so judge what they can't: correctness, completeness, design.
- Keep your reply short: the verdict and why."""

PLAN_NOTE = """## Planning the Mega Plan "{title}"
You are the orchestrator of a Mega Plan: a large job that worker agents will carry out step by step, one at a time,
each in its own chat, with you reviewing every step before the next starts. Right now your only job is to write the
plan. Do NOT start doing the work. The plan already exists (id {pid}) and is attached to this chat: add its
steps with mega_plan action=add_steps, never action=create.

Goal:
{goal}

How to plan:
- Understand the goal first. If there is existing material{explore}, look at it. Research only what you need to plan well.
- Break the goal into sequential steps with mega_plan action=add_steps ({size}). The workers are capable but local
  models: they do excellent work on a focused, well-specified step and get sloppy on sprawling ones, so prefer more,
  smaller steps (one module, one feature, one document section) over a few huge ones. Time is not a constraint;
  quality is. Later steps build on earlier ones; order matters: steps run strictly in order.
- Make verification automatic wherever you can. For software, the first step should set up the project skeleton and a
  test runner. Give each step a `check`: one shell command, run from the workspace root in an offline sandbox, that
  exits 0 only when the step's work is right (e.g. `pytest -q tests/test_parser.py`, `npm test`, `python -m mypy src`).
  The plan runs checks itself after every attempt and sends failures straight back to the worker. Also set a plan-wide
  regression check with mega_plan action=set_check (e.g. `pytest -q`) so later steps can't silently break earlier
  ones. Steps whose output can't be checked by a command (prose, design) just get clear criteria.
- For each step give: title; brief (complete, self-contained instructions: the worker sees the goal and the plan
  outline, but nothing of this chat); criteria (concrete, checkable acceptance criteria: what must exist or pass);
  agent (who does it); phase (short label grouping steps, e.g. "Foundation", "Features", "Polish": at the end of
  each phase you review how its steps fit together, so group steps into phases of 3-8); check (see above).
  Set checkpoint=true on steps the user should approve before the plan moves on (risky or taste-dependent ones).
- Agents available for steps: {roster}.
- Usually end with an integration/verification step that checks the whole result against the goal.
- When the plan is written, reply with a short overview of it. The user reviews it on the plan board and starts it."""

PHASE_NOTE = """## Phase review in the Mega Plan "{title}"
Phase "{phase}" just finished. Nobody is watching live. Before the next phase starts, step back and check that the
phase's steps add up: do the parts fit together, does it all actually run, does it still serve the goal, and is the
plan ahead still right given what was built? Inspect the work{tools}.
Then act:
- If something is broken or missing, add fix-up steps right after this phase with mega_plan action=add_steps and
  after="{last}" (each with a brief, criteria and a check), so they run next.
- If the steps ahead need changing because of what you learned, use update_step / remove_step / add_steps.
- If all is well, change nothing.
Reply with a short assessment: what the phase delivered, what you changed in the plan and why."""

FINAL_NOTE = """## Wrapping up the Mega Plan "{title}"
Every step of this plan has finished. Nobody is watching live. Check the overall result against the goal (look at the
actual work{tools}), then call mega_plan action=finish with `summary`: a Markdown report for the user covering what
was built, where it is, how it was verified, deviations from the plan, and anything left to do. Reply briefly."""


def _ws_hint(p):
    return (" in the shared workspace (the repository you are in; read what's there before changing it). File tools take "
            "paths relative to the repository root (convert.py, src/app.py); /work is only where run_code mounts that same "
            "root, so never create a work/ folder"
            if p["projectId"] else "")


def _checks_hint(p, s):
    cmds = [c for c in (s.get("check"), p["options"].get("check")) if c]
    if not cmds or not p["projectId"]:
        return ""
    return ("\n- When you finish, the plan itself runs these checks from the workspace root, in an offline sandbox: "
            + ", ".join(f"`{c}`" for c in dict.fromkeys(cmds)) + ". The step only goes to review when they pass, so run them "
            "yourself (run_code, language bash) before you report.")


def _tool_hint(p):
    return (", run the tests or the program with run_code, and use search_files / project_diff as needed"
            if p["projectId"] else "and artifacts")


def worker_message(p, s, all_steps, was) -> str:
    if was == "revising" and s["feedback"]:
        return (f"The orchestrator reviewed your work on step {s['n']} (\"{s['title']}\") and asked for changes:\n\n"
                f"{s['feedback']}\n\nFix these, re-check every acceptance criterion, and end with an updated "
                "\"## Handoff\" report.")
    if s["convId"] and s["hadTurn"]:
        return (f"Work on step {s['n']} (\"{s['title']}\") again: the previous attempt was interrupted or reset. Check "
                "what is already done, finish the step as briefed above, and end with the \"## Handoff\" report.")
    body = f"# Step {s['n']} of {len(all_steps)}: {s['title']}\n\n{s['brief'] or '(no further brief: use the title and the plan)'}"
    if s["criteria"]:
        body += f"\n\n## Done when\n{s['criteria']}"
    return body


def review_message(p, s, all_steps) -> str:
    report = s["report"].strip() or "(the worker's reply was empty)"
    if len(report) > 12000:
        report = report[:12000] + "\n…[report truncated]"
    changes = _changes(p["projectId"], s.get("baseSha"))
    msg = (f"[Review] Step {s['n']} of {len(all_steps)}, \"{s['title']}\" (id {s['id']}), attempt {s['attempts']}, "
           f"done by {_agent_name(s['agentId'])}.\n\n### Brief\n{s['brief'] or '—'}\n\n### Acceptance criteria\n"
           f"{s['criteria'] or '(none given: judge against the brief)'}\n\n### Worker's report\n{report}")
    if s.get("checkResult"):
        msg += "\n\n### Automated checks (run by the plan after this attempt)\n" + _check_text(s["checkResult"])
    if changes:
        msg += f"\n\n### Changes in the workspace during this step\n{changes}"
    msg += (f"\n\nReview it now and call mega_plan action=review with step=\"{s['id']}\" and your verdict "
            f"(attempt {s['attempts']} of {p['options'].get('maxAttempts', DEFAULT_ATTEMPTS)}).")
    return msg


def context(conv_id) -> str:
    """The plan, compactly, for the system prompt of its orchestrator chat (and any chat that made it)."""
    lk = link_of(conv_id)
    if not lk or lk["role"] == "step":
        return ""
    p = get(lk["planId"])
    if not p:
        return ""
    all_steps = steps(p["id"])
    c = p["counts"]
    lines = [f"## Mega Plan attached to this chat: \"{p['title']}\" (id {p['id']}, {p['status']})",
             f"Goal: {p['goal'][:3000]}",
             f"Progress: {c['done'] + c['skipped']}/{c['total']} steps finished"
             + (f", {c['failed']} failed" if c["failed"] else "") + (f". Note: {p['note']}" if p["note"] else ""),
             "Steps:", outline(p, all_steps, full=p["status"] in ("planning", "draft") or len(all_steps) <= 12)]
    if p["summary"]:
        lines.append("Final report so far:\n" + p["summary"][:2000])
    return "\n".join(lines)


# ── the driver ──────────────────────────────────────────────────────────────

def _wake():
    if _wake_event:
        _wake_event.set()


def _set_step(sid, **f):
    if not f:
        return
    with db.conn() as c:
        c.execute(f"UPDATE mega_steps SET {', '.join(k + '=?' for k in f)}, updated=? WHERE id=?", (*f.values(), time.time(), sid))


def _base_sha(sid):
    with db.conn() as c:
        r = c.execute("SELECT base_sha FROM mega_steps WHERE id=?", (sid,)).fetchone()
    return r["base_sha"] if r else None


def _pause(pid, note, kind="pause", step_id=None):
    p = update_plan(pid, status="paused", note=note)
    log(pid, note, kind, step_id)
    if p:
        import activity
        activity.post("plan", "paused", f"Mega Plan paused: {p['title']}", note, f"#/plans/{pid}")


async def _turn(p, conv_id, content, note, step_id, phase, opts=None):
    """One agent turn for the plan. A turn that errors (the model crashed, ran out of memory, the server hiccuped) is
    retried after a pause, since a plan runs unattended for hours; only repeated errors stop it."""
    global _running
    final = None
    try:
        for wait in (*ERROR_RETRIES, None):
            # stays set through the retry wait too, so /api/status never shows the plan idle while it is mid-turn
            _running = {"plan": p["id"], "step": step_id, "conv": conv_id, "phase": phase, "since": time.time() * 1000}
            final = await run_turn(conv_id, content, note, opts or {})
            if final["status"] != "error" or wait is None or get(p["id"])["status"] not in ("running", "planning"):
                return final
            log(p["id"], f"A turn hit an error ({final.get('error', 'unknown')[:200]}); retrying in {wait}s.", "error", step_id)
            await asyncio.sleep(wait)
        return final
    finally:
        _running = None


def _check_text(res) -> str:
    out = []
    for r in res.get("runs", []):
        verdict = "passed" if r["ok"] else f"FAILED (exit {r['exit']})"
        out.append(f"$ {r['cmd']}   → {verdict}\n```\n{r['output'] or '(no output)'}\n```")
    return "\n".join(out)


async def _run_checks(p, s) -> dict | None:
    """Run the step's check and the plan's regression check in the workspace sandbox. None when there's nothing to run."""
    cmds = list(dict.fromkeys(c for c in (s.get("check"), p["options"].get("check")) if c))
    if not cmds or not p["projectId"]:
        return None
    from tools import ToolContext, run_code
    global _running

    async def nothing(_):
        pass

    _running = {"plan": p["id"], "step": s["id"], "conv": s.get("convId"), "phase": "check", "since": time.time() * 1000}
    runs = []
    try:
        for cmd in cmds:
            ctx = ToolContext(conv_id="", message_id="", agent={}, settings={}, emit=nothing, project_id=p["projectId"])
            res = await run_code({"language": "bash", "code": cmd}, ctx)
            code = res.display.get("exitCode")
            text = res.text if len(res.text) <= CHECK_OUTPUT else "…" + res.text[-CHECK_OUTPUT:]
            runs.append({"cmd": cmd, "exit": code, "ok": code == 0 and not res.error, "output": text.strip()})
    finally:
        _running = None
    return {"ok": all(r["ok"] for r in runs), "at": time.time() * 1000, "runs": runs}


async def _work(p, s, all_steps):
    """Run the step's worker turn; afterwards the step waits for review."""
    was = s["status"]
    attempts = s["attempts"] + 1
    conv_id = s["convId"]
    had_turn = bool(conv_id and db.get_conversation(conv_id))
    if not had_turn:
        conv = db.create_conversation(s["agentId"], title=f"{p['title']} · {s['n']}. {s['title']}"[:120], project_id=p["projectId"])
        conv_id = conv["id"]
        link(conv_id, p["id"], "step", s["id"])
    elif db.get_conversation(conv_id)["agentId"] != s["agentId"]:
        db.update_conversation(conv_id, agentId=s["agentId"])
    # a revision is reviewed against where the step started, so the reviewer sees the step's whole change
    base = (_base_sha(s["id"]) if was == "revising" else None) or _head(p["projectId"])
    _set_step(s["id"], status="running", attempts=attempts, conv_id=conv_id, base_sha=base, started=time.time(), finished=None)
    s = {**s, "attempts": attempts, "convId": conv_id, "hadTurn": had_turn}
    log(p["id"], f"Step {s['n']} \"{s['title']}\" started by {_agent_name(s['agentId'])}"
        + (f" (attempt {attempts})" if attempts > 1 else "") + ".", "start", s["id"])
    note = WORKER_NOTE.format(title=p["title"], goal=p["goal"], outline=outline(p, all_steps, mark=s["id"]), ws=_ws_hint(p),
                              checks=_checks_hint(p, s))
    final = await _turn(p, conv_id, worker_message(p, s, all_steps, was), note, s["id"], "work", _profile(p, "work"))
    if final["status"] == "stopped":
        _set_step(s["id"], status=was, attempts=attempts - 1)
        if get(p["id"])["status"] == "running":  # stopped from the step's chat, not by pausing the plan
            _pause(p["id"], f"Step {s['n']} was stopped. Resume the plan to run it again.", "pause", s["id"])
        return
    if final["status"] == "error":
        _set_step(s["id"], status="failed", report=final.get("error", ""), finished=time.time())
        _pause(p["id"], f"Step {s['n']} hit an error: {final.get('error', 'unknown')}. Fix the cause and retry the step.",
               "error", s["id"])
        return
    report = final.get("content", "")[:40000]
    checks = await _run_checks(p, s)
    if checks and not checks["ok"]:
        # objective failure: straight back to the worker with the output, no review turn spent on it
        failed = [r for r in checks["runs"] if not r["ok"]]
        fb = ("The plan's automated checks failed after your attempt:\n\n" + _check_text({"runs": failed}) +
              "\n\nFind the root cause and fix it (don't weaken or skip the checks), run them yourself until they pass, "
              "then give an updated \"## Handoff\".")
        max_attempts = int(p["options"].get("maxAttempts", DEFAULT_ATTEMPTS))
        if attempts >= max_attempts:
            _set_step(s["id"], status="failed", report=report, check_result=json.dumps(checks), feedback=fb[:4000],
                      finished=time.time())
            _pause(p["id"], f"Step {s['n']}'s checks still fail after {attempts} attempts "
                            f"(`{failed[0]['cmd']}`). Look at the step, then retry, edit or skip it.", "attention", s["id"])
        else:
            _set_step(s["id"], status="revising", report=report, check_result=json.dumps(checks), feedback=fb[:4000])
            log(p["id"], f"Step {s['n']}'s checks failed (`{failed[0]['cmd']}`); sent straight back to the worker.",
                "check", s["id"])
        return
    _set_step(s["id"], status="review", report=report, check_result=json.dumps(checks) if checks else "")
    log(p["id"], f"Step {s['n']} finished its work" + ("; checks passed" if checks else "")
        + "; the orchestrator is reviewing it.", "work", s["id"])


_VERDICT_WORDS = {"accept": "accept", "accepted": "accept", "revise": "revise", "revision": "revise",
                  "fail": "fail", "failed": "fail"}


def _guess_verdict(text: str) -> str | None:
    """A verdict stated in prose: "Verdict: accept", "**Accept.**", or a line that starts with the word."""
    t = text.lower()
    found = set()
    for m in re.finditer(r"verdict\W{0,4}(accept\w*|revis\w*|fail\w*)|\*\*\s*(accept\w*|revise|fail\w*)\b"
                         r"|^\W{0,4}(accept(?:ed)?|revise|fail(?:ed)?)\b", t, re.M):
        word = next(g for g in m.groups() if g)
        found.add(_VERDICT_WORDS.get(word, "revise" if word.startswith("revis") else word))
    return found.pop() if len(found) == 1 else None   # mixed signals: let a person decide


async def _review(p, s, all_steps):
    conv = _orch_conv(p)
    s = {**s, "baseSha": _base_sha(s["id"])}
    note = REVIEW_NOTE.format(title=p["title"], tools=_tool_hint(p))
    final = await _turn(p, conv, review_message(p, s, all_steps), note, s["id"], "review", _profile(p, "review"))
    if final["status"] == "stopped":
        if get(p["id"])["status"] == "running":
            _pause(p["id"], f"The review of step {s['n']} was stopped. Resume to review it again.", "pause", s["id"])
        return
    after = get_step(s["id"])
    if after and after["status"] == "review" and final["status"] == "complete":
        # replied without calling the tool: ask once, plainly, for the call itself
        final = await _turn(p, conv, f"You haven't recorded your verdict on step {s['n']} yet. Call mega_plan now with "
                                     f"action=review, step=\"{s['id']}\", verdict (accept / revise / fail) and summary "
                                     "(accept) or feedback (revise/fail). Don't redo the review.", note, s["id"], "review",
                            {k: v for k, v in _profile(p, "review").items() if k != "freshContext"})
        if final["status"] == "stopped":
            return
        after = get_step(s["id"])
    if after and after["status"] == "review":
        # still no tool call: take a clearly stated verdict, otherwise ask the user
        v = _guess_verdict(final.get("content", ""))
        if v:
            apply_review(p["id"], s["id"], v, final.get("content", "")[-2000:], final.get("content", "")[-1200:],
                         by=p["orchestrator"])
        else:
            _pause(p["id"], f"The orchestrator didn't give a verdict on step {s['n']}. Accept, retry or give feedback "
                            "on the board, then resume.", "attention", s["id"])


def apply_review(pid, step_key, verdict, feedback="", summary="", by="user") -> tuple[dict, str]:
    p = get(pid)
    s = _resolve(steps(pid), step_key)
    if not s:
        raise KeyError(step_key)
    verdict = (verdict or "").lower().strip()
    if by != "user" and s["status"] != "review":
        raise ValueError(f"step {s['n']} isn't waiting for review (it is {s['status']})")
    who = "you" if by == "user" else _agent_name(by)
    max_attempts = int(p["options"].get("maxAttempts", DEFAULT_ATTEMPTS))
    if verdict == "accept" and by != "user" and s.get("checkResult") and not s["checkResult"].get("ok"):
        raise ValueError(f"step {s['n']}'s automated checks failed; it can't be accepted. Use verdict=revise.")
    if verdict == "accept":
        _set_step(s["id"], status="done", handoff=(summary or "").strip()[:4000], feedback=(feedback or "").strip()[:4000],
                  finished=time.time())
        log(pid, f"Step {s['n']} accepted by {who}." + (f" {summary.strip()[:600]}" if summary else ""), "accept", s["id"])
        outcome = "accepted"
        if s["checkpoint"] and by != "user" and p["status"] == "running":
            _pause(pid, f"Checkpoint: step {s['n']} \"{s['title']}\" is done and waits for your approval. Look it over, "
                        "then resume the plan.", "checkpoint", s["id"])
            outcome += "; the plan now waits for the user's approval (checkpoint)"
    elif verdict == "revise":
        if not (feedback or "").strip():
            raise ValueError("revise needs feedback: the specific fixes the worker should make")
        if s["attempts"] >= max_attempts and by != "user":
            _set_step(s["id"], status="failed", feedback=feedback.strip()[:4000], finished=time.time())
            _pause(pid, f"Step {s['n']} still isn't right after {s['attempts']} attempts. Read the review, adjust the "
                        "step or retry it, then resume.", "attention", s["id"])
            outcome = f"out of attempts ({max_attempts}); the step is marked failed and the plan paused for the user"
        else:
            _set_step(s["id"], status="revising", feedback=feedback.strip()[:4000])
            log(pid, f"Step {s['n']} sent back for revision by {who}: {feedback.strip()[:600]}", "revise", s["id"])
            outcome = "sent back to the worker with your feedback"
    elif verdict == "fail":
        _set_step(s["id"], status="failed", feedback=(feedback or "").strip()[:4000], finished=time.time())
        if p["status"] == "running":
            _pause(pid, f"Step {s['n']} failed: {(feedback or '').strip()[:400]}", "fail", s["id"])
        else:
            log(pid, f"Step {s['n']} marked failed by {who}.", "fail", s["id"])
        outcome = "marked failed; the plan is paused for the user"
    else:
        raise ValueError("verdict must be accept, revise or fail")
    _wake()
    return get_step(s["id"]), outcome


async def _plan_turn(p):
    conv = _orch_conv(p)
    size = ("as many as the job needs, typically 8-40" if (p["options"].get("quality") or "thorough") == "thorough"
            else "typically 4-15")
    note = PLAN_NOTE.format(title=p["title"], pid=p["id"], goal=p["goal"], roster=roster(), size=size,
                            explore=" in the workspace (read its README and files)" if p["projectId"] else "")
    msg = (f"Write the Mega Plan for this goal:\n\n{p['goal']}" +
           (f"\n\nExtra guidance from the user:\n{p['options']['guidance']}" if p["options"].get("guidance") else ""))
    final = await _turn(p, conv, msg, note, None, "plan", _profile(p, "plan"))
    p = get(p["id"])
    n = p["counts"]["total"]
    if final["status"] != "complete" or not n:
        update_plan(p["id"], status="draft", note="" if n else "Planning ended without steps. Add them by hand or ask the "
                                                                "orchestrator again in its chat.")
        log(p["id"], f"Planning stopped ({final['status']}).", "attention")
        return
    if p["options"].get("autoRun"):
        update_plan(p["id"], status="running", note="")
        log(p["id"], f"Planned {n} steps; starting right away.", "plan")
    else:
        update_plan(p["id"], status="draft", note="")
        log(p["id"], f"Planned {n} steps. Review them, then start the plan.", "plan")


async def _final(p):
    conv = _orch_conv(p)
    reg = await _run_checks(p, {"id": None, "check": ""})
    extra = ("\n\nThe plan's regression check, just run:\n" + _check_text(reg)) if reg else ""
    final = await _turn(p, conv, f"All steps of \"{p['title']}\" are finished. Check the result against the goal and "
                                 "write the final report with mega_plan action=finish." + extra,
                        FINAL_NOTE.format(title=p["title"], tools=_tool_hint(p)), None, "final", _profile(p, "final"))
    p = get(p["id"])
    if p["status"] == "running" and final["status"] == "complete":  # replied without calling finish: ask once
        final = await _turn(p, conv, "You haven't saved the final report yet. Call mega_plan now with action=finish and "
                                     "summary: the full Markdown report (what was built, where, how it was verified, "
                                     "deviations from the plan, what's left).",
                            FINAL_NOTE.format(title=p["title"], tools=_tool_hint(p)), None, "final",
                            {k: v for k, v in _profile(p, "final").items() if k != "freshContext"})
        p = get(p["id"])
    if p["status"] == "running":  # finish still wasn't called; close it out with whatever was said
        if final["status"] == "stopped":
            return
        update_plan(p["id"], status="complete", note="", summary=p["summary"] or final.get("content", ""))
        log(p["id"], "Plan complete.", "complete")


async def _phase_review(p, phase, phase_steps):
    conv = _orch_conv(p)
    reg = await _run_checks(p, {"id": None, "check": ""})
    log(p["id"], f"Phase \"{phase}\" finished; {_agent_name(p['orchestrator'])} is reviewing how it fits together.",
        "phase")
    lines = [f"[Phase review] Phase \"{phase}\" is done ({len(phase_steps)} steps):"]
    for x in phase_steps:
        lines.append(f"- {x['n']}. {x['title']} ({x['status']})" + (f": {x['handoff'][:500]}" if x["handoff"] else ""))
    if reg:
        lines.append("\nThe plan's regression check, just run:\n" + _check_text(reg))
    before = p["counts"]["total"]
    final = await _turn(p, conv, "\n".join(lines), PHASE_NOTE.format(title=p["title"], phase=phase,
                        last=phase_steps[-1]["id"], tools=_tool_hint(p)), None, "phase", _profile(p, "phase"))
    if final["status"] == "stopped":
        return
    p = get(p["id"])
    update_plan(p["id"], options={"phasesReviewed": [*(p["options"].get("phasesReviewed") or []), phase]})
    added = p["counts"]["total"] - before
    text = (final.get("content") or "").strip()
    head = re.search(r"^(?:#{1,4} |\*\*)", text, re.M)   # skip "let me look…" preambles: log the assessment itself
    if head:
        text = text[head.start():]
    log(p["id"], f"Phase \"{phase}\" reviewed" + (f"; {added} fix-up/new step(s) added" if added > 0 else "")
        + (f": {text[:700]}" if text else "."), "phase")


async def _advance(p):
    all_steps = steps(p["id"])
    s = next((x for x in all_steps if x["status"] not in FINISHED), None)
    if s is None:
        if not all_steps:
            _pause(p["id"], "The plan has no steps.", "attention")
            return
        await _final(p)
        return
    i = all_steps.index(s)
    prev = all_steps[i - 1] if i else None
    done_phases = p["options"].get("phasesReviewed") or []
    if (prev and prev["phase"] and prev["phase"] != s["phase"] and prev["phase"] not in done_phases
            and p["options"].get("phaseReviews", True) and s["status"] == "pending"):
        await _phase_review(p, prev["phase"], [x for x in all_steps[:i] if x["phase"] == prev["phase"]])
        return
    if s["status"] in ("pending", "revising", "running"):
        await _work(p, s, all_steps)
    elif s["status"] == "review":
        await _review(p, s, all_steps)
    elif s["status"] == "failed":
        _pause(p["id"], f"Step {s['n']} failed. Retry, edit or skip it, then resume.", "attention", s["id"])


async def _driver():
    global _wake_event
    _wake_event = asyncio.Event()
    while True:
        _wake_event.clear()
        r = None
        try:
            with db.conn() as c:
                r = c.execute("SELECT id FROM mega_plans WHERE status IN ('planning','running') ORDER BY updated LIMIT 1").fetchone()
            if r:
                p = get(r["id"])
                if p["status"] == "planning":
                    await _plan_turn(p)
                else:
                    await _advance(p)
                continue
        except Exception as e:  # keep the driver alive; park the plan that broke
            print(f"[megaplan] {type(e).__name__}: {e}")
            if r:
                try:
                    _pause(r["id"], f"The orchestrator hit an internal error: {type(e).__name__}: {e}", "error")
                except Exception:
                    pass
        try:
            await asyncio.wait_for(_wake_event.wait(), 30)
        except asyncio.TimeoutError:
            pass


def start():
    _recover()
    t = asyncio.create_task(_driver())
    _TASKS.add(t)


def stop():
    for t in list(_TASKS):
        t.cancel()
    _TASKS.clear()


def running_now():
    return dict(_running) if _running else None


def _stop_live(pid):
    if _running and _running["plan"] == pid and abort_turn:
        abort_turn(_running["conv"])


# ── control (shared by the API and the tool) ───────────────────────────────

def run(pid, by="user"):
    p = get(pid)
    if p["status"] in ("running", "planning"):
        return p
    if not p["counts"]["total"]:
        raise ValueError("the plan has no steps yet: plan it first or add steps")
    ensure_workspace(p)
    # a step failed on the way: running again means trying it again
    with db.conn() as c:
        c.execute("UPDATE mega_steps SET status='revising', attempts=0 WHERE plan_id=? AND status='failed'", (pid,))
    if p["status"] == "complete":
        p = update_plan(pid, summary="")
    update_plan(pid, status="running", note="")
    log(pid, "Plan started." if p["status"] == "draft" else "Plan resumed.", "run")
    _wake()
    return get(pid)


def pause(pid, note="Paused by you."):
    p = get(pid)
    if p["status"] not in ("running", "planning"):
        return p
    update_plan(pid, status="paused" if p["status"] == "running" else "draft", note=note)
    log(pid, note, "pause")
    _stop_live(pid)
    return get(pid)


def start_planning(pid, guidance=""):
    p = get(pid)
    if p["status"] in ("running", "planning"):
        raise ValueError("the plan is busy")
    ensure_workspace(p)
    if guidance:
        update_plan(pid, options={"guidance": guidance})
    update_plan(pid, status="planning", note="")
    log(pid, f"{_agent_name(p['orchestrator'])} is planning the steps.", "plan")
    _wake()
    return get(pid)


# ── agent tool ──────────────────────────────────────────────────────────────

GUIDE = """- mega_plan runs large projects as a Mega Plan: a board of sequential steps, each carried out by a chosen agent in
  its own chat, with an orchestrator reviewing every step before the next one starts. Use it when the user asks for a
  mega plan, or for a big multi-part job (an application, a long report, a migration) that clearly needs many agent
  turns: `create` it with a title, the goal and the steps, then link it: [the plan](plan:<plan id>). Starting it
  (`run`) makes agents work on their own for a long time, so do that only when the user asked to run it."""


def _display(pid, **extra):
    p = get(pid)
    return {"plan": {"id": p["id"], "title": p["title"], "status": p["status"], "counts": p["counts"], **extra}}


def _items(args):
    items = args.get("steps") or args.get("items")
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except json.JSONDecodeError:
            raise ValueError("steps must be a JSON array of objects")
    if isinstance(items, dict):
        items = [items]
    return items or []


def render_text(p) -> str:
    all_steps = steps(p["id"])
    out = [f"# {p['title']} ({p['status']})", f"Goal: {p['goal']}", f"Orchestrator: {_agent_name(p['orchestrator'])}"]
    if p["note"]:
        out.append(f"Note: {p['note']}")
    out += ["", outline(p, all_steps, full=True)]
    if p["summary"]:
        out += ["", "## Final report", p["summary"]]
    return "\n".join(out)


async def mega_plan(args, ctx):
    action = str(args.get("action") or "view").lower().replace("-", "_")
    by = ctx.agent.get("id")
    lk = link_of(ctx.conv_id)
    pid = args.get("plan_id") or (lk and lk["planId"])

    if action == "list":
        ps = list_plans()
        return ToolResult("\n".join(f"- {x['id']} · {x['title']} · {x['status']} · {x['counts']['done']}/{x['counts']['total']} done"
                                    for x in ps) or "No mega plans yet.")
    if action == "create":
        if lk and lk["role"] == "step":
            return ToolResult("You are working on a step of a plan; you can't start a new plan from here.", error=True)
        if lk and lk["role"] == "orchestrator" and get(lk["planId"]) and not args.get("new"):
            # models planning in the orchestrator chat often reach for create; the plan already exists, so fill it
            try:
                made = add_steps(lk["planId"], _items(args))
            except ValueError as e:
                return ToolResult(f"This chat already orchestrates plan {lk['planId']}; add its steps with add_steps. {e}",
                                  error=True)
            return ToolResult(f"This chat already orchestrates the plan \"{get(lk['planId'])['title']}\" ({lk['planId']}), so the "
                              f"steps went into it instead of a new plan: added {len(made)} step(s). The plan now has "
                              f"{get(lk['planId'])['counts']['total']} steps.", _display(lk["planId"], added=len(made)))
        goal = str(args.get("goal") or "").strip()
        if not goal:
            return ToolResult("create needs `goal`: what the whole plan must achieve, in detail.", error=True)
        try:
            items = _items(args)
        except ValueError as e:
            return ToolResult(str(e), error=True)
        workspace = str(args.get("workspace") or "new")
        project_id = None
        if workspace not in ("new", "none"):
            if not db.get_project(workspace):
                return ToolResult(f"No Studio/Code project {workspace!r}; use 'new' or 'none'.", error=True)
            project_id = workspace
        orch = str(args.get("orchestrator") or by)
        if not _agent_exists(orch):
            return ToolResult(f"No agent named {orch!r}.", error=True)
        p = create_plan(args.get("title") or "", goal, orch, project_id, created_by=f"agent:{by}",
                        options={"workspace": workspace if workspace in ("new", "none") else "existing"})
        if not lk:
            link(ctx.conv_id, p["id"], "creator")
        note = ""
        if items:
            try:
                add_steps(p["id"], items)
            except ValueError as e:
                note = f" Some steps were rejected: {e}. Fix them with add_steps."
        return ToolResult(f"Created the Mega Plan \"{p['title']}\" ({p['id']}) with {get(p['id'])['counts']['total']} steps; "
                          f"it is a draft the user can review and edit on its board. Link it as [{p['title']}](plan:{p['id']})."
                          + note + " Call action=run only if the user asked to start it.", _display(p["id"], created=True))
    if action == "open":
        target = str(args.get("plan_id") or "")
        if not get(target):
            return ToolResult("No plan with that id; action=list shows them.", error=True)
        if not lk:
            link(ctx.conv_id, target, "creator")
        return ToolResult(render_text(get(target)), _display(target))

    if not pid or not get(pid):
        return ToolResult("No Mega Plan is attached to this chat. Use action=create, or action=open with plan_id.", error=True)
    p = get(pid)
    if lk and lk["role"] == "step" and action not in ("view",):
        return ToolResult("Step workers can only view the plan. Report problems in your handoff; the orchestrator decides.",
                          error=True)

    try:
        if action == "view":
            return ToolResult(render_text(p))
        if action == "add_steps":
            made = add_steps(pid, _items(args), after=args.get("after"))
            return ToolResult(f"Added {len(made)} step(s): " + ", ".join(f"{s['n']}. {s['title']} ({s['id']})" for s in made)
                              + f". The plan now has {get(pid)['counts']['total']} steps.", _display(pid, added=len(made)))
        if action == "update_step":
            s = update_step(pid, args.get("step"), {k: v for k, v in args.items() if k not in ("action", "step", "plan_id")})
            return ToolResult(f"Updated step {s['n']} ({s['title']}).", _display(pid))
        if action == "remove_step":
            s = _resolve(steps(pid), args.get("step"))
            if s and s["status"] in FINISHED + ("review",):
                return ToolResult("That step already ran; mark it skipped with update_step instead of removing it.", error=True)
            s = delete_step(pid, args.get("step"))
            log(pid, f"Step {s['n']} \"{s['title']}\" removed by {_agent_name(by)}.", "edit")
            return ToolResult(f"Removed step {s['n']} ({s['title']}).", _display(pid))
        if action == "review":
            s, outcome = apply_review(pid, args.get("step"), args.get("verdict"), str(args.get("feedback") or ""),
                                      str(args.get("summary") or ""), by=by)
            return ToolResult(f"Step {s['n']} {outcome}.", _display(pid, reviewed=s["n"]))
        if action == "set_check":
            cmd = str(args.get("check") or "").strip()[:2000]
            update_plan(pid, options={"check": cmd})
            log(pid, f"Plan-wide check set to `{cmd}` by {_agent_name(by)}." if cmd else "Plan-wide check removed.", "edit")
            return ToolResult((f"Plan-wide regression check set: `{cmd}`. It runs after every step and at every phase end."
                               if cmd else "Plan-wide check removed."), _display(pid))
        if action == "finish":
            summary = str(args.get("summary") or "").strip()
            if not summary:
                return ToolResult("finish needs `summary`: the final Markdown report.", error=True)
            open_steps = [s for s in steps(pid) if s["status"] not in FINISHED]
            if open_steps and p["status"] == "running":
                return ToolResult(f"Step {open_steps[0]['n']} hasn't finished yet; finish the plan after all steps are done.",
                                  error=True)
            update_plan(pid, summary=summary, status="complete" if not open_steps else p["status"], note="")
            log(pid, "Plan complete: final report written." if not open_steps else "Report updated.", "complete")
            return ToolResult("Final report saved on the plan board.", _display(pid, finished=True))
        if action == "run":
            run(pid, by=by)
            return ToolResult("The plan is running: steps now execute one after another on their own, and you review "
                              "each one in the orchestrator chat. The user watches progress on the board.", _display(pid))
        if action == "pause":
            pause(pid, f"Paused by {_agent_name(by)}.")
            return ToolResult("Paused.", _display(pid))
    except KeyError:
        return ToolResult("No step with that id or number in this plan.", error=True)
    except ValueError as e:
        return ToolResult(f"Couldn't do that: {e}", error=True)
    return ToolResult("action must be create, view, add_steps, update_step, remove_step, review, set_check, finish, run, "
                      "pause, list or open.",
                      error=True)


STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short imperative title"},
        "brief": {"type": "string", "description": "Complete, self-contained instructions for the worker"},
        "criteria": {"type": "string", "description": "Checkable acceptance criteria, one per line"},
        "agent": {"type": "string", "description": "Agent id that carries out the step"},
        "phase": {"type": "string", "description": "Optional short phase label grouping steps"},
        "checkpoint": {"type": "boolean", "description": "Pause for the user's approval after this step"},
        "check": {"type": "string", "description": "Shell command run from the workspace root that exits 0 only when "
                                                   "the step is right, e.g. 'pytest -q tests/test_x.py'"},
    },
    "required": ["title", "brief"],
}


def register():
    TOOLS["mega_plan"] = {
        "fn": mega_plan, "service": None,
        "ui": {"displayName": "Mega Plans", "icon": "ListChecks", "category": "automation",
               "description": "Breaks large projects into sequential steps run by different agents, with an orchestrator reviewing each step."},
        "schema": _fn("mega_plan",
                      "Run a large project as a Mega Plan: sequential steps, each done by a chosen agent in its own chat, with "
                      "an orchestrator reviewing every step against its acceptance criteria before the next one starts. "
                      "Actions: create (title, goal, steps, workspace) · view · add_steps (steps, after) · update_step (step + "
                      "changed fields) · remove_step (step) · review (step, verdict accept|revise|fail, feedback, summary) · "
                      "set_check (check: plan-wide regression command) · finish (summary) · run · pause · list · open (plan_id). "
                      "Steps are named by id or by number; give steps a `check` command whenever the work can be tested.",
                      {"action": {"type": "string", "enum": ["create", "view", "add_steps", "update_step", "remove_step", "review",
                                                             "set_check", "finish", "run", "pause", "list", "open"]},
                       "title": {"type": "string", "description": "create: plan title; update_step: new step title"},
                       "goal": {"type": "string", "description": "create: everything the plan must achieve, in detail"},
                       "steps": {"type": "array", "items": STEP_SCHEMA, "description": "create/add_steps: steps in order"},
                       "after": {"type": "string", "description": "add_steps: insert after this step (default: at the end)"},
                       "workspace": {"type": "string", "description": "create: 'new' (a fresh Code workspace, default), 'none', "
                                                                      "or an existing Studio/Code project id"},
                       "orchestrator": {"type": "string", "description": "create: agent id that reviews steps (default: you)"},
                       "step": {"type": "string", "description": "update_step/remove_step/review: step id or number"},
                       "brief": {"type": "string"}, "criteria": {"type": "string"}, "agent": {"type": "string"},
                       "phase": {"type": "string"}, "checkpoint": {"type": "boolean"},
                       "check": {"type": "string", "description": "update_step: the step's check command; "
                                                                  "set_check: the plan-wide regression check"},
                       "verdict": {"type": "string", "enum": ["accept", "revise", "fail"]},
                       "feedback": {"type": "string", "description": "review: specific fixes (revise) or why it failed"},
                       "summary": {"type": "string", "description": "review accept: handoff for later steps; finish: final report"},
                       "plan_id": {"type": "string", "description": "open: plan to attach to this chat"}}, ["action"]),
    }
    _give_shellb()


def _give_shellb():
    """One-time: rosters saved before mega plans existed don't list the tool for Shell:B yet."""
    if db.kv_get("migr_mega_plan"):
        return
    agents = db.kv_get("agents")
    if agents:
        for a in agents:
            if a.get("id") == "shellb" and "mega_plan" not in a.get("tools", []):
                a["tools"] = [*a.get("tools", []), "mega_plan"]
        db.kv_set("agents", agents)
    db.kv_set("migr_mega_plan", True)


# ── API ─────────────────────────────────────────────────────────────────────

def _need(pid):
    p = get(pid)
    if not p:
        raise HTTPException(404, "No such plan")
    return p


def _bad(e):
    return HTTPException(404, "No such step") if isinstance(e, KeyError) else HTTPException(400, str(e))


@router.get("/api/plans")
def api_list():
    return list_plans()


@router.post("/api/plans")
async def api_create(req: Request):
    b = await req.json()
    goal = str(b.get("goal") or "").strip()
    if not goal:
        raise HTTPException(400, "Describe the goal")
    orch = b.get("orchestrator") or "shellb"
    if not _agent_exists(orch):
        raise HTTPException(400, f"No agent {orch!r}")
    ws = b.get("workspace") or "new"
    project_id = None
    if ws not in ("new", "none"):
        if not db.get_project(ws):
            raise HTTPException(400, "No such workspace")
        project_id = ws
    p = create_plan(b.get("title") or "", goal, orch, project_id,
                    options={"workspace": ws if ws in ("new", "none") else "existing", "autoRun": bool(b.get("autoRun")),
                             "maxAttempts": max(1, min(6, int(b.get("maxAttempts") or DEFAULT_ATTEMPTS))),
                             "quality": b.get("quality") if b.get("quality") in QUALITY else "thorough",
                             "check": str(b.get("check") or "").strip()[:2000],
                             "phaseReviews": b.get("phaseReviews", True) is not False})
    if b.get("plan", True):
        start_planning(p["id"], str(b.get("guidance") or ""))
    return detail(p["id"])


@router.get("/api/plans/{pid}")
def api_get(pid: str):
    _need(pid)
    return detail(pid)


@router.patch("/api/plans/{pid}")
async def api_patch(pid: str, req: Request):
    _need(pid)
    b = await req.json()
    fields = {k: b[k] for k in ("title", "goal", "summary") if k in b}
    if "orchestrator" in b:
        if not _agent_exists(b["orchestrator"]):
            raise HTTPException(400, "No such agent")
        fields["orchestrator"] = b["orchestrator"]
    if "options" in b:
        o = b["options"] or {}
        fields["options"] = {k: o[k] for k in ("maxAttempts", "autoRun", "check", "phaseReviews") if k in o}
        if o.get("quality") in QUALITY:
            fields["options"]["quality"] = o["quality"]
    update_plan(pid, **fields)
    return detail(pid)


@router.delete("/api/plans/{pid}")
def api_delete(pid: str):
    _need(pid)
    delete_plan(pid)
    return {"ok": True}


@router.post("/api/plans/{pid}/{verb}")
async def api_control(pid: str, verb: str, req: Request):
    _need(pid)
    b = await req.json() if (await req.body()) else {}
    try:
        if verb == "run":
            run(pid)
        elif verb == "pause":
            pause(pid)
        elif verb == "plan":
            start_planning(pid, str(b.get("guidance") or ""))
        elif verb == "steps":
            add_steps(pid, b.get("steps") or [b], after=b.get("after"))
            log(pid, "Steps added by you.", "edit")
        else:
            raise HTTPException(404, "Unknown action")
    except (ValueError, KeyError) as e:
        raise _bad(e)
    return detail(pid)


@router.patch("/api/plans/{pid}/steps/{sid}")
async def api_step_patch(pid: str, sid: str, req: Request):
    _need(pid)
    b = await req.json()
    try:
        if b.get("move") in (-1, 1):
            move_step(pid, sid, int(b["move"]))
        elif b.get("verdict"):
            apply_review(pid, sid, b["verdict"], str(b.get("feedback") or ""), str(b.get("summary") or ""), by="user")
        else:
            before = _resolve(steps(pid), sid)
            s = update_step(pid, sid, b, by_user=True)
            if "status" in b and before and before["status"] != s["status"]:
                verb = {"pending": "reset to run again", "done": "marked done", "skipped": "skipped", "failed": "marked failed"}
                log(pid, f"Step {s['n']} {verb.get(s['status'], s['status'])} by you.", "edit", s["id"])
    except (ValueError, KeyError) as e:
        raise _bad(e)
    return detail(pid)


@router.delete("/api/plans/{pid}/steps/{sid}")
def api_step_delete(pid: str, sid: str):
    _need(pid)
    try:
        s = delete_step(pid, sid)
    except (ValueError, KeyError) as e:
        raise _bad(e)
    log(pid, f"Step \"{s['title']}\" removed by you.", "edit")
    return detail(pid)
