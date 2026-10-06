// Interactive Map Features & Telemetry Menu for Shell:B Worlds.
// Contains all toggleable layers: satellites, flights, shipwrecks, wonders, launch sites, ships at sea, CCTV, etc.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Anchor,
  Check,
  ChevronDown,
  Compass,
  Eye,
  Layers,
  Navigation,
  Radar,
  Radio,
  Rocket,
  Satellite,
  Search,
  Ship,
  Sparkles,
  Sun,
  Video,
  X,
  Zap
} from 'lucide-react';
import { SHIPWRECKS } from './shipwrecks';
import { WORLD_WONDERS } from './wonders';
import { LAUNCH_SITES } from './launchsites';
import { VESSELS_AT_SEA } from './maritime';
import { CCTV_CAMERAS } from './cctv';

export interface FeaturesMenuProps {
  isEarth: boolean;
  hasLandmarks: boolean;
  hasTraverses: boolean;
  orbitable: boolean;
  bodyName: string;
  globe?: boolean;

  // Layer States & Setters
  orbitersOn: boolean;
  setOrbitersOn: (v: boolean) => void;
  traffic: boolean; // flights
  setTraffic: (v: boolean) => void;
  shipwrecksOn: boolean;
  setShipwrecksOn: (v: boolean) => void;
  wondersOn: boolean;
  setWondersOn: (v: boolean) => void;
  launchSitesOn: boolean;
  setLaunchSitesOn: (v: boolean) => void;
  maritimeOn: boolean;
  setMaritimeOn: (v: boolean) => void;
  cctvOn: boolean;
  setCctvOn: (v: boolean) => void;
  earthquakesOn: boolean;
  setEarthquakesOn: (v: boolean) => void;
  terminatorOn: boolean;
  setTerminatorOn: (v: boolean) => void;
  gridOn: boolean;
  setGridOn: (v: boolean) => void;
  nightSkyOn?: boolean;
  setNightSkyOn?: (v: boolean) => void;
  landmarksOn: boolean;
  setLandmarksOn: (v: boolean) => void;
  traversesOn: boolean;
  setTraversesOn: (v: boolean) => void;

  // Telemetry counts
  orbiterCount?: number;
  planeCount?: number;
  earthquakeCount?: number;
}

type CategoryTab = 'all' | 'live' | 'places' | 'planet';

