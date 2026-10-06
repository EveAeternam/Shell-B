"""Nightly reflection: Shell:B tidies what it knows about the owner while nobody is using it.

Once a night (setting `memoryReflectionHour`, local time; off with `memoryReflection`), when no turn is running:
  1. expire   memories whose expiry date passed (memory._expire)
  2. tidy     first-person memories ("I am…") are rewritten in the third person, like the rest
  3. merge    clusters of very similar memories (cosine ≥ MERGE_SIM) go to the utility model, which merges them into
              one memory or says they're separate facts (remembered, so the pair isn't asked about again)
  4. stale    memories older than STALE_DAYS that describe a temporary state ("about to", "currently", plans with dates)
              become "Forget?" proposals in the Memory review queue; the owner decides. Never re-asked within ASK_AGAIN.
  5. digest   once a week, an Activity post: what was learned, corrected, forgotten, what waits for review, and the
              week's thumbs from feedback.py, with agents that drew repeated complaints.

Changes follow `memoryLearning`: auto applies tidy and merge (each is reversible: the originals are retired with a
note and can be restored), review queues them as pending. Stale checks are always questions, never automatic.
"""
import asyncio
import json
import re
import time
from collections import Counter
from datetime import datetime, timedelta

import numpy as np
from fastapi import APIRouter

import db
import memory

router = APIRouter(prefix="/api/memory/reflection")

MERGE_SIM = 0.72
MAX_CLUSTERS = 6
STALE_DAYS = 21
ASK_AGAIN = 90 * 86400
DIGEST_EVERY = 7 * 86400
busy = lambda: False  # noqa: E731  set by app.py
_task = None
_running = False


def _state() -> dict:
    return db.kv_get("reflection", {}) or {}


def _save_state(**kw):
    db.kv_set("reflection", {**_state(), **kw})


def _now(settings):
    return memory._now(settings)


async def _ask_json(prompt: str, settings: dict, n=900) -> dict:
    from agent import OLLAMA, model_info
    import httpx
    import providers
    model = settings.get("utilityModel") or ""
    if not model or providers.is_cloud(model):
        return {}
    payload = {"model": model, "stream": False, "format": "json", "keep_alive": "2h",
               "options": {"temperature": 0.1, "num_predict": n}, "messages": [{"role": "user", "content": prompt}]}
    if "thinking" in (await model_info(model))["capabilities"]:
        payload["think"] = False
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.post(f"{OLLAMA}/api/chat", json=payload)
        r.raise_for_status()
    raw = r.json()["message"]["content"] or ""
    m = re.search(r"\{.*\}", raw, re.S)
    try:
        return json.loads(m.group(0)) if m else {}
    except ValueError:
        return {}


# ── steps ───────────────────────────────────────────────────────────────────

FIRST_PERSON = re.compile(r"^\s*(I|I'm|I've|My|Me)\b", re.I)

TIDY_PROMPT = """Rewrite each memory about the user in the third person, calling them {name}. Keep every detail and the
meaning exactly; change nothing else. One sentence each where possible.

{listing}

Reply with JSON only: {{"rewrites": {{"mem-…": "…", …}}}}"""


async def tidy(settings, mode, log):
    from feedback import _owner_name
    todo = [m for m in memory.rows() if FIRST_PERSON.match(m["text"])][:20]
    if not todo:
        return
    out = (await _ask_json(TIDY_PROMPT.format(name=_owner_name(), listing="\n".join(f"[{m['id']}] {m['text']}" for m in todo)),
                           settings)).get("rewrites", {})
    for m in todo:
        new = memory._clean(out.get(m["id"]))
        if not new or new == m["text"] or FIRST_PERSON.match(new):
            continue
        mid, dup = await memory.add(new, category=m["category"], origin="reflection", source=m["source"], pinned=m["pinned"],
                                    replaces=m["id"], status="active" if mode == "auto" else "pending",
                                    created=m["createdAt"] / 1000, settings=settings)
        if not dup:
            log["tidied"].append({"id": mid, "text": new, "old": m["text"]})


MERGE_PROMPT = """These memories about the user may overlap.

{listing}

If they say the same thing, or one is contained in another, merge them into ONE memory that keeps every distinct
detail (one or two sentences, third person). If they are different facts that merely share a topic, keep them.

Reply with JSON only: {{"action": "merge", "text": "…", "category": "identity|work|preference|person|project|interest|routine|other"}}
or {{"action": "keep"}}"""


