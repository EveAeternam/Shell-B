// Interactive Layers & Telemetry Popover Menu for Shell:B Worlds.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Check,
  ChevronDown,
  Compass,
  Layers,
  Navigation,
  Radar,
  Rocket,
  Satellite,
  Sparkles,
  Sun,
  X
} from 'lucide-react';

interface LayersMenuProps {
  isEarth: boolean;
  hasLandmarks: boolean;
  hasTraverses: boolean;
  orbitable: boolean;
  bodyName: string;

  // Layer States & Setters
  globe?: boolean;
  nightSkyOn?: boolean;
  setNightSkyOn?: (v: boolean) => void;
  terminatorOn: boolean;
  setTerminatorOn: (v: boolean) => void;
  gridOn: boolean;
  setGridOn: (v: boolean) => void;
  landmarksOn: boolean;
  setLandmarksOn: (v: boolean) => void;
  traversesOn: boolean;
  setTraversesOn: (v: boolean) => void;
  orbitersOn: boolean;
  setOrbitersOn: (v: boolean) => void;
  earthquakesOn: boolean;
  setEarthquakesOn: (v: boolean) => void;
  traffic: boolean;
  setTraffic: (v: boolean) => void;

  // Telemetry counts
  orbiterCount?: number;
  earthquakeCount?: number;
  planeCount?: number;
}

export function LayersMenu({
  isEarth,
  hasLandmarks,
  hasTraverses,
  orbitable,
  bodyName,
  globe,
  nightSkyOn,
  setNightSkyOn,
  terminatorOn,
  setTerminatorOn,
  gridOn,
  setGridOn,
  landmarksOn,
  setLandmarksOn,
  traversesOn,
  setTraversesOn,
  orbitersOn,
  setOrbitersOn,
  earthquakesOn,
  setEarthquakesOn,
  traffic,
  setTraffic,
  orbiterCount,
  planeCount,
}: LayersMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Count active layers
  const activeCount = [
    globe && nightSkyOn,
    terminatorOn,
    gridOn,
    hasLandmarks && landmarksOn,
    hasTraverses && traversesOn,
    orbitable && orbitersOn,
    isEarth && earthquakesOn,
    isEarth && traffic,
  ].filter(Boolean).length;

  // Close when clicking outside
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

  return (
    <div ref={menuRef} className="relative pointer-events-auto">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={clsx(
          'h-9 px-3 flex items-center gap-1.5 rounded-lg border text-[12px] transition sb-map-glass font-medium shadow-sm',
          open || activeCount > 0
            ? 'border-sky-500/40 text-[var(--text-primary)] shadow-sky-500/5'
            : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        )}
        title="Toggle map overlays and live telemetry feeds"
      >
        <Layers className={clsx('w-3.5 h-3.5', activeCount > 0 ? 'text-sky-400' : 'text-[var(--text-muted)]')} />
        <span>Layers</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
            {activeCount}
          </span>
        )}
        <ChevronDown className={clsx('w-3 h-3 text-[var(--text-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {/* Popover Card */}
      {open && (
        <div className="absolute right-0 top-11 w-76 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-subtle)] sb-map-glass shadow-2xl backdrop-blur-xl p-2.5 text-[12px] z-30 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between px-2 py-1.5 pb-2 border-b border-[var(--border-subtle)]">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Map Overlays</span>
              <span className="text-[10px] text-[var(--text-secondary)] block">{bodyName} Telemetry</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-1.5 space-y-1">
            {/* Cosmic Night Sky (Globe mode) */}
            {globe && setNightSkyOn && (
              <LayerToggleRow
                icon={<Sparkles className="w-3.5 h-3.5 text-indigo-300" />}
                label="Cosmic Night Sky"
                desc="Astronomical starfield, Milky Way & atmosphere limb"
                checked={!!nightSkyOn}
                onChange={() => setNightSkyOn(!nightSkyOn)}
              />
            )}

            {/* Solar Terminator */}
            <LayerToggleRow
              icon={<Sun className="w-3.5 h-3.5 text-amber-400" />}
              label="Sunlight & Shadow"
              desc="Real-time day/night solar boundary"
              checked={terminatorOn}
              onChange={() => setTerminatorOn(!terminatorOn)}
            />

            {/* Coordinate Grid */}
            <LayerToggleRow
              icon={<Compass className="w-3.5 h-3.5 text-indigo-400" />}
              label="Coordinate Graticule"
              desc="Latitude & longitude lines"
              checked={gridOn}
              onChange={() => setGridOn(!gridOn)}
            />

            {/* Landmarks & Space Missions */}
            {hasLandmarks && (
              <LayerToggleRow
                icon={<Rocket className="w-3.5 h-3.5 text-emerald-400" />}
                label="Missions & Landing Sites"
                desc="Historic Apollo & robotic landers"
                checked={landmarksOn}
                onChange={() => setLandmarksOn(!landmarksOn)}
              />
            )}

            {/* Traverses (Mars & Moon) */}
            {hasTraverses && (
              <LayerToggleRow
                icon={<Navigation className="w-3.5 h-3.5 text-amber-400" />}
                label="Rover & EVA Traverses"
                desc="Perseverance, Curiosity, Apollo EVA tracks"
                checked={traversesOn}
                onChange={() => setTraversesOn(!traversesOn)}
              />
            )}

            {/* Orbiters & Satellites (3D in Globe Mode) */}
            {orbitable && (
              <LayerToggleRow
                icon={<Satellite className="w-3.5 h-3.5 text-sky-400" />}
                label={globe ? 'Spacecraft (3D Altitude)' : 'Spacecraft & Orbiters'}
                desc={globe ? 'Orbiting in 3D altitude with orbital rings and ground stalks' : (isEarth ? 'Space stations and orbital tracking' : `Orbiters around ${bodyName}`)}
                badge={orbiterCount ? (globe ? `${orbiterCount} in 3D` : `${orbiterCount} active`) : undefined}
                checked={orbitersOn}
                onChange={() => setOrbitersOn(!orbitersOn)}
              />
            )}

            {/* Earthquakes (Earth) */}
            {isEarth && (
              <LayerToggleRow
                icon={<Activity className="w-3.5 h-3.5 text-rose-400" />}
                label="Live Earthquakes"
                desc="USGS M2.5+ real-time global seismic feeds"
                checked={earthquakesOn}
                onChange={() => setEarthquakesOn(!earthquakesOn)}
              />
            )}

            {/* Air Traffic (Earth) */}
            {isEarth && (
              <LayerToggleRow
                icon={<Radar className="w-3.5 h-3.5 text-sky-400" />}
                label="Live Air Traffic"
                desc="OpenSky ADS-B commercial flights"
                badge={planeCount && planeCount > 0 ? `${planeCount} planes` : undefined}
                checked={traffic}
                onChange={() => setTraffic(!traffic)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LayerToggleRow({
  icon,
  label,
  desc,
  badge,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  badge?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={clsx(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition select-none',
        checked
          ? 'bg-[var(--bg-tertiary)]/70 text-[var(--text-primary)]'
          : 'hover:bg-[var(--bg-tertiary)]/40 text-[var(--text-secondary)]'
      )}
    >
      <div className="shrink-0 p-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[12px] truncate">{label}</span>
          {badge && (
            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/20">
              {badge}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">{desc}</div>
      </div>
      <div
        className={clsx(
          'w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0',
          checked
            ? 'bg-sky-500 border-sky-400 text-slate-950'
            : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
        )}
      >
        {checked && <Check className="w-3 h-3 stroke-[3]" />}
      </div>
    </button>
  );
}
