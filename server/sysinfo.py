"""System info for Settings → System: host, CPU, GPU, memory, disks and what Shell:B's stack keeps on them.

GET /api/system is polled only while that tab is open (the global /api/status poll stays light). Folder sizes come
from `du`, cached for a minute because model folders hold hundreds of GB.
"""
import asyncio
import os
import platform
import re
import shutil
import socket
import subprocess
import time

import httpx
from pathlib import Path

from fastapi import APIRouter

import db

router = APIRouter()
HOME = Path.home()
STARTED = time.time()
REAL_FS = {"ext4", "ext3", "xfs", "btrfs", "zfs", "f2fs", "vfat", "exfat", "ntfs", "ntfs3", "fuseblk", "nfs", "nfs4", "cifs"}
# where the stack keeps its bulk, largest first in practice
FOLDERS = [
    ("Ollama models", Path("/usr/share/ollama/.ollama/models")),
    ("Ollama models (user)", HOME / ".ollama/models"),
    ("ComfyUI models", HOME / "comfyui/models"),
    ("Hugging Face cache", HOME / ".cache/huggingface"),
    ("Shell:B folder (code, venvs, services and data)", HOME / "shellb"),
]
_sizes: dict[str, tuple[float, int | None]] = {}  # path → (when, bytes)
SIZE_TTL = 60


def _run(cmd: list[str], timeout=5) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def _du(p: Path) -> int | None:
    hit = _sizes.get(str(p))
    if hit and time.time() - hit[0] < SIZE_TTL:
        return hit[1]
    out = _run(["du", "-sb", str(p)], timeout=60)
    size = int(out.split()[0]) if out.split() and out.split()[0].isdigit() else None
    _sizes[str(p)] = (time.time(), size)
    return size


def _meminfo() -> dict:
    vals = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        k, v = line.split(":", 1)
        vals[k] = int(v.split()[0]) * 1024
    return {"total": vals.get("MemTotal", 0), "available": vals.get("MemAvailable", 0),
            "swapTotal": vals.get("SwapTotal", 0), "swapFree": vals.get("SwapFree", 0)}


def _cpu_times():
    f = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
    nums = [int(x) for x in f]
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    return idle, sum(nums)


async def _cpu() -> dict:
    i0, t0 = _cpu_times()
    await asyncio.sleep(0.25)
    i1, t1 = _cpu_times()
    usage = 100 * (1 - (i1 - i0) / max(1, t1 - t0))
    models = []
    for line in _run(["lscpu"]).splitlines():
        if line.startswith("Model name:"):
            models.append(line.split(":", 1)[1].strip())
    temps = []
    for z in Path("/sys/class/thermal").glob("thermal_zone*"):
        try:
            temps.append(int((z / "temp").read_text()) / 1000)
        except Exception:
            pass
    return {"model": " + ".join(dict.fromkeys(models)) or platform.processor() or platform.machine(),
            "cores": os.cpu_count(), "usage": round(usage, 1), "load": list(os.getloadavg()),
            "temp": round(max(temps), 1) if temps else None}


def _num(s: str):
    s = s.strip()
    try:
        return float(s)
    except ValueError:
        return None


def _gpus() -> list[dict]:
    q = "name,driver_version,temperature.gpu,utilization.gpu,power.draw,memory.used,memory.total,clocks.sm"
    out = _run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"])
    cuda = re.search(r"CUDA Version:\s*([\d.]+)", _run(["nvidia-smi"]))
    gpus = []
    for line in out.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) < 8:
            continue
        mu, mt = _num(f[5]), _num(f[6])
        gpus.append({"name": f[0], "driver": f[1], "cuda": cuda.group(1) if cuda else None, "temp": _num(f[2]),
                     "util": _num(f[3]), "power": _num(f[4]), "clockMHz": _num(f[7]),
                     # GB10 shares system memory, so nvidia-smi reports no VRAM of its own
                     "memUsed": mu * 1024 * 1024 if mu is not None else None,
                     "memTotal": mt * 1024 * 1024 if mt is not None else None})
    return gpus


