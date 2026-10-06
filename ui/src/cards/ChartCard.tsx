// ```chart``` fence: the model sends data, never chart code.
//   {"type": "line|bar|area|pie|doughnut|scatter", "title": "...", "labels": [...], "series": [{"name": "...", "data": [...]}],
//    "x": "axis title", "y": "axis title", "unit": "%", "stacked": false, "horizontal": false}
// Colours are the dataviz skill's validated categorical palette (checked against Shell:B's card surfaces in both
// modes); light mode has four slots under 3:1, so every chart carries a Table view as the required relief.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables, type ChartConfiguration, type ChartType } from 'chart.js';
import { BarChart3, Download, LineChart, PieChart, ScatterChart, Table2 } from 'lucide-react';
import { useDarkTheme } from '../maps/MapCard';
import { CardButton, CardFrame, CardPending, downloadCsv, parseJson } from './CardFrame';
import type { CardProps } from './registry';
import { DataTable } from './TableCard';

Chart.register(...registerables);

const PALETTE = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
const MAX_SERIES = 8;

type Kind = 'line' | 'bar' | 'area' | 'pie' | 'doughnut' | 'scatter';
interface Series { name: string; data: (number | null)[] | [number, number][] }
interface Spec { type: Kind; title?: string; labels: string[]; series: Series[]; x?: string; y?: string; unit?: string; stacked: boolean; horizontal: boolean; dropped: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);

function parse(text: string): Spec | null {
  const r = parseJson(text);
  if (!r) return null;
  // accept the chart.js shape too ({data: {labels, datasets: [{label, data}]}}), which models know well
  const d = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : r) as Record<string, unknown>;
  const rawSeries = (Array.isArray(r.series) ? r.series : Array.isArray(d.datasets) ? d.datasets : []) as Record<string, unknown>[];
  const type = (['line', 'bar', 'area', 'pie', 'doughnut', 'scatter'].includes(String(r.type)) ? r.type : 'bar') as Kind;
  let series: Series[] = rawSeries.filter(s => s && Array.isArray(s.data)).map((s, i) => ({
    name: String(s.name ?? s.label ?? `Series ${i + 1}`),
    data: type === 'scatter'
      ? (s.data as unknown[]).flatMap(p => {
        const [x, y] = Array.isArray(p) ? [num(p[0]), num(p[1])] : [num((p as Record<string, unknown>)?.x), num((p as Record<string, unknown>)?.y)];
        return x != null && y != null ? [[x, y] as [number, number]] : [];
      })
      : (s.data as unknown[]).map(num),
  }));
  if (!series.length && Array.isArray(r.data) && Array.isArray(r.labels)) series = [{ name: String(r.title ?? 'Value'), data: (r.data as unknown[]).map(num) }];
  if (!series.length) return null;
  const longest = Math.max(...series.map(s => s.data.length));
  const labels = Array.isArray(r.labels ?? d.labels) ? (r.labels ?? d.labels as unknown[]) as unknown[] : Array.from({ length: longest }, (_, i) => i + 1);
  const dropped = Math.max(0, series.length - MAX_SERIES);
  return {
    type, title: typeof r.title === 'string' ? r.title : undefined, labels: labels.map(String), series: series.slice(0, MAX_SERIES),
    x: typeof r.x === 'string' ? r.x : typeof r.xLabel === 'string' ? r.xLabel : undefined,
    y: typeof r.y === 'string' ? r.y : typeof r.yLabel === 'string' ? r.yLabel : undefined,
    unit: typeof r.unit === 'string' ? r.unit : undefined, stacked: r.stacked === true, horizontal: r.horizontal === true, dropped,
  };
}

const ICON = { line: LineChart, area: LineChart, bar: BarChart3, pie: PieChart, doughnut: PieChart, scatter: ScatterChart };

function css(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined; }

