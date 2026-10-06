"""Shell:B agent roster and settings management."""
import db
from defaults import DEFAULT_AGENTS, DEFAULT_SETTINGS


def get_settings():
    return {**DEFAULT_SETTINGS, **db.kv_get("settings", {})}


def get_agents():
    stored = db.kv_get("agents")
    if stored is None:
        return [dict(a) for a in DEFAULT_AGENTS]
    ids = {a["id"] for a in stored}
    # new built-ins shipped after the user customised their roster still appear
    return stored + [dict(a) for a in DEFAULT_AGENTS if a["id"] not in ids and a["id"] not in db.kv_get("deleted_agents", [])]


def find_agent(agent_id):
    agents = get_agents()
    return next((a for a in agents if a["id"] == agent_id), agents[0]), agents
