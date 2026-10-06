// ```timeline``` fence: {"title": "...", "events": [{"date": "1969-07-20", "label": "Apollo 11 lands", "note": "...",
// "end": "1972-12-19", "group": "Apollo"}]}. Dates may be a year (negative = BCE), year-month, a full date or an ISO time.
// An overview strip shows how events spread through time (spans as bars); the list below reads top to bottom.
import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import { useDarkTheme } from '../maps/MapCard';
import { CardFrame, CardPending, parseJson } from './CardFrame';
import type { CardProps } from './registry';

const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

type Precision = 'year' | 'month' | 'day' | 'time';
interface When { t: number; precision: Precision; raw: string }
interface Ev { start: When; end?: When; label: string; note?: string; group?: string }

const DAY = 86_400_000, YEAR = 365.2425 * DAY;

function when(v: unknown): When | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(Math.trunc(v));
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  let m = /^(-?\d{1,6})(?:\s*(BCE?|AD|CE))?$/i.exec(s);
  if (m) {
    const y = /^BCE?$/i.test(m[2] ?? '') || +m[1] < 0 ? 1 - Math.abs(+m[1]) : +m[1];  // "-3000" and "3000 BC" both mean 3000 BCE (year 0 doesn't exist)
    const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(y);
    return { t: d.getTime(), precision: 'year', raw: s };
  }
  m = /^(-?\d{1,6})-(\d{2})$/.exec(s);
  if (m) { const d = new Date(Date.UTC(2000, +m[2] - 1, 1)); d.setUTCFullYear(+m[1]); return { t: d.getTime(), precision: 'month', raw: s }; }
  m = /^(-?\d{1,6})-(\d{2})-(\d{2})$/.exec(s);
  if (m) { const d = new Date(Date.UTC(2000, +m[2] - 1, +m[3])); d.setUTCFullYear(+m[1]); return { t: d.getTime(), precision: 'day', raw: s }; }
  const t = Date.parse(s);
  return Number.isFinite(t) ? { t, precision: /\d{2}:\d{2}/.test(s) ? 'time' : 'day', raw: s } : null;
}

