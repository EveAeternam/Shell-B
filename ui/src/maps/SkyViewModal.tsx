// Observer Ground-Up Planetarium View ("Look Up from Here").
// Simulates the local celestial sky dome, Sun elevation, Earth/Moon phases, and visible planets
// from any surface coordinates on Earth, Mars, or the Moon.
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  Compass,
  Eye,
  Globe2,
  Loader2,
  Moon,
  Orbit,
  Sparkles,
  Sun,
  X
} from 'lucide-react';
import { fmtCoord } from './core';

interface SkyTarget {
  name: string;
  type: string;
  alt_deg?: number;
  az_deg?: number;
  phase?: string;
  illumination?: string;
  mag?: number;
  visible?: boolean;
  note?: string;
}

interface SkyData {
  body: string;
  lat: number;
  lon: number;
  timestamp: string;
  solar_altitude_deg: number;
  solar_azimuth_deg: number;
  state: 'day' | 'civil_twilight' | 'nautical_twilight' | 'astronomical_twilight' | 'night';
  state_label: string;
  targets: SkyTarget[];
}

interface SkyViewModalProps {
  bodyId: string;
  bodyName: string;
  lat: number;
  lon: number;
  onClose: () => void;
  onAskAtlas?: (prompt: string) => void;
}

export function SkyViewModal({
  bodyId,
  bodyName,
  lat,
  lon,
  onClose,
  onAskAtlas,
}: SkyViewModalProps) {
  const [data, setData] = useState<SkyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(`/api/planetary/sky_view?body=${encodeURIComponent(bodyId)}&lat=${lat}&lon=${lon}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SkyData) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        if (!alive) return;
        setError(e.message || 'Failed to simulate local sky.');
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [bodyId, lat, lon]);

  // Project (alt, az) to circular 2D sky dome:
  // Center is Zenith (alt=90°), Outer circle is Horizon (alt=0°).
  // radius r = (90 - alt) / 90 * R.
  // az 0° = North (top), 90° = East (right), 180° = South (bottom), 270° = West (left).
  const domeRadius = 90;
  const project = (alt: number, az: number) => {
    const clampedAlt = Math.max(0, Math.min(90, alt));
    const r = ((90 - clampedAlt) / 90) * domeRadius;
    const rad = ((az - 90) * Math.PI) / 180;
    const x = domeRadius + r * Math.cos(rad);
    const y = domeRadius + r * Math.sin(rad);
    return { x, y };
  };

  const isDay = data && data.solar_altitude_deg > 0;
  const isTwilight = data && data.solar_altitude_deg <= 0 && data.solar_altitude_deg > -18;

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-[460px] max-w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden flex flex-col text-[12px]">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-sky-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-[15px] text-[var(--text-primary)]">
                  Local Sky View
                </h3>
                {data && (
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                      data.state === 'day'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : isTwilight
                        ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                        : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                    )}
                  >
                    {data.state_label}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {bodyName} · {fmtCoord(lat, lon)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[75vh]">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center text-[var(--text-muted)] space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
              <p>Simulating surface celestial horizon…</p>
            </div>
          )}

          {error && (
            <div className="py-8 text-center text-rose-400">
              <p>{error}</p>
            </div>
          )}

          {data && (
            <>
              {/* Sky Dome Horizon Radar */}
              <div className="flex flex-col items-center justify-center">
                <div
                  className={clsx(
                    'relative w-[210px] h-[210px] rounded-full border-2 transition-colors duration-500 shadow-inner flex items-center justify-center',
                    isDay
                      ? 'border-sky-400/40 bg-gradient-to-b from-sky-950/40 to-sky-900/20'
                      : isTwilight
                      ? 'border-purple-500/40 bg-gradient-to-b from-purple-950/60 to-amber-950/20'
                      : 'border-indigo-500/30 bg-[#05060a]'
                  )}
                >
                  {/* Zenith Crosshair */}
                  <div className="absolute w-2 h-2 rounded-full border border-white/20" />
                  <div className="absolute w-[140px] h-[140px] rounded-full border border-white/5 border-dashed" />
                  <div className="absolute w-[70px] h-[70px] rounded-full border border-white/5 border-dashed" />

                  {/* Cardinal Directions */}
                  <span className="absolute top-1 text-[9px] font-bold text-white/40">N</span>
                  <span className="absolute right-1.5 text-[9px] font-bold text-white/40">E</span>
                  <span className="absolute bottom-1 text-[9px] font-bold text-white/40">S</span>
                  <span className="absolute left-1.5 text-[9px] font-bold text-white/40">W</span>

                  {/* Sun (if above horizon) */}
                  {data.solar_altitude_deg > -6 && (
                    (() => {
                      const pos = project(
                        Math.max(0, data.solar_altitude_deg),
                        data.solar_azimuth_deg
                      );
                      return (
                        <div
                          className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                          style={{ left: pos.x + 15, top: pos.y + 15 }}
                          title={`Sun (Alt: ${data.solar_altitude_deg}°)`}
                        >
                          <div className="w-5 h-5 rounded-full bg-amber-400 shadow-lg shadow-amber-400/80 animate-pulse flex items-center justify-center">
                            <Sun className="w-3 h-3 text-amber-950" />
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {/* Visible Targets */}
                  {data.targets
                    .filter(t => t.visible && (t.alt_deg ?? 0) > 0)
                    .map(t => {
                      const az = t.az_deg ?? (data.solar_azimuth_deg + 140) % 360;
                      const pos = project(t.alt_deg!, az);
                      const isMoonOrEarth = t.name.includes('Moon') || t.name.includes('Earth');

                      return (
                        <div
                          key={t.name}
                          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer"
                          style={{ left: pos.x + 15, top: pos.y + 15 }}
                          title={`${t.name} (${t.alt_deg}° alt)`}
                        >
                          {isMoonOrEarth ? (
                            <div className="w-4 h-4 rounded-full bg-sky-300 border border-white flex items-center justify-center shadow-md shadow-sky-400/50">
                              <span className="text-[7px] font-bold text-sky-950">●</span>
                            </div>
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-amber-200 border border-white shadow-sm shadow-amber-200" />
                          )}
                          <span className="text-[8px] font-semibold text-white/80 group-hover:text-white mt-0.5 truncate max-w-[60px] bg-black/60 px-1 rounded">
                            {t.name.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                </div>
                <div className="mt-1.5 text-[10px] text-[var(--text-muted)] flex items-center gap-3">
                  <span>Center: Zenith (90°)</span>
                  <span>Outer Ring: Horizon (0°)</span>
                </div>
              </div>

              {/* Celestial Targets List */}
              <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Celestial Bodies in View
                </h4>

                <div className="grid grid-cols-1 gap-2">
                  {/* Sun Status Card */}
                  <div className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-[var(--text-primary)]">The Sun</div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {data.solar_altitude_deg > 0 ? 'Above Horizon' : 'Below Horizon'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-medium text-[var(--text-primary)]">
                        {data.solar_altitude_deg > 0 ? `+${data.solar_altitude_deg}°` : `${data.solar_altitude_deg}°`} alt
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">
                        {Math.round(data.solar_azimuth_deg)}° Azimuth
                      </div>
                    </div>
                  </div>

                  {/* Other Targets */}
                  {data.targets.map(t => (
                    <div
                      key={t.name}
                      className={clsx(
                        'p-2.5 rounded-xl border flex items-center justify-between text-[11px] transition',
                        t.visible
                          ? 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
                          : 'border-[var(--border-subtle)]/40 bg-[var(--bg-primary)]/40 opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {t.name.includes('Moon') ? (
                          <Moon className="w-4 h-4 text-slate-300 shrink-0" />
                        ) : t.name.includes('Earth') ? (
                          <Globe2 className="w-4 h-4 text-sky-400 shrink-0" />
                        ) : (
                          <Orbit className="w-4 h-4 text-purple-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[var(--text-primary)] truncate">
                              {t.name}
                            </span>
                            {t.phase && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] truncate">
                                {t.phase}
                              </span>
                            )}
                          </div>
                          {t.note ? (
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{t.note}</div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)]">{t.type}</div>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 pl-2">
                        {t.alt_deg != null && (
                          <div
                            className={clsx(
                              'font-mono font-medium',
                              t.visible ? 'text-emerald-400' : 'text-[var(--text-muted)]'
                            )}
                          >
                            {t.alt_deg > 0 ? `+${t.alt_deg}°` : `${t.alt_deg}°`} alt
                          </div>
                        )}
                        <div className="text-[9px] text-[var(--text-muted)]">
                          {t.visible ? '✨ Visible' : 'Below horizon'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 flex items-center justify-between gap-2">
          {onAskAtlas && (
            <button
              onClick={() => {
                onClose();
                onAskAtlas(
                  `What does the local sky and horizon look like from ${bodyName} at coordinates ${fmtCoord(lat, lon)}? Tell me about the visible celestial bodies.`
                );
              }}
              className="px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 font-medium text-[11px] transition flex items-center gap-1.5"
            >
              <Compass className="w-3.5 h-3.5" /> Ask Atlas About This Sky
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-[11px] transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
