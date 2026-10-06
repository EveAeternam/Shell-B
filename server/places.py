"""Offline place search over regional OSM extracts (built by ~/shellb/maps/regions/build_places.py).

Each region is ~/shellb/maps/regions/<name>/places.db: a `places` table plus an FTS5 index over a normalised
`search` column. `search()` tries every installed region first and only then goes online (weather.places →
Nominatim). Query words get the same normalisation as the index (st → street, pkwy → parkway …); a leading house
number must match the address's number exactly.
"""
import asyncio
import re
import sqlite3
from pathlib import Path

REGIONS = Path.home() / "shellb" / "maps" / "regions"

ABBR = {"st": "street", "ave": "avenue", "av": "avenue", "blvd": "boulevard", "dr": "drive", "rd": "road", "ln": "lane",
        "pkwy": "parkway", "hwy": "highway", "ct": "court", "pl": "place", "cir": "circle", "ter": "terrace", "trl": "trail",
        "sq": "square", "pt": "point", "mt": "mount", "ft": "fort", "n": "north", "s": "south", "e": "east", "w": "west",
        "ne": "northeast", "nw": "northwest", "se": "southeast", "sw": "southwest", "intl": "international",
        "sr": "state road", "cr": "county road", "expy": "expressway", "fwy": "freeway", "tpke": "turnpike"}
STATES = {"fl", "florida", "usa", "us", "united", "states", "america"}  # region words the index doesn't hold


def norm_words(s: str) -> list[str]:
    return [ABBR.get(w, w) for w in re.findall(r"[\w']+", s.lower().replace("'", ""))]


def regions() -> list[dict]:
    out = []
    for d in sorted(REGIONS.glob("*/places.db")):
        out.append({"name": d.parent.name, "path": d, "bytes": d.stat().st_size})
    return out


def _query(db: Path, q: str, limit: int) -> list[dict]:
    words = [w for w in norm_words(q) if w not in STATES]
    if not words:
        return []
    number = words[0] if words[0].isdigit() and len(words) > 1 else None
    terms = " ".join(f'"{w}"' + ("*" if i == len(words) - 1 and len(w) >= 2 else "") for i, w in enumerate(words))
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        # bm25 is negative (lower = better); rank lifts cities over streets over shops
        rows = con.execute(f"""
            SELECT p.name, p.kind, p.category, p.street, p.housenumber, p.city, p.postcode, p.lat, p.lon, p.rank,
                   bm25(places_fts) AS score
            FROM places_fts JOIN places p ON p.id = places_fts.rowid
            WHERE places_fts MATCH ? {"AND p.housenumber = ?" if number else ""}
            ORDER BY score - p.rank / 12.0 LIMIT ?""", (terms, number, limit * 4) if number else (terms, limit * 4)).fetchall()
    finally:
        con.close()
    seen, out = set(), []
    for name, kind, cat, street, hn, city, post, lat, lon, rank, score in rows:
        key = (name.lower(), kind, round(lat, 1), round(lon, 1))  # a city's point and its boundary are one result
        if key in seen:
            continue
        seen.add(key)
        where = ", ".join(x for x in (city, post) if x)
        out.append({"name": name, "full": f"{name}{', ' + where if where else ''}", "lat": lat, "lon": lon,
                    "type": cat.split("=")[-1] if kind == "poi" else kind if kind != "place" else cat,
                    "kind": kind, "city": city, "offline": True, "score": round(-score + rank / 12.0, 2)})
        if len(out) >= limit:
            break
    return out


async def search_offline(q: str, limit: int = 5) -> list[dict]:
    out: list[dict] = []
    for r in regions():
        try:
            out += await asyncio.to_thread(_query, r["path"], q, limit)
        except sqlite3.Error:
            continue
    return sorted(out, key=lambda x: -x["score"])[:limit]


async def search(q: str, limit: int = 5) -> list[dict]:
    """Local index when it clearly has the answer; otherwise online first (the world is bigger than one state), with the
    local matches as the fallback when there's no internet."""
    local = await search_offline(q, limit)
    named_region = any(w in ("fl", "florida") for w in norm_words(q))
    if local and (named_region or local[0]["kind"] in ("place", "address")):
        return local
    import weather  # late: weather imports tools, which imports a lot
    try:
        online = await asyncio.wait_for(weather.places(q, limit), timeout=8)
    except Exception:
        online = []
    seen = {(round(o["lat"], 3), round(o["lon"], 3)) for o in online}
    return (online + [x for x in local if (round(x["lat"], 3), round(x["lon"], 3)) not in seen])[:limit]
