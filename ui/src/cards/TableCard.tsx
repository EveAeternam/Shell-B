// ```table``` fence: {"title", "columns": [...], "rows": [[...], ...]} or rows as objects, or {"csv": "a,b\n1,2"}.
// Sortable, filterable, numbers right-aligned; DataTable is reused by the chart card's Table view.
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Download, Search, Table2 } from 'lucide-react';
import { CardButton, CardFrame, CardPending, downloadCsv, parseJson } from './CardFrame';
import type { CardProps } from './registry';

type Cell = string | number | boolean | null;

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

const asCell = (v: unknown): Cell => {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v as Cell;
  const s = String(v).trim();
  // "4,879" and "12 104" are numbers too (models love thousands separators)
  return /^[-+]?(\d+|\d{1,3}([, ]\d{3})+)(\.\d+)?$/.test(s) ? +s.replace(/[, ]/g, '') : String(v);
};

function parse(text: string): { title?: string; columns: string[]; rows: Cell[][]; unit?: string } | null {
  const r = parseJson(text);
  let columns: string[] = [], rows: Cell[][] = [];
  const csv = r ? r.csv : text.includes(',') || text.includes('\t') ? text : null;  // a bare CSV fence works too
  if (typeof csv === 'string') {
    const all = splitCsv(csv.trim());
    if (all.length < 1) return null;
    [columns, ...rows] = [all[0], ...all.slice(1).map(row => row.map(asCell))] as [string[], ...Cell[][]];
  } else if (r && Array.isArray(r.rows)) {
    const objs = r.rows.every(x => x && typeof x === 'object' && !Array.isArray(x));
    columns = Array.isArray(r.columns) ? r.columns.map(String)
      : objs ? [...new Set((r.rows as Record<string, unknown>[]).flatMap(o => Object.keys(o)))] : [];
    rows = (r.rows as unknown[]).map(x => objs ? columns.map(c => asCell((x as Record<string, unknown>)[c])) : Array.isArray(x) ? x.map(asCell) : [asCell(x)]);
    if (!columns.length) columns = rows[0]?.map((_, i) => `Column ${i + 1}`) ?? [];
  } else return null;
  if (!columns.length) return null;
  return { title: typeof r?.title === 'string' ? r.title : undefined, columns, rows, unit: typeof r?.unit === 'string' ? r.unit : undefined };
}

export function TableCard({ source, streaming }: CardProps) {
  const t = useMemo(() => parse(source), [source]);
  if (!t) return <CardPending icon={Table2} streaming={streaming} waiting="Building the table…" broken="This table couldn’t be read: give columns and rows, or CSV." />;
  return (
    <CardFrame icon={Table2} title={t.title ?? 'Table'} meta={`· ${t.rows.length.toLocaleString()} row${t.rows.length === 1 ? '' : 's'}`}
      actions={<CardButton onClick={() => downloadCsv(t.title ?? 'table', t.columns, t.rows)} title="Download as CSV"><Download className="w-3 h-3" /> CSV</CardButton>}>
      <DataTable columns={t.columns} rows={t.rows} unit={t.unit} />
    </CardFrame>
  );
}

export function DataTable({ columns, rows, unit, maxHeight = 420 }: { columns: string[]; rows: Cell[][]; unit?: string; maxHeight?: number }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [filter, setFilter] = useState('');
  const numeric = useMemo(() => columns.map((_, c) => {
    const vals = rows.map(r => r[c]).filter(v => v != null && v !== '');
    return vals.length > 0 && vals.every(v => typeof v === 'number');
  }), [columns, rows]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let out = f ? rows.filter(r => r.some(v => v != null && String(v).toLowerCase().includes(f))) : rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      });
    }
    return out;
  }, [rows, filter, sort]);
  const fmt = (v: Cell, c: number) => v == null ? '' : typeof v === 'number'
    ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) + (unit && numeric[c] && c > 0 ? (unit === '%' ? '%' : '') : '')
    : String(v);

  return (
    <div>
      {rows.length > 10 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)]">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter rows" aria-label="Filter rows"
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-muted)]" />
          {filter && <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{shown.length} match{shown.length === 1 ? '' : 'es'}</span>}
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[var(--bg-code)]">
            <tr>
              {columns.map((c, i) => (
                <th key={i} scope="col" aria-sort={sort?.col === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
                  className={clsx('px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-subtle)] whitespace-nowrap',
                    numeric[i] ? 'text-right' : 'text-left')}>
                  <button className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)] rounded"
                    onClick={() => setSort(s => s?.col === i ? (s.dir > 0 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}>
                    {c}{sort?.col === i && (sort.dir > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, ri) => (
              <tr key={ri} className="hover:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)]">
                {columns.map((_, ci) => (
                  <td key={ci} className={clsx('px-3 py-1.5 border-b border-[var(--border-subtle)] align-top',
                    numeric[ci] ? 'text-right font-mono tabular-nums text-[11.5px]' : 'text-[var(--text-secondary)]', ci === 0 && !numeric[ci] && 'text-[var(--text-primary)]')}>
                    {fmt(r[ci] ?? null, ci)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-[var(--text-muted)]">No rows match “{filter}”.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