def _clusters(mems) -> list[list[dict]]:
    if len(mems) < 2:
        return []
    M = np.stack([np.frombuffer(m["embedding"], dtype=np.float32) for m in mems])
    S = M @ M.T
    kept = set(db.kv_get("reflection_kept", []))
    pairs = sorted(((S[i, j], i, j) for i in range(len(mems)) for j in range(i + 1, len(mems)) if S[i, j] >= MERGE_SIM),
                   reverse=True)
    used, out = set(), []
    for _, i, j in pairs:
        if i in used or j in used or "|".join(sorted((mems[i]["id"], mems[j]["id"]))) in kept:
            continue
        group = [i, j] + [k for k in range(len(mems)) if k not in (i, j) and k not in used
                          and S[i, k] >= MERGE_SIM and S[j, k] >= MERGE_SIM][:2]
        used.update(group)
        out.append([mems[k] for k in group])
        if len(out) >= MAX_CLUSTERS:
            break
    return out


async def merge(settings, mode, log):
    mems = [m for m in memory.rows(with_embeddings=True) if len(m["embedding"]) > 4]
    kept = db.kv_get("reflection_kept", [])
    for group in _clusters(mems):
        listing = "\n".join(f"[{m['id']}] ({m['category']}) {m['text']}" for m in group)
        out = await _ask_json(MERGE_PROMPT.format(listing=listing), settings, 400)
        text = memory._clean(out.get("text"))
        if out.get("action") != "merge" or not text:
            ids = [m["id"] for m in group]
            kept += ["|".join(sorted((a, b))) for a in ids for b in ids if a < b]
            continue
        ids = ",".join(m["id"] for m in group)
        mid, dup = await memory.add(text, category=out.get("category") or group[0]["category"], origin="reflection",
                                    source=group[0]["source"], pinned=any(m["pinned"] for m in group), replaces=ids,
                                    status="active" if mode == "auto" else "pending",
                                    created=min(m["createdAt"] for m in group) / 1000, settings=settings)
        if not dup:
            log["merged"].append({"id": mid, "text": text, "from": [m["text"] for m in group]})
    db.kv_set("reflection_kept", kept[-2000:])


STALE_PROMPT = """Today is {today}. Below are memories about the user, each with the date it was noted.

{listing}

Which ones are probably no longer true by now? Look for temporary states and plans: "about to", "currently",
"this week", "is applying", "is planning", dated events that have passed. Lasting facts (name, skills, certifications,
preferences, relationships) are not stale.

Reply with JSON only: {{"stale": [{{"id": "mem-…", "reason": "short reason, e.g. 'said about to happen 3 months ago'"}}]}}"""


async def stale(settings, log, today=None):
    today = today or _now(settings)
    asked = db.kv_get("reflection_asked", {}) or {}
    cutoff = today.timestamp() - STALE_DAYS * 86400
    pending_targets = {(m["replaces"] or "")[7:] for m in memory.rows(("pending",)) if (m["replaces"] or "").startswith("forget:")}
    cands = [m for m in memory.rows() if m["createdAt"] / 1000 < cutoff and m["id"] not in pending_targets
             and today.timestamp() - asked.get(m["id"], 0) > ASK_AGAIN][:40]
    if not cands:
        return
    listing = "\n".join(f"[{m['id']}] (noted {datetime.fromtimestamp(m['createdAt'] / 1000):%b %d %Y}) {m['text']}" for m in cands)
    out = await _ask_json(STALE_PROMPT.format(today=f"{today:%B %d, %Y}", listing=listing), settings)
    by_id = {m["id"]: m for m in cands}
    for s in (out.get("stale") or [])[:8]:
        m = by_id.get(str(s.get("id") or "")) if isinstance(s, dict) else None
        if not m:
            continue
        reason = memory._clean(s.get("reason")) or "May be out of date"
        items = await memory.apply([{"op": "retire", "id": m["id"], "reason": f"May be out of date: {reason}"}],
                                   {m["id"]: m}, mode="review", origin="reflection", source=m["source"], settings=settings)
        asked[m["id"]] = today.timestamp()
        if items:
            log["stale"].append({"id": items[0]["id"], "text": m["text"], "reason": reason})
    db.kv_set("reflection_asked", asked)


def _week(since: float) -> dict:
    with db.conn() as c:
        rows = c.execute("SELECT text, origin, status, note, created, updated FROM memories WHERE created>? OR updated>?",
                         (since, since)).fetchall()
        fb = c.execute("SELECT agent_id, rating, reasons FROM feedback WHERE created>?", (since,)).fetchall() \
            if c.execute("SELECT name FROM sqlite_master WHERE name='feedback'").fetchone() else []
    learned = [r["text"] for r in rows if r["created"] > since and r["status"] == "active"
               and r["origin"] in ("auto", "history", "feedback", "agent")]
    forgot = [r["text"] for r in rows if r["status"] == "retired" and r["updated"] > since
              and not (r["note"] or "").startswith("Replaced by")]
    up = sum(1 for r in fb if r["rating"] == "up")
    down = [r for r in fb if r["rating"] == "down"]
    complaints = Counter()
    for r in down:
        for reason in json.loads(r["reasons"] or "[]"):
            complaints[(r["agent_id"], reason)] += 1
    patterns = [f"{a} · {reason.replace('-', ' ')} ×{n}" for (a, reason), n in complaints.most_common(3) if n >= 2]
    return {"learned": learned, "forgot": forgot, "up": up, "down": len(down), "patterns": patterns}


