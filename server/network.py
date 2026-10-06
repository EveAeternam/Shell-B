"""Network info endpoint for Settings → Network: Wi-Fi, Ethernet, VPN/Tunnels, Gateway, DNS, and Tailscale.

GET /api/network returns real-time status of Linux network interfaces on this machine.
"""
import asyncio
import json
import os
import re
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()


def _run(cmd: list[str], timeout: float = 3.0) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def _get_network_data() -> dict:
    res = {
        "timestamp": time.time() * 1000,
        "defaultGateway": None,
        "dns": [],
        "wifi": [],
        "wired": [],
        "vpn": [],
        "tailscale": None,
    }

    # 1. Default Route / Gateway
    route_out = _run(["ip", "-j", "route", "show", "default"])
    if route_out:
        try:
            routes = json.loads(route_out)
            if routes and isinstance(routes, list):
                res["defaultGateway"] = {
                    "gateway": routes[0].get("gateway"),
                    "interface": routes[0].get("dev"),
                    "prefsrc": routes[0].get("prefsrc"),
                }
        except Exception:
            pass

    # 2. DNS Resolvers (resolvectl then /etc/resolv.conf)
    dns_servers = []
    rc_out = _run(["resolvectl", "dns"])
    if rc_out:
        for line in rc_out.splitlines():
            if ":" in line:
                parts = line.split(":", 1)[1].strip().split()
                for p in parts:
                    if p not in dns_servers:
                        dns_servers.append(p)
    if not dns_servers:
        try:
            resolv = Path("/etc/resolv.conf").read_text()
            for line in resolv.splitlines():
                if line.strip().startswith("nameserver"):
                    s = line.strip().split()[1]
                    if s not in dns_servers:
                        dns_servers.append(s)
        except Exception:
            pass
    res["dns"] = dns_servers

    # 3. Tailscale Status
    ts_json = _run(["tailscale", "status", "--json"])
    if ts_json:
        try:
            ts_data = json.loads(ts_json)
            self_node = ts_data.get("Self", {})
            res["tailscale"] = {
                "backendState": ts_data.get("BackendState"),
                "version": ts_data.get("Version"),
                "ips": ts_data.get("TailscaleIPs", []),
                "dnsName": self_node.get("DNSName", "").rstrip("."),
                "hostName": self_node.get("HostName"),
                "online": self_node.get("Online", True),
                "tun": ts_data.get("TUN", True),
            }
        except Exception:
            pass

    # 4. Interface details via `ip -j addr show`
    ip_out = _run(["ip", "-j", "addr", "show"])
    ifaces = []
    if ip_out:
        try:
            ifaces = json.loads(ip_out)
        except Exception:
            pass

    # nmcli device status to identify Wi-Fi connection state
    wifi_status_out = _run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "dev"])
    wifi_map = {}
    for line in wifi_status_out.splitlines():
        parts = line.split(":")
        if len(parts) >= 4 and parts[1] == "wifi":
            wifi_map[parts[0]] = {"state": parts[2], "connection": parts[3]}

    for iface in ifaces:
        name = iface.get("ifname", "")
        if not name or name == "lo":
            continue

        sys_path = Path("/sys/class/net") / name
        is_wireless = (sys_path / "wireless").is_dir() or (sys_path / "phy80211").is_dir() or name in wifi_map
        is_vpn = (
            name.startswith(("tun", "tap", "wg", "tailscale", "zt"))
            or iface.get("link_type") == "none"
        )
        is_bridge = name.startswith(("br-", "docker", "virbr"))
        is_veth = name.startswith("veth")

        # Skip virtual containers/bridges from main 3 categories to keep UI clean
        if is_bridge or is_veth:
            continue

        # Operstate and carrier
        operstate = "unknown"
        if (sys_path / "operstate").is_file():
            try:
                operstate = (sys_path / "operstate").read_text().strip()
            except Exception:
                pass

        carrier = False
        if (sys_path / "carrier").is_file():
            try:
                carrier = (sys_path / "carrier").read_text().strip() == "1"
            except Exception:
                pass

        # Ethernet Speed
        speed = None
        if (sys_path / "speed").is_file():
            try:
                s = int((sys_path / "speed").read_text().strip())
                if s > 0:
                    speed = f"{s} Mbps"
            except Exception:
                pass

        # Duplex
        duplex = None
        if (sys_path / "duplex").is_file():
            try:
                duplex = (sys_path / "duplex").read_text().strip()
            except Exception:
                pass

        # Traffic stats
        rx_bytes, tx_bytes = 0, 0
        if (sys_path / "statistics/rx_bytes").is_file():
            try:
                rx_bytes = int((sys_path / "statistics/rx_bytes").read_text().strip())
                tx_bytes = int((sys_path / "statistics/tx_bytes").read_text().strip())
            except Exception:
                pass

        # IP addresses
        ipv4, ipv6 = [], []
        for addr in iface.get("addr_info", []):
            fam = addr.get("family")
            loc = addr.get("local")
            plen = addr.get("prefixlen")
            if fam == "inet" and loc:
                ipv4.append(f"{loc}/{plen}")
            elif fam == "inet6" and loc:
                ipv6.append(f"{loc}/{plen}")

        mac = iface.get("address", "")
        flags = iface.get("flags", [])
        is_up = "UP" in flags and operstate != "down"

        item = {
            "interface": name,
            "operstate": operstate,
            "connected": carrier or (is_up and (bool(ipv4) or name.startswith("tailscale"))),
            "mac": mac,
            "ipv4": ipv4,
            "ipv6": ipv6,
            "rxBytes": rx_bytes,
            "txBytes": tx_bytes,
        }

        if is_wireless:
            nm_info = wifi_map.get(name, {})
            ssid = nm_info.get("connection") if nm_info.get("connection") != "--" else ""
            item["ssid"] = ssid
            item["type"] = "Wi-Fi"
            # Query iw dev link for signal and frequency
            iw_link = _run(["iw", "dev", name, "link"])
            if "SSID:" in iw_link:
                m = re.search(r"SSID:\s*(.+)", iw_link)
                if m:
                    item["ssid"] = m.group(1).strip()
            if "freq:" in iw_link:
                m = re.search(r"freq:\s*(\d+)", iw_link)
                if m:
                    item["frequency"] = f"{int(m.group(1)) / 1000:.1f} GHz"
            if "signal:" in iw_link:
                m = re.search(r"signal:\s*([-\d]+)\s*dBm", iw_link)
                if m:
                    item["signalDbm"] = int(m.group(1))
            res["wifi"].append(item)
        elif is_vpn:
            vpn_type = "Tailscale" if "tailscale" in name else "WireGuard" if name.startswith("wg") else "TUN/TAP"
            item["type"] = vpn_type
            res["vpn"].append(item)
        else:
            if speed:
                item["speed"] = speed
            if duplex:
                item["duplex"] = duplex
            item["type"] = "Ethernet"
            res["wired"].append(item)

    return res


@router.get("/api/network")
async def get_network():
    return await asyncio.to_thread(_get_network_data)
