"""Codex secrets: API keys, tokens and passwords that agents can use but never see.

A secret is a Codex entry of kind `secret` whose title is its NAME (e.g. GITHUB_TOKEN) and whose body describes it. The
value lives apart from the entry, AES-256-GCM encrypted in table codex_secrets, with the key in data/codex/.key. That
protects a copied database file, not a compromised machine: the key sits on the same disk.

Agents only ever see the name. They use a secret by writing `{{secret:NAME}}` into the headers, body or query string of
`codex action=request`, an HTTPS call that this module makes for them:
- each secret lists the hosts it may be sent to; a request to any other host is refused before anything is decrypted;
- unless the owner turned it off for that secret, every use waits for the owner's approval (agent.py → remote.wait_approval,
  which also lists it in the Activity inbox);
- redirects aren't followed, local addresses are refused, and the value is blanked out of whatever comes back;
- every use is appended to data/codex/secret-audit.jsonl.

Setting, changing, revealing and re-scoping a secret all require the owner (a session or the admin key), never a bare
localhost request, so neither an agent nor a page running on this machine can widen where a secret may go.
"""
import base64
import json
import os
import re
import time
from fnmatch import fnmatch
from urllib.parse import quote, urlparse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, HTTPException, Request

import codex
import db
from tools import ToolResult

router = APIRouter(prefix="/api/codex/secrets")
KEY = codex.ROOT / ".key"
AUDIT = codex.ROOT / "secret-audit.jsonl"
NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
PLACEHOLDER = re.compile(r"\{\{\s*secret:([A-Za-z][A-Za-z0-9_]*)\s*\}\}")
MAX_VALUE = 16_000
RESPONSE_LIMIT = 20_000
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD")


def init():
    with db.conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS codex_secrets(entry_id TEXT PRIMARY KEY, nonce BLOB, value BLOB, updated REAL)")


# ── encryption ──────────────────────────────────────────────────────────────