export function FeaturesMenu({
  isEarth,
  hasLandmarks,
  hasTraverses,
  orbitable,
  bodyName,
  globe,
  orbitersOn,
  setOrbitersOn,
  traffic,
  setTraffic,
  shipwrecksOn,
  setShipwrecksOn,
  wondersOn,
  setWondersOn,
  launchSitesOn,
  setLaunchSitesOn,
  maritimeOn,
  setMaritimeOn,
  cctvOn,
  setCctvOn,
  earthquakesOn,
  setEarthquakesOn,
  terminatorOn,
  setTerminatorOn,
  gridOn,
  setGridOn,
  nightSkyOn,
  setNightSkyOn,
  landmarksOn,
  setLandmarksOn,
  traversesOn,
  setTraversesOn,
  orbiterCount,
  planeCount,
}: FeaturesMenuProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CategoryTab>('all');
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Active layer counter
  const activeCount = [
    orbitable && orbitersOn,
    isEarth && traffic,
    isEarth && shipwrecksOn,
    isEarth && wondersOn,
    isEarth && launchSitesOn,
    isEarth && maritimeOn,
    isEarth && cctvOn,
    isEarth && earthquakesOn,
    terminatorOn,
    gridOn,
    globe && nightSkyOn,
    hasLandmarks && landmarksOn,
    hasTraverses && traversesOn,
  ].filter(Boolean).length;

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Bulk enable / disable
  const toggleAll = (enable: boolean) => {
    if (orbitable) setOrbitersOn(enable);
    if (isEarth) {
      setTraffic(enable);
      setShipwrecksOn(enable);
      setWondersOn(enable);
      setLaunchSitesOn(enable);
      setMaritimeOn(enable);
      setCctvOn(enable);
      setEarthquakesOn(enable);
    }
    setTerminatorOn(enable);
    setGridOn(enable);
    if (globe && setNightSkyOn) setNightSkyOn(enable);
    if (hasLandmarks) setLandmarksOn(enable);
    if (hasTraverses) setTraversesOn(enable);
  };

  const featureItems = useMemo(() => [
    // ── LIVE TELEMETRY ───────────────────────────────────────────────────────
    {
      id: 'satellites',
      category: 'live' as const,
      visible: orbitable,
      icon: <Satellite className="w-4 h-4 text-sky-400" />,
      label: globe ? 'Satellites (3D Orbit)' : 'Satellites & Orbiters',
      desc: globe ? '3D orbital altitude, trajectory rings, and ground nadir stalks' : 'Real-time orbital tracking and telemetry',
      badge: orbiterCount ? `${orbiterCount} in orbit` : 'Live TLE / Horizons',
      badgeColor: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
      checked: orbitersOn,
      onChange: () => setOrbitersOn(!orbitersOn),
    },
    {
      id: 'flights',
      category: 'live' as const,
      visible: isEarth,
      icon: <Radar className="w-4 h-4 text-cyan-400" />,
      label: 'Flights (Air Traffic)',
      desc: 'OpenSky live commercial aircraft, flight paths, and transponder telemetry',
      badge: planeCount && planeCount > 0 ? `${planeCount} tracked` : 'Live ADS-B',
      badgeColor: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
      checked: traffic,
      onChange: () => setTraffic(!traffic),
    },
    {
      id: 'maritime',
      category: 'live' as const,
      visible: isEarth,
      icon: <Ship className="w-4 h-4 text-emerald-400" />,
      label: 'Ships at Sea (Maritime)',
      desc: 'Cargo carriers, supertankers, research vessels, and liners traversing oceans',
      badge: `${VESSELS_AT_SEA.length} vessels`,
      badgeColor: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
      checked: maritimeOn,
      onChange: () => setMaritimeOn(!maritimeOn),
    },
    {
      id: 'cctv',
      category: 'live' as const,
      visible: isEarth,
      icon: <Video className="w-4 h-4 text-rose-400" />,
      label: 'CCTV & Live Webcams',
      desc: '24/7 public streaming cameras from Times Square, Shibuya, ISS Earth cam, etc.',
      badge: `${CCTV_CAMERAS.length} live cams`,
      badgeColor: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
      checked: cctvOn,
      onChange: () => setCctvOn(!cctvOn),
    },
    {
      id: 'earthquakes',
      category: 'live' as const,
      visible: isEarth,
      icon: <Activity className="w-4 h-4 text-red-400" />,
      label: 'Live Earthquakes (USGS)',
      desc: 'Real-time global seismic feeds and epicenter depth monitoring',
      badge: 'USGS M2.5+',
      badgeColor: 'text-red-300 bg-red-500/10 border-red-500/30',
      checked: earthquakesOn,
      onChange: () => setEarthquakesOn(!earthquakesOn),
    },

    // ── PLACES & EXPLORATION ────────────────────────────────────────────────
    {
      id: 'shipwrecks',
      category: 'places' as const,
      visible: isEarth,
      icon: <Anchor className="w-4 h-4 text-teal-400" />,
      label: 'Historic Shipwrecks',
      desc: 'Titanic, Bismarck, Endurance, Edmund Fitzgerald, and famous deep-sea wrecks',
      badge: `${SHIPWRECKS.length} wrecks`,
      badgeColor: 'text-teal-300 bg-teal-500/10 border-teal-500/30',
      checked: shipwrecksOn,
      onChange: () => setShipwrecksOn(!shipwrecksOn),
    },
    {
      id: 'wonders',
      category: 'places' as const,
      visible: isEarth,
      icon: <Sparkles className="w-4 h-4 text-amber-400" />,
      label: 'Wonders of the World',
      desc: 'Seven Wonders of the Ancient World, New 7 Wonders, and iconic Natural Wonders',
      badge: `${WORLD_WONDERS.length} wonders`,
      badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
      checked: wondersOn,
      onChange: () => setWondersOn(!wondersOn),
    },
    {
      id: 'launchsites',
      category: 'places' as const,
      visible: isEarth,
      icon: <Rocket className="w-4 h-4 text-orange-400" />,
      label: 'Launch Sites & Spaceports',
      desc: 'Kennedy Space Center, Starbase, Baikonur, Kourou, Tanegashima, and global pads',
      badge: `${LAUNCH_SITES.length} spaceports`,
      badgeColor: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
      checked: launchSitesOn,
      onChange: () => setLaunchSitesOn(!launchSitesOn),
    },
    {
      id: 'landmarks',
      category: 'places' as const,
      visible: hasLandmarks,
      icon: <Zap className="w-4 h-4 text-violet-400" />,
      label: 'Historic Missions & Landers',
      desc: 'Apollo landing sites, Viking, Surveyor, and planetary exploration milestones',
      badge: 'Historic Sites',
      badgeColor: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
      checked: landmarksOn,
      onChange: () => setLandmarksOn(!landmarksOn),
    },
    {
      id: 'traverses',
      category: 'places' as const,
      visible: hasTraverses,
      icon: <Navigation className="w-4 h-4 text-amber-400" />,
      label: 'Rover & EVA Traverses',
      desc: 'Perseverance, Curiosity, Apollo lunar rover tracks and science waypoints',
      badge: 'Rover Tracks',
      badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
      checked: traversesOn,
      onChange: () => setTraversesOn(!traversesOn),
    },

    // ── PLANET & ENVIRONMENT ────────────────────────────────────────────────
    {
      id: 'terminator',
      category: 'planet' as const,
      visible: true,
      icon: <Sun className="w-4 h-4 text-amber-400" />,
      label: 'Solar Terminator',
      desc: 'Astronomical real-time day and night boundary across the globe',
      badge: 'Real-time Sun',
      badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
      checked: terminatorOn,
      onChange: () => setTerminatorOn(!terminatorOn),
    },
    {
      id: 'grid',
      category: 'planet' as const,
      visible: true,
      icon: <Compass className="w-4 h-4 text-indigo-400" />,
      label: 'Coordinate Graticule',
      desc: 'Latitude, longitude, equator, and prime meridian grid lines',
      badge: 'Lat / Lon Grid',
      badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
      checked: gridOn,
      onChange: () => setGridOn(!gridOn),
    },
    {
      id: 'nightsky',
      category: 'planet' as const,
      visible: !!globe && !!setNightSkyOn,
      icon: <Sparkles className="w-4 h-4 text-indigo-300" />,
      label: 'Cosmic Night Sky',
      desc: 'Astronomical starfield, Milky Way dust lane, and planetary atmospheric limb',
      badge: 'Globe Mode',
      badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
      checked: !!nightSkyOn,
      onChange: () => setNightSkyOn?.(!nightSkyOn),
    },
  ], [
    orbitable, isEarth, hasLandmarks, hasTraverses, globe,
    orbitersOn, setOrbitersOn, orbiterCount,
    traffic, setTraffic, planeCount,
    maritimeOn, setMaritimeOn,
    cctvOn, setCctvOn,
    earthquakesOn, setEarthquakesOn,
    shipwrecksOn, setShipwrecksOn,
    wondersOn, setWondersOn,
    launchSitesOn, setLaunchSitesOn,
    landmarksOn, setLandmarksOn,
    traversesOn, setTraversesOn,
    terminatorOn, setTerminatorOn,
    gridOn, setGridOn,
    nightSkyOn, setNightSkyOn,
  ]);

  const filteredItems = useMemo(() => {
    return featureItems.filter(item => {
      if (!item.visible) return false;
      if (category !== 'all' && item.category !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.badge.toLowerCase().includes(q);
      }
      return true;
    });
  }, [featureItems, category, search]);

  return (
    <div ref={menuRef} className="relative pointer-events-auto">
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={clsx(
          'h-9 px-3.5 flex items-center gap-2 rounded-xl border text-[12px] font-semibold transition sb-map-glass shadow-md',
          open || activeCount > 0
            ? 'border-sky-500/60 bg-sky-500/15 text-sky-200 shadow-sky-500/10 ring-1 ring-sky-500/30'
            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-sky-500/40'
        )}
        title="Toggle map features: satellites, flights, shipwrecks, wonders, launch sites, ships, CCTV"
      >
        <Layers className={clsx('w-4 h-4', activeCount > 0 ? 'text-sky-400' : 'text-[var(--text-muted)]')} />
        <span>Map Features</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-sky-500 text-white shadow-sm">
            {activeCount}
          </span>
        )}
        <ChevronDown className={clsx('w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {/* Popover Menu */}
      {open && (
        <div className="absolute right-0 top-11 w-96 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--border-subtle)] sb-map-glass shadow-2xl backdrop-blur-2xl p-3 text-[12px] z-40 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[82vh]">
          {/* Menu Header */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[var(--border-subtle)] shrink-0">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-[var(--text-primary)]">Map Features &amp; Telemetry</span>
                <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  {activeCount} ACTIVE
                </span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)] block mt-0.5">
                Toggle live feeds, historical sites &amp; planetary layers
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition"
              title="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search & Bulk Controls */}
          <div className="pt-2.5 pb-2 shrink-0 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter features (satellites, shipwrecks, CCTV…)"
                className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[var(--bg-primary)]/70 border border-[var(--border-subtle)] text-[11.5px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-500/60 transition"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'live', label: 'Live Feeds' },
                  { id: 'places', label: 'Places & History' },
                  { id: 'planet', label: 'Atmosphere' },
                ] as const
              ).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCategory(tab.id)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg font-medium transition shrink-0',
                    category === tab.id
                      ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/40 shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50'
                  )}
                >
                  {tab.label}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-1 pl-1">
                <button
                  onClick={() => toggleAll(true)}
                  className="px-2 py-0.5 text-[10.5px] rounded text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 transition"
                  title="Enable all available layers"
                >
                  All On
                </button>
                <span className="text-[var(--border-subtle)]">|</span>
                <button
                  onClick={() => toggleAll(false)}
                  className="px-2 py-0.5 text-[10.5px] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition"
                  title="Disable all layers"
                >
                  All Off
                </button>
              </div>
            </div>
          </div>

          {/* Feature Toggle List */}
          <div className="overflow-y-auto space-y-1 pr-1 flex-1 min-h-0 pt-1">
            {filteredItems.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">
                No matching map features found.
              </div>
            ) : (
              filteredItems.map(item => (
                <FeatureToggleRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  desc={item.desc}
                  badge={item.badge}
                  badgeColor={item.badgeColor}
                  checked={item.checked}
                  onChange={item.onChange}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureToggleRow({
  icon,
  label,
  desc,
  badge,
  badgeColor,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  desc: string;
  badge?: string;
  badgeColor?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div
      onClick={onChange}
      className={clsx(
        'group flex items-start gap-3 p-2 rounded-xl cursor-pointer transition select-none border',
        checked
          ? 'bg-sky-500/10 border-sky-500/30 text-[var(--text-primary)] shadow-sm'
          : 'bg-transparent border-transparent hover:bg-[var(--bg-tertiary)]/50 text-[var(--text-secondary)]'
      )}
    >
      <div className={clsx('p-1.5 rounded-lg shrink-0 mt-0.5', checked ? 'bg-sky-500/20' : 'bg-[var(--bg-primary)]/80')}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-[12.5px] text-[var(--text-primary)]">{label}</span>
          {badge && (
            <span className={clsx('px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold border', badgeColor ?? 'text-[var(--text-muted)] border-[var(--border-subtle)]')}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] leading-tight mt-0.5 line-clamp-2">
          {desc}
        </p>
      </div>

      {/* Modern iOS / Toggle Switch */}
      <div className="shrink-0 mt-1">
        <div
          className={clsx(
            'w-8 h-4.5 rounded-full transition-colors relative flex items-center p-0.5',
            checked ? 'bg-sky-500' : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]'
          )}
        >
          <div
            className={clsx(
              'w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 transform',
              checked ? 'translate-x-3.5' : 'translate-x-0'
            )}
          />
        </div>
      </div>
    </div>
  );
}
