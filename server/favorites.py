"""Favorites: one starred list across everything Shell:B keeps — chats, artifacts, Studio/Code projects,
chat Projects, research notebooks and mega plans.

A favorite is (kind, ref, sub): `sub` is only used by artifacts (ref = conversation, sub = artifact id).
Titles aren't stored; every read resolves them live, and favorites whose target is gone are dropped.
"""
import time

from fastapi import APIRouter, HTTPException, Request

import db

router = APIRouter()

KINDS = ("chat", "artifact", "project", "group", "research", "plan")


def init():
    with db.conn() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS favorites(
  kind TEXT, ref TEXT, sub TEXT DEFAULT '', created REAL, pos REAL, PRIMARY KEY(kind, ref, sub))""")


def _resolve(c, kind, ref, sub):
    """The live card for one favorite, or None if its target no longer exists."""
    if kind == "chat":
        r = c.execute("SELECT title, agent_id, group_id, project_id, updated FROM conversations WHERE id=?", (ref,)).fetchone()
        if not r:
            return None
        g = c.execute("SELECT name FROM groups WHERE id=?", (r["group_id"],)).fetchone() if r["group_id"] else None
        return {"title": r["title"], "subtitle": g["name"] if g else "Chat", "href": f"#/c/{ref}",
                "agentId": r["agent_id"], "updatedAt": r["updated"] * 1000}
    if kind == "artifact":
        r = c.execute("""SELECT a.title, a.type, a.language, a.version, a.created, v.title conv_title, v.agent_id
                         FROM artifacts a JOIN conversations v ON v.id=a.conv_id
                         WHERE a.conv_id=? AND a.id=? ORDER BY a.version DESC LIMIT 1""", (ref, sub)).fetchone()
        if not r:
            return None
        return {"title": r["title"], "subtitle": r["conv_title"], "href": f"#/c/{ref}/{sub}", "type": r["type"],
                "agentId": r["agent_id"], "version": r["version"], "updatedAt": r["created"] * 1000}
    if kind == "project":
        r = c.execute("SELECT name, kind, description, updated FROM projects WHERE id=?", (ref,)).fetchone()
        if not r:
            return None
        code = r["kind"] == "code"
        return {"title": r["name"], "subtitle": r["description"] or ("Code workspace" if code else "Studio project"),
                "href": f"#/{'code' if code else 'studio'}/{ref}", "type": r["kind"], "updatedAt": r["updated"] * 1000}
    if kind == "group":
        r = c.execute("SELECT name, description, emoji, color, updated FROM groups WHERE id=?", (ref,)).fetchone()
        if not r:
            return None
        return {"title": r["name"], "subtitle": r["description"] or "Project", "href": f"#/p/{ref}",
                "emoji": r["emoji"], "color": r["color"], "updatedAt": r["updated"] * 1000}
    if kind == "research":
        r = c.execute("SELECT title, question, emoji, updated FROM research_boards WHERE id=?", (ref,)).fetchone()
        if not r:
            return None
        return {"title": r["title"] or r["question"] or "Untitled notebook", "subtitle": "Research notebook",
                "href": f"#/research/{ref}", "emoji": r["emoji"], "updatedAt": r["updated"] * 1000}
    if kind == "plan":
        r = c.execute("SELECT title, status, updated FROM mega_plans WHERE id=?", (ref,)).fetchone()
        if not r:
            return None
        return {"title": r["title"], "subtitle": f"Mega plan · {r['status']}", "href": f"#/plans/{ref}",
                "status": r["status"], "updatedAt": r["updated"] * 1000}
    return None


def list_favorites():
    out, gone = [], []
    with db.conn() as c:
        for f in c.execute("SELECT * FROM favorites ORDER BY pos, created").fetchall():
            try:
                card = _resolve(c, f["kind"], f["ref"], f["sub"])
            except Exception:  # a module's table may not exist yet; keep the favorite
                card = {"title": f["ref"], "subtitle": f["kind"], "href": "#/"}
            if card is None:
                gone.append((f["kind"], f["ref"], f["sub"]))
                continue
            out.append({"kind": f["kind"], "ref": f["ref"], "sub": f["sub"], "createdAt": f["created"] * 1000, **card})
        for g in gone:
            c.execute("DELETE FROM favorites WHERE kind=? AND ref=? AND sub=?", g)
    return out


def _key(body):
    kind, ref, sub = body.get("kind"), body.get("ref"), body.get("sub") or ""
    if kind not in KINDS or not ref:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)} and ref is required")
    if kind == "artifact" and not sub:
        raise HTTPException(400, "An artifact favorite needs sub (the artifact id)")
    return kind, ref, sub


@router.get("/api/favorites")
def get_favorites():
    return list_favorites()


@router.post("/api/favorites")
async def add_favorite(req: Request):
    kind, ref, sub = _key(await req.json())
    with db.conn() as c:
        if _resolve(c, kind, ref, sub) is None:
            raise HTTPException(404, f"No such {kind}")
        top = c.execute("SELECT MIN(pos) p FROM favorites").fetchone()["p"]
        c.execute("INSERT OR IGNORE INTO favorites(kind, ref, sub, created, pos) VALUES(?,?,?,?,?)",
                  (kind, ref, sub, time.time(), (top if top is not None else 0) - 1))  # newest first
    return list_favorites()


@router.delete("/api/favorites")
def remove_favorite(kind: str, ref: str, sub: str = ""):
    with db.conn() as c:
        c.execute("DELETE FROM favorites WHERE kind=? AND ref=? AND sub=?", (kind, ref, sub))
    return list_favorites()


@router.post("/api/favorites/order")
async def reorder_favorites(req: Request):
    """Body: {keys: ["kind:ref:sub", ...]} in the wanted order; favorites left out keep their place after them."""
    keys = (await req.json()).get("keys") or []
    with db.conn() as c:
        for i, k in enumerate(keys):
            kind, _, rest = k.partition(":")
            ref, _, sub = rest.partition(":")
            c.execute("UPDATE favorites SET pos=? WHERE kind=? AND ref=? AND sub=?", (i, kind, ref, sub))
    return list_favorites()
