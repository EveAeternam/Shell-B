#!/usr/bin/env python3
"""Regenerate src/maps/moons.json, the moon catalogue behind the Worlds app's Sol view (needs internet; run from ui/).

Sources:
  https://ssd.jpl.nasa.gov/sats/elem/      mean orbital elements for every satellite with a known orbit
  https://ssd.jpl.nasa.gov/sats/phys_par/  mean radii, where measured
  https://ssd.jpl.nasa.gov/api/horizons.api  one state vector per moon at 2000.0, 2026.0 and 2026-10-04

The mean-element table can't be used as-is: its mean anomalies for Saturn's and Uranus's moons don't match their
ephemerides even at the stated epoch, and "P" is the anomalistic period for some systems and sidereal for others.
So each moon is re-anchored to Horizons at 2026.0:
  regular moons (P < 100 d, i < 30°): table plane and precession rates, sidereal rate measured from the
    2000.0 → 2026.0 longitudes, mean anomaly fitted to the 2026.0 position. Good to a few degrees across decades.
  irregular moons: a two-body orbit from the 2026.0 state vector (ecliptic frame). Good to a few degrees for
    a year or so; the Sun perturbs them, so they wander tens of degrees over decades.
The 2026-10-04 vector is only used to report the error.

Row: [name, planet, a_km, e, w, M, i, node, P_days (sidereal), P_apsis_yr, P_node_yr, pole_ra, pole_dec, frame, epoch_jd, radius_km]
frame 0 = J2000 ecliptic, 1 = local Laplace plane (pole given), 2 = the planet's equator (pole from IAU, in sol.ts).
"""
import concurrent.futures as cf
import html
import json
import math
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "maps" / "moons.json"
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/shellb-moons-horizons.json")
EPOCH = {"2000-01-01.5": 2451545.0, "2020-01-01.0": 2458849.5, "2025-01-01.0": 2460676.5}
FRAME = {"ecliptic": 0, "Laplace": 1, "equatorial": 2}
CENTER = {"earth": 399, "mars": 499, "jupiter": 599, "saturn": 699, "uranus": 799, "neptune": 899, "pluto": 999}
GM = {"mars": 42828.37, "jupiter": 126686534, "saturn": 37931187, "uranus": 5793939, "neptune": 6836529, "pluto": 975.5}  # km³/s², system
POLES = {"uranus": (257.311, -15.175), "pluto": (132.993, -6.163), "neptune": (299.36, 43.46)}  # must match sol.ts
J0, J1, JB = 2461041.5, 2461317.5, 2451545.0  # anchor, check, back-fit
D = math.pi / 180
EPS = 23.4392911 * D


def table(url: str) -> list[list[str]]:
    page = urllib.request.urlopen(url, timeout=60).read().decode()
    return [[re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip()
             for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)]


def num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return None


