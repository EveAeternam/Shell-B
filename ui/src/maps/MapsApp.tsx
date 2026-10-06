// Worlds app (#/worlds, formerly Maps at #/maps): the Sol orrery (SolView), Earth from the offline OSM planet,
// plus every planet and moon mosaic in ~/shellb/maps/bodies, with live traffic, satellites, planetary landmarks,
// historic missions, geodesic measurements, turn-by-turn directions, real-time solar terminator, and curated tours.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import type * as ML from 'maplibre-gl';
import {
  Activity, Anchor, Bookmark, Check, ChevronDown, Compass, Copy, Crosshair, Download, Eye, Flag, Globe2,
  Info, Layers, Loader2, LocateFixed, Map as MapIcon, MapPin, Navigation, Orbit,
  PanelLeftClose, PanelLeftOpen, Radar, Rocket, RotateCcw, Route as RouteIcon,
  Ruler, Satellite, Search, Ship, Sparkles, Sun, Thermometer, Video, Wind, X
} from 'lucide-react';
import { drawOverlays, fetchBodies, fmtCoord, frameSpec, loadMapLib, styleFor, type MapBody, type MapLib, type MapSpec } from './core';
import { MAPS_HANDOFF, useDarkTheme } from './MapCard';
import { SolView } from './SolView';
import { SOL_BODIES, isMajorMoon, moonsOf } from './sol';
import { FLIGHT_HANDOFF, FlightPanel } from './FlightCard';
import { areaFlights, findFlight, pathLayers, planeLayer, viewRadiusNm, type Aircraft, type FindResult } from './flights';
import { attachOrbiters, type OrbiterInfo, type OrbiterLayer } from './orbiters';
import type { FeatureCollection } from 'geojson';

// New feature modules
import { attachLandmarks, getLandmarksForBody, searchLandmarks, type Landmark, type LandmarkLayer } from './landmarks';
import { attachTerminator } from './terminator';
import { attachMeasureLayer, detachMeasureLayer, computePath, formatDist, type MeasurePoint, type MeasureResult } from './measure';
import { attachGrid } from './grid';
import { getBookmarks, type Bookmark as BookmarkItem } from './bookmarks';
import { DirectionsPanel, type RouteData, type RouteStep } from './DirectionsPanel';
import { DossierDrawer } from './DossierDrawer';
import { LandmarkModal } from './LandmarkModal';
import { LiveWeatherWidget } from './LiveWeatherWidget';
import { BookmarksModal } from './BookmarksModal';
import { AtlasCopilot } from './AtlasCopilot';
import { attachTraverseLayer, getTraversesForBody, type Traverse, type TraverseLayer, type TraverseWaypoint } from './traverses';
import { TraverseModal } from './TraverseModal';
import { SkyViewModal } from './SkyViewModal';
import { FeaturesMenu } from './FeaturesMenu';
import { NightSky } from './NightSky';
import { attachShipwrecks, SHIPWRECKS, type Shipwreck, type ShipwreckLayer } from './shipwrecks';
import { attachWonders, WORLD_WONDERS, type WorldWonder, type WonderLayer } from './wonders';
import { attachLaunchSites, LAUNCH_SITES, type LaunchSite, type LaunchSiteLayer } from './launchsites';
import { attachMaritime, VESSELS_AT_SEA, type Vessel, type MaritimeLayer } from './maritime';
import { attachCCTV, CCTV_CAMERAS, type CCTVCamera, type CCTVLayer } from './cctv';
import { MapFeatureModal, type AnyFeature } from './MapFeatureModal';

export const WORLD_PALETTE: Record<string, { color: string; label?: string }> = {
  sol: { color: '#f59e0b', label: 'Star' },
  mercury: { color: '#94a3b8', label: 'Terrestrial' },
  venus: { color: '#eab308', label: 'Terrestrial' },
  earth: { color: '#0ea5e9', label: 'Terrestrial' },
  moon: { color: '#e2e8f0', label: 'Lunar' },
  mars: { color: '#ea580c', label: 'Terrestrial' },
  phobos: { color: '#a8a29e', label: 'Moon' },
  deimos: { color: '#a8a29e', label: 'Moon' },
  ceres: { color: '#71717a', label: 'Dwarf Planet' },
  jupiter: { color: '#d97706', label: 'Gas Giant' },
  io: { color: '#facc15', label: 'Volcanic Moon' },
  europa: { color: '#38bdf8', label: 'Ocean Moon' },
  ganymede: { color: '#93c5fd', label: 'Icy Moon' },
  callisto: { color: '#94a3b8', label: 'Cratered Moon' },
  saturn: { color: '#eab308', label: 'Ringed Giant' },
  mimas: { color: '#cbd5e1', label: 'Moon' },
  enceladus: { color: '#7dd3fc', label: 'Geyser Moon' },
  tethys: { color: '#cbd5e1', label: 'Moon' },
  dione: { color: '#cbd5e1', label: 'Moon' },
  rhea: { color: '#cbd5e1', label: 'Moon' },
  titan: { color: '#f97316', label: 'Atmospheric Moon' },
  iapetus: { color: '#71717a', label: 'Moon' },
  uranus: { color: '#2dd4bf', label: 'Ice Giant' },
  neptune: { color: '#3b82f6', label: 'Ice Giant' },
  pluto: { color: '#c084fc', label: 'Dwarf Planet' },
  charon: { color: '#a1a1aa', label: 'Moon' },
};

const LAST = 'shellb.maps.last';
const VIEW = (id: string) => `shellb.maps.view.${id}`;
const GLOBE = 'shellb.maps.globe';
const TRAFFIC = 'shellb.maps.traffic';
const ORBITERS = 'shellb.maps.orbiters';
const LANDMARKS_KEY = 'shellb.maps.landmarks';
const TERMINATOR_KEY = 'shellb.maps.terminator';
const GRID_KEY = 'shellb.maps.grid';
const MEASURE_UNIT = 'shellb.maps.measure.unit';
const TRAVERSES_KEY = 'shellb.maps.traverses';
const EARTHQUAKES_KEY = 'shellb.maps.earthquakes';
const NIGHT_SKY_KEY = 'shellb.maps.nightsky';
const SHIPWRECKS_KEY = 'shellb.maps.shipwrecks';
const WONDERS_KEY = 'shellb.maps.wonders';
const LAUNCHSITES_KEY = 'shellb.maps.launchsites';
const MARITIME_KEY = 'shellb.maps.maritime';
const CCTV_KEY = 'shellb.maps.cctv';

/** Worlds with spacecraft data (server/sky.py): TLEs for Earth, JPL Horizons tracks for the rest. */
const ORBITED = new Set(['earth', 'moon', 'mars', 'mercury']);

const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function takeHandoff(): MapSpec | null {
  try {
    const raw = sessionStorage.getItem(MAPS_HANDOFF);
    sessionStorage.removeItem(MAPS_HANDOFF);
    return raw ? JSON.parse(raw) as MapSpec : null;
  } catch { return null; }
}

function takeFlight(): string | null {
  try {
    const q = sessionStorage.getItem(FLIGHT_HANDOFF);
    sessionStorage.removeItem(FLIGHT_HANDOFF);
    return q;
  } catch { return null; }
}