function fmt(v: number, unit?: string) {
  const s = Math.abs(v) >= 1e4 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? (unit === '$' ? `$${s}` : `${s}${/^[%°]/.test(unit) ? '' : ' '}${unit}`) : s;
}

export function ChartCard({ source, streaming }: CardProps) {
  const spec = useMemo(() => parse(source), [source]);
  const [table, setTable] = useState(false);
  if (!spec) return <CardPending icon={BarChart3} streaming={streaming} waiting="Drawing the chart…" broken="This chart couldn’t be drawn: its data isn’t valid JSON with a series list." />;
  const pieLike = spec.type === 'pie' || spec.type === 'doughnut';
  const header = spec.type === 'scatter' ? ['Series', 'x', 'y'] : [spec.x ?? 'Label', ...spec.series.map(s => s.name)];
  const rows: (string | number | null)[][] = spec.type === 'scatter'
    ? spec.series.flatMap(s => (s.data as [number, number][]).map(([x, y]) => [s.name, x, y]))
    : spec.labels.map((l, i) => [l, ...spec.series.map(s => (s.data as (number | null)[])[i] ?? null)]);
  return (
    <CardFrame icon={ICON[spec.type]} title={spec.title ?? 'Chart'}
      meta={spec.dropped ? `· first ${MAX_SERIES} of ${MAX_SERIES + spec.dropped} series` : pieLike ? undefined : `· ${spec.series.length} series`}
      actions={<>
        <CardButton onClick={() => setTable(t => !t)} title={table ? 'Show the chart' : 'Show the numbers as a table'} active={table}><Table2 className="w-3 h-3" /> Table</CardButton>
        <CardButton onClick={() => downloadCsv(spec.title ?? 'chart', header, rows)} title="Download the data as CSV"><Download className="w-3 h-3" /> CSV</CardButton>
      </>}>
      {table ? <DataTable columns={header} rows={rows} unit={spec.unit} maxHeight={320} /> : <ChartCanvas spec={spec} />}
    </CardFrame>
  );
}