def _disks() -> list[dict]:
    seen, out = set(), []
    for line in Path("/proc/mounts").read_text().splitlines():
        dev, mnt, fs = line.split()[:3]
        mnt = mnt.replace("\\040", " ")
        if fs not in REAL_FS or mnt.startswith(("/snap", "/var/snap", "/run")):
            continue
        try:
            st = os.stat(mnt)
            u = shutil.disk_usage(mnt)
        except OSError:
            continue
        if st.st_dev in seen:
            continue
        seen.add(st.st_dev)
        out.append({"mount": mnt, "device": dev, "fs": fs, "total": u.total, "used": u.used, "free": u.free})
    return sorted(out, key=lambda d: -d["total"])


def _docker() -> dict | None:
    out = _run(["docker", "system", "df", "--format", "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"], timeout=10)
    rows = [line.split("\t") for line in out.strip().splitlines() if line.count("\t") == 2]
    return {"rows": [{"type": t, "size": s, "reclaimable": r} for t, s, r in rows]} if rows else None


def _storage() -> list[dict]:
    """Big folders of the stack plus Shell:B's own data, with sizes."""
    items = []
    for label, p in FOLDERS:
        if p.is_dir():
            items.append({"label": label, "path": str(p), "size": _du(p)})
    data = db.DATA
    subs = []
    for d in sorted(data.iterdir()) if data.is_dir() else []:
        size = _du(d) if d.is_dir() else d.stat().st_size
        if size:
            subs.append({"label": d.name, "path": str(d), "size": size})
    subs.sort(key=lambda x: -(x["size"] or 0))
    items.append({"label": "Shell:B data", "path": str(data), "size": _du(data), "children": subs[:12]})
    return items


def _host() -> dict:
    os_name = ""
    try:
        m = re.search(r'^PRETTY_NAME="?([^"\n]+)', Path("/etc/os-release").read_text(), re.M)
        os_name = m.group(1) if m else ""
    except OSError:
        pass
    ips = _run(["hostname", "-I"]).split()
    ts = _run(["tailscale", "ip", "-4"]).strip().splitlines()
    lan = [ip for ip in ips if ":" not in ip and not ip.startswith(("172.17.", "172.18.", "172.19.", "172.2", "100."))]
    return {"hostname": socket.gethostname(), "os": os_name, "kernel": platform.release(), "arch": platform.machine(),
            "uptime": float(Path("/proc/uptime").read_text().split()[0]), "python": platform.python_version(),
            "lan": lan, "tailscale": ts[0] if ts else None, "appUptime": time.time() - STARTED,
            "dbSize": dbf.stat().st_size if (dbf := db.DATA / "shellb.db").exists() else None}


@router.get("/api/system")
async def system():
    cpu, gpus, disks, storage, docker, host = await asyncio.gather(
        _cpu(), asyncio.to_thread(_gpus), asyncio.to_thread(_disks), asyncio.to_thread(_storage),
        asyncio.to_thread(_docker), asyncio.to_thread(_host))
    return {"host": host, "cpu": cpu, "gpus": gpus, "memory": _meminfo(), "disks": disks, "storage": storage,
            "docker": docker, "at": time.time() * 1000}


async def _ollama_ps() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get("http://localhost:11434/api/ps")
            return [{"name": m.get("name"), "size": m.get("size_vram") or m.get("size"), "until": m.get("expires_at")}
                    for m in r.json().get("models", [])]
    except Exception:
        return []


@router.get("/api/system/live")
async def system_live():
    """The cheap subset of /api/system for the ```system``` chat card, which polls every few seconds."""
    cpu, gpus, models = await asyncio.gather(_cpu(), asyncio.to_thread(_gpus), _ollama_ps())
    root = shutil.disk_usage("/")
    return {"cpu": {k: cpu[k] for k in ("usage", "temp", "load", "cores")}, "gpu": gpus[0] if gpus else None,
            "memory": _meminfo(), "disk": {"total": root.total, "used": root.used}, "models": models,
            "host": platform.node(), "at": time.time() * 1000}