/** "51.5, -0.12", "51.5 -0.12", "51.5N 0.12W" → lat/lon */
function parseCoords(s: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(s);
  if (!m) return null;
  let lat = +m[1], lon = +m[3];
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (lon > 180) lon -= 360;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

interface Suggestion {
  id: string;
  kind: 'coord' | 'flight' | 'landmark' | 'geocode' | 'feature';
  title: string;
  subtitle?: string;
  lat?: number;
  lon?: number;
  landmark?: Landmark;
  feature?: AnyFeature;
}

function bodyFromHash(): string | null {
  const m = /^#\/(?:worlds|maps)\/([a-zA-Z0-9_-]+)/.exec(location.hash);
  return m ? m[1].toLowerCase() : null;
}

export function MapsApp() {
  const dark = useDarkTheme();
  const [bodies, setBodies] = useState<MapBody[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handoff] = useState(takeHandoff);
  const [flightHandoff] = useState(takeFlight);
  const [bodyId, setBodyId] = useState<string>(() => (
    bodyFromHash() ?? (flightHandoff ? 'earth' : handoff?.body ?? store.get<string>(LAST) ?? 'earth')
  ));
  const [globe, setGlobe] = useState<boolean>(() => handoff?.globe ?? store.get<boolean>(GLOBE) ?? true);
  const [panel, setPanel] = useState(() => window.innerWidth >= 900);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [zoom, setZoom] = useState(0);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [overlay, setOverlay] = useState<MapSpec | null>(handoff);

  // Omnibox search & suggestions
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searching, setSearching] = useState(false);

  // Live flights (Earth only): the traffic layer, and one followed flight
  const [traffic, setTraffic] = useState<boolean>(() => store.get<boolean>(TRAFFIC) ?? false);
  const [planes, setPlanes] = useState<Aircraft[]>([]);
  const [trafficErr, setTrafficErr] = useState<string | null>(null);
  const [flightQ, setFlightQ] = useState<string | null>(flightHandoff);
  const [follow, setFollow] = useState(!!flightHandoff);
  const [sel, setSel] = useState<{ res: FindResult | null; error: string | null; updated: number | null }>({ res: null, error: null, updated: null });
  const [solFocus, setSolFocus] = useState<{ id: string } | null>(null);

  // Spacecraft layer
  const [orbitersOn, setOrbitersOn] = useState<boolean>(() => store.get<boolean>(ORBITERS) ?? false);
  const [orbStatus, setOrbStatus] = useState<{ count: number; error?: string; note?: string } | null>(null);
  const [orbSel, setOrbSel] = useState<OrbiterInfo | null>(null);
  const orbLayer = useRef<OrbiterLayer | null>(null);

  // Landmarks & historic missions layer
  const [landmarksOn, setLandmarksOn] = useState<boolean>(() => store.get<boolean>(LANDMARKS_KEY) ?? true);
  const [landmarkSel, setLandmarkSel] = useState<Landmark | null>(null);
  const landmarkLayer = useRef<LandmarkLayer | null>(null);

  // Real-time Solar Terminator layer
  const [terminatorOn, setTerminatorOn] = useState<boolean>(() => store.get<boolean>(TERMINATOR_KEY) ?? false);
  const termLayer = useRef<{ detach: () => void; update: () => void } | null>(null);

  // Cosmic Night Sky & Celestial Starfield in Globe mode
  const [nightSkyOn, setNightSkyOn] = useState<boolean>(() => store.get<boolean>(NIGHT_SKY_KEY) ?? true);

  // Coordinate Graticule Grid layer
  const [gridOn, setGridOn] = useState<boolean>(() => store.get<boolean>(GRID_KEY) ?? false);
  const gridLayer = useRef<{ detach: () => void } | null>(null);

  // Rover & Expedition Traverses layer (Mars & Moon)
  const [traversesOn, setTraversesOn] = useState<boolean>(() => store.get<boolean>(TRAVERSES_KEY) ?? true);
  const [selectedTraverse, setSelectedTraverse] = useState<{ traverse: Traverse; waypoint: TraverseWaypoint } | null>(null);
  const traverseLayer = useRef<TraverseLayer | null>(null);

  // Live Earthquakes layer (Earth)
  const [earthquakesOn, setEarthquakesOn] = useState<boolean>(() => store.get<boolean>(EARTHQUAKES_KEY) ?? false);

  // Earth feature layers (Shipwrecks, Wonders, Launch Sites, Maritime, CCTV)
  const [shipwrecksOn, setShipwrecksOn] = useState<boolean>(() => store.get<boolean>(SHIPWRECKS_KEY) ?? true);
  const [wondersOn, setWondersOn] = useState<boolean>(() => store.get<boolean>(WONDERS_KEY) ?? true);
  const [launchSitesOn, setLaunchSitesOn] = useState<boolean>(() => store.get<boolean>(LAUNCHSITES_KEY) ?? true);
  const [maritimeOn, setMaritimeOn] = useState<boolean>(() => store.get<boolean>(MARITIME_KEY) ?? true);
  const [cctvOn, setCctvOn] = useState<boolean>(() => store.get<boolean>(CCTV_KEY) ?? true);
  const [selectedFeature, setSelectedFeature] = useState<AnyFeature | null>(null);

  const shipwreckLayer = useRef<ShipwreckLayer | null>(null);
  const wonderLayer = useRef<WonderLayer | null>(null);
  const launchSiteLayer = useRef<LaunchSiteLayer | null>(null);
  const maritimeLayer = useRef<MaritimeLayer | null>(null);
  const cctvLayer = useRef<CCTVLayer | null>(null);

  // Local Sky Horizon modal
  const [skyViewOpen, setSkyViewOpen] = useState(false);

  // Geodesic Measurement tool
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measureUnit, setMeasureUnit] = useState<'metric' | 'imperial' | 'nautical'>(
    () => store.get<'metric' | 'imperial' | 'nautical'>(MEASURE_UNIT) ?? 'metric'
  );

  // Drawers and Modals
  const [directionsOpen, setDirectionsOpen] = useState(() => /[?&]directions\b/.test(location.hash) || /[?&]directions\b/.test(location.search));
  const [activeRoute, setActiveRoute] = useState<RouteData | null>(null);
  const routeMarkers = useRef<ML.Marker[]>([]);

  const [dossierOpen, setDossierOpen] = useState(() => /[?&]dossier\b/.test(location.hash) || /[?&]dossier\b/.test(location.search));
  const [bookmarksOpen, setBookmarksOpen] = useState(() => /[?&]bookmarks\b/.test(location.hash) || /[?&]bookmarks\b/.test(location.search));
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [viewport, setViewport] = useState({ lat: 0, lon: 0, zoom: 2 });

  const [mapGen, setMapGen] = useState(0);  // bumps when a (re)built map has loaded

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ML.Map | null>(null);
  const libRef = useRef<MapLib | null>(null);
  const pinMarker = useRef<ML.Marker | null>(null);

  // Trigger immediate map resize whenever side panels or drawers toggle
  useEffect(() => {
    mapRef.current?.resize();
    const raf = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(raf);
  }, [panel, atlasOpen, dossierOpen, bookmarksOpen, directionsOpen, weatherOpen]);

  // Poll catalog while Earth downloads
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const load = (fresh: boolean) => fetchBodies(fresh).then(b => {
      if (!alive) return;
      setBodies(b); setError(null);
      if (b.some(x => x.downloading != null)) t = setTimeout(() => load(true), 15000);
    }).catch(() => alive && setError('The map service didn’t answer.'));
    load(true);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const body = bodies?.find(b => b.id === bodyId) ?? null;
  const isEarth = body?.id === 'earth';

  // Solar system bodies tree
  const tree = useMemo(() => {
    const maps = new Map((bodies ?? []).map(b => [b.id, b]));
    const known = new Set(SOL_BODIES.map(b => b.id));
    const node = (id: string, name: string) => ({ id, name, map: maps.get(id) ?? null });
    const tops = SOL_BODIES.filter(b => b.kind !== 'star' && b.kind !== 'moon').map(t => {
      const moons = moonsOf(t.id);
      const extra = (bodies ?? []).filter(m => m.parent === t.id && !known.has(m.id));
      const all = [...moons.map(m => ({ ...node(m.id, m.name), major: isMajorMoon(m, moons.length) })), ...extra.map(m => ({ ...node(m.id, m.name), major: true }))];
      return { ...node(t.id, t.name), moons: all };
    });
    const strays = (bodies ?? []).filter(b => !known.has(b.id) && (!b.parent || !known.has(b.parent))).map(b => ({ ...node(b.id, b.name), moons: [] }));
    return [...tops, ...strays];
  }, [bodies]);

  const [worldFilter, setWorldFilter] = useState('');
  const filteredTree = useMemo(() => {
    const q = worldFilter.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .filter(t => t.name.toLowerCase().includes(q) || t.moons.some(m => m.name.toLowerCase().includes(q)))
      .map(t => {
        if (t.name.toLowerCase().includes(q)) return t;
        return { ...t, moons: t.moons.filter(m => m.name.toLowerCase().includes(q)) };
      });
  }, [tree, worldFilter]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const openWorld = useCallback((id: string) => {
    if (id !== 'earth' && !bodies?.find(b => b.id === id)?.available) { setSolFocus({ id }); choose('sol'); }
    else choose(id);
  }, [bodies]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapIds = useMemo(() => new Set((bodies ?? []).filter(b => b.available).map(b => b.id)), [bodies]);

  // (re)build map when world, theme or projection changes
  useEffect(() => {
    if (!body?.available || !box.current) return;
    let gone = false;
    let undraw: (() => void) | null = null;
    (async () => {
      const lib = libRef.current = await loadMapLib();
      const style = await styleFor(body, dark, globe);
      if (gone || !box.current) return;
      const saved = store.get<{ c: [number, number]; z: number; b?: number; p?: number }>(VIEW(body.id));
      const map = new lib.Map({
        container: box.current, style, attributionControl: { compact: true },
        center: saved?.c ?? [0, 20], zoom: saved?.z ?? (globe ? 1.4 : 1.6), bearing: saved?.b ?? 0, pitch: saved?.p ?? 0,
        maxZoom: body.type === 'vector' ? 19 : body.maxzoom + 3, maxPitch: 75,
      });
      mapRef.current = map;
      map.addControl(new lib.NavigationControl({ visualizePitch: true }), 'top-right');
      if (body.id === 'earth') map.addControl(new lib.ScaleControl({ unit: 'metric' }), 'bottom-right');
      map.on('mousemove', e => setCursor({ lat: e.lngLat.lat, lon: e.lngLat.wrap().lng }));
      map.on('mouseout', () => setCursor(null));
      map.on('zoom', () => setZoom(map.getZoom()));
      map.on('moveend', () => {
        const c = map.getCenter().wrap();
        setViewport({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
        store.set(VIEW(body.id), { c: [c.lng, c.lat], z: map.getZoom(), b: map.getBearing(), p: map.getPitch() });
      });

      map.on('click', e => {
        // If measure mode is active, clicks add waypoints
        if (measuring) {
          setMeasurePoints(pts => [...pts, { lat: e.lngLat.lat, lon: e.lngLat.wrap().lng }]);
          return;
        }
        if (map.getLayer('sb-orb') && map.queryRenderedFeatures(e.point, { layers: ['sb-orb'] }).length) return;
        if (map.getLayer('sb-landmarks-circle') && map.queryRenderedFeatures(e.point, { layers: ['sb-landmarks-circle'] }).length) return;
        if (map.getLayer('sb-shipwrecks-circle') && map.queryRenderedFeatures(e.point, { layers: ['sb-shipwrecks-circle'] }).length) return;
        if (map.getLayer('sb-wonders-circle') && map.queryRenderedFeatures(e.point, { layers: ['sb-wonders-circle'] }).length) return;
        if (map.getLayer('sb-launchsites-circle') && map.queryRenderedFeatures(e.point, { layers: ['sb-launchsites-circle'] }).length) return;
        if (map.getLayer('sb-maritime-vessel') && map.queryRenderedFeatures(e.point, { layers: ['sb-maritime-vessel'] }).length) return;
        if (map.getLayer('sb-cctv-circle') && map.queryRenderedFeatures(e.point, { layers: ['sb-cctv-circle'] }).length) return;
        const hit = map.getLayer('sb-planes') ? map.queryRenderedFeatures(e.point, { layers: ['sb-planes'] })[0] : undefined;
        if (hit) { setFlightQ(String(hit.properties?.label ?? hit.properties?.hex)); setFollow(false); return; }
        setPin({ lat: e.lngLat.lat, lon: e.lngLat.wrap().lng });
        setWeatherOpen(false);
      });

      map.on('dragstart', () => setFollow(false));
      map.on('load', () => {
        const c = map.getCenter().wrap();
        setViewport({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
        setZoom(map.getZoom());
        setMapGen(g => g + 1);
        if (overlay && (overlay.body ?? 'earth') === body.id) {
          undraw = drawOverlays(lib, map, overlay);
          frameSpec(lib, map, overlay, false, { top: 140, bottom: 64, left: 64, right: 88 });
        }
      });
    })().catch(e => { console.error('Map engine init failed:', e); !gone && setError(`Map engine: ${(e as Error)?.message || e}`); });

    return () => {
      gone = true;
      undraw?.();
      pinMarker.current?.remove(); pinMarker.current = null;
      mapRef.current?.remove(); mapRef.current = null;
    };
  }, [body?.id, body?.available, dark, globe, overlay, measuring]);

  // Dropped pin marker
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    pinMarker.current?.remove(); pinMarker.current = null;
    if (!pin || !map || !lib) return;
    pinMarker.current = new lib.Marker({ color: '#ff5a36', scale: 0.85 }).setLngLat([pin.lon, pin.lat]).addTo(map);
  }, [pin]);

  // Traffic layer (Earth only)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isEarth || !traffic) { setPlanes([]); setTrafficErr(null); return; }
    let gone = false, t: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(t);
      if (!document.hidden) {
        const c = map.getCenter().wrap();
        try {
          const r = await areaFlights(c.lat, c.lng, viewRadiusNm(map));
          if (!gone) { setPlanes(r.aircraft); setTrafficErr(null); }
        } catch (e) { if (!gone) setTrafficErr((e as Error).message); }
      }
      if (!gone) t = setTimeout(load, 8000);
    };
    const onMove = () => { clearTimeout(t); t = setTimeout(load, 400); };
    map.on('moveend', onMove);
    load();
    return () => { gone = true; clearTimeout(t); map.off('moveend', onMove); };
  }, [mapGen, isEarth, traffic]);

  // Followed flight
  useEffect(() => {
    setSel({ res: null, error: null, updated: null });
    if (!flightQ || !isEarth) return;
    let gone = false, t: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await findFlight(flightQ);
          if (!gone) setSel({ res: r, error: null, updated: Date.now() });
        } catch (e) { if (!gone) setSel(s => ({ ...s, error: (e as Error).message })); }
      }
      if (!gone) t = setTimeout(load, 6000);
    };
    load();
    return () => { gone = true; clearTimeout(t); };
  }, [flightQ, isEarth]);

  // Planes layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapGen || !isEarth || (!traffic && !flightQ)) return;
    const drawPath = pathLayers(map);
    const drawPlanes = planeLayer(map, 'sb-planes', { labels: true });
    const a = sel.res?.aircraft;
    drawPlanes(a ? [...planes.filter(p => p.hex !== a.hex), a] : planes, a?.hex);
    drawPath(flightQ ? sel.res : null);
  }, [mapGen, isEarth, traffic, flightQ, planes, sel.res]);

  // Centering on followed flight
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current, a = sel.res?.aircraft;
    if (!map || !a) return;
    if (flownTo.current !== flightQ) {
      flownTo.current = flightQ;
      map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 7) });
    } else if (follow) {
      map.easeTo({ center: [a.lon, a.lat], duration: 900 });
    }
  }, [sel.res, follow, flightQ, mapGen]);

  // Spacecraft layer
  const orbitable = !!body?.available && ORBITED.has(bodyId);
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    setOrbSel(null); setOrbStatus(null);
    if (!map || !lib || !mapGen || !orbitable || !orbitersOn) return;
    const layer = attachOrbiters(lib, map, bodyId, { onSelect: setOrbSel, onStatus: setOrbStatus });
    orbLayer.current = layer;
    return () => { layer.detach(); orbLayer.current = null; };
  }, [mapGen, bodyId, orbitable, orbitersOn]);

  // Landmarks & Missions layer
  const hasLandmarks = !!body?.available && getLandmarksForBody(bodyId).length > 0;
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    setLandmarkSel(null);
    if (!map || !lib || !mapGen || !hasLandmarks || !landmarksOn) return;
    const layer = attachLandmarks(lib, map, bodyId, { onSelect: setLandmarkSel });
    landmarkLayer.current = layer;
    return () => { layer.detach(); landmarkLayer.current = null; };
  }, [mapGen, bodyId, hasLandmarks, landmarksOn]);

  // Traverses layer (Mars & Moon)
  const hasTraverses = !!body?.available && getTraversesForBody(bodyId).length > 0;
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    setSelectedTraverse(null);
    if (!map || !lib || !mapGen || !hasTraverses || !traversesOn) return;
    const travs = getTraversesForBody(bodyId);
    const layer = attachTraverseLayer(lib, map, travs, (wp, t) => {
      setSelectedTraverse({ traverse: t, waypoint: wp });
    });
    traverseLayer.current = layer;
    return () => { layer.remove(); traverseLayer.current = null; };
  }, [mapGen, bodyId, hasTraverses, traversesOn]);

  // Live Earthquakes layer (Earth)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapGen || !isEarth || !earthquakesOn) return;
    const srcId = 'sb-earthquakes-src';
    const layerId = 'sb-earthquakes-circle';

    map.addSource(srcId, {
      type: 'geojson',
      data: '/api/planetary/earthquakes.geojson?min_mag=2.5',
    });

    map.addLayer({
      id: layerId,
      type: 'circle',
      source: srcId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2.5, 4, 5, 8, 7, 16],
        'circle-color': [
          'interpolate', ['linear'], ['get', 'mag'],
          2.5, '#4ade80',
          4.5, '#facc15',
          6.0, '#fb923c',
          7.5, '#f43f5e'
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#06070c'
      }
    });

    const onClickEq = (e: ML.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const geom = f.geometry as any;
      if (geom?.coordinates) {
        setPin({ lat: geom.coordinates[1], lon: geom.coordinates[0] });
      }
    };

    map.on('click', layerId, onClickEq);
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

    return () => {
      map.off('click', layerId, onClickEq);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    };
  }, [mapGen, isEarth, earthquakesOn]);

  // Shipwrecks layer (Earth)
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth || !shipwrecksOn) {
      shipwreckLayer.current?.detach();
      shipwreckLayer.current = null;
      return;
    }
    const layer = attachShipwrecks(lib, map, w => {
      setSelectedFeature(w ? { kind: 'shipwreck', item: w } : null);
    });
    shipwreckLayer.current = layer;
    return () => { layer.detach(); shipwreckLayer.current = null; };
  }, [mapGen, isEarth, shipwrecksOn]);

  // World Wonders layer (Earth)
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth || !wondersOn) {
      wonderLayer.current?.detach();
      wonderLayer.current = null;
      return;
    }
    const layer = attachWonders(lib, map, w => {
      setSelectedFeature(w ? { kind: 'wonder', item: w } : null);
    });
    wonderLayer.current = layer;
    return () => { layer.detach(); wonderLayer.current = null; };
  }, [mapGen, isEarth, wondersOn]);

  // Launch Sites layer (Earth)
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth || !launchSitesOn) {
      launchSiteLayer.current?.detach();
      launchSiteLayer.current = null;
      return;
    }
    const layer = attachLaunchSites(lib, map, s => {
      setSelectedFeature(s ? { kind: 'launchsite', item: s } : null);
    });
    launchSiteLayer.current = layer;
    return () => { layer.detach(); launchSiteLayer.current = null; };
  }, [mapGen, isEarth, launchSitesOn]);

  // Maritime / Ships at Sea layer (Earth)
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth || !maritimeOn) {
      maritimeLayer.current?.detach();
      maritimeLayer.current = null;
      return;
    }
    const layer = attachMaritime(lib, map, v => {
      setSelectedFeature(v ? { kind: 'vessel', item: v } : null);
    });
    maritimeLayer.current = layer;
    return () => { layer.detach(); maritimeLayer.current = null; };
  }, [mapGen, isEarth, maritimeOn]);

  // Live CCTV layer (Earth)
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth || !cctvOn) {
      cctvLayer.current?.detach();
      cctvLayer.current = null;
      return;
    }
    const layer = attachCCTV(lib, map, c => {
      setSelectedFeature(c ? { kind: 'cctv', item: c } : null);
    });
    cctvLayer.current = layer;
    return () => { layer.detach(); cctvLayer.current = null; };
  }, [mapGen, isEarth, cctvOn]);

  // Solar Terminator layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapGen || !body?.available || !terminatorOn) return;
    const layer = attachTerminator(map);
    termLayer.current = layer;
    return () => { layer.detach(); termLayer.current = null; };
  }, [mapGen, body?.available, terminatorOn]);

  // Coordinate Graticule Grid layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapGen || !body?.available || !gridOn) return;
    const layer = attachGrid(map);
    gridLayer.current = layer;
    return () => { layer.detach(); gridLayer.current = null; };
  }, [mapGen, body?.available, gridOn]);

  // Measure layer
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !body?.available) return;
    if (!measuring || measurePoints.length === 0) {
      detachMeasureLayer(map);
      return;
    }
    attachMeasureLayer(lib, map, measurePoints, cursor);
  }, [mapGen, body?.available, measuring, measurePoints, cursor]);

  // Directions route drawing on map
  useEffect(() => {
    const map = mapRef.current, lib = libRef.current;
    if (!map || !lib || !mapGen || !isEarth) return;
    const SRC_ID = 'sb-app-route';
    routeMarkers.current.forEach(m => m.remove());
    routeMarkers.current = [];

    if (!activeRoute) {
      const src = map.getSource(SRC_ID) as ML.GeoJSONSource | undefined;
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const geojson: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: activeRoute.coords } }],
    };

    const src = map.getSource(SRC_ID) as ML.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson);
    } else {
      map.addSource(SRC_ID, { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'sb-app-route-casing', type: 'line', source: SRC_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#06070c', 'line-width': 7, 'line-opacity': 0.7 },
      });
      map.addLayer({
        id: 'sb-app-route', type: 'line', source: SRC_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3b82f6', 'line-width': 4 },
      });
    }

    const stops = [activeRoute.from, ...(activeRoute.via || []), activeRoute.to];
    routeMarkers.current = stops.map((s, i, all) =>
      new lib.Marker({ color: i === 0 ? '#10b981' : i === all.length - 1 ? '#f43f5e' : '#f59e0b', scale: 0.8 })
        .setLngLat([s.lon, s.lat])
        .setPopup(new lib.Popup({ offset: 22, closeButton: false, className: 'sb-map-popup' }).setText(s.name))
        .addTo(map)
    );

    if (activeRoute.bbox) {
      map.fitBounds([[activeRoute.bbox[0], activeRoute.bbox[1]], [activeRoute.bbox[2], activeRoute.bbox[3]]], {
        padding: { top: 120, bottom: 80, left: 80, right: 380 }, maxZoom: 15, animate: true,
      });
    }
  }, [mapGen, isEarth, activeRoute]);

  const choose = useCallback((id: string) => {
    if (id === bodyId) return;
    if (id !== 'sol') setSolFocus(null);
    setBodyId(id); store.set(LAST, id); setPin(null); setCursor(null);
    setLandmarkSel(null); setMeasurePoints([]); setMeasuring(false);
    setSelectedFeature(null);
    setActiveRoute(null); setDirectionsOpen(false); setWeatherOpen(false);
    setSkyViewOpen(false); setSelectedTraverse(null);
    try { window.history.replaceState(null, '', `#/worlds/${id}`); } catch {}
    if (overlay && (overlay.body ?? 'earth') !== id) setOverlay(null);
    if (window.innerWidth < 900) setPanel(false);
  }, [bodyId, overlay]);

  useEffect(() => {
    const onHash = () => {
      const b = bodyFromHash();
      if (b && b !== bodyId) {
        choose(b);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [bodyId, choose]);

  const toggleGlobe = () => setGlobe(g => { store.set(GLOBE, !g); return !g; });

  // Omnibox suggestions debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const list: Suggestion[] = [];

      // Check coordinates
      const coord = parseCoords(q);
      if (coord) {
        list.push({
          id: 'coord',
          kind: 'coord',
          title: `Go to coordinates: ${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)}`,
          subtitle: 'Decimal latitude & longitude',
          lat: coord.lat,
          lon: coord.lon,
        });
      }

      // Check flights (Earth)
      if (isEarth && /^[a-zA-Z0-9-]{3,8}$/.test(q)) {
        list.push({
          id: `flight-${q}`,
          kind: 'flight',
          title: `Track flight ${q.toUpperCase()}`,
          subtitle: 'ADS-B live telemetry',
        });
      }

      // Search landmarks on current world
      const lms = searchLandmarks(q, bodyId);
      lms.slice(0, 4).forEach(l => {
        list.push({
          id: `lm-${l.id}`,
          kind: 'landmark',
          title: l.name,
          subtitle: [l.kind, l.agency, l.country].filter(Boolean).join(' · '),
          lat: l.lat,
          lon: l.lon,
          landmark: l,
        });
      });

      // Search offline planetary gazetteer (15,700 IAU features)
      if (!isEarth && bodyId !== 'sol') {
        try {
          const r = await fetch(`/api/planetary/search?body=${encodeURIComponent(bodyId)}&q=${encodeURIComponent(q)}&limit=6`);
          if (r.ok && alive) {
            const d = await r.json();
            (d.results || []).forEach((item: { name: string; type: string; lat: number; lon: number; diameter_km: number; origin?: string }) => {
              if (!list.some(existing => Math.abs((existing.lat ?? 0) - item.lat) < 0.001 && Math.abs((existing.lon ?? 0) - item.lon) < 0.001)) {
                list.push({
                  id: `planet-${item.name}-${item.lat}-${item.lon}`,
                  kind: 'landmark',
                  title: item.name,
                  subtitle: [item.type, item.diameter_km > 0 ? `${item.diameter_km} km` : ''].filter(Boolean).join(' · '),
                  lat: item.lat,
                  lon: item.lon,
                  landmark: {
                    id: `iau-${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
                    bodyId: bodyId,
                    name: item.name,
                    kind: item.type.toLowerCase().includes('crater') ? 'crater' : item.type.toLowerCase().includes('mons') ? 'volcano' : 'plain',
                    lat: item.lat,
                    lon: item.lon,
                    diameter: item.diameter_km > 0 ? `${item.diameter_km} km` : undefined,
                    desc: item.origin || `${item.type} on ${bodyId.toUpperCase()}`,
                    status: 'IAU Named Feature'
                  }
                });
              }
            });
          }
        } catch {}
      }

      // Search geocoder on Earth
      if (isEarth) {
        try {
          const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=4`);
          if (r.ok && alive) {
            const d = await r.json();
            (d.results || []).forEach((item: { name: string; full: string; lat: number; lon: number; type: string }) => {
              list.push({
                id: `geo-${item.lat}-${item.lon}`,
                kind: 'geocode',
                title: item.name,
                subtitle: item.full,
                lat: item.lat,
                lon: item.lon,
              });
            });
          }
        } catch {}

        const qLower = q.toLowerCase();

        // Shipwrecks
        SHIPWRECKS.filter(s => s.name.toLowerCase().includes(qLower) || s.vesselType.toLowerCase().includes(qLower)).slice(0, 2).forEach(s => {
          list.push({
            id: `wreck-${s.id}`,
            kind: 'feature',
            title: s.name,
            subtitle: `Historic Shipwreck (${s.yearSunk}) · ${s.vesselType}`,
            lat: s.lat,
            lon: s.lon,
            feature: { kind: 'shipwreck', item: s },
          });
        });

        // World Wonders
        WORLD_WONDERS.filter(w => w.name.toLowerCase().includes(qLower) || w.location.toLowerCase().includes(qLower)).slice(0, 2).forEach(w => {
          list.push({
            id: `wonder-${w.id}`,
            kind: 'feature',
            title: w.name,
            subtitle: `${w.category.toUpperCase()} Wonder · ${w.location}`,
            lat: w.lat,
            lon: w.lon,
            feature: { kind: 'wonder', item: w },
          });
        });

        // Spaceport Launch Sites
        LAUNCH_SITES.filter(ls => ls.name.toLowerCase().includes(qLower) || ls.operator.toLowerCase().includes(qLower)).slice(0, 2).forEach(ls => {
          list.push({
            id: `launch-${ls.id}`,
            kind: 'feature',
            title: ls.name,
            subtitle: `Spaceport · ${ls.operator} (${ls.country})`,
            lat: ls.lat,
            lon: ls.lon,
            feature: { kind: 'launchsite', item: ls },
          });
        });

        // Vessels at Sea
        VESSELS_AT_SEA.filter(v => v.name.toLowerCase().includes(qLower) || v.destination.toLowerCase().includes(qLower)).slice(0, 2).forEach(v => {
          list.push({
            id: `vessel-${v.id}`,
            kind: 'feature',
            title: v.name,
            subtitle: `${v.vesselType} · ${v.speedKnots} kn · ${v.flag}`,
            lat: v.lat,
            lon: v.lon,
            feature: { kind: 'vessel', item: v },
          });
        });

        // Live CCTV Webcams
        CCTV_CAMERAS.filter(c => c.name.toLowerCase().includes(qLower) || c.city.toLowerCase().includes(qLower)).slice(0, 2).forEach(c => {
          list.push({
            id: `cctv-${c.id}`,
            kind: 'feature',
            title: c.name,
            subtitle: `Live Cam · ${c.city}, ${c.country}`,
            lat: c.lat,
            lon: c.lon,
            feature: { kind: 'cctv', item: c },
          });
        });
      }

      if (alive) {
        setSuggestions(list);
        setSearching(false);
      }
    }, 220);

    return () => { alive = false; clearTimeout(timer); };
  }, [searchQuery, isEarth, bodyId]);

  const selectSuggestion = (s: Suggestion) => {
    setSearchFocused(false);
    setSearchQuery('');
    const map = mapRef.current;
    if (s.kind === 'flight') {
      const q = s.title.replace('Track flight ', '').trim().toUpperCase();
      setFlightQ(q); setFollow(true); flownTo.current = null;
      return;
    }
    if (s.kind === 'feature' && s.feature && s.lat != null && s.lon != null) {
      setSelectedFeature(s.feature);
      if (s.feature.kind === 'shipwreck') shipwreckLayer.current?.select(s.feature.item.id);
      else if (s.feature.kind === 'wonder') wonderLayer.current?.select(s.feature.item.id);
      else if (s.feature.kind === 'launchsite') launchSiteLayer.current?.select(s.feature.item.id);
      else if (s.feature.kind === 'vessel') maritimeLayer.current?.select(s.feature.item.id);
      else if (s.feature.kind === 'cctv') cctvLayer.current?.select(s.feature.item.id);
      map?.flyTo({
        center: [s.lon, s.lat],
        zoom: Math.max(map.getZoom(), 12),
        duration: 1200,
      });
      return;
    }
    if (s.lat != null && s.lon != null) {
      if (s.kind === 'landmark' && s.landmark) {
        setLandmarkSel(s.landmark);
        landmarkLayer.current?.select(s.landmark.id);
      } else {
        setPin({ lat: s.lat, lon: s.lon });
      }
      map?.flyTo({
        center: [s.lon, s.lat],
        zoom: Math.max(map.getZoom(), s.kind === 'landmark' ? 7 : isEarth ? 13 : 6),
        duration: 1200,
      });
    }
  };

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0]);
      return;
    }
    const c = parseCoords(searchQuery);
    if (c) {
      setPin(c);
      mapRef.current?.flyTo({ center: [c.lon, c.lat], zoom: Math.max(mapRef.current.getZoom(), isEarth ? 12 : 6) });
      setSearchQuery('');
      setSearchFocused(false);
    }
  };

  const copyPin = () => {
    if (!pin) return;
    navigator.clipboard.writeText(`${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  // Measuring calculations
  const measurePath = useMemo(() => {
    if (measurePoints.length < 2) return null;
    return computePath(measurePoints, body?.radius_km ?? 6371);
  }, [measurePoints, body?.radius_km]);

  return (
    <div className="h-full flex min-h-0 bg-[var(--bg-primary)]">
      {/* Left sidebar: Solar System & Worlds catalog */}
      {panel && (
        <aside className="w-60 shrink-0 border-r border-[var(--border-subtle)] flex flex-col min-h-0 bg-[var(--bg-secondary)]">
          <div className="px-3 pt-3 pb-2 border-b border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Orbit className="w-3.5 h-3.5 text-sky-400" />
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Solar System</h2>
              </div>
              <button
                className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                onClick={() => setPanel(false)}
                title="Hide worlds list"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-2 text-[var(--text-muted)] pointer-events-none" />
              <input
                value={worldFilter}
                onChange={e => setWorldFilter(e.target.value)}
                placeholder="Filter worlds & moons…"
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg pl-7 pr-6 py-1 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-sky-500/50 transition"
              />
              {worldFilter && (
                <button onClick={() => setWorldFilter('')} className="absolute right-2 top-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {!bodies && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="h-8 mx-2 my-1 rounded bg-[var(--bg-tertiary)] animate-pulse" />)}
            {(bodies || error) && (!worldFilter || 'sol (orrery)'.includes(worldFilter.toLowerCase())) && (
              <WorldRow body={{ id: 'sol', name: 'Sol (Orrery)', available: true }} active={bodyId === 'sol'}
                onPick={() => { setSolFocus({ id: 'sol' }); choose('sol'); }} depth={0} star />
            )}
            {filteredTree.map(t => {
              const shown = expanded.has(t.id) ? t.moons : t.moons.filter(m => m.major || m.map);
              const hidden = t.moons.filter(m => !m.major && !m.map).length;
              const row = (w: { id: string; name: string; map: MapBody | null }, depth: 1 | 2) => (
                <WorldRow key={w.id} body={w.map ?? { id: w.id, name: w.name, available: false }} depth={depth} hollow={!w.map}
                  active={w.map ? w.id === bodyId : bodyId === 'sol' && solFocus?.id === w.id}
                  title={w.map ? undefined : `No ${w.name} map installed; view in Sol`} onPick={openWorld} />
              );
              return (
                <div key={t.id} className="mb-1">
                  {row(t, 1)}
                  {shown.map(m => row(m, 2))}
                  {t.moons.some(m => !m.major && !m.map) && (
                    <button className="w-full pl-10 pr-2 py-1 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                      onClick={() => setExpanded(e => { const n = new Set(e); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
                      {expanded.has(t.id) ? 'Fewer moons' : `+${hidden} smaller moon${hidden === 1 ? '' : 's'}`}
                    </button>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
      )}

      {/* Main View Area */}
      <section className="relative flex-1 min-w-0 flex min-h-0">
        <div className="relative flex-1 min-w-0 flex flex-col">
          {bodyId === 'sol' ? (
            <SolView mapIds={mapIds} onOpenMap={choose} focus={solFocus} onShowPanel={panel ? undefined : () => setPanel(true)} />
          ) : (
            <>
              {/* Map container with Astronomical Night Sky */}
              <div className="absolute inset-0 bg-[#020308] overflow-hidden">
                {globe && (
                  <NightSky
                    globe={globe}
                    map={mapRef.current}
                    bodyId={bodyId}
                    enabled={nightSkyOn}
                  />
                )}
                <div ref={box} className="w-full h-full relative z-10" />
              </div>

              {/* TOP TOOLBAR */}
              <div className="absolute top-3 left-3 right-14 flex items-center gap-2 pointer-events-none z-20">
                {!panel && (
                  <button
                    className="pointer-events-auto h-9 w-9 grid place-items-center rounded-xl border border-[var(--border-subtle)] sb-map-glass text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition shadow-sm"
                    onClick={() => setPanel(true)}
                    title="Show solar system worlds"
                  >
                    <PanelLeftOpen className="w-4 h-4" />
                  </button>
                )}

                {/* World Badge & Dossier Trigger */}
                <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] sb-map-glass pl-3 pr-2 py-1.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: WORLD_PALETTE[bodyId.toLowerCase()]?.color ?? '#38bdf8' }}
                    />
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[13px] font-bold tracking-tight text-[var(--text-primary)] leading-none">
                          {body?.name ?? 'Worlds'}
                        </span>
                        {body && (
                          <span className="text-[9px] uppercase tracking-wider font-semibold text-[var(--text-muted)]">
                            {body.parent ? `Moon` : body.kind}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {body && (
                    <button
                      onClick={() => setDossierOpen(d => !d)}
                      className={clsx(
                        'p-1 rounded-lg text-[11px] transition ml-1',
                        dossierOpen
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      )}
                      title="Open scientific dossier and physical parameters"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex-1" />

                {/* OMNIBOX SEARCH */}
                <div className="relative pointer-events-auto">
                  <form onSubmit={submitSearch} className="flex items-center h-9 rounded-xl border border-[var(--border-subtle)] sb-map-glass focus-within:border-sky-500/50 shadow-sm transition">
                    <Search className="w-3.5 h-3.5 ml-2.5 text-[var(--text-muted)] shrink-0" />
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onFocus={() => setSearchFocused(true)}
                      placeholder={isEarth ? 'Search cities, flights, coordinates…' : `Search ${body?.name ?? ''} landmarks, craters…`}
                      className="w-48 sm:w-60 bg-transparent px-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                    />
                    {searching && <Loader2 className="w-3 h-3 animate-spin mr-2 text-[var(--text-muted)]" />}
                    {searchQuery && (
                      <button type="button" onClick={() => { setSearchQuery(''); setSuggestions([]); }} className="mr-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </form>

                  {/* Suggestions dropdown */}
                  {searchFocused && suggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-10 rounded-xl border border-[var(--border-subtle)] sb-map-glass py-1.5 shadow-2xl backdrop-blur-xl z-30 max-h-72 overflow-y-auto">
                      {suggestions.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onMouseDown={() => selectSuggestion(s)}
                          className="w-full px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] flex items-start gap-2 transition"
                        >
                          {s.kind === 'landmark' ? <Flag className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> :
                           s.kind === 'flight' ? <Radar className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" /> :
                           s.kind === 'coord' ? <Crosshair className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" /> :
                           s.kind === 'feature' ? (
                             s.feature?.kind === 'shipwreck' ? <Anchor className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" /> :
                             s.feature?.kind === 'wonder' ? <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" /> :
                             s.feature?.kind === 'launchsite' ? <Rocket className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" /> :
                             s.feature?.kind === 'vessel' ? <Ship className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> :
                             <Video className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                           ) :
                           <Navigation className="w-3.5 h-3.5 text-[var(--accent)] mt-0.5 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{s.title}</div>
                            {s.subtitle && <div className="text-[10px] text-[var(--text-muted)] truncate">{s.subtitle}</div>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* View & Navigation Tools Cluster */}
                <div className="pointer-events-auto flex items-center rounded-xl border border-[var(--border-subtle)] sb-map-glass p-0.5 shadow-sm">
                  {/* Globe / Flat Toggle */}
                  <button
                    className={clsx(
                      'h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium transition',
                      globe ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                    onClick={toggleGlobe} aria-pressed={globe} title="Switch between 3D Globe and 2D Mercator map"
                  >
                    <Globe2 className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden sm:inline">Globe</span>
                  </button>

                  <div className="w-px h-4 bg-[var(--border-subtle)] my-auto" />

                  {/* Geodesic Ruler / Measure Tool */}
                  <button
                    className={clsx(
                      'h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium transition',
                      measuring ? 'bg-teal-500/20 text-teal-300 font-semibold shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                    onClick={() => {
                      setMeasuring(m => !m);
                      if (measuring) setMeasurePoints([]);
                    }}
                    aria-pressed={measuring} title="Measure great-circle geodesic distances"
                  >
                    <Ruler className="w-3.5 h-3.5 text-teal-400" />
                    <span className="hidden md:inline">Measure</span>
                  </button>

                  {/* Directions Button (Earth) */}
                  {isEarth && (
                    <>
                      <div className="w-px h-4 bg-[var(--border-subtle)] my-auto" />
                      <button
                        className={clsx(
                          'h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium transition',
                          directionsOpen ? 'bg-sky-500/20 text-sky-300 font-semibold shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        )}
                        onClick={() => {
                          setDirectionsOpen(o => !o);
                          if (bookmarksOpen) setBookmarksOpen(false);
                          if (dossierOpen) setDossierOpen(false);
                        }}
                        aria-pressed={directionsOpen} title="Offline turn-by-turn routing (Valhalla)"
                      >
                        <RouteIcon className="w-3.5 h-3.5 text-[var(--accent)]" />
                        <span className="hidden md:inline">Routes</span>
                      </button>
                    </>
                  )}

                  <div className="w-px h-4 bg-[var(--border-subtle)] my-auto" />

                  {/* Bookmarks */}
                  <button
                    className={clsx(
                      'h-8 px-2.5 flex items-center rounded-lg text-[12px] transition',
                      bookmarksOpen ? 'bg-amber-500/20 text-amber-300 shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                    onClick={() => {
                      setBookmarksOpen(o => !o);
                      if (directionsOpen) setDirectionsOpen(false);
                      if (dossierOpen) setDossierOpen(false);
                    }}
                    aria-pressed={bookmarksOpen} title="Curated tours and saved locations"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                  </button>
                </div>

                {/* Interactive Map Features & Telemetry Menu */}
                <FeaturesMenu
                  isEarth={isEarth}
                  hasLandmarks={hasLandmarks}
                  hasTraverses={hasTraverses}
                  orbitable={orbitable}
                  bodyName={body?.name ?? bodyId}
                  globe={globe}
                  orbitersOn={orbitersOn}
                  setOrbitersOn={v => { store.set(ORBITERS, v); setOrbitersOn(v); }}
                  traffic={traffic}
                  setTraffic={v => { store.set(TRAFFIC, v); setTraffic(v); }}
                  shipwrecksOn={shipwrecksOn}
                  setShipwrecksOn={v => { store.set(SHIPWRECKS_KEY, v); setShipwrecksOn(v); }}
                  wondersOn={wondersOn}
                  setWondersOn={v => { store.set(WONDERS_KEY, v); setWondersOn(v); }}
                  launchSitesOn={launchSitesOn}
                  setLaunchSitesOn={v => { store.set(LAUNCHSITES_KEY, v); setLaunchSitesOn(v); }}
                  maritimeOn={maritimeOn}
                  setMaritimeOn={v => { store.set(MARITIME_KEY, v); setMaritimeOn(v); }}
                  cctvOn={cctvOn}
                  setCctvOn={v => { store.set(CCTV_KEY, v); setCctvOn(v); }}
                  earthquakesOn={earthquakesOn}
                  setEarthquakesOn={v => { store.set(EARTHQUAKES_KEY, v); setEarthquakesOn(v); }}
                  terminatorOn={terminatorOn}
                  setTerminatorOn={v => { store.set(TERMINATOR_KEY, v); setTerminatorOn(v); }}
                  gridOn={gridOn}
                  setGridOn={v => { store.set(GRID_KEY, v); setGridOn(v); }}
                  nightSkyOn={nightSkyOn}
                  setNightSkyOn={v => { store.set(NIGHT_SKY_KEY, v); setNightSkyOn(v); }}
                  landmarksOn={landmarksOn}
                  setLandmarksOn={v => { store.set(LANDMARKS_KEY, v); setLandmarksOn(v); }}
                  traversesOn={traversesOn}
                  setTraversesOn={v => { store.set(TRAVERSES_KEY, v); setTraversesOn(v); }}
                  orbiterCount={orbStatus?.count}
                  planeCount={planes.length}
                />

                {/* Atlas Copilot Trigger Pill */}
                <button
                  className={clsx(
                    'pointer-events-auto h-9 px-3.5 flex items-center gap-2 rounded-xl border text-[12px] transition sb-map-glass font-semibold shadow-md',
                    atlasOpen
                      ? 'border-sky-400 bg-sky-500/20 text-sky-200 shadow-sky-500/20 ring-1 ring-sky-400/40'
                      : 'border-sky-500/40 text-sky-400 hover:text-sky-300 hover:border-sky-400 hover:shadow-sky-500/10'
                  )}
                  onClick={() => {
                    setAtlasOpen(o => !o);
                    if (dossierOpen) setDossierOpen(false);
                    if (directionsOpen) setDirectionsOpen(false);
                    if (bookmarksOpen) setBookmarksOpen(false);
                  }}
                  aria-pressed={atlasOpen} title="Open Atlas AI Planetary Copilot"
                >
                  <Compass className="w-3.5 h-3.5 text-sky-400" />
                  <span>Atlas</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                </button>
              </div>

              {/* MEASURING HUD RIBBON */}
              {measuring && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 rounded-xl border border-teal-500/40 sb-map-glass shadow-2xl backdrop-blur-md text-[12px]">
                  <div className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-teal-400 shrink-0" />
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Total Distance</span>
                      <span className="text-[16px] font-bold text-teal-300 font-mono tabular-nums">
                        {measurePath ? formatDist(measurePath.totalKm, measureUnit) : '0 km'}
                      </span>
                    </div>
                  </div>

                  {measurePath && measurePath.segments.length > 0 && (
                    <div className="border-l border-[var(--border-subtle)] pl-3 text-[11px] text-[var(--text-secondary)]">
                      <div>{measurePoints.length} points ({measurePath.segments.length} legs)</div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Bearing: {measurePath.segments[measurePath.segments.length - 1].bearingCompass} ({Math.round(measurePath.segments[measurePath.segments.length - 1].bearingDeg)}°)
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 border-l border-[var(--border-subtle)] pl-3">
                    <button
                      onClick={() => setMeasureUnit(u => u === 'metric' ? 'imperial' : u === 'imperial' ? 'nautical' : 'metric')}
                      className="px-2 py-1 rounded bg-[var(--bg-tertiary)] font-mono text-[10px] uppercase text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      title="Switch unit"
                    >
                      {measureUnit}
                    </button>
                    {measurePoints.length > 0 && (
                      <button
                        onClick={() => setMeasurePoints(pts => pts.slice(0, -1))}
                        className="px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        title="Undo point"
                      >
                        Undo
                      </button>
                    )}
                    <button
                      onClick={() => { setMeasuring(false); setMeasurePoints([]); }}
                      className="px-2.5 py-1 rounded bg-teal-500 text-slate-950 font-semibold text-[11px] hover:bg-teal-400 transition"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}

              {/* Selected interactive map feature modal (Shipwrecks, Wonders, Launch Sites, Vessels, CCTV) */}
              {selectedFeature && (
                <div className="absolute top-16 left-3 z-30">
                  <MapFeatureModal
                    feature={selectedFeature}
                    onClose={() => {
                      setSelectedFeature(null);
                      shipwreckLayer.current?.select(null);
                      wonderLayer.current?.select(null);
                      launchSiteLayer.current?.select(null);
                      maritimeLayer.current?.select(null);
                      cctvLayer.current?.select(null);
                    }}
                    onFlyTo={(la, lo) => {
                      mapRef.current?.flyTo({ center: [lo, la], zoom: Math.max(mapRef.current.getZoom(), 12), duration: 1200 });
                    }}
                  />
                </div>
              )}

              {/* Landmark / Mission details modal card */}
              {landmarkSel && (
                <div className="absolute top-16 left-3 z-30">
                  <LandmarkModal
                    landmark={landmarkSel}
                    onClose={() => { setLandmarkSel(null); landmarkLayer.current?.select(null); }}
                    onFlyTo={(la, lo) => {
                      mapRef.current?.flyTo({ center: [lo, la], zoom: Math.max(mapRef.current.getZoom(), isEarth ? 14 : 7), duration: 1200 });
                    }}
                  />
                </div>
              )}

              {/* Weather popup on dropped pin */}
              {weatherOpen && pin && isEarth && (
                <div className="absolute bottom-14 left-3 z-30">
                  <LiveWeatherWidget lat={pin.lat} lon={pin.lon} onClose={() => setWeatherOpen(false)} />
                </div>
              )}

              {/* Rover & Expedition Traverse Waypoint Modal */}
              {selectedTraverse && (
                <TraverseModal
                  traverse={selectedTraverse.traverse}
                  waypoint={selectedTraverse.waypoint}
                  onSelectWaypoint={wp => setSelectedTraverse({ traverse: selectedTraverse.traverse, waypoint: wp })}
                  onFlyTo={(la, lo, zm) => {
                    mapRef.current?.flyTo({ center: [lo, la], zoom: zm ?? Math.max(mapRef.current.getZoom(), 14), duration: 1000 });
                  }}
                  onClose={() => setSelectedTraverse(null)}
                />
              )}

              {/* Local Sky View Horizon Modal */}
              {skyViewOpen && pin && (
                <SkyViewModal
                  bodyId={bodyId}
                  bodyName={body?.name ?? bodyId}
                  lat={pin.lat}
                  lon={pin.lon}
                  onClose={() => setSkyViewOpen(false)}
                  onAskAtlas={() => {
                    setAtlasOpen(true);
                  }}
                />
              )}

              {/* Followed flight panel */}
              {isEarth && flightQ && (
                <div className="absolute top-16 right-14 w-80 max-w-[calc(100%-5rem)] max-h-[calc(100%-6rem)] overflow-y-auto rounded-lg border border-[var(--border-subtle)] sb-map-glass z-20">
                  <FlightPanel res={sel.res} error={sel.error} updated={sel.updated} loadingLabel={`Looking for ${flightQ}…`}
                    onClose={() => { setFlightQ(null); setFollow(false); }} />
                  {sel.res?.aircraft && (
                    <div className="px-3.5 pb-3">
                      <button className={clsx('w-full h-8 flex items-center justify-center gap-1.5 rounded-md border text-[12px] transition',
                        follow ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}
                        onClick={() => setFollow(f => !f)} aria-pressed={follow}>
                        <LocateFixed className="w-3.5 h-3.5" /> {follow ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Selected spacecraft */}
              {orbitable && orbitersOn && orbSel && (
                <div className="absolute bottom-12 right-3 w-64 rounded-lg border border-[var(--border-subtle)] sb-map-glass p-3 text-[12px] z-20">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] leading-tight font-semibold tracking-tight truncate">{orbSel.name}</div>
                      {orbSel.mission && <div className="text-[11px] text-[var(--text-muted)] truncate">{orbSel.mission}</div>}
                    </div>
                    <button className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => orbLayer.current?.select(null)} title="Close"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {([['Latitude', `${Math.abs(orbSel.lat).toFixed(2)}° ${orbSel.lat >= 0 ? 'N' : 'S'}`], ['Longitude', `${Math.abs(orbSel.lon).toFixed(2)}° ${orbSel.lon >= 0 ? 'E' : 'W'}`],
                      ['Altitude', `${Math.round(orbSel.alt).toLocaleString()} km`], [isEarth ? 'Speed' : 'Ground speed', `${orbSel.speed.toFixed(2)} km/s`]] as [string, string][]).map(([k, v]) => (
                      <div key={k}><dt className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{k}</dt><dd className="font-mono tabular-nums">{v}</dd></div>
                    ))}
                  </dl>
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                    <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#d95926]" />last 45 min</span>
                    <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-[var(--text-secondary)]" />next 90 min</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-muted)]">{isEarth ? 'Computed here from Celestrak elements' : 'Ground track from JPL Horizons'}</div>
                </div>
              )}

              {/* Status messages */}
              {orbitable && orbitersOn && orbStatus && (orbStatus.error || orbStatus.note) && (
                <div className={clsx('absolute top-16 left-3 rounded-md border sb-map-glass px-2 py-1 text-[11px] z-10', orbStatus.error ? 'border-amber-500/40 text-amber-300' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]')}>
                  {orbStatus.error ? `Satellites: ${orbStatus.error}` : orbStatus.note}
                </div>
              )}
              {isEarth && traffic && trafficErr && (
                <div className="absolute top-16 left-3 rounded-md border border-amber-500/40 sb-map-glass px-2 py-1 text-[11px] text-amber-300 z-10">{trafficErr}</div>
              )}

              {/* BOTTOM READOUT & PIN ACTIONS */}
              {body?.available && (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 pointer-events-none z-20">
                  <div className="rounded-xl border border-[var(--border-subtle)] sb-map-glass px-3 py-1.5 font-mono text-[11px] tabular-nums text-[var(--text-secondary)] shadow-lg flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400/80 animate-pulse" />
                    <span>{cursor ? fmtCoord(cursor.lat, cursor.lon) : 'Point cursor'}</span>
                    <span className="text-[var(--border-subtle)]">|</span>
                    <span className="text-[var(--text-muted)] font-sans text-[10px] uppercase tracking-wider font-semibold">
                      z{zoom.toFixed(1)}
                    </span>
                  </div>

                  {pin && (
                    <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-sky-500/40 sb-map-glass pl-3 pr-1.5 py-1.5 text-[11px] shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span className="font-mono tabular-nums text-[var(--text-primary)] font-semibold">
                          {pin.lat.toFixed(4)}°, {pin.lon.toFixed(4)}°
                        </span>
                      </div>

                      <div className="w-px h-4 bg-[var(--border-subtle)] my-auto" />

                      <button
                        className="p-1 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
                        onClick={copyPin}
                        title="Copy coordinates"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>

                      <button
                        className={clsx(
                          'px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition',
                          skyViewOpen
                            ? 'bg-sky-500 text-white shadow-sm'
                            : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-500/30'
                        )}
                        onClick={() => setSkyViewOpen(s => !s)}
                        title="Simulate local celestial sky dome from here"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Sky View</span>
                      </button>

                      {isEarth && (
                        <button
                          className={clsx(
                            'p-1.5 rounded-md transition',
                            weatherOpen ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                          )}
                          onClick={() => setWeatherOpen(w => !w)}
                          title="View weather at pin"
                        >
                          <Thermometer className="w-3.5 h-3.5 text-amber-400" />
                        </button>
                      )}

                      {isEarth && (
                        <button
                          className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition"
                          onClick={() => { setDirectionsOpen(true); }}
                          title="Directions to/from here"
                        >
                          <RouteIcon className="w-3.5 h-3.5 text-[var(--accent)]" />
                        </button>
                      )}

                      <button
                        className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                        onClick={() => { setPin(null); setWeatherOpen(false); setSkyViewOpen(false); }}
                        title="Remove pin"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Empty / Error state */}
              {(error || (body && !body.available) || (bodies && !body)) && (
                <div className="absolute inset-0 grid place-items-center p-6 z-10 bg-[#06070c]">
                  <div className="max-w-sm text-center">
                    {body?.downloading != null ? (
                      <>
                        <Download className="w-6 h-6 mx-auto text-[var(--text-muted)]" />
                        <h3 className="mt-3 text-[15px] font-semibold tracking-tight">The {body.name} map is downloading</h3>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">The full OpenStreetMap planet is about 139 GB. It appears here as soon as it finishes; other worlds work meanwhile.</p>
                        <div className="mt-4 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                          <div className="h-full bg-[var(--accent)] transition-[width] duration-700" style={{ width: `${Math.round(body.downloading * 100)}%` }} />
                        </div>
                        <div className="mt-1.5 text-[11px] tabular-nums text-[var(--text-muted)]">{(body.downloading * 100).toFixed(1)}%</div>
                      </>
                    ) : (
                      <>
                        <Orbit className="w-6 h-6 mx-auto text-[var(--text-muted)]" />
                        <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{error ?? (body ? `No ${body.name} tiles installed` : 'That world isn’t in the catalogue')}</h3>
                        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">Map data lives in ~/shellb/maps on the Spark.</p>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!bodies && !error && <div className="absolute inset-0 grid place-items-center z-10 bg-[#06070c]"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>}
            </>
          )}
        </div>

        {/* RIGHT DRAWERS (Directions / Dossier / Bookmarks) */}
        {directionsOpen && isEarth && (
          <aside className="shrink-0 h-full z-30">
            <DirectionsPanel
              pinCoord={pin}
              onRouteReady={setActiveRoute}
              onStepClick={st => {
                if (st.at && mapRef.current) {
                  mapRef.current.flyTo({ center: st.at, zoom: Math.max(mapRef.current.getZoom(), 15), duration: 700 });
                }
              }}
              onClose={() => { setDirectionsOpen(false); setActiveRoute(null); }}
            />
          </aside>
        )}

        {dossierOpen && (
          <aside className="shrink-0 h-full z-30">
            <DossierDrawer
              bodyId={bodyId}
              onClose={() => setDossierOpen(false)}
              onOpenSol={id => {
                setSolFocus({ id });
                choose('sol');
                setDossierOpen(false);
              }}
            />
          </aside>
        )}

        {bookmarksOpen && (
          <aside className="shrink-0 h-full z-30">
            <BookmarksModal
              currentBodyId={bodyId}
              pinCoord={pin}
              onSelect={bm => {
                if (bm.bodyId.toLowerCase() !== bodyId.toLowerCase()) {
                  choose(bm.bodyId.toLowerCase());
                }
                setTimeout(() => {
                  mapRef.current?.flyTo({
                    center: [bm.lon, bm.lat],
                    zoom: bm.zoom,
                    bearing: bm.bearing ?? 0,
                    pitch: bm.pitch ?? 0,
                    duration: 1500,
                  });
                  setPin({ lat: bm.lat, lon: bm.lon });
                }, 100);
              }}
              onClose={() => setBookmarksOpen(false)}
            />
          </aside>
        )}

        {atlasOpen && (
          <aside className="shrink-0 h-full z-30">
            <AtlasCopilot
              isOpen={atlasOpen}
              onClose={() => setAtlasOpen(false)}
              bodyId={bodyId}
              bodyName={body?.name ?? bodyId}
              viewport={viewport}
              selectedLandmark={landmarkSel}
              onFlyTo={target => {
                if (target.body && target.body.toLowerCase() !== bodyId.toLowerCase()) {
                  choose(target.body.toLowerCase());
                }
                setTimeout(() => {
                  mapRef.current?.flyTo({
                    center: [target.lon, target.lat],
                    zoom: target.zoom ?? 7,
                    duration: 1500,
                  });
                  setPin({ lat: target.lat, lon: target.lon });
                }, 100);
              }}
              onApplyOverlay={spec => {
                setOverlay(spec);
              }}
            />
          </aside>
        )}
      </section>
    </div>
  );
}

const INDENT = ['pl-2', 'pl-6', 'pl-10'];

function WorldRow({ body, active, onPick, depth, star, hollow, title }: {
  body: Pick<MapBody, 'id' | 'name' | 'available'> & Partial<MapBody>; active: boolean; onPick: (id: string) => void;
  depth: 0 | 1 | 2; star?: boolean; hollow?: boolean; title?: string;
}) {
  const moon = depth === 2;
  const palette = WORLD_PALETTE[body.id.toLowerCase()] ?? { color: '#94a3b8' };
  const hasMap = Boolean(body.available && body.id !== 'sol');

  return (
    <button
      onClick={() => onPick(body.id)}
      aria-current={active ? 'page' : undefined}
      title={title}
      className={clsx(
        'group w-full flex items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-[12.5px] transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]',
        INDENT[depth],
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium shadow-xs'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/60 hover:text-[var(--text-primary)]',
        !body.available && !hollow && 'opacity-60',
        hollow && !active && 'text-[var(--text-muted)]'
      )}
    >
      <span
        className={clsx(
          'shrink-0 rounded-full transition-all duration-150',
          moon ? 'w-2 h-2' : star ? 'w-3 h-3' : 'w-2.5 h-2.5',
          hollow && 'border border-dashed'
        )}
        style={{
          backgroundColor: hollow ? 'transparent' : palette.color,
          borderColor: hollow ? palette.color : undefined,
          boxShadow: active ? `0 0 8px ${palette.color}aa` : undefined,
          opacity: hollow && !active ? 0.45 : !body.available && !hollow ? 0.6 : 1,
        }}
      />
      <span className={clsx('flex-1 truncate', (!moon || active) && 'font-medium')}>
        {body.name}
      </span>
      {hasMap && (
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20 group-hover:bg-sky-500/20 transition">
          Map
        </span>
      )}
      {body.downloading != null && (
        <span className="shrink-0 text-[10px] tabular-nums font-mono text-amber-400 font-medium">
          {Math.round(body.downloading * 100)}%
        </span>
      )}
    </button>
  );
}
