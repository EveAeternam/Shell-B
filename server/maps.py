"""Offline maps: PMTiles basemaps for Earth and other worlds, plus the glyphs and sprites the Earth style needs.

Everything lives outside the repo in ~/shellb/maps (it's ~140 GB):
  planet.pmtiles            Protomaps planet build (vector, OSM), symlink to <date>.pmtiles; <date>.pmtiles.part while downloading
  bodies/catalog.json       other planets and moons: raster mosaics reprojected to Web Mercator, one <id>.pmtiles each
  assets/fonts, assets/sprites   from protomaps/basemaps-assets
MapLibre reads the .pmtiles files with HTTP range requests, which FileResponse serves.
"""
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/maps")

ROOT = Path.home() / "shellb" / "maps"
BODIES = ROOT / "bodies"
ASSETS = ROOT / "assets"
PLANET_BYTES = 138_547_794_382  # 20261003 build; only used for the download progress bar

EARTH = {"id": "earth", "name": "Earth", "kind": "planet", "parent": None, "radius_km": 6371, "type": "vector",
         "minzoom": 0, "maxzoom": 15, "attribution": "© OpenStreetMap contributors, Protomaps",
         "description": "OpenStreetMap vector basemap, street level worldwide"}

_ID = re.compile(r"^[a-z0-9_-]{1,40}$")


def _bodies() -> list[dict]:
    try:
        cat = json.loads((BODIES / "catalog.json").read_text())
    except (OSError, ValueError):
        return []
    out = []
    for b in cat if isinstance(cat, list) else []:
        if isinstance(b, dict) and _ID.match(str(b.get("id", ""))) and b["id"] != "earth":
            f = BODIES / str(b.get("file") or f"{b['id']}.pmtiles")
            out.append({**b, "type": "raster", "available": f.is_file(), "_path": f})
    return out


def _earth() -> dict:
    planet = ROOT / "planet.pmtiles"
    if planet.exists():
        return {**EARTH, "available": True}
    part = next(iter(sorted(ROOT.glob("*.pmtiles.part"))), None)
    progress = min(part.stat().st_size / PLANET_BYTES, 0.999) if part else None
    return {**EARTH, "available": False, "downloading": progress}


def prompt_note(base: str) -> str:
    """The agent prompt's map section, plus which worlds are installed right now."""
    names = [b["id"] for b in [_earth(), *_bodies()] if b["available"] or b.get("downloading") is not None]
    return base + ("\nInstalled worlds: " + ", ".join(names) + "." if names else "")


@router.get("/catalog")
def catalog():
    return {"bodies": [_earth(), *({k: v for k, v in b.items() if k != "_path"} for b in _bodies())]}


@router.get("/tiles/{body}.pmtiles")
def tiles(body: str):
    if body == "earth":
        path = ROOT / "planet.pmtiles"
    else:
        path = next((b["_path"] for b in _bodies() if b["id"] == body), None)
    if not path or not path.is_file():
        raise HTTPException(404, "no tiles for that body yet")
    # immutable per build; MapLibre asks for small byte ranges, which FileResponse answers with 206
    return FileResponse(path.resolve(), media_type="application/octet-stream",
                        headers={"Cache-Control": "public, max-age=86400"})


@router.get("/fonts/{stack}/{rng}.pbf")
def glyphs(stack: str, rng: str):
    # MapLibre asks for "Noto Sans Regular,Noto Sans Medium" style stacks; the first font we have wins
    if not re.match(r"^\d+-\d+$", rng):
        raise HTTPException(404)
    for name in stack.split(","):
        name = name.strip()
        if re.match(r"^[\w .-]{1,80}$", name) and ".." not in name:
            f = ASSETS / "fonts" / name / f"{rng}.pbf"
            if f.is_file():
                return FileResponse(f, media_type="application/x-protobuf", headers={"Cache-Control": "public, max-age=604800"})
    raise HTTPException(404)


@router.get("/sprites/{version}/{name}")
def sprites(version: str, name: str):
    if not re.match(r"^v\d+$", version) or not re.match(r"^[a-z]+(@2x)?\.(json|png)$", name):
        raise HTTPException(404)
    f = ASSETS / "sprites" / version / name
    if not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, headers={"Cache-Control": "public, max-age=604800"})
