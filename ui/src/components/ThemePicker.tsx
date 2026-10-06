import clsx from 'clsx';
import { Check, Moon, Sun } from 'lucide-react';
import type { Settings } from '../types';
import { api } from '../api';
import { THEMES, setTheme, useTheme, type Mode, type Swatch, type ThemeId, type ThemeInfo } from '../themes';
import { btn } from './common';

/** A tiny drawing of the app in a theme's colours: rail, sidebar, a title, the stripe, a primary button. */
function Thumb({ t, mode }: { t: ThemeInfo; mode: Mode }) {
  const s: Swatch = t.swatch[mode] ?? t.swatch.dark!;
  const r = t.hard ? 1 : 5;
  const stripe = s.inks.length > 1
    ? `linear-gradient(90deg, ${s.inks.map((c, i) => `${c} ${(i / s.inks.length) * 100}% ${((i + 1) / s.inks.length) * 100}%`).join(', ')})`
    : s.inks[0];
  const button = `linear-gradient(100deg, ${s.inks.slice(t.id === 'synthfield' ? 1 : 0).join(', ')})`;
  return (
    <div className="relative h-[84px] w-full overflow-hidden" style={{ background: s.bg, borderRadius: r }} aria-hidden>
      <div className="absolute inset-y-0 left-0 w-[14%]" style={{ background: s.panel, borderRight: `1px solid ${s.text}1a` }} />
      <div className="absolute inset-y-0 left-[14%] w-[26%]" style={{ background: s.panel, opacity: 0.6 }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="mx-[10%] mt-[9px] h-[3px]" style={{ background: s.text, opacity: i ? 0.25 : 0.5, borderRadius: r }} />)}
      </div>
      <div className="absolute left-[48%] top-[18px] text-[11px] font-semibold leading-none"
        style={{ color: s.text, fontFamily: t.font, letterSpacing: t.hard ? '0.14em' : 0, textTransform: t.hard ? 'uppercase' : undefined }}>
        Good evening
      </div>
      <div className="absolute left-[48%] top-[34px] h-[3px] w-[22%]" style={{ background: stripe }} />
      <div className="absolute left-[48%] right-[8%] top-[46px] h-[10px]" style={{ background: s.panel, border: `1px solid ${s.text}22`, borderRadius: r }} />
      <div className="absolute right-[8%] bottom-[9px] h-[11px] w-[22%]"
        style={{ background: button, borderRadius: t.hard ? 0 : 999, clipPath: t.hard ? 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 0 100%)' : undefined }} />
    </div>
  );
}

/** Settings → General: pick a theme (applies at once) and light or dark. */
export function ThemePicker({ settings, mode, onMode }: { settings?: Settings; mode: Mode; onMode: (m: Mode) => void }) {
  const current = useTheme();
  const pick = (id: ThemeId) => {
    setTheme(id);
    // the server only keeps keys it knows; until it has `theme`, the choice stays in this browser
    if (settings && 'theme' in settings) api.saveSettings({ theme: id }).catch(() => {});
  };
  const info = THEMES.find(t => t.id === current);
  const fallsBack = info && !info.modes.includes(mode);
  return (
    <div className="py-3 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-3 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="text-sm">Theme</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {settings && 'theme' in settings ? 'Saved to Shell:B, so it follows you to other devices' : 'Saved in this browser'}
          </div>
        </div>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Mode">
          {(['dark', 'light'] as const).map(m => (
            <button key={m} role="radio" aria-checked={mode === m} onClick={() => onMode(m)}
              className={clsx(btn.subtle, mode === m && '!border-[var(--accent)] !text-[var(--accent-soft)] !bg-[var(--bg-hover)]')}>
              {m === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}<span className="capitalize">{m}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label="Theme">
        {THEMES.map(t => {
          const on = t.id === current;
          return (
            <button key={t.id} role="radio" aria-checked={on} onClick={() => pick(t.id)}
              className={clsx('text-left p-2 rounded-lg border transition bg-[var(--bg-tertiary)]',
                on ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40' : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]')}>
              <Thumb t={t} mode={mode} />
              <div className="mt-2 flex items-center gap-1.5 text-[13px] font-medium">
                {t.label}
                {on && <Check className="w-3.5 h-3.5 text-[var(--accent-soft)]" />}
                {!t.modes.includes('light') && <span className="ml-auto text-[10px] font-normal text-[var(--text-muted)]">dark only</span>}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">{t.blurb}</div>
            </button>
          );
        })}
      </div>
      {fallsBack && <div className="mt-2 text-[11px] text-[var(--text-muted)]">{info!.label} has no light design, so light mode shows Classic light.</div>}
    </div>
  );
}
