import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Cpu, Download, HardDrive, ShieldCheck } from 'lucide-react';
import { fmtBytes, req } from '../api';
import type { DownloadItem } from '../types';

/** Bytes per second from the server, or measured here from successive samples (Ollama pulls don't report a rate). */
function useRates(items: DownloadItem[]) {
  const last = useRef(new Map<string, { t: number; done: number; rate: number | null }>());
  const now = Date.now();
  const rates = new Map<string, number | null>();
  for (const it of items) {
    const prev = last.current.get(it.id);
    let rate = it.rate ?? null;
    if (rate == null && prev && now - prev.t > 500 && it.done >= prev.done) {
      const r = ((it.done - prev.done) * 1000) / (now - prev.t);
      rate = prev.rate == null ? r : prev.rate * 0.6 + r * 0.4;  // smoothed
    } else if (rate == null) rate = prev?.rate ?? null;
    rates.set(it.id, rate);
    if (!prev || now - prev.t > 500) last.current.set(it.id, { t: now, done: it.done, rate });
  }
  return rates;
}

const pct = (it: DownloadItem) => (it.total ? Math.min(100, (it.done / it.total) * 100) : 0);
function eta(it: DownloadItem, rate: number | null) {
  if (it.phase !== 'download' || !rate || !it.total) return '';
  const s = (it.total - it.done) / rate;
  return s < 90 ? `${Math.ceil(s)} s left` : s < 5400 ? `${Math.round(s / 60)} min left` : `${(s / 3600).toFixed(1)} h left`;
}
function line(it: DownloadItem, rate: number | null) {
  if (it.phase === 'queued') return `Queued · ${fmtBytes(it.total)}`;
  if (it.phase === 'verify') return `Checking the checksum · ${Math.round(pct(it))}%`;
  if (it.phase === 'install') return 'Swapping in the new version';
  if (!it.total) return it.detail || 'Starting';
  return [`${fmtBytes(it.done)} of ${fmtBytes(it.total)}`, rate ? `${fmtBytes(rate)}/s` : '', eta(it, rate)].filter(Boolean).join(' · ');
}

/** A small ring in the top bar while anything big is downloading (offline data, model pulls); click for details. */
export function Downloads({ initial }: { initial?: DownloadItem[] }) {
  const [items, setItems] = useState<DownloadItem[]>(initial ?? []);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (initial) setItems(initial); }, [initial]);
  const active = items.length > 0;
  // the status poll is every 10 s; while something downloads, poll faster for a live bar
  useEffect(() => {
    if (!active) return;
    const tick = () => req<{ items: DownloadItem[] }>('/api/datasets/downloads').then(r => setItems(r.items)).catch(() => {});
    const t = setInterval(tick, open ? 1500 : 4000);
    return () => clearInterval(t);
  }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', close); addEventListener('keydown', close);
    return () => { removeEventListener('mousedown', close); removeEventListener('keydown', close); };
  }, [open]);
  const rates = useRates(items);
  if (!active) return null;

  const running = items.filter(i => i.phase !== 'queued');
  const total = running.reduce((a, i) => a + i.total, 0);
  const done = running.reduce((a, i) => a + Math.min(i.done, i.total), 0);
  const frac = total ? done / total : 0;
  const verifying = running.some(i => i.phase === 'verify');
  const R = 7, C = 2 * Math.PI * R;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
        title={`${running.length || items.length} download${items.length === 1 ? '' : 's'} · ${Math.round(frac * 100)}%`}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]">
        <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90 shrink-0" aria-hidden>
          <circle cx="9" cy="9" r={R} fill="none" stroke="var(--bg-tertiary)" strokeWidth="2.5" />
          <circle cx="9" cy="9" r={R} fill="none" stroke={verifying ? '#10b981' : 'var(--accent)'} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.03, frac))} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <span className="font-mono tabular-nums">{Math.round(frac * 100)}%</span>
        {items.length > 1 && <span className="hidden sm:inline text-[var(--text-muted)]">· {items.length}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Downloads" className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
            <Download className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex-1">Downloads</span>
            {total > 0 && <span className="font-mono text-[10px] text-[var(--text-muted)]">{fmtBytes(done)} / {fmtBytes(total)}</span>}
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {items.map(it => {
              const rate = rates.get(it.id) ?? null;
              const Icon = it.kind === 'model' ? Cpu : it.phase === 'verify' ? ShieldCheck : HardDrive;
              return (
                <li key={it.id}>
                  <a href={it.link} onClick={() => setOpen(false)} className="block px-3 py-2.5 hover:bg-[var(--bg-hover)] transition">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon className={clsx('w-3.5 h-3.5 shrink-0', it.kind === 'model' ? 'text-cyan-400' : 'text-sky-400')} />
                      <span className="font-medium truncate flex-1">{it.name}</span>
                      {it.phase !== 'queued' && it.total > 0 && <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">{Math.round(pct(it))}%</span>}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
                      {it.kind === 'data' && it.detail ? <span className="font-mono">{it.detail} · </span> : null}{line(it, rate)}
                      {it.note && <span className="text-amber-500"> · {it.note}</span>}
                    </div>
                    {it.phase !== 'queued' && (
                      <div className="mt-1.5 h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                        <div className={clsx('h-full transition-all duration-700', it.phase === 'verify' ? 'bg-emerald-500' : 'bg-[var(--accent)]')} style={{ width: `${Math.max(1, pct(it))}%` }} />
                      </div>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
          <div className="px-3 py-2 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
            Offline-data downloads pick up where they left off after a restart, and report to <a href="#/activity" onClick={() => setOpen(false)} className="underline hover:text-[var(--text-primary)]">Activity</a>.
          </div>
        </div>
      )}
    </div>
  );
}
