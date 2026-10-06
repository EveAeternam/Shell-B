// Themes. Each one is a stylesheet in this folder scoped to html[data-skin='<id>'] that overrides the CSS variables (and,
// if it likes, the chrome) of the base look in index.css. Classic *is* that base, so it sets no data-skin at all.
// Light/dark is a separate switch (the html class); a theme that has no light design falls back to Classic light.
//
// To add a theme: write <id>.css here, import it below, and add an entry to THEMES. index.html's boot script repeats the
// theme ids and DEFAULT_THEME so the right theme paints before React loads: keep the two in step.
//
// The choice lives in localStorage ('shellb.skin', the old skin key, so existing picks carry over). When the server's
// settings know a `theme` key it is also saved there, and the server's value wins on load so it follows you across devices.
import { useSyncExternalStore } from 'react';
import './synthwave.css';
import './synthfield.css';

export type ThemeId = 'synthfield' | 'synthwave' | 'classic';
export type Mode = 'dark' | 'light';

/** Colours for the picker's thumbnail: page, panel, text, then the theme's accent inks (drawn as a stripe). */
export interface Swatch { bg: string; panel: string; text: string; inks: string[] }

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  blurb: string;
  modes: Mode[];
  /** heading face for the thumbnail */
  font?: string;
  /** square corners in the thumbnail */
  hard?: boolean;
  swatch: Partial<Record<Mode, Swatch>>;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'synthfield', label: 'Synthfield', modes: ['dark', 'light'], hard: true, font: "'Barlow Condensed', sans-serif",
    blurb: 'Synthwave night drawn like a Starfield ship console: hard panels, condensed caps, the sunset stripe.',
    swatch: {
      dark: { bg: '#0a0d1f', panel: '#10142b', text: '#f1ecdf', inks: ['#3d7bff', '#ff3d7f', '#ff7a2f', '#ffc23d'] },
      light: { bg: '#ebe6d9', panel: '#f6f2e8', text: '#15172a', inks: ['#3d7bff', '#ff3d7f', '#ff7a2f', '#ffc23d'] },
    },
  },
  {
    id: 'synthwave', label: 'Synthwave', modes: ['dark'],
    blurb: 'Neon violet and hot pink on deep indigo, a sunset gradient and a glowing grid floor.',
    swatch: { dark: { bg: '#120a24', panel: '#190e33', text: '#f6ecff', inks: ['#a855f7', '#ff2e97', '#ff7a3d', '#22d3ee'] } },
  },
  {
    id: 'classic', label: 'Classic', modes: ['dark', 'light'],
    blurb: 'The original warm neutral look with terracotta accents. Quiet, no backdrop.',
    swatch: {
      dark: { bg: '#191919', panel: '#202020', text: '#f0eee9', inks: ['#c96442', '#da7756'] },
      light: { bg: '#faf8f5', panel: '#f3efe9', text: '#1a1815', inks: ['#b5532f', '#c96442'] },
    },
  },
];

export const DEFAULT_THEME: ThemeId = 'synthfield';
const KEY = 'shellb.skin';

export const themeInfo = (id: string) => THEMES.find(t => t.id === id);

export function currentTheme(): ThemeId {
  const s = document.documentElement.dataset.skin;
  return s && themeInfo(s) ? (s as ThemeId) : 'classic';
}

const listeners = new Set<() => void>();

export function setTheme(id: ThemeId) {
  if (!themeInfo(id)) return;
  const el = document.documentElement;
  if (id === 'classic') delete el.dataset.skin; else el.dataset.skin = id;
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  listeners.forEach(l => l());
}

export function nextTheme(): ThemeId {
  const i = THEMES.findIndex(t => t.id === currentTheme());
  return THEMES[(i + 1) % THEMES.length].id;
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** The active theme, re-rendering when it changes. */
export function useTheme(): ThemeId { return useSyncExternalStore(subscribe, currentTheme); }
