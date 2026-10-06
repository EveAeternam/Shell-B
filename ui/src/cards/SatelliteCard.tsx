// ```satellite``` fence: {"sat": "iss"} (or tiangong, hubble, a NORAD number). The server hands over orbital elements
// (cached, so this works offline for days); the browser propagates the orbit with satellite.js every second and draws
// the ground track (last 45 min solid, next 90 min dashed) and the footprint where it's above the horizon.
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as ML from 'maplibre-gl';
import type { FeatureCollection, Position } from 'geojson';
import { Satellite } from 'lucide-react';
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import { MapStatus, useLiveMap } from '../maps/useLiveMap';
import { CardFrame, CardPending, parseJson } from './CardFrame';
import type { CardProps } from './registry';

interface Tle { norad: number; name: string; line1: string; line2: string; fetched: number; stale?: boolean }
interface Fix { lat: number; lon: number; alt: number; speed: number }

const R = 6371;

function fixAt(rec: SatRec, when: Date): Fix | null {
  const pv = propagate(rec, when);
  if (!pv || !pv.position || typeof pv.position === 'boolean' || !pv.velocity || typeof pv.velocity === 'boolean') return null;
  const g = eciToGeodetic(pv.position, gstime(when));
  const v = pv.velocity;
  return { lat: degreesLat(g.latitude), lon: degreesLong(g.longitude), alt: g.height, speed: Math.hypot(v.x, v.y, v.z) };
}

function footprint(f: Fix): Position[] {
  const ang = Math.acos(R / (R + f.alt));  // angular radius of the horizon circle
  const la = f.lat * Math.PI / 180, lo = f.lon * Math.PI / 180, pts: Position[] = [];
  for (let i = 0; i <= 96; i++) {
    const b = (i / 96) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(ang) + Math.cos(la) * Math.sin(ang) * Math.cos(b));
    const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(la), Math.cos(ang) - Math.sin(la) * Math.sin(lat2));
    pts.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);  // left unwrapped: MapLibre draws lon past ±180 across the seam
  }
  return pts;
}

const fc = (features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });

export function SatelliteCard({ source, streaming }: CardProps) {
  const sat = useMemo(() => {
    const r = parseJson(source);
    const v = r ? r.sat ?? r.satellite ?? r.name ?? r.norad ?? r.id : source.trim();
    return v != null && String(v).trim() ? String(v).trim() : null;
  }, [source]);
  if (!sat) return <CardPending icon={Satellite} streaming={streaming} waiting="Finding the satellite…" broken={'This card needs {"sat": "iss"} or a NORAD number.'} />;
  return <Tracker sat={sat} />;
}

