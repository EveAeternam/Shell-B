import clsx from 'clsx';
import { appById, type AppId } from '../components/apps';
import type { KioskWindow } from './types';

interface Props {
  windows: KioskWindow[];
  activeWindowId: string | null;
  onSelectWindow: (id: string) => void;
  onOpenApp: (appId: AppId) => void;
  onShowDesktop: () => void;
}

const PINNED_DOCK_APPS: AppId[] = ['chat', 'studio', 'code', 'radio', 'maps', 'notes', 'library', 'activity'];

export function KioskDock({
  windows,
  activeWindowId,
  onSelectWindow,
  onOpenApp,
  onShowDesktop,
}: Props) {
  return (
    <footer className="h-12 px-3 shrink-0 flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/90 backdrop-blur-md z-40 select-none">
      {/* Pinned Quick-Launch Dock Icons */}
      <div className="flex items-center gap-1">
        {PINNED_DOCK_APPS.map(appId => {
          const app = appById(appId);
          if (!app) return null;
          const Icon = app.icon;
          const openWin = windows.find(w => w.appId === appId);
          const isOpen = !!openWin;
          const isActive = openWin?.id === activeWindowId && !openWin.isMinimized;

          return (
            <button
              key={appId}
              onClick={() => {
                if (openWin) onSelectWindow(openWin.id);
                else onOpenApp(appId);
              }}
              className={clsx(
                'w-9 h-9 rounded-xl flex items-center justify-center transition relative group',
                isActive
                  ? 'bg-[var(--accent)]/20 text-[var(--accent-soft)] ring-1 ring-[var(--accent)]/40'
                  : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
              title={app.label}
              aria-label={app.label}
            >
              <Icon className="w-4 h-4" />
              {isOpen && (
                <span
                  className={clsx(
                    'absolute bottom-1 w-1 h-1 rounded-full transition-all',
                    isActive ? 'bg-[var(--accent)] w-3' : 'bg-[var(--text-muted)]'
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Running Windows Taskbar Items */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto px-4 max-w-2xl scrollbar-none">
        {windows.map(win => {
          const app = appById(win.appId);
          const AppIcon = app?.icon;
          const isActive = win.id === activeWindowId && !win.isMinimized;

          return (
            <button
              key={win.id}
              onClick={() => onSelectWindow(win.id)}
              className={clsx(
                'flex items-center gap-2 py-1.5 px-3 rounded-lg text-xs transition border truncate max-w-[180px]',
                isActive
                  ? 'bg-[var(--bg-tertiary)] border-[var(--border-strong)] text-[var(--text-primary)] font-medium ring-1 ring-[var(--accent)]/30'
                  : win.isMinimized
                  ? 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-muted)] opacity-60 hover:opacity-100'
                  : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              {AppIcon && <AppIcon className="w-3.5 h-3.5 shrink-0" style={{ color: app?.tint }} />}
              <span className="truncate">{win.title}</span>
            </button>
          );
        })}
      </div>

      {/* Show Desktop Button */}
      <div className="flex items-center gap-1">
        <button
          onClick={onShowDesktop}
          className="w-3 h-8 rounded hover:bg-[var(--border-strong)] transition border-l border-[var(--border-subtle)] ml-1"
          title="Show Desktop"
          aria-label="Show Desktop"
        />
      </div>
    </footer>
  );
}
