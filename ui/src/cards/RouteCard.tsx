// ```route``` fence: {"from": "Orlando", "to": "Kennedy Space Center", "mode": "auto|bicycle|pedestrian", "via": [...]}.
// Directions come from the local Valhalla via /api/route (offline inside installed regions). Click a step to fly to it.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type * as ML from 'maplibre-gl';
import { Bike, Car, Footprints, Route as RouteIcon } from 'lucide-react';
import { MapStatus, useLiveMap } from '../maps/useLiveMap';
import { CardButton, CardFrame, CardPending, parseJson } from './CardFrame';
import type { CardProps } from './registry';

type Mode = 'auto' | 'bicycle' | 'pedestrian';
interface Stop { name: string; lat: number; lon: number }
interface Step { text: string; km: number; s: number; type: number; street: string | null; at: [number, number] | null }
interface Route { from: Stop; to: Stop; via: Stop[]; mode: Mode; km: number; s: number; coords: [number, number][]; steps: Step[]; bbox: [number, number, number, number] | null }

const MODE_ICON = { auto: Car, bicycle: Bike, pedestrian: Footprints };
const MODE_WORD = { auto: 'Drive', bicycle: 'Bike', pedestrian: 'Walk' };
const US = /-(US|LR|MM)\b/i.test(navigator.language);

const dist = (km: number) => (US ? (km * 0.621371 < 0.2 ? `${Math.round(km * 3280.84 / 10) * 10} ft` : `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi`)
  : km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);