function Tracker({ sat }: { sat: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [tle, setTle] = useState<Tle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const rec = useMemo(() => (tle ? twoline2satrec(tle.line1, tle.line2) : null), [tle]);
  const mapRef = useRef<ML.Map | null>(null);
  const framed = useRef(false);

  useEffect(() => {
    let gone = false;
    fetch(`/api/sky/tle?sat=${encodeURIComponent(sat)}`).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `HTTP ${r.status}`);
      if (!gone) setTle(d);
    }).catch(e => !gone && setError((e as Error).message));
    return () => { gone = true; };
  }, [sat]);

  const { state, retry } = useLiveMap(box, { options: { center: [0, 15], zoom: 0.8 }, onReady: (_lib, map) => {
    mapRef.current = map;
    framed.current = false;
    for (const id of ['sb-sat-foot', 'sb-sat-past', 'sb-sat-next', 'sb-sat-pos']) map.addSource(id, { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'sb-sat-foot-fill', type: 'fill', source: 'sb-sat-foot', paint: { 'fill-color': '#3987e5', 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'sb-sat-foot-line', type: 'line', source: 'sb-sat-foot', paint: { 'line-color': '#3987e5', 'line-opacity': 0.6, 'line-width': 1 } });
    map.addLayer({ id: 'sb-sat-next', type: 'line', source: 'sb-sat-next', paint: { 'line-color': '#e5e7eb', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [2, 3] } });
    map.addLayer({ id: 'sb-sat-past', type: 'line', source: 'sb-sat-past', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#d95926', 'line-width': 2 } });
    map.addLayer({ id: 'sb-sat-pos', type: 'circle', source: 'sb-sat-pos',
      paint: { 'circle-radius': 6, 'circle-color': '#d95926', 'circle-stroke-color': '#06070c', 'circle-stroke-width': 2 } });
  } });

  // ground track: recompute every 10 s so its ends stay on the moving dot
  useEffect(() => {
    if (!rec || state.phase !== 'ready') return;
    const draw = () => {
      const map = mapRef.current;
      if (!map?.getSource('sb-sat-past')) return;
      // continuous across the ±180 seam (MapLibre draws lon past it), shifted so the "now" end sits on the live dot
      const now = Date.now(), path = (from: number, to: number, anchorEnd: boolean) => {
        const pts: Position[] = [];
        for (let t = from; t < to; t += 30_000) { const f = fixAt(rec, new Date(t)); if (f) pts.push([f.lon, f.lat]); }
        const last = fixAt(rec, new Date(to));
        if (last) pts.push([last.lon, last.lat]);
        for (let i = 1; i < pts.length; i++) {
          while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
          while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
        }
        const live = fixAt(rec, new Date(now));
        const anchor = anchorEnd ? pts[pts.length - 1] : pts[0];
        if (live && anchor) { const k = Math.round((anchor[0] - live.lon) / 360) * 360; pts.forEach(p => { p[0] -= k; }); }
        return fc(pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : []);
      };
      (map.getSource('sb-sat-past') as ML.GeoJSONSource).setData(path(now - 45 * 60_000, now, true));
      (map.getSource('sb-sat-next') as ML.GeoJSONSource).setData(path(now, now + 90 * 60_000, false));
    };
    draw();
    const i = setInterval(draw, 10_000);
    return () => clearInterval(i);
  }, [rec, state.phase]);

  // live position: every second, no network
  useEffect(() => {
    if (!rec) return;
    const tick = () => {
      const f = fixAt(rec, new Date());
      if (!f) return;
      setFix(f);
      const map = mapRef.current;
      if (!map?.getSource('sb-sat-pos')) return;
      (map.getSource('sb-sat-pos') as ML.GeoJSONSource).setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } }]));
      const ring = footprint(f);
      (map.getSource('sb-sat-foot') as ML.GeoJSONSource).setData(fc(Math.abs(f.lat) + Math.acos(R / (R + f.alt)) * 180 / Math.PI < 89
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }]
        : []));  // a footprint over a pole can't be a simple ring in Web Mercator; skip it there
      if (!framed.current) { framed.current = true; map.jumpTo({ center: [f.lon, Math.max(-50, Math.min(50, f.lat))], zoom: 1.2 }); }
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [rec, state.phase]);

  const period = rec ? (2 * Math.PI) / rec.no : null;  // rec.no: mean motion in rad/min
  const age = tle ? (Date.now() / 1000 - tle.fetched) / 3600 : 0;
  return (
    <CardFrame icon={Satellite} title={tle?.name ?? sat.toUpperCase()} meta={tle ? `· NORAD ${tle.norad}` : undefined}>
      <div className="flex flex-col sm:flex-row">
        <div className="relative h-[260px] sm:h-[300px] flex-1 min-w-0 bg-[#06070c]">
          <div className="absolute inset-0"><div ref={box} className="w-full h-full" /></div>
          <MapStatus state={state} retry={retry} />
        </div>
        <div className="sm:w-60 shrink-0 border-t sm:border-t-0 sm:border-l border-[var(--border-subtle)] p-3.5 text-[12px]">
          {error ? <p className="text-[var(--text-muted)]">{error}</p> : !fix ? <p className="text-[var(--text-muted)] animate-pulse">Computing the orbit…</p> : (
            <>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {([['Latitude', `${Math.abs(fix.lat).toFixed(2)}° ${fix.lat >= 0 ? 'N' : 'S'}`], ['Longitude', `${Math.abs(fix.lon).toFixed(2)}° ${fix.lon >= 0 ? 'E' : 'W'}`],
                  ['Altitude', `${Math.round(fix.alt)} km`], ['Speed', `${fix.speed.toFixed(2)} km/s`],
                  ['Orbit', period ? `${period.toFixed(1)} min` : '—'], ['Per day', period ? `${(1440 / period).toFixed(1)} orbits` : '—']] as [string, string][])
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{k}</dt>
                      <dd className="font-mono text-[12px] tabular-nums">{v}</dd>
                    </div>
                  ))}
              </dl>
              <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#d95926]" />last 45 min</span>
                <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-[var(--text-secondary)]" />next 90 min</span>
              </div>
              <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                Computed here from orbital elements {age < 1 ? 'under an hour' : `${Math.round(age)} h`} old{tle?.stale ? ' (offline copy)' : ''} · Celestrak
              </p>
            </>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