def horizons(planet: str, code: str) -> dict[float, list[float]] | None:
    q = {"format": "json", "COMMAND": f"'{code}'", "EPHEM_TYPE": "VECTORS", "CENTER": f"'500@{CENTER[planet]}'",
         "TLIST": f"'{J0}' '{J1}' '{JB}'", "VEC_TABLE": "2", "OUT_UNITS": "KM-D", "REF_PLANE": "ECLIPTIC", "CSV_FORMAT": "YES"}
    for attempt in range(4):
        try:
            r = json.load(urllib.request.urlopen("https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q), timeout=60))["result"]
            if "$$SOE" not in r:
                return None
            lines = r.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
            return {round(float(l.split(",")[0]), 1): [float(x) for x in l.split(",")[2:8]] for l in lines}
        except Exception:
            time.sleep(2 + 3 * attempt)
    return None


# ── geometry (mirrors sol.ts) ────────────────────────────────────────────────

def rot(xp, yp, w, O, I):
    cw, sw, cO, sO, cI, sI = math.cos(w), math.sin(w), math.cos(O), math.sin(O), math.cos(I), math.sin(I)
    return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
            (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp]


def from_plane(v, pole):
    if not pole:
        return v
    ti, tn = (90 - pole[1]) * D, (pole[0] + 90) * D
    y1, z1 = v[1] * math.cos(ti) - v[2] * math.sin(ti), v[1] * math.sin(ti) + v[2] * math.cos(ti)
    x2, y2 = v[0] * math.cos(tn) - y1 * math.sin(tn), v[0] * math.sin(tn) + y1 * math.cos(tn)
    return [x2, y2 * math.cos(EPS) + z1 * math.sin(EPS), -y2 * math.sin(EPS) + z1 * math.cos(EPS)]


def to_plane(v, pole):
    if not pole:
        return v
    x, y, z = v
    y, z = y * math.cos(EPS) - z * math.sin(EPS), y * math.sin(EPS) + z * math.cos(EPS)
    ti, tn = (90 - pole[1]) * D, (pole[0] + 90) * D
    x, y = x * math.cos(tn) + y * math.sin(tn), -x * math.sin(tn) + y * math.cos(tn)
    return [x, y * math.cos(ti) + z * math.sin(ti), -y * math.sin(ti) + z * math.cos(ti)]


def kepler(M, e):
    M = (M + math.pi) % (2 * math.pi) - math.pi
    E = M + e * math.sin(M)
    for _ in range(50):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    return E


def pole_of(r):
    return (r[11], r[12]) if r[13] == 1 else POLES.get(r[1]) if r[13] == 2 else None


def rates(r):
    wd = 360 / r[9] / 365.25 if r[9] else 0
    Od = -360 / r[10] / 365.25 if r[10] else 0
    return 360 / r[8] - wd - Od, wd, Od  # P is sidereal: the mean longitude goes round once per P


def at(r, JD):
    Md, wd, Od = rates(r)
    d = JD - r[14]
    a, e = r[2], r[3]
    E = kepler((r[5] + Md * d) * D, e)
    return from_plane(rot(a * (math.cos(E) - e), a * math.sqrt(1 - e * e) * math.sin(E), (r[4] + wd * d) * D, (r[7] + Od * d) * D, r[6] * D), pole_of(r))


def anchor(r, v):
    """re-epoch a row at J0 so the moon sits where Horizons has it"""
    _, wd, Od = rates(r)
    d = J0 - r[14]
    w, O, I = r[4] + wd * d, r[7] + Od * d, r[6] * D
    x, y, z = to_plane(v, pole_of(r))
    x1, y1 = x * math.cos(O * D) + y * math.sin(O * D), -x * math.sin(O * D) + y * math.cos(O * D)
    u = math.atan2(y1 * math.cos(I) + z * math.sin(I), x1) / D
    e, nu = r[3], (u - w) * D
    E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    out = list(r)
    out[4], out[5], out[7], out[14] = round(w % 360, 4), round((E - e * math.sin(E)) / D % 360, 4), round(O % 360, 4), J0
    return out


def wrap(x):
    return (x + 180) % 360 - 180


def measure_rate(r, st):
    """the row with P replaced by the sidereal period measured from Horizons, for regular moons; else None"""
    if r[8] > 100 or r[6] > 30 or JB not in st or J1 not in st:
        return None
    lon = lambda v: math.degrees(math.atan2(*to_plane(v, pole_of(r))[1::-1]))
    wd = 360 / r[9] / 365.25 if r[9] else 0
    Od = -360 / r[10] / 365.25 if r[10] else 0
    cands = [360 / r[8], 360 / r[8] + wd + Od]  # the table's P read as sidereal or as anomalistic
    l0, l1, lb = lon(st[J0][:3]), lon(st[J1][:3]), lon(st[JB][:3])
    # coarse rate over nine months (whole turns resolved by the table), then refined over 26 years
    d1 = wrap(l1 - l0)
    coarse = min(((k * 360 + d1) / (J1 - J0) for c in cands for k in [round(c * (J1 - J0) / 360) + j for j in (-1, 0, 1)]),
                 key=lambda n: min(abs(n - c) for c in cands))
    db, span = wrap(l0 - lb), J0 - JB
    n = (round((coarse * span - db) / 360) * 360 + db) / span
    out = list(r)
    out[8] = round(360 / n, 9)
    return out


def osculating(r, s):
    """two-body elements in the ecliptic frame from a Horizons state (km, km/day)"""
    mu = GM[r[1]] * 86400 ** 2
    rv, vv = s[:3], s[3:]
    rn, v2 = math.hypot(*rv), sum(x * x for x in vv)
    h = [rv[1] * vv[2] - rv[2] * vv[1], rv[2] * vv[0] - rv[0] * vv[2], rv[0] * vv[1] - rv[1] * vv[0]]
    hn = math.hypot(*h)
    rdv = sum(a * b for a, b in zip(rv, vv))
    ev = [((v2 - mu / rn) * rv[k] - rdv * vv[k]) / mu for k in range(3)]
    e, a = math.hypot(*ev), 1 / (2 / rn - v2 / mu)
    if a <= 0 or e >= 1:
        return None
    hx = [x / hn for x in h]
    O = math.atan2(h[0], -h[1])
    node = [math.cos(O), math.sin(O), 0]
    cross = lambda p, q: [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
    dot = lambda p, q: sum(x * y for x, y in zip(p, q))
    w = math.atan2(dot(ev, cross(hx, node)), dot(ev, node))
    nu = math.atan2(dot(rv, cross(hx, ev)) / e, dot(rv, ev) / e)
    E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
    out = list(r)
    out[2:9] = [round(a, 1), round(e, 6), round(math.degrees(w) % 360, 4), round(math.degrees(E - e * math.sin(E)) % 360, 4),
                round(math.degrees(math.acos(h[2] / hn)), 4), round(math.degrees(O) % 360, 4), round(2 * math.pi / math.sqrt(mu / a ** 3), 6)]
    out[9:15] = [None, None, None, None, 0, J0]
    return out


def angle(p, q):
    c = sum(a * b for a, b in zip(p, q)) / math.hypot(*p) / math.hypot(*q)
    return math.degrees(math.acos(max(-1, min(1, c))))


def main() -> None:
    radius = {}
    for c in table("https://ssd.jpl.nasa.gov/sats/phys_par/"):
        if len(c) >= 5 and c[0] and c[1] and (r := num(c[4].split(" ")[0])) is not None:
            radius[(c[0], c[1])] = r
    seen, rows = set(), []
    for c in table("https://ssd.jpl.nasa.gov/sats/elem/"):
        if len(c) < 19 or not c[0].isdigit() or (c[1], c[2]) in seen:  # a few moons appear under two ephemerides
            continue
        seen.add((c[1], c[2]))
        f = [num(x) for x in c[7:18]]
        rows.append(([c[2], c[1].lower(), f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7] or None, f[8] or None,
                      f[9], f[10], FRAME[c[5]], EPOCH[c[6]], radius.get((c[1], c[2]))], c[3]))

    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [(r, code) for r, code in rows if r[1] != "earth" and f"{r[1]}/{r[0]}" not in cache]
    with cf.ThreadPoolExecutor(4) as ex:
        for (r, _), st in zip(todo, ex.map(lambda rc: horizons(rc[0][1], rc[1]), todo)):
            if st:
                cache[f"{r[1]}/{r[0]}"] = {str(k): v for k, v in st.items()}
    CACHE.write_text(json.dumps(cache))

    out, errs = [], {}
    for r, _ in rows:
        raw = cache.get(f"{r[1]}/{r[0]}")
        if r[1] == "earth" or not raw:  # the Moon has its own series in sol.ts; a moon Horizons lacks keeps its table row
            out.append(r)
            continue
        st = {float(k): v for k, v in raw.items()}
        fit = measure_rate(r, st)
        row = anchor(fit, st[J0][:3]) if fit else osculating(r, st[J0]) or anchor(r, st[J0][:3])
        out.append(row)
        if J1 in st:
            errs.setdefault((r[1], "regular" if fit else "irregular"), []).append(angle(at(row, J1), st[J1][:3]))
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(out)} moons → {OUT}")
    for (planet, kind), e in sorted(errs.items()):
        e.sort()
        print(f"  {planet:8} {kind:9} {len(e):3}  error after 9 months: median {statistics.median(e):.2f}°, max {e[-1]:.1f}°")


if __name__ == "__main__":
    main()
