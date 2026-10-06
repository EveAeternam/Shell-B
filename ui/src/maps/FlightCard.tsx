// The ```flight``` fence in a chat reply: one flight followed live ({"q": "UAL123"}) or the traffic around a point
// ({"area": {"lat", "lon", "radius_nm"}}). FlightPanel is shared with the Worlds app's traffic layer.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type * as ML from 'maplibre-gl';
import { AlertTriangle, Plane, PlaneLanding, PlaneTakeoff, Radar, SquareArrowOutUpRight } from 'lucide-react';
import type { MapLib } from './core';
import { MapStatus, useLiveMap } from './useLiveMap';
import {
  altColor, apCode, areaFlights, findFlight, fmtAlt, fmtSpeed, fmtVrate, pathLayers, phase, planeLayer, unwrap,
  type Aircraft, type AreaResult, type FindResult,
} from './flights';

export const FLIGHT_HANDOFF = 'shellb.maps.flight';

export function openFlightInMaps(q: string) {
  try { sessionStorage.setItem(FLIGHT_HANDOFF, q); } catch { /* private mode */ }
  location.hash = '#/worlds';
}

type Spec = { q: string } | { area: { lat: number; lon: number; radius: number } };

function parse(text: string): Spec | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const q = r.q ?? r.query ?? r.callsign ?? r.flight ?? r.registration ?? r.hex;
  if (typeof q === 'string' && q.trim()) return { q: q.trim() };
  const a = (r.area && typeof r.area === 'object' ? r.area : r) as Record<string, unknown>;
  const lat = Number(a.lat), lon = Number(a.lon ?? a.lng), radius = Number(a.radius_nm ?? a.radius ?? 60);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { area: { lat, lon, radius: Number.isFinite(radius) ? Math.min(250, Math.max(5, radius)) : 60 } };
  }
  return null;
}

/** Re-run `fn` every `ms` while the element is on screen and the tab is visible. */
function usePoll(el: React.RefObject<HTMLElement | null>, ms: number, fn: () => Promise<void> | void, deps: unknown[]) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let seen = true, t: ReturnType<typeof setTimeout> | undefined, gone = false;
    const io = el.current ? new IntersectionObserver(([e]) => { seen = e.isIntersecting; }) : null;
    if (el.current) io!.observe(el.current);
    const tick = async () => {
      if (gone) return;
      if (seen && !document.hidden) { try { await fnRef.current(); } catch { /* fn reports its own errors */ } }
      if (!gone) t = setTimeout(tick, ms);
    };
    tick();
    return () => { gone = true; clearTimeout(t); io?.disconnect(); };
  }, deps);  // eslint-disable-line react-hooks/exhaustive-deps
}

function useAgo(t: number | null) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(i); }, []);
  return t == null ? null : Math.max(0, Math.round((Date.now() - t) / 1000));
}

export function FlightCard({ source, streaming }: { source: string; streaming?: boolean }) {
  const spec = parse(source);
  if (!spec) {
    return (
      <div className="not-prose my-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-code)] px-4 py-6 text-[12px] text-[var(--text-muted)] flex items-center gap-2">
        <Plane className={clsx('w-4 h-4', streaming && 'animate-pulse')} />
        {streaming ? 'Finding the flight…' : 'This flight card couldn’t be read: give {"q": "UAL123"} or {"area": {"lat", "lon"}}.'}
      </div>
    );
  }
  return 'q' in spec ? <OneFlight q={spec.q} /> : <AreaTraffic {...spec.area} />;
}

// ── the map under a card ───────────────────────────────────────────────────

// ── one flight ─────────────────────────────────────────────────────────────