def digest(log, settings, force=False) -> bool:
    st = _state()
    now = time.time()
    if not force and now - st.get("lastDigest", 0) < DIGEST_EVERY:
        return False
    since = st.get("lastDigest") or now - DIGEST_EVERY
    w = _week(since)
    pending = memory.pending_count()
    parts = []
    if w["learned"]:
        parts.append(f"Learned {len(w['learned'])}: " + "; ".join(w["learned"][:4]) + ("…" if len(w["learned"]) > 4 else ""))
    if w["forgot"]:
        parts.append(f"Forgot {len(w['forgot'])}.")
    if log.get("merged") or log.get("tidied"):
        parts.append(f"Tidied {len(log.get('merged', [])) + len(log.get('tidied', []))}.")
    if w["up"] or w["down"]:
        parts.append(f"Your ratings: {w['up']} 👍 {w['down']} 👎" + (f" (repeated: {', '.join(w['patterns'])})" if w["patterns"] else "") + ".")
    if pending:
        parts.append(f"{pending} waiting for your OK.")
    _save_state(lastDigest=now)
    if not parts:
        return False
    import activity
    activity.post("memory", "review" if pending else "done", "This week, Shell:B learned about you",
                  " ".join(parts), "#/memory", ref=f"digest:{int(now)}")
    return True


# ── running ─────────────────────────────────────────────────────────────────

async def run(settings=None, force_digest=False) -> dict:
    global _running
    if _running:
        return _state().get("last", {})
    _running = True
    settings = settings or memory._settings()
    mode = settings.get("memoryLearning", "auto")
    mode = "review" if mode == "off" else mode
    log = {"at": time.time() * 1000, "tidied": [], "merged": [], "stale": [], "error": ""}
    try:
        memory._expire()
        async with memory._lock:
            await memory.classify_uncategorized(settings)
            for step in (tidy, merge):
                try:
                    await step(settings, mode, log)
                except Exception as e:  # noqa: BLE001  one step failing doesn't stop the others
                    log["error"] += f"{step.__name__}: {type(e).__name__}: {e}. "
            try:
                await stale(settings, log)
            except Exception as e:  # noqa: BLE001
                log["error"] += f"stale: {type(e).__name__}: {e}. "
            try:
                import codex
                await codex.populate_from_memories(settings, mode=mode)
            except Exception as e:  # noqa: BLE001
                log["error"] += f"codex_sync: {type(e).__name__}: {e}. "
        if log["stale"] and mode == "auto":
            import activity
            activity.post("memory", "review", f"{len(log['stale'])} thing{'s' if len(log['stale']) > 1 else ''} Shell:B knows may be out of date",
                          "; ".join(s["text"] for s in log["stale"]), "#/memory", ref=f"stale:{int(time.time())}")
        log["digest"] = digest(log, settings, force=force_digest)
    finally:
        _running = False
        _save_state(lastRun=time.time(), last=log)
    return log


def _due(settings) -> bool:
    if not settings.get("memoryReflection", True):
        return False
    now = _now(settings)
    hour = int(settings.get("memoryReflectionHour", 3)) % 24
    slot = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if now < slot:
        slot -= timedelta(days=1)
    return _state().get("lastRun", 0) < slot.timestamp()


async def _loop():
    await asyncio.sleep(60)
    while True:
        try:
            settings = memory._settings()
            if _due(settings) and not busy():
                await run(settings)
        except Exception as e:  # noqa: BLE001
            print(f"reflection: {type(e).__name__}: {e}")
        await asyncio.sleep(600)


def start():
    global _task
    if _task is None:
        _task = asyncio.create_task(_loop())


def stop():
    global _task
    if _task and not _task.done():
        _task.cancel()
        _task = None


# ── HTTP ────────────────────────────────────────────────────────────────────

def _info():
    st = _state()
    settings = memory._settings()
    now = _now(settings)
    hour = int(settings.get("memoryReflectionHour", 3)) % 24
    nxt = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if _due(settings):  # missed or never run: within ten minutes, once nobody is chatting
        nxt = now
    elif nxt <= now:
        nxt += timedelta(days=1)
    return {"enabled": settings.get("memoryReflection", True), "hour": hour, "running": _running,
            "lastRun": st.get("lastRun", 0) * 1000, "lastDigest": st.get("lastDigest", 0) * 1000,
            "next": nxt.timestamp() * 1000, "last": st.get("last")}


@router.get("")
def api_info():
    return _info()


@router.post("/run")
async def api_run(digest: bool = False):
    if not _running:
        t = asyncio.create_task(run(force_digest=digest))
        memory._tasks.add(t)
        t.add_done_callback(memory._tasks.discard)
        await asyncio.sleep(0.05)
    return _info()