def _key() -> bytes:
    if not KEY.exists():
        codex.ROOT.mkdir(exist_ok=True)
        fd = os.open(KEY, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(AESGCM.generate_key(bit_length=256))
    return KEY.read_bytes()


def _store(eid: str, value: str):
    nonce = os.urandom(12)
    ct = AESGCM(_key()).encrypt(nonce, value.encode(), eid.encode())  # bound to its entry: rows can't be swapped
    with db.conn() as c:
        c.execute("INSERT OR REPLACE INTO codex_secrets VALUES(?,?,?,?)", (eid, nonce, ct, time.time()))


def _value(eid: str) -> str | None:
    with db.conn() as c:
        r = c.execute("SELECT nonce, value FROM codex_secrets WHERE entry_id=?", (eid,)).fetchone()
    return AESGCM(_key()).decrypt(r["nonce"], r["value"], eid.encode()).decode() if r else None


def has_value(eid: str) -> bool:
    with db.conn() as c:
        return c.execute("SELECT 1 FROM codex_secrets WHERE entry_id=?", (eid,)).fetchone() is not None


def forget(eid: str):
    with db.conn() as c:
        c.execute("DELETE FROM codex_secrets WHERE entry_id=?", (eid,))
    audit(secrets=[eid], outcome="deleted")


# ── lookups ─────────────────────────────────────────────────────────────────

def by_name(name: str) -> dict | None:
    with db.conn() as c:
        r = c.execute("SELECT id FROM codex_entries WHERE kind='secret' AND title=?", (name.upper(),)).fetchone()
    return codex.get(r["id"]) if r else None


def _hosts(value) -> list[str]:
    if isinstance(value, str):
        value = re.split(r"[\s,]+", value)
    out = []
    for h in value or []:
        h = str(h).strip().lower()
        h = urlparse(h).hostname or h if "://" in h else h.split("/")[0]
        if h and re.fullmatch(r"(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+", h) and h not in out:
            out.append(h)
    return out[:20]


def host_allowed(host: str, allowed: list[str]) -> bool:
    host = host.lower()
    return any(host == a or (a.startswith("*.") and (fnmatch(host, a) or host == a[2:])) for a in allowed)


def describe(e: dict) -> str:
    m = e["meta"]
    hosts = ", ".join(m.get("hosts") or []) or "no hosts yet (it can't be used until the owner adds some)"
    return (f"Secret {{{{secret:{e['title']}}}}}: {e.get('body') or e.get('preview') or 'no description'}\n"
            f"May be sent to: {hosts}. {'Each use waits for the owner to approve it.' if m.get('approval', 'ask') == 'ask' else 'Used without asking.'}\n"
            "Its value is never shown to you. Use it with codex action=request (url, method, headers, body), writing "
            f"{{{{secret:{e['title']}}}}} where the value belongs.")


def audit(**entry):
    with AUDIT.open("a") as f:
        f.write(json.dumps({"t": time.time(), **entry}) + "\n")
    try:
        outcome = entry.get("outcome", "access")
        db.audit_log(f"secret:{outcome}", entry)
    except Exception:
        pass


def recent_uses(eid: str, n=20) -> list[dict]:
    if not AUDIT.exists():
        return []
    out = []
    for line in AUDIT.read_text().splitlines()[-2000:]:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if eid in d.get("secrets", []):
            out.append(d)
    return out[-n:][::-1]


# ── the request agents make ─────────────────────────────────────────────────

def _names(*parts) -> list[str]:
    found = []
    for p in parts:
        for m in PLACEHOLDER.finditer(p or ""):
            n = m.group(1).upper()
            if n not in found:
                found.append(n)
    return found


def prepare(args: dict) -> dict | ToolResult:
    """Check a request before anything is decrypted. Returns the plan, or a ToolResult explaining the refusal."""
    import scrape
    url = str(args.get("url") or "").strip()
    method = str(args.get("method") or "GET").upper()
    headers = args.get("headers") or {}
    if isinstance(headers, str):
        try:
            headers = json.loads(headers)
        except ValueError:
            return ToolResult("headers must be an object, e.g. {\"Authorization\": \"Bearer {{secret:NAME}}\"}.", error=True)
    headers = {str(k): str(v) for k, v in dict(headers).items()}
    body = args.get("body")
    if body is not None and not isinstance(body, str):
        body = json.dumps(body)
        headers.setdefault("Content-Type", "application/json")
    if method not in METHODS:
        return ToolResult(f"method is one of {', '.join(METHODS)}.", error=True)
    p = urlparse(url)
    if p.scheme != "https" or not p.hostname:
        return ToolResult("request only makes https:// calls.", error=True)
    if PLACEHOLDER.search(p.netloc) or PLACEHOLDER.search(p.path):
        return ToolResult("Secrets may go in headers, the body or the query string, not in the host or path.", error=True)
    try:
        scrape._check_url(url)
    except ValueError as e:
        return ToolResult(str(e), error=True)
    names = _names(url, body, *headers.keys(), *headers.values())
    secrets = []
    for n in names:
        e = by_name(n)
        if not e:
            return ToolResult(f"There is no secret named {n}. Search the Codex (kind secret) for the right name, or ask the "
                              "owner to add it.", error=True)
        if not has_value(e["id"]):
            return ToolResult(f"{n} has no value yet; the owner sets it in the Codex.", error=True)
        allowed = e["meta"].get("hosts") or []
        if not host_allowed(p.hostname, allowed):
            audit(secrets=[e["id"]], host=p.hostname, method=method, outcome="refused-host")
            return ToolResult(f"{n} may only be sent to {', '.join(allowed) or 'no hosts yet'}, not {p.hostname}. Only the owner "
                              "can change that, in the Codex.", error=True)
        secrets.append(e)
    ask = any(e["meta"].get("approval", "ask") == "ask" for e in secrets)
    shown = "\n".join([f"{method} {url}", *(f"{k}: {v}" for k, v in headers.items())]
                      + ([f"\n{body[:3000]}" + ("…" if len(body) > 3000 else "")] if body else []))
    title = (f"Send {', '.join(e['title'] for e in secrets)} to {p.hostname}" if secrets else f"{method} {p.hostname}")
    return {"url": url, "method": method, "headers": headers, "body": body, "secrets": secrets, "ask": ask,
            "title": title, "detail": shown, "host": p.hostname}


def _fill(text: str | None, values: dict[str, str], in_query=False) -> str | None:
    if text is None:
        return None
    return PLACEHOLDER.sub(lambda m: quote(values[m.group(1).upper()], safe="") if in_query else values[m.group(1).upper()], text)


def _redact(text: str, values: dict[str, str]) -> str:
    for name, v in values.items():
        if len(v) < 4:
            continue
        for form in {v, quote(v, safe=""), base64.b64encode(v.encode()).decode()}:
            text = text.replace(form, f"{{{{secret:{name}}}}}")
    return text


async def perform(plan: dict, ctx) -> ToolResult:
    import scrape
    values = {e["title"]: _value(e["id"]) for e in plan["secrets"]}
    p = urlparse(plan["url"])
    url = p._replace(query=_fill(p.query, values, in_query=True)).geturl()
    headers = {_fill(k, values): _fill(v, values) for k, v in plan["headers"].items()}
    body = _fill(plan["body"], values)
    ids = [e["id"] for e in plan["secrets"]]
    try:
        async with scrape.client(timeout=60) as c:
            c.follow_redirects = False   # a redirect must not carry a secret to some other host
            r = await c.request(plan["method"], url, headers=headers, content=body.encode() if body is not None else None)
    except Exception as e:  # noqa: BLE001
        audit(secrets=ids, host=plan["host"], method=plan["method"], conv=ctx.conv_id, agent=ctx.agent.get("id"),
              outcome=f"error: {type(e).__name__}")
        return ToolResult(_redact(f"The request failed: {type(e).__name__}: {e}", values), error=True)
    audit(secrets=ids, host=plan["host"], method=plan["method"], conv=ctx.conv_id, agent=ctx.agent.get("id"),
          outcome=str(r.status_code))
    if plan["secrets"]:
        with db.conn() as c:
            for e in plan["secrets"]:
                m = codex.get(e["id"])["meta"]
                m.update(lastUsed=time.time() * 1000, uses=int(m.get("uses", 0)) + 1)
                c.execute("UPDATE codex_entries SET meta=? WHERE id=?", (json.dumps(m), e["id"]))
    ctype = r.headers.get("content-type", "")
    if r.is_redirect:
        text = f"Redirect to {r.headers.get('location', '?')} (not followed, so the secret stays with {plan['host']})."
    elif ctype.startswith("text/") or "json" in ctype or "xml" in ctype or not r.content:
        text = r.text
    else:
        text = f"[{len(r.content)} bytes of {ctype or 'binary data'}]"
    keep = ("content-type", "location", "link", "x-ratelimit-remaining", "retry-after")
    head = f"HTTP {r.status_code} {r.reason_phrase}\n" + "".join(f"{k}: {v}\n" for k, v in r.headers.items() if k.lower() in keep)
    more = len(text) - RESPONSE_LIMIT
    out = head + "\n" + text[:RESPONSE_LIMIT] + (f"\n\n[… {more} more characters cut]" if more > 0 else "")
    return ToolResult(_redact(out, values), error=r.status_code >= 400)


# ── owner API ───────────────────────────────────────────────────────────────

def _owner(req: Request):
    import remote
    if not remote.is_admin(req):
        raise HTTPException(403, "Only the signed-in owner can do this (or enter the admin key).")


def _summary(e: dict) -> dict:
    return {**e, "secret": {"set": has_value(e["id"]), "hosts": e["meta"].get("hosts") or [],
                            "approval": e["meta"].get("approval", "ask"), "uses": e["meta"].get("uses", 0),
                            "lastUsed": e["meta"].get("lastUsed"), "recent": recent_uses(e["id"], 10)}}


def _name(value) -> str:
    n = re.sub(r"[^A-Z0-9_]", "_", str(value or "").strip().upper())
    if not NAME_RE.match(n):
        raise HTTPException(400, "A secret's name is letters, digits and _ (e.g. GITHUB_TOKEN), starting with a letter.")
    return n


@router.post("")
async def api_create(req: Request):
    _owner(req)
    b = await req.json()
    name = _name(b.get("name"))
    if by_name(name):
        raise HTTPException(400, f"There is already a secret called {name}.")
    value = str(b.get("value") or "")
    if not value or len(value) > MAX_VALUE:
        raise HTTPException(400, "A secret needs a value (up to 16,000 characters).")
    try:
        e = codex.create({"kind": "secret", "title": name, "body": str(b.get("description") or ""), "tags": b.get("tags"),
                          "collectionId": b.get("collectionId") or ""})
    except ValueError as ex:
        raise HTTPException(400, str(ex))
    _store(e["id"], value)
    codex._set_meta(e["id"], hosts=_hosts(b.get("hosts")), approval="auto" if b.get("approval") == "auto" else "ask")
    audit(secrets=[e["id"]], outcome="created", name=name)
    return _summary(codex.get(e["id"], full=True))


@router.get("/{eid}")
def api_get(eid: str):
    e = codex.get(eid, full=True)
    if not e or e["kind"] != "secret":
        raise HTTPException(404, "No such secret.")
    return _summary(e)


@router.patch("/{eid}")
async def api_patch(eid: str, req: Request):
    """Name, value, hosts and approval: everything that decides where a secret can go."""
    _owner(req)
    e = codex.get(eid)
    if not e or e["kind"] != "secret":
        raise HTTPException(404, "No such secret.")
    b = await req.json()
    if "name" in b:
        n = _name(b["name"])
        other = by_name(n)
        if other and other["id"] != eid:
            raise HTTPException(400, f"There is already a secret called {n}.")
        with db.conn() as c:
            c.execute("UPDATE codex_entries SET title=?, updated=? WHERE id=?", (n, time.time(), eid))
    if b.get("value"):
        if len(str(b["value"])) > MAX_VALUE:
            raise HTTPException(400, "That value is too long.")
        _store(eid, str(b["value"]))
    meta = {}
    if "hosts" in b:
        meta["hosts"] = _hosts(b["hosts"])
    if "approval" in b:
        meta["approval"] = "auto" if b["approval"] == "auto" else "ask"
    if meta:
        codex._set_meta(eid, **meta)
    audit(secrets=[eid], outcome="changed:" + ",".join(k for k in ("name", "value", "hosts", "approval") if k in b and (k != "value" or b[k])))
    if "name" in b or "hosts" in b:
        codex._set_meta(eid, index="pending")
        codex._spawn(codex.index(eid))
    return _summary(codex.get(eid, full=True))


@router.post("/{eid}/reveal")
def api_reveal(eid: str, req: Request):
    _owner(req)
    e = codex.get(eid)
    if not e or e["kind"] != "secret":
        raise HTTPException(404, "No such secret.")
    audit(secrets=[eid], outcome="revealed")
    return {"value": _value(eid) or ""}
