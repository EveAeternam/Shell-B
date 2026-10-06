"""Offline shim: rewrite well-known CDN URLs in generated pages to the copies served from /vendor.

Models often reach for unpkg/jsdelivr/Google Fonts even when told not to; with these rewrites the page still
renders when the internet is down. The rules live in ui/src/cdnMap.json, shared with ui/src/offline.ts.
"""
import json
import re
from pathlib import Path

_MAP = Path(__file__).resolve().parent.parent / "ui" / "src" / "cdnMap.json"
_RULES = [(re.compile(r"(?:https?:)?" + pat), rep) for pat, rep in json.loads(_MAP.read_text())["rules"]]
_SRI = re.compile(r"""(<(?:script|link)\b[^>]*?["']/vendor/[^>]*?)\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')""", re.I)
_SRI_AFTER = re.compile(r"""(<(?:script|link)\b[^>]*?)\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')([^>]*?["']/vendor/)""", re.I)


def localize(text: str) -> str:
    """Point known CDN URLs at /vendor. The CDN's SRI hash won't match the local copy, so it goes too."""
    if "//" not in text:
        return text
    out = text
    for rx, rep in _RULES:
        out = rx.sub(lambda m: rep.replace("$1", m.group(1) or "") if rx.groups else rep, out)
    if out != text and "integrity" in out:
        out = _SRI_AFTER.sub(r"\1\2", _SRI.sub(r"\1", out))
    return out
