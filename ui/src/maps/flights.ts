// Live flights (server/flights.py) on MapLibre maps: the plane layer, trails and routes, shared by the chat card and the Worlds app.
import type * as ML from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';

export interface Aircraft {
  hex: string;
  callsign: string | null;
  reg: string | null;
  type: string | null;
  desc: string | null;
  operator: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  ground: boolean;
  gs: number | null;
  track: number | null;
  vrate: number | null;
  squawk: string | null;
  emergency: string | null;
  category: string | null;
  seen: number | null;
}

export interface Airport { iata: string | null; icao: string | null; name: string | null; city: string | null; country: string | null; lat: number | null; lon: number | null }
export interface Route { callsign: string | null; iata: string | null; airline: string | null; origin: Airport | null; destination: Airport | null; stale?: boolean }
export interface FindResult { query: string; aircraft: Aircraft | null; route: Route | null; trail: [number, number, number | null, number][] }
export interface AreaResult { now: number; feed: string; aircraft: Aircraft[] }

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const findFlight = (q: string) => get<FindResult>(`/api/flights/find?q=${encodeURIComponent(q)}`);
export const areaFlights = (lat: number, lon: number, radiusNm: number) =>
  get<AreaResult>(`/api/flights/area?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radius=${Math.round(radiusNm)}`);

// ── formatting ─────────────────────────────────────────────────────────────

export const fmtAlt = (a: Aircraft) => (a.ground ? 'Ground' : a.alt == null ? '—' : a.alt >= 18000 ? `FL${Math.round(a.alt / 100)}` : `${a.alt.toLocaleString()} ft`);
export const fmtSpeed = (a: Aircraft) => (a.gs == null ? '—' : `${Math.round(a.gs)} kt`);
export const fmtVrate = (a: Aircraft) => (a.ground || a.vrate == null ? '—' : `${a.vrate > 0 ? '+' : ''}${Math.round(a.vrate / 64) * 64} fpm`);
export const phase = (a: Aircraft) => (a.ground ? 'On the ground' : a.vrate == null ? 'Airborne' : a.vrate > 300 ? 'Climbing' : a.vrate < -300 ? 'Descending' : 'Cruising');
export const apCode = (p: Airport | null | undefined) => p?.iata ?? p?.icao ?? '???';

/** Altitude colour ramp (ground → FL400), the usual ADS-B-display look. */
export const ALT_STOPS: [number, string][] = [[0, '#9ca3af'], [1000, '#f97316'], [6000, '#facc15'], [12000, '#4ade80'], [25000, '#22d3ee'], [40000, '#a78bfa']];
export function altColor(a: Pick<Aircraft, 'alt' | 'ground'>): string {
  if (a.ground || a.alt == null) return ALT_STOPS[0][1];
  return [...ALT_STOPS].reverse().find(([h]) => (a.alt ?? 0) >= h)?.[1] ?? ALT_STOPS[0][1];
}

// ── geometry ───────────────────────────────────────────────────────────────

/** Keep a path continuous across the antimeridian (MapLibre draws lon > 180 fine). */
export function unwrap(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lon, lat] of points) {
    let l = lon;
    const prev = out[out.length - 1];
    if (prev) while (l - prev[0] > 180) l -= 360;
    if (prev) while (l - prev[0] < -180) l += 360;
    out.push([l, lat]);
  }
  return out;
}

/** Great-circle path between two airports, as [lon, lat]. */
export function greatCircle(a: [number, number], b: [number, number], n = 96): [number, number][] {
  const rad = Math.PI / 180;
  const [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-6) return [a, b];
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad]);
  }
  return unwrap(pts);
}

// ── map layers ─────────────────────────────────────────────────────────────

const PLANE = 'sb-plane';
// a top-down airliner, nose up, drawn on a 64px canvas as an SDF so the layer can tint it per altitude
const PLANE_PATH = 'M32 4c2.2 0 3.4 2.6 3.4 6v13.2l20.6 12.4v5.2L35.4 34.6v12.6l7 5.4v4.4L32 54.2 21.6 57v-4.4l7-5.4V34.6L8 40.8v-5.2l20.6-12.4V10c0-3.4 1.2-6 3.4-6z';

function ensurePlaneImage(map: ML.Map) {
  if (map.hasImage(PLANE)) return;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fill(new Path2D(PLANE_PATH));
  map.addImage(PLANE, g.getImageData(0, 0, s, s), { sdf: true, pixelRatio: 2 });
}

