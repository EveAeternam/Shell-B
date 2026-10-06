import { useState, useMemo, useEffect } from 'react';
import clsx from 'clsx';
import { Search, X, Grid } from 'lucide-react';
import { APPS, GROUP_LABEL, type AppDef, type AppGroup, type AppId } from '../components/apps';
import type { Status } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  status?: Status;
  onOpenApp: (id: AppId) => void;
}

export function MobileAppsSheet({ open, onClose, status, onOpenApp }: Props) {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return APPS;
    return APPS.filter(
      a =>
        a.label.toLowerCase().includes(term) ||
        a.hint.toLowerCase().includes(term) ||
        (a.keywords && a.keywords.toLowerCase().includes(term))
    );
  }, [q]);

  const groups: { group: AppGroup; label: string; items: AppDef[] }[] = useMemo(() => {
    const order: AppGroup[] = ['make', 'know', 'run', 'system'];
    return order
      .map(group => ({
        group,
        label: GROUP_LABEL[group],
        items: filtered.filter(a => a.group === group),
      }))
      .filter(g => g.items.length > 0);
  }, [filtered]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-primary)] border-t border-[var(--border-subtle)] rounded-t-2xl max-h-[85vh] h-[80vh] flex flex-col overflow-hidden animate-slide-up pb-[env(safe-area-inset-bottom)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="h-12 shrink-0 px-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <Grid className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold">Shell:B Applications</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Search */}
        <div className="p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search tools and apps…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Apps list / grid */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {groups.map(g => (
            <div key={g.group} className="space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1">
                {g.label}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {g.items.map(app => {
                  const Icon = app.icon;
                  const live = app.live?.(status);
                  return (
                    <button
                      key={app.id}
                      onClick={() => {
                        onOpenApp(app.id);
                        onClose();
                      }}
                      className="flex items-start gap-2.5 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] text-left transition relative group"
                    >
                      <div
                        className="p-2 rounded-lg shrink-0 mt-0.5"
                        style={{
                          background: `color-mix(in srgb, ${app.tint} 15%, transparent)`,
                          color: app.tint,
                        }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--accent-soft)] transition">
                            {app.label}
                          </span>
                          {live?.dot && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                          )}
                          {live?.busy && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          )}
                          {live?.badge !== undefined && live.badge > 0 && (
                            <span
                              className={clsx(
                                'px-1 py-0.2 rounded-full text-[9px] font-mono shrink-0',
                                live.urgent
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                              )}
                            >
                              {live.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 mt-0.5 leading-snug">
                          {live?.label ?? app.hint}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