function show(w: When) {
  const d = new Date(w.t), y = d.getUTCFullYear();
  const year = y <= 0 ? `${1 - y} BCE` : String(y);
  if (w.precision === 'year') return year;
  const mon = d.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
  if (w.precision === 'month') return `${mon} ${year}`;
  if (w.precision === 'day') return `${d.getUTCDate()} ${mon} ${year}`;
  return new Date(w.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function parse(text: string): { title?: string; events: Ev[] } | null {
  const r = parseJson(text);
  const list = (r && Array.isArray(r.events) ? r.events : r && Array.isArray(r.items) ? r.items : (() => {
    try { const a = JSON.parse(text); return Array.isArray(a) ? a : null; } catch { return null; }
  })()) as Record<string, unknown>[] | null;
  if (!list) return null;
  const events = list.flatMap(e => {
    if (!e || typeof e !== 'object') return [];
    const start = when(e.date ?? e.start ?? e.when ?? e.year);
    const label = e.label ?? e.title ?? e.event ?? e.name;
    if (!start || typeof label !== 'string') return [];
    const end = when(e.end) ?? undefined;
    return [{ start, end: end && end.t > start.t ? end : undefined, label, note: typeof e.note === 'string' ? e.note : typeof e.description === 'string' ? e.description : undefined,
      group: typeof e.group === 'string' ? e.group : typeof e.category === 'string' ? e.category : undefined }];
  }).sort((a, b) => a.start.t - b.start.t);
  return events.length ? { title: typeof r?.title === 'string' ? r.title : undefined, events } : null;
}

function span(a: When, b: When) {
  const ms = b.t - a.t;
  if (ms >= 2 * YEAR) return `${Math.round(ms / YEAR).toLocaleString()} years`;
  if (ms >= 60 * DAY) return `${Math.round(ms / (YEAR / 12))} months`;
  if (ms >= 2 * DAY) return `${Math.round(ms / DAY)} days`;
  return `${Math.round(ms / 3_600_000)} hours`;
}

export function TimelineCard({ source, streaming }: CardProps) {
  const tl = useMemo(() => parse(source), [source]);
  const dark = useDarkTheme();
  if (!tl) return <CardPending icon={CalendarRange} streaming={streaming} waiting="Laying out the timeline…" broken={'This timeline couldn’t be read: give {"events": [{"date", "label"}]}.'} />;
  const colors = PALETTE[dark ? 'dark' : 'light'];
  const groups = [...new Set(tl.events.map(e => e.group).filter((g): g is string => !!g))].slice(0, 8);
  const color = (g?: string) => (g && groups.includes(g) ? colors[groups.indexOf(g)] : 'var(--accent)');
  const first = tl.events[0].start, last = tl.events.reduce((m, e) => Math.max(m, (e.end ?? e.start).t), first.t);
  const lo = first.t, range = Math.max(1, last - lo);
  const x = (t: number) => ((t - lo) / range) * 100;
  const W = 1000;

  return (
    <CardFrame icon={CalendarRange} title={tl.title ?? 'Timeline'}
      meta={`· ${tl.events.length} event${tl.events.length === 1 ? '' : 's'}${tl.events.length > 1 ? ` · ${show(first)} – ${show({ ...first, t: last, precision: first.precision })} (${span(first, { ...first, t: last })})` : ''}`}>
      {tl.events.length > 1 && (
        <div className="px-4 pt-3 pb-1">
          <svg viewBox={`0 0 ${W} 28`} className="w-full h-7" preserveAspectRatio="none" role="img" aria-label="Where the events fall in time">
            <line x1={0} x2={W} y1={14} y2={14} stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {tl.events.map((e, i) => e.end ? (
              <rect key={i} x={(x(e.start.t) / 100) * W} y={9} width={Math.max(3, ((x(e.end.t) - x(e.start.t)) / 100) * W)} height={10} rx={3} fill={color(e.group)} opacity={0.75}>
                <title>{e.label}: {show(e.start)} – {show(e.end)}</title>
              </rect>
            ) : (
              <rect key={i} x={(x(e.start.t) / 100) * W - 1.5} y={5} width={3} height={18} rx={1.5} fill={color(e.group)}>
                <title>{e.label}: {show(e.start)}</title>
              </rect>
            ))}
          </svg>
          <div className="flex justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
            <span>{show({ ...first, precision: first.precision === 'time' ? 'day' : first.precision })}</span>
            <span>{show({ ...first, t: last, precision: first.precision === 'time' ? 'day' : first.precision })}</span>
          </div>
        </div>
      )}
      {groups.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-1 text-[11px] text-[var(--text-secondary)]">
          {groups.map(g => <li key={g} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: color(g) }} />{g}</li>)}
        </ul>
      )}
      <ol className="px-4 py-3 max-h-[480px] overflow-y-auto list-none m-0">
        {tl.events.map((e, i) => (
          <li key={i} className="grid grid-cols-[7.5rem_14px_1fr] gap-x-3">
            <time className="pt-0.5 text-right text-[11px] tabular-nums text-[var(--text-muted)] leading-snug">
              {show(e.start)}{e.end && <><br />– {show(e.end)}</>}
            </time>
            <span className="relative flex justify-center" aria-hidden>
              <span className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]" style={{ top: i === 0 ? 8 : 0, bottom: i === tl.events.length - 1 ? 'calc(100% - 8px)' : 0 }} />
              <span className="relative mt-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-[var(--bg-code)]" style={{ background: color(e.group) }} />
            </span>
            <div className="pb-4 min-w-0">
              <div className="text-[13px] leading-snug font-medium">{e.label}</div>
              {(e.note || (groups.length > 1 && e.group)) && (
                <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-secondary)] max-w-[65ch]">
                  {e.note}{e.end && <span className="text-[var(--text-muted)]">{e.note ? ' · ' : ''}{span(e.start, e.end)}</span>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </CardFrame>
  );
}