function OneFlight({ q }: { q: string }) {
  const root = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<FindResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const resRef = useRef(res);
  resRef.current = res;
  const draw = useRef<{ planes: ReturnType<typeof planeLayer>; path: ReturnType<typeof pathLayers>; map: ML.Map; lib: MapLib; framed: boolean } | null>(null);

  const render = (r: FindResult | null) => {
    const d = draw.current;
    if (!d || !r) return;
    d.path(r);
    d.planes(r.aircraft ? [r.aircraft] : [], r.aircraft?.hex);
    if (!d.framed && (r.aircraft || r.trail.length)) {
      d.framed = true;
      const pts = unwrap([...r.trail.map(([lat, lon]) => [lon, lat] as [number, number]), ...(r.aircraft ? [[r.aircraft.lon, r.aircraft.lat] as [number, number]] : [])]);
      const dest = r.route?.destination;
      if (dest?.lat != null && dest.lon != null && r.aircraft && !r.aircraft.ground) pts.push([dest.lon, dest.lat]);
      const b = new d.lib.LngLatBounds(pts[0], pts[0]);
      pts.forEach(p => b.extend(p));
      d.map.fitBounds(b, { padding: 40, maxZoom: 9, animate: false });
    }
  };

  const { state: mapState, retry } = useLiveMap(box, { options: { center: [0, 30], zoom: 1.5 }, onReady: (lib, map) => {
    draw.current = { path: pathLayers(map), planes: planeLayer(map), map, lib, framed: false };
    render(resRef.current);
  } });

  usePoll(root, 6000, async () => {
    try {
      const r = await findFlight(q);
      setRes(r); setError(null); setUpdated(Date.now());
      render(r);
    } catch (e) { setError((e as Error).message); }
  }, [q]);

  return (
    <figure ref={root} className="not-prose my-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-code)] overflow-hidden">
      <figcaption className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
        <Plane className="w-3.5 h-3.5" /><span className="font-medium text-[var(--text-secondary)]">Flight {res?.aircraft?.callsign ?? q.toUpperCase()}</span>
        <div className="flex-1" />
        <button className="flex items-center gap-1 hover:text-[var(--text-primary)] transition rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
          onClick={() => openFlightInMaps(res?.aircraft?.callsign ?? q)} title="Follow this flight in the Worlds app">
          <SquareArrowOutUpRight className="w-3 h-3" /> Open in Maps
        </button>
      </figcaption>
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-[260px] sm:h-auto sm:min-h-[300px] flex-1 min-w-0 bg-[#06070c]">
          <div className="absolute inset-0"><div ref={box} className="w-full h-full" /></div>{/* MapLibre CSS makes its container position:relative */}
          <MapStatus state={mapState} retry={retry} />
        </div>
        <div className="sm:w-72 shrink-0 border-t sm:border-t-0 sm:border-l border-[var(--border-subtle)]">
          <FlightPanel res={res} error={error} updated={updated} loadingLabel={`Looking for ${q.toUpperCase()}…`} />
        </div>
      </div>
    </figure>
  );
}

// ── traffic around a point ─────────────────────────────────────────────────

function AreaTraffic({ lat, lon, radius }: { lat: number; lon: number; radius: number }) {
  const root = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<AreaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const setPlanes = useRef<ReturnType<typeof planeLayer> | null>(null);
  const resRef = useRef(res);
  resRef.current = res;

  const { state: mapState, retry } = useLiveMap(box, { onReady: (lib, map) => {
    setPlanes.current = planeLayer(map, 'sb-planes', { labels: true });
    map.jumpTo({ center: [lon, lat], zoom: Math.max(5, Math.min(10, 9.6 - Math.log2(radius / 10))) });
    map.on('click', 'sb-planes', e => setPicked(String(e.features?.[0]?.properties?.hex ?? '') || null));
    map.on('mouseenter', 'sb-planes', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'sb-planes', () => { map.getCanvas().style.cursor = ''; });
    setPlanes.current(resRef.current?.aircraft ?? []);
    void lib;
  } });

  useEffect(() => { setPlanes.current?.(res?.aircraft ?? [], picked); }, [res, picked]);

  usePoll(root, 8000, async () => {
    try { setRes(await areaFlights(lat, lon, radius)); setError(null); setUpdated(Date.now()); } catch (e) { setError((e as Error).message); }
  }, [lat, lon, radius]);

  const ago = useAgo(updated);
  const sel = res?.aircraft.find(a => a.hex === picked) ?? null;
  const airborne = res?.aircraft.filter(a => !a.ground).length ?? 0;
  return (
    <figure ref={root} className="not-prose my-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-code)] overflow-hidden">
      <figcaption className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)]">
        <Radar className="w-3.5 h-3.5" /><span className="font-medium text-[var(--text-secondary)]">Live traffic</span>
        <span className="tabular-nums">· {Math.round(radius)} nm around {Math.abs(lat).toFixed(2)}°{lat >= 0 ? 'N' : 'S'} {Math.abs(lon).toFixed(2)}°{lon >= 0 ? 'E' : 'W'}</span>
        <div className="flex-1" />
        {res && <span className="tabular-nums">{airborne} airborne · {res.aircraft.length - airborne} on ground</span>}
      </figcaption>
      <div className="relative h-[340px] bg-[#06070c]">
        <div className="absolute inset-0"><div ref={box} className="w-full h-full" /></div>{/* MapLibre CSS makes its container position:relative */}
        <MapStatus state={mapState} retry={retry} />
        {error && <div className="absolute top-2 left-2 rounded-md border border-amber-500/40 sb-map-glass px-2 py-1 text-[11px] text-amber-300">{error}</div>}
        {sel && (
          <div className="absolute bottom-2 left-2 w-64 rounded-lg border border-[var(--border-subtle)] sb-map-glass">
            <AircraftSummary a={sel} onOpen={() => openFlightInMaps(sel.callsign ?? sel.hex)} />
          </div>
        )}
        {ago != null && <div className="absolute bottom-2 right-12 text-[10px] tabular-nums text-[var(--text-muted)] pointer-events-none">updated {ago}s ago · {res?.feed}</div>}
      </div>
    </figure>
  );
}