export const planeColorExpr: ML.ExpressionSpecification = ['case', ['get', 'ground'], ALT_STOPS[0][1],
  ['interpolate', ['linear'], ['coalesce', ['get', 'alt'], 0], ...ALT_STOPS.flatMap(([h, c]) => [h, c])]] as unknown as ML.ExpressionSpecification;

export function planesGeoJSON(list: Aircraft[], selected?: string | null): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: list.map(a => ({
      type: 'Feature', id: parseInt(a.hex, 16) || undefined,
      properties: { hex: a.hex, label: a.callsign ?? a.reg ?? a.hex.toUpperCase(), track: a.track ?? 0, alt: a.alt ?? 0, ground: a.ground, sel: a.hex === selected },
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
    })),
  };
}

/** Adds (once) the plane symbol layer + its source; returns a setter for the planes on it. */
export function planeLayer(map: ML.Map, id = 'sb-planes', opts: { labels?: boolean } = {}) {
  ensurePlaneImage(map);
  if (!map.getSource(id)) {
    map.addSource(id, { type: 'geojson', data: planesGeoJSON([]) });
    map.addLayer({
      id, type: 'symbol', source: id,
      layout: {
        'icon-image': PLANE, 'icon-size': ['case', ['get', 'sel'], 1.25, 0.9], 'icon-rotate': ['get', 'track'],
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        ...(opts.labels ? {
          'text-field': ['step', ['zoom'], ['case', ['get', 'sel'], ['get', 'label'], ''], 7, ['get', 'label']],
          'text-font': ['Noto Sans Medium'], 'text-size': 10, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-optional': true,
        } : {}),
      },
      paint: {
        'icon-color': planeColorExpr, 'icon-halo-color': '#06070c', 'icon-halo-width': 1.5,
        'text-color': '#e5e7eb', 'text-halo-color': '#06070c', 'text-halo-width': 1.2,
      },
    });
  }
  return (list: Aircraft[], selected?: string | null) => (map.getSource(id) as ML.GeoJSONSource | undefined)?.setData(planesGeoJSON(list, selected));
}

/** Trail (flown, coloured by altitude) and the remaining great-circle leg to the destination. */
export function pathLayers(map: ML.Map, id = 'sb-flightpath') {
  if (!map.getSource(`${id}-trail`)) {
    map.addSource(`${id}-trail`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource(`${id}-ahead`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('sb-planes') ? 'sb-planes' : undefined;
    map.addLayer({ id: `${id}-ahead`, type: 'line', source: `${id}-ahead`, layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#e5e7eb', 'line-opacity': 0.55, 'line-width': 1.5, 'line-dasharray': [2, 3] } }, before);
    map.addLayer({ id: `${id}-trail`, type: 'line', source: `${id}-trail`, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } }, before);
  }
  return (r: FindResult | null) => {
    const trailSrc = map.getSource(`${id}-trail`) as ML.GeoJSONSource | undefined;
    const aheadSrc = map.getSource(`${id}-ahead`) as ML.GeoJSONSource | undefined;
    if (!trailSrc || !aheadSrc) return;
    const a = r?.aircraft;
    const pts = unwrap([...(r?.trail ?? []).map(([lat, lon]) => [lon, lat] as [number, number]), ...(a ? [[a.lon, a.lat] as [number, number]] : [])]);
    const alts = [...(r?.trail ?? []).map(p => p[2]), a?.alt ?? null];
    // one short segment per step so the colour follows altitude
    const features: Feature[] = [];
    for (let i = 1; i < pts.length; i++) {
      features.push({ type: 'Feature', properties: { color: altColor({ alt: alts[i], ground: alts[i] === 0 }) },
        geometry: { type: 'LineString', coordinates: [pts[i - 1], pts[i]] } });
    }
    trailSrc.setData({ type: 'FeatureCollection', features });
    const dest = r?.route?.destination;
    aheadSrc.setData({ type: 'FeatureCollection', features: a && !a.ground && dest?.lat != null && dest.lon != null ? [{
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: greatCircle([a.lon, a.lat], [dest.lon, dest.lat]) },
    }] : [] });
  };
}

/** Radius (nm) that covers the visible map, capped at the feeds' 250 nm. */
export function viewRadiusNm(map: ML.Map): number {
  const b = map.getBounds(), c = map.getCenter();
  const corner = b.getNorthEast();
  return Math.min(250, Math.max(5, c.distanceTo(corner) / 1852));
}