function ChartCanvas({ spec }: { spec: Spec }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dark = useDarkTheme();

  useEffect(() => {
    if (!canvas.current) return;
    const colors = PALETTE[dark ? 'dark' : 'light'];
    const surface = css('--bg-code') ?? (dark ? '#141416' : '#f6f3ee');
    const ink = css('--text-secondary') ?? '#999', muted = css('--text-muted') ?? '#888', grid = css('--border-subtle') ?? 'rgba(127,127,127,.2)';
    const font = getComputedStyle(document.body).fontFamily;
    const pieLike = spec.type === 'pie' || spec.type === 'doughnut';
    const area = spec.type === 'area';
    const many = spec.series.length >= 2;

    let type: ChartType = spec.type === 'area' ? 'line' : spec.type;
    let datasets;
    let labels: string[] | undefined = spec.labels;
    if (pieLike) {
      // one series; slices past the palette fold into "Other" so no hue is ever generated
      const s = spec.series[0].data as (number | null)[];
      let pairs = spec.labels.map((l, i) => [l, s[i] ?? 0] as [string, number]).filter(([, v]) => v > 0);
      if (pairs.length > MAX_SERIES) {
        pairs.sort((a, b) => b[1] - a[1]);
        pairs = [...pairs.slice(0, MAX_SERIES - 1), ['Other', pairs.slice(MAX_SERIES - 1).reduce((t, [, v]) => t + v, 0)]];
      }
      labels = pairs.map(p => p[0]);
      datasets = [{ label: spec.series[0].name, data: pairs.map(p => p[1]), backgroundColor: pairs.map((_, i) => colors[i]), borderColor: surface, borderWidth: 2, hoverOffset: 4 }];
    } else if (spec.type === 'scatter') {
      type = 'scatter';
      labels = undefined;
      datasets = spec.series.map((s, i) => ({ label: s.name, data: (s.data as [number, number][]).map(([x, y]) => ({ x, y })),
        backgroundColor: colors[i], borderColor: surface, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6 }));
    } else {
      datasets = spec.series.map((s, i) => type === 'bar' ? {
        label: s.name, data: s.data as (number | null)[], backgroundColor: colors[i],
        borderRadius: 4, borderSkipped: 'start' as const, borderColor: surface, borderWidth: spec.stacked ? { top: 2 } : 0,
        barPercentage: 0.85, categoryPercentage: many && !spec.stacked ? 0.8 : 0.7, maxBarThickness: 40,
      } : {
        label: s.name, data: s.data as (number | null)[], borderColor: colors[i], borderWidth: 2, tension: 0.25, spanGaps: true,
        pointRadius: s.data.length > 40 ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: colors[i], pointBorderColor: surface, pointBorderWidth: 2,
        fill: area ? (spec.stacked ? (i ? '-1' : 'origin') : 'origin') : false,
        backgroundColor: colors[i] + (area ? (spec.stacked ? '66' : many ? '1f' : '33') : ''),
      });
    }

    const axis = (title?: string, value = false) => ({
      stacked: spec.stacked && !pieLike,
      grid: { color: grid, drawTicks: false, display: value },  // value-axis gridlines only, kept recessive
      border: { display: !value, color: grid },
      ticks: { color: muted, padding: 6, maxRotation: 0, autoSkipPadding: 12,
        ...(value ? { callback: (v: string | number) => fmt(Number(v), spec.unit) } : {}) },
      title: { display: !!title, text: title, color: ink, font: { size: 11 } },
      ...(value && type === 'bar' ? { beginAtZero: true } : {}),
    });

    const cfg: ChartConfiguration = {
      type,
      data: { labels, datasets } as ChartConfiguration['data'],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        indexAxis: spec.horizontal && type === 'bar' ? 'y' : 'x',
        interaction: type === 'line' ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
        layout: { padding: { top: 4, right: 8 } },
        font: { family: font },
        plugins: {
          legend: { display: many || pieLike, position: pieLike ? 'right' : 'top', align: 'start',
            labels: { color: ink, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', padding: 12, font: { size: 11 } } },
          tooltip: {
            backgroundColor: css('--bg-secondary') ?? '#1c1c1f', titleColor: css('--text-primary') ?? '#fff', bodyColor: ink,
            borderColor: grid, borderWidth: 1, padding: 8, boxPadding: 4, usePointStyle: true,
            callbacks: {
              label: ctx => {
                const raw = ctx.raw as number | { x: number; y: number };
                const v = typeof raw === 'object' && raw ? `(${fmt(raw.x)}, ${fmt(raw.y, spec.unit)})` : fmt(Number(raw), spec.unit);
                if (pieLike) {
                  const total = (ctx.dataset.data as number[]).reduce((t, n) => t + n, 0);
                  return ` ${ctx.label}: ${v} (${((Number(raw) / total) * 100).toFixed(1)}%)`;
                }
                return ` ${ctx.dataset.label}: ${v}`;
              },
            },
          },
        },
        ...(pieLike ? { cutout: spec.type === 'doughnut' ? '62%' : 0 } : {
          scales: spec.horizontal && type === 'bar'
            ? { x: axis(spec.y, true), y: axis(spec.x) }
            : { x: type === 'scatter' ? { ...axis(spec.x, true), type: 'linear' as const } : axis(spec.x), y: axis(spec.y, true) },
        }),
      } as ChartConfiguration['options'],
    };
    const chart = new Chart(canvas.current, cfg);
    return () => chart.destroy();
  }, [spec, dark]);

  return (
    <div className="relative h-[300px] px-3 pt-3 pb-2">
      <canvas ref={canvas} role="img" aria-label={`${spec.title ?? 'Chart'}: ${spec.series.map(s => s.name).join(', ')}. Use Table for the numbers.`} />
    </div>
  );
}