function AircraftSummary({ a, onOpen }: { a: Aircraft; onOpen: () => void }) {
  return (
    <div className="p-2.5 text-[11px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-tight">{a.callsign ?? a.reg ?? a.hex.toUpperCase()}</span>
        <span className="text-[var(--text-muted)] truncate">{a.desc ?? a.type ?? ''}{a.reg && a.callsign ? ` · ${a.reg}` : ''}</span>
      </div>
      <div className="mt-1 flex gap-3 tabular-nums text-[var(--text-secondary)]">
        <span style={{ color: altColor(a) }}>{fmtAlt(a)}</span><span>{fmtSpeed(a)}</span><span>{fmtVrate(a)}</span>
      </div>
      <button className="mt-1.5 text-[var(--accent)] hover:underline" onClick={onOpen}>Follow in Maps →</button>
    </div>
  );
}

// ── details panel ──────────────────────────────────────────────────────────

function distKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, [l1, p1, l2, p2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r];
  return 12742 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
}

function AltitudeSpark({ trail, now }: { trail: FindResult['trail']; now: Aircraft | null }) {
  const pts = [...trail.map(p => p[2]), now?.alt ?? null].filter((v): v is number => v != null);
  if (pts.length < 3) return null;
  const max = Math.max(...pts, 1000), w = 240, h = 36;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" preserveAspectRatio="none" role="img" aria-label="Altitude over this flight">
      <path d={`${d}L${w},${h}L0,${h}Z`} fill="var(--accent)" opacity={0.12} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function FlightPanel({ res, error, updated, loadingLabel, onClose }: {
  res: FindResult | null; error: string | null; updated: number | null; loadingLabel?: string; onClose?: () => void;
}) {
  const ago = useAgo(updated);
  if (!res) {
    return <div className="p-4 text-[12px] text-[var(--text-muted)]">{error ?? <span className="animate-pulse">{loadingLabel ?? 'Loading…'}</span>}</div>;
  }
  const a = res.aircraft, rt = res.route;
  const o = rt?.origin, t = rt?.destination;
  let progress: number | null = null;
  if (a && o?.lat != null && o.lon != null && t?.lat != null && t.lon != null) {
    const done = distKm([o.lon, o.lat], [a.lon, a.lat]), left = distKm([a.lon, a.lat], [t.lon, t.lat]);
    progress = done + left > 0 ? done / (done + left) : null;
  }
  return (
    <div className="p-3.5 flex flex-col gap-3 text-[12px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[19px] leading-tight font-semibold tracking-tight">{a?.callsign ?? rt?.callsign ?? res.query}</div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            {[rt?.airline, a?.desc ?? a?.type, a?.reg].filter(Boolean).join(' · ') || 'Unknown aircraft'}
          </div>
        </div>
        {onClose && <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[11px]" onClick={onClose}>Close</button>}
      </div>

      {a?.emergency && (
        <div className="flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
          <AlertTriangle className="w-3.5 h-3.5" /> Emergency: {a.emergency} (squawk {a.squawk})
        </div>
      )}

      {rt?.stale && !o && !t && (
        <p className="text-[11px] text-[var(--text-muted)]">Route unknown: the published route for this callsign doesn’t match where the aircraft is.</p>
      )}
      {(o || t) && (
        <div>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0"><div className="text-[15px] font-semibold tracking-tight">{apCode(o)}</div><div className="text-[10px] text-[var(--text-muted)] truncate">{o?.city ?? o?.name}</div></div>
            <div className="min-w-0 text-right"><div className="text-[15px] font-semibold tracking-tight">{apCode(t)}</div><div className="text-[10px] text-[var(--text-muted)] truncate">{t?.city ?? t?.name}</div></div>
          </div>
          <div className="relative mt-1.5 h-1 rounded-full bg-[var(--bg-tertiary)]">
            {progress != null && <>
              <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${progress * 100}%` }} />
              <Plane className="absolute -top-[5px] w-3.5 h-3.5 text-[var(--text-primary)] rotate-45" style={{ left: `calc(${progress * 100}% - 7px)` }} />
            </>}
          </div>
        </div>
      )}

      {a ? (
        <>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            {a.ground ? <PlaneLanding className="w-3.5 h-3.5" /> : a.vrate != null && a.vrate > 300 ? <PlaneTakeoff className="w-3.5 h-3.5" /> : <Plane className="w-3.5 h-3.5" />}
            {phase(a)}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {([['Altitude', fmtAlt(a), altColor(a)], ['Ground speed', fmtSpeed(a)], ['Vertical', fmtVrate(a)],
              ['Track', a.track != null ? `${Math.round(a.track)}°` : '—'], ['Squawk', a.squawk ?? '—'], ['Hex', a.hex.toUpperCase()]] as [string, string, string?][])
              .map(([k, v, c]) => (
                <div key={k}>
                  <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{k}</dt>
                  <dd className="font-mono text-[12px] tabular-nums" style={c ? { color: c } : undefined}>{v}</dd>
                </div>
              ))}
          </dl>
          <AltitudeSpark trail={res.trail} now={a} />
        </>
      ) : (
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          Not in the air right now: no ADS-B position for {res.query}. It may be parked with its transponder off, out of receiver range, or not flying today.
        </p>
      )}

      <div className="text-[10px] text-[var(--text-muted)] tabular-nums flex items-center gap-1.5">
        <span className={clsx('w-1.5 h-1.5 rounded-full', error ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse')} />
        {error ? `Couldn’t refresh: ${error}` : `Live · updated ${ago ?? 0}s ago`}{a?.seen != null && !error ? ` · position ${Math.round(a.seen)}s old` : ''}
      </div>
    </div>
  );
}
