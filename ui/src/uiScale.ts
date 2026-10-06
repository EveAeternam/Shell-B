// UI scale: zooms the whole interface (text, icons, spacing) from Settings → General. Per browser (localStorage), so a
// phone and a desktop can differ. Done with CSS `zoom` on <html> because much of the UI is sized in px, which a root
// font-size change would miss. index.html's boot script applies the saved value before first paint: keep KEY in step.
import { useSyncExternalStore } from 'react';

const KEY = 'shellb.uiscale';
export const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const clamp = (n: number) => (Number.isFinite(n) ? Math.min(2, Math.max(0.75, n)) : 1);

export function loadScale(): number {
  try { return clamp(parseFloat(localStorage.getItem(KEY) || '1')); } catch { return 1; }
}

export function applyScale(s: number) {
  document.documentElement.style.zoom = s === 1 ? '' : String(s);
}

const listeners = new Set<() => void>();

export function setScale(s: number) {
  s = clamp(s);
  try { localStorage.setItem(KEY, String(s)); } catch { /* private mode */ }
  applyScale(s);
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { applyScale(loadScale()); l(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}

export function useScale(): number { return useSyncExternalStore(subscribe, loadScale); }
