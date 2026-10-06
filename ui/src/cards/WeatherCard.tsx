// ```weather``` fence: {"place": "Orlando, FL"} or {"lat", "lon", "name"}. Live from Open-Meteo via /api/weather,
// refreshed every 10 minutes while on screen. Units follow the browser's region (°F/mph in the US) with a toggle.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Droplets, Moon, Sun, Sunrise, Sunset, Wind,
  type LucideIcon,
} from 'lucide-react';
import { CardButton, CardFrame, CardPending, parseJson } from './CardFrame';
import type { CardProps } from './registry';

interface Place { name: string; region?: string; country?: string; lat: number; lon: number }
interface Forecast {
  timezone: string;
  current: Record<string, number | string>;
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[]; is_day: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[];
    sunrise: string[]; sunset: string[]; uv_index_max: (number | null)[] };
}

const WMO: Record<number, [string, LucideIcon, LucideIcon?]> = {
  0: ['Clear', Sun, Moon], 1: ['Mostly clear', Sun, Moon], 2: ['Partly cloudy', CloudSun, CloudMoon], 3: ['Overcast', Cloud],
  45: ['Fog', CloudFog], 48: ['Freezing fog', CloudFog], 51: ['Light drizzle', CloudDrizzle], 53: ['Drizzle', CloudDrizzle], 55: ['Heavy drizzle', CloudDrizzle],
  56: ['Freezing drizzle', CloudDrizzle], 57: ['Freezing drizzle', CloudDrizzle], 61: ['Light rain', CloudRain], 63: ['Rain', CloudRain], 65: ['Heavy rain', CloudRain],
  66: ['Freezing rain', CloudRain], 67: ['Freezing rain', CloudRain], 71: ['Light snow', CloudSnow], 73: ['Snow', CloudSnow], 75: ['Heavy snow', CloudSnow],
  77: ['Snow grains', CloudSnow], 80: ['Light showers', CloudRain], 81: ['Showers', CloudRain], 82: ['Violent showers', CloudRain],
  85: ['Snow showers', CloudSnow], 86: ['Heavy snow showers', CloudSnow], 95: ['Thunderstorms', CloudLightning], 96: ['Thunderstorms, hail', CloudLightning],
  99: ['Thunderstorms, heavy hail', CloudLightning],
};
const wmo = (code: number, day = true) => {
  const w = WMO[code] ?? ['Unknown', Cloud];
  return { text: w[0], Icon: !day && w[2] ? w[2] : w[1] };
};

const US = /-(US|LR|MM)\b/i.test(navigator.language);
const UNIT_KEY = 'shellb.weather.units';

function useUnits(): ['metric' | 'us', () => void] {
  const [u, setU] = useState<'metric' | 'us'>(() => {
    try { const s = localStorage.getItem(UNIT_KEY); if (s === 'metric' || s === 'us') return s; } catch { /* private mode */ }
    return US ? 'us' : 'metric';
  });
  return [u, () => setU(x => { const n = x === 'us' ? 'metric' : 'us'; try { localStorage.setItem(UNIT_KEY, n); } catch { /* */ } return n; })];
}

function parse(text: string): { place?: string; lat?: number; lon?: number; name?: string } | null {
  const r = parseJson(text);
  if (!r) return text.trim() && !text.includes('{') ? { place: text.trim() } : null;
  const place = typeof r.place === 'string' ? r.place : typeof r.location === 'string' ? r.location : typeof r.city === 'string' ? r.city : undefined;
  const lat = Number(r.lat), lon = Number(r.lon ?? r.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, name: typeof r.name === 'string' ? r.name : place };
  return place ? { place } : null;
}

export function WeatherCard({ source, streaming }: CardProps) {
  const spec = useMemo(() => parse(source), [source]);
  if (!spec) return <CardPending icon={CloudSun} streaming={streaming} waiting="Checking the weather…" broken={'This weather card needs {"place": "City"} or lat and lon.'} />;
  return <Weather {...spec} />;
}

function Weather({ place, lat, lon, name }: { place?: string; lat?: number; lon?: number; name?: string }) {
  const root = useRef<HTMLElement>(null);
  const [data, setData] = useState<{ place: Place; forecast: Forecast } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [units, toggleUnits] = useUnits();

  useEffect(() => {
    let gone = false, t: ReturnType<typeof setTimeout> | undefined;
    const qs = lat != null && lon != null ? `lat=${lat}&lon=${lon}${name ? `&place=${encodeURIComponent(name)}` : ''}` : `place=${encodeURIComponent(place ?? '')}`;
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch(`/api/weather?${qs}`);
          const d = await r.json();
          if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `HTTP ${r.status}`);
          if (!gone) { setData(d); setError(null); }
        } catch (e) { if (!gone) setError((e as Error).message); }
      }
      if (!gone) t = setTimeout(load, 600_000);
    };
    load();
    return () => { gone = true; clearTimeout(t); };
  }, [place, lat, lon, name]);

  const T = (c: number) => Math.round(units === 'us' ? c * 9 / 5 + 32 : c);
  const deg = units === 'us' ? '°F' : '°C';
  const speed = (kmh: number) => units === 'us' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
  const where = data ? [data.place.name, data.place.region, data.place.country].filter(Boolean).join(', ') : place ?? name ?? 'Weather';

  return (
    <CardFrame icon={CloudSun} title={where} className="max-w-[640px]"
      actions={<CardButton onClick={toggleUnits} title="Switch units">{units === 'us' ? '°F' : '°C'}</CardButton>}>
      <section ref={root}>
        {!data ? (
          <div className="px-4 py-8 text-[12px] text-[var(--text-muted)]">{error ?? <span className="animate-pulse">Checking the weather…</span>}</div>
        ) : <Body f={data.forecast} T={T} deg={deg} speed={speed} />}
        {data && error && <div className="px-4 pb-2 text-[10px] text-amber-300">Couldn’t refresh: {error}</div>}
      </section>
    </CardFrame>
  );
}

