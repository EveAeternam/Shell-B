import { useEffect, useSyncExternalStore } from 'react';

/** What can be starred. Artifacts are (ref = conversation id, sub = artifact id); everything else is just ref. */
export type FavKind = 'chat' | 'artifact' | 'project' | 'group' | 'research' | 'plan';

export interface Favorite {
  kind: FavKind;
  ref: string;
  sub: string;
  title: string;
  subtitle: string;
  href: string;
  createdAt: number;
  updatedAt?: number;
  agentId?: string;
  type?: string; // artifact type, or Studio/Code project kind
  emoji?: string;
  color?: string;
  status?: string;
  version?: number;
}

export const FAV_LABEL: Record<FavKind, string> = {
  chat: 'Chats', artifact: 'Artifacts', project: 'Studio & Code', group: 'Projects', research: 'Research', plan: 'Mega Plans',
};

export const favKey = (kind: FavKind, ref: string, sub = '') => `${kind}:${ref}:${sub}`;

// One shared list for the whole app, so every star stays in sync.
let items: Favorite[] = [];
let keys = new Set<string>();
let loading: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function set(next: Favorite[]) {
  items = next;
  keys = new Set(next.map(f => favKey(f.kind, f.ref, f.sub)));
  loaded = true;
  listeners.forEach(l => l());
}

async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
  set(await r.json());
}

/** Re-read from the server (titles change when things are renamed; deleted targets drop out). */
export function refreshFavorites() {
  loading ??= call('/api/favorites').catch(() => {}).finally(() => { loading = null; });
  return loading;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useFavorites() {
  const list = useSyncExternalStore(subscribe, () => items);
  useEffect(() => { if (!loaded) refreshFavorites(); }, []);
  return list;
}

export function useIsFavorite(kind: FavKind, ref: string, sub = '') {
  useFavorites();
  return keys.has(favKey(kind, ref, sub));
}

export function isFavorite(kind: FavKind, ref: string, sub = '') {
  return keys.has(favKey(kind, ref, sub));
}

/** Star or unstar. Optimistic: the star flips at once and the server's list replaces it when it answers. */
export async function setFavorite(kind: FavKind, ref: string, sub: string, on: boolean, title = '') {
  const before = items;
  if (on) set([{ kind, ref, sub, title, subtitle: '', href: '#/', createdAt: Date.now() }, ...items]);
  else set(items.filter(f => favKey(f.kind, f.ref, f.sub) !== favKey(kind, ref, sub)));
  try {
    if (on) await call('/api/favorites', { method: 'POST', body: JSON.stringify({ kind, ref, sub }) });
    else await call(`/api/favorites?${new URLSearchParams({ kind, ref, sub })}`, { method: 'DELETE' });
  } catch {
    set(before);
  }
}

export function reorderFavorites(next: Favorite[]) {
  set(next);
  return call('/api/favorites/order', { method: 'POST', body: JSON.stringify({ keys: next.map(f => favKey(f.kind, f.ref, f.sub)) }) })
    .catch(() => refreshFavorites());
}