const dur = (s: number) => { const m = Math.round(s / 60), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${Math.max(1, m)} min`; };

function parse(text: string): { from: string; to: string; mode: Mode; via: string[] } | null {
  const r = parseJson(text);
  if (!r) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v && typeof v === 'object' && 'lat' in v ? `${(v as Stop).lat},${(v as Stop).lon}` : '');
  const from = s(r.from ?? r.origin ?? r.start), to = s(r.to ?? r.destination ?? r.end);
  if (!from || !to) return null;
  const m = String(r.mode ?? 'auto').toLowerCase();
  const mode: Mode = /bike|bicycl|cycl/.test(m) ? 'bicycle' : /walk|foot|pedestr/.test(m) ? 'pedestrian' : 'auto';
  return { from, to, mode, via: Array.isArray(r.via) ? r.via.map(s).filter(Boolean) : [] };
}

export function RouteCard({ source, streaming }: CardProps) {
  const spec = useMemo(() => parse(source), [source]);
  if (!spec) return <CardPending icon={RouteIcon} streaming={streaming} waiting="Working out the route…" broken={'This route card needs {"from": "…", "to": "…"}.'} />;
  return <Directions {...spec} />;
}

function Directions({ from, to, mode: initialMode, via }: { from: string; to: string; mode: Mode; via: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const mapRef = useRef<{ map: ML.Map; lib: typeof import('maplibre-gl'); markers: ML.Marker[] } | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    let gone = false;
    setError(null);
    const qs = new URLSearchParams({ from, to, mode, via: via.join('|') });
    fetch(`/api/route?${qs}`).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `HTTP ${r.status}`);
      if (!gone) { setRoute(d); setActive(null); }
    }).catch(e => { if (!gone) { setError((e as Error).message); setRoute(null); } });
    return () => { gone = true; };
  }, [from, to, mode, via.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps

  const draw = () => {
    const m = mapRef.current, r = routeRef.current;
    if (!m || !r) return;
    const src = m.map.getSource('sb-route') as ML.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coords } }] });
    m.markers.forEach(x => x.remove());
    m.markers = [r.from, ...r.via, r.to].map((s, i, all) => new m.lib.Marker({ color: i === 0 ? '#1baf7a' : i === all.length - 1 ? '#e66767' : '#c98500', scale: 0.8 })
      .setLngLat([s.lon, s.lat]).setPopup(new m.lib.Popup({ offset: 22, closeButton: false, className: 'sb-map-popup' }).setText(s.name)).addTo(m.map));
    if (r.bbox) m.map.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 40, animate: false, maxZoom: 15 });
  };

  const { state, retry } = useLiveMap(box, { onReady: (lib, map) => {
    map.addSource('sb-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // a dark casing under the line keeps it legible over both busy and empty map areas
    map.addLayer({ id: 'sb-route-casing', type: 'line', source: 'sb-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#06070c', 'line-width': 7, 'line-opacity': 0.6 } });
    map.addLayer({ id: 'sb-route', type: 'line', source: 'sb-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#3987e5', 'line-width': 4 } });
    mapRef.current = { map, lib, markers: [] };
    draw();
  } });

  useEffect(draw, [route, state.phase]);  // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => {
    setActive(i);
    const at = route?.steps[i]?.at, m = mapRef.current;
    if (at && m) m.map.flyTo({ center: at, zoom: Math.max(m.map.getZoom(), 15), duration: 700 });
  };

  const Icon = MODE_ICON[mode];
  return (
    <CardFrame icon={RouteIcon} title={route ? `${route.from.name.split(',')[0]} → ${route.to.name.split(',')[0]}` : `${from} → ${to}`}
      meta={route ? `· ${dist(route.km)} · ${dur(route.s)}` : undefined}
      actions={<div className="flex items-center gap-2">
        {(['auto', 'bicycle', 'pedestrian'] as Mode[]).map(m => {
          const I = MODE_ICON[m];
          return <CardButton key={m} onClick={() => setMode(m)} title={MODE_WORD[m]} active={mode === m}><I className="w-3.5 h-3.5" /></CardButton>;
        })}
      </div>}>
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-[260px] sm:h-[340px] flex-1 min-w-0 bg-[#06070c]">
          <div className="absolute inset-0"><div ref={box} className="w-full h-full" /></div>
          <MapStatus state={state} retry={retry} />
        </div>
        <div className="sm:w-72 shrink-0 border-t sm:border-t-0 sm:border-l border-[var(--border-subtle)] flex flex-col max-h-[340px]">
          {error ? <p className="p-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">{error}</p>
            : !route ? <p className="p-3.5 text-[12px] text-[var(--text-muted)] animate-pulse">Working out the route…</p> : (
              <>
                <div className="px-3.5 pt-3 pb-2 border-b border-[var(--border-subtle)]">
                  <div className="flex items-baseline gap-2">
                    <Icon className="w-4 h-4 self-center text-[var(--text-secondary)]" />
                    <span className="text-[19px] font-semibold tracking-tight tabular-nums">{dur(route.s)}</span>
                    <span className="text-[12px] text-[var(--text-muted)] tabular-nums">{dist(route.km)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug truncate" title={route.from.name}>
                    <span className="inline-block w-2 h-2 rounded-full bg-[#1baf7a] mr-1.5" />{route.from.name}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] leading-snug truncate" title={route.to.name}>
                    <span className="inline-block w-2 h-2 rounded-full bg-[#e66767] mr-1.5" />{route.to.name}
                  </div>
                </div>
                <ol className="flex-1 overflow-y-auto py-1 list-none m-0 pl-0">
                  {route.steps.map((st, i) => (
                    <li key={i}>
                      <button onClick={() => go(i)}
                        className={clsx('w-full text-left grid grid-cols-[1.25rem_1fr_auto] gap-2 px-3.5 py-1.5 text-[12px] leading-snug hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]',
                          active === i && 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]')}>
                        <span className="text-[10px] tabular-nums text-[var(--text-muted)] pt-0.5">{i + 1}</span>
                        <span className="text-[var(--text-secondary)]">{st.text}</span>
                        <span className="text-[10px] tabular-nums text-[var(--text-muted)] pt-0.5">{st.km > 0 ? dist(st.km) : ''}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="px-3.5 py-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)]">Offline directions · Valhalla · © OpenStreetMap</div>
              </>
            )}
        </div>
      </div>
    </CardFrame>
  );
}
