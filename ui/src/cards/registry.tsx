// Fenced blocks that render as live cards instead of code. Markdown.tsx asks `cardFor(lang)`; each card is its own
// lazy chunk, so chart.js and MapLibre only load when a reply actually contains one.
import { lazy, Suspense, type ComponentType } from 'react';

export interface CardProps { source: string; streaming?: boolean }

const CARDS: Record<string, ComponentType<CardProps>> = {
  map: lazy(() => import('../maps/MapCard').then(m => ({ default: m.MapCard }))),
  flight: lazy(() => import('../maps/FlightCard').then(m => ({ default: m.FlightCard }))),
  chart: lazy(() => import('./ChartCard').then(m => ({ default: m.ChartCard }))),
  table: lazy(() => import('./TableCard').then(m => ({ default: m.TableCard }))),
  weather: lazy(() => import('./WeatherCard').then(m => ({ default: m.WeatherCard }))),
  satellite: lazy(() => import('./SatelliteCard').then(m => ({ default: m.SatelliteCard }))),
  system: lazy(() => import('./SystemCard').then(m => ({ default: m.SystemCard }))),
  timeline: lazy(() => import('./TimelineCard').then(m => ({ default: m.TimelineCard }))),
  route: lazy(() => import('./RouteCard').then(m => ({ default: m.RouteCard }))),
};

export const hasCard = (lang: string) => lang.toLowerCase() in CARDS;

export function LiveCard({ lang, ...props }: CardProps & { lang: string }) {
  const Card = CARDS[lang.toLowerCase()];
  return (
    <Suspense fallback={<div className="not-prose my-3 h-24 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-code)] animate-pulse" />}>
      <Card {...props} />
    </Suspense>
  );
}