function hourLabel(iso: string) {
  const h = +iso.slice(11, 13);
  return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
}

function Body({ f, T, deg, speed }: { f: Forecast; T: (c: number) => number; deg: string; speed: (k: number) => string }) {
  const c = f.current;
  const now = wmo(Number(c.weather_code), c.is_day === 1);
  const d = f.daily;
  const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
  // the next 24 hours from the current hour
  const start = Math.max(0, f.hourly.time.findIndex(t => t >= String(c.time).slice(0, 13)));
  const hours = f.hourly.time.slice(start, start + 24).map((t, i) => ({
    t, temp: f.hourly.temperature_2m[start + i], rain: f.hourly.precipitation_probability[start + i] ?? 0,
    code: f.hourly.weather_code[start + i], day: f.hourly.is_day[start + i] === 1,
  }));
  const hMin = Math.min(...hours.map(h => h.temp)), hMax = Math.max(...hours.map(h => h.temp));
  const W = 560, H = 64, y = (v: number) => H - 14 - ((v - hMin) / Math.max(1, hMax - hMin)) * (H - 28);
  const line = hours.map((h, i) => `${i ? 'L' : 'M'}${(i / (hours.length - 1)) * W},${y(h.temp)}`).join('');
  const time = (iso: string) => iso.slice(11, 16);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <now.Icon className="w-10 h-10 text-[var(--accent)]" strokeWidth={1.5} />
          <div>
            <div className="text-[34px] leading-none font-semibold tracking-tight tabular-nums">{T(Number(c.temperature_2m))}{deg}</div>
            <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{now.text} · feels {T(Number(c.apparent_temperature))}°</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5"><Wind className="w-3 h-3" /><dd className="tabular-nums text-[var(--text-secondary)]">{speed(Number(c.wind_speed_10m))}, gusts {speed(Number(c.wind_gusts_10m))}</dd></div>
          <div className="flex items-center gap-1.5"><Droplets className="w-3 h-3" /><dd className="tabular-nums text-[var(--text-secondary)]">{c.relative_humidity_2m}% humidity</dd></div>
          <div className="flex items-center gap-1.5"><Sunrise className="w-3 h-3" /><dd className="tabular-nums text-[var(--text-secondary)]">{time(d.sunrise[0])}</dd></div>
          <div className="flex items-center gap-1.5"><Sunset className="w-3 h-3" /><dd className="tabular-nums text-[var(--text-secondary)]">{time(d.sunset[0])}</dd></div>
        </dl>
      </div>

      {hours.length > 2 && (
        <div className="px-4 pb-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Next 24 hours</div>
          <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full h-auto" role="img" aria-label={`Temperature over the next 24 hours, ${T(hMin)} to ${T(hMax)}${deg}`}>
            {hours.map((h, i) => h.rain >= 10 && (  // rain chance as faint columns behind the line
              <rect key={i} x={(i / (hours.length - 1)) * W - 4} width={8} y={H - 14 - (h.rain / 100) * (H - 28)} height={(h.rain / 100) * (H - 28)} rx={2}
                fill="#3987e5" opacity={0.28}><title>{hourLabel(h.t)}: {h.rain}% chance of rain</title></rect>
            ))}
            <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {hours.map((h, i) => i % 3 === 0 && (
              <g key={i}>
                <text x={(i / (hours.length - 1)) * W} y={y(h.temp) - 6} textAnchor={i === 0 ? 'start' : 'middle'} fontSize={10} fill="var(--text-secondary)" className="tabular-nums">{T(h.temp)}°</text>
                <text x={(i / (hours.length - 1)) * W} y={H + 10} textAnchor={i === 0 ? 'start' : 'middle'} fontSize={9} fill="var(--text-muted)">{i === 0 ? 'Now' : hourLabel(h.t)}</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <ol className="border-t border-[var(--border-subtle)] list-none m-0 pl-0">
        {d.time.map((day, i) => {
          const w = wmo(d.weather_code[i]);
          const a = ((d.temperature_2m_min[i] - lo) / Math.max(1, hi - lo)) * 100, b = ((d.temperature_2m_max[i] - lo) / Math.max(1, hi - lo)) * 100;
          const rain = d.precipitation_probability_max[i] ?? 0;
          return (
            <li key={day} className="grid grid-cols-[3.5rem_1.25rem_2.75rem_2rem_1fr_2rem] items-center gap-2 px-4 py-1.5 text-[12px] border-b last:border-b-0 border-[var(--border-subtle)]">
              <span className="text-[var(--text-secondary)]">{i === 0 ? 'Today' : new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <w.Icon className="w-4 h-4 text-[var(--text-secondary)]" aria-label={w.text} />
              <span className={clsx('text-[10px] tabular-nums', rain >= 30 ? 'text-[#3987e5]' : 'text-transparent')}>{rain}%</span>
              <span className="text-right tabular-nums text-[var(--text-muted)]">{T(d.temperature_2m_min[i])}°</span>
              <span className="relative h-1 rounded-full bg-[var(--bg-tertiary)]">
                <span className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#3987e5] to-[#d95926]" style={{ left: `${a}%`, width: `${Math.max(4, b - a)}%` }} />
              </span>
              <span className="tabular-nums">{T(d.temperature_2m_max[i])}°</span>
            </li>
          );
        })}
      </ol>
      <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)]">Open-Meteo forecast · {f.timezone}</div>
    </div>
  );
}
