import { useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import { Minus, Square, Copy, X } from 'lucide-react';
import { appById } from '../components/apps';
import type { KioskWindow } from './types';

interface Props {
  win: KioskWindow;
  isActive: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  children: ReactNode;
}

export function WindowFrame({
  win,
  isActive,
  onFocus,
  onClose,
  onMinimize,
  onToggleMaximize,
  onMove,
  onResize,
  children,
}: Props) {
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; initW: number; initH: number } | null>(null);

  if (win.isMinimized) return null;

  const app = appById(win.appId);
  const AppIcon = app?.icon;

  // Pointer drag on titlebar
  const onTitlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (win.isMaximized || (e.target as HTMLElement).closest('button')) return;
    onFocus(win.id);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: win.x,
      initY: win.y,
    };
  };

  const onTitlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newX = Math.max(0, dragRef.current.initX + dx);
    const newY = Math.max(0, dragRef.current.initY + dy);
    onMove(win.id, newX, newY);
  };

  const onTitlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    dragRef.current = null;
  };

  // Pointer resize on bottom-right corner
  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (win.isMaximized) return;
    e.stopPropagation();
    onFocus(win.id);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initW: win.width,
      initH: win.height,
    };
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    const dw = e.clientX - resizeRef.current.startX;
    const dh = e.clientY - resizeRef.current.startY;
    const minW = win.minWidth ?? 380;
    const minH = win.minHeight ?? 280;
    const newW = Math.max(minW, resizeRef.current.initW + dw);
    const newH = Math.max(minH, resizeRef.current.initH + dh);
    onResize(win.id, newW, newH);
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    resizeRef.current = null;
  };

  const style: React.CSSProperties = win.isMaximized
    ? {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: win.zIndex,
      }
    : {
        position: 'absolute',
        left: `${win.x}px`,
        top: `${win.y}px`,
        width: `${win.width}px`,
        height: `${win.height}px`,
        zIndex: win.zIndex,
      };

  return (
    <div
      style={style}
      onMouseDown={() => onFocus(win.id)}
      className={clsx(
        'flex flex-col bg-[var(--bg-primary)] border shadow-2xl transition-[box-shadow,border-color] overflow-hidden select-none',
        win.isMaximized ? 'rounded-none border-0' : 'rounded-xl',
        isActive
          ? 'border-[var(--accent)]/50 ring-1 ring-[var(--accent)]/30 shadow-[0_12px_40px_rgba(0,0,0,0.5)]'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] opacity-95'
      )}
    >
      {/* Title Bar */}
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onDoubleClick={() => onToggleMaximize(win.id)}
        className={clsx(
          'h-10 px-3 shrink-0 flex items-center justify-between border-b cursor-grab active:cursor-grabbing transition-colors',
          isActive
            ? 'bg-[var(--bg-secondary)] border-[var(--border-strong)] text-[var(--text-primary)]'
            : 'bg-[var(--bg-tertiary)]/70 border-[var(--border-subtle)] text-[var(--text-secondary)]'
        )}
      >
        {/* Left: Window Icon & Title */}
        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
          {AppIcon && (
            <div
              className="p-1 rounded-md shrink-0"
              style={{
                background: `color-mix(in srgb, ${app?.tint ?? 'var(--accent)'} 20%, transparent)`,
                color: app?.tint ?? 'var(--accent)',
              }}
            >
              <AppIcon className="w-3.5 h-3.5" />
            </div>
          )}
          <span className="text-xs font-semibold truncate tracking-tight">
            {win.title}
          </span>
        </div>

        {/* Right: Window Controls */}
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onMinimize(win.id)}
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
            title="Minimize"
            aria-label="Minimize window"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onToggleMaximize(win.id)}
            className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
            title={win.isMaximized ? 'Restore' : 'Maximize'}
            aria-label={win.isMaximized ? 'Restore window' : 'Maximize window'}
          >
            {win.isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            onClick={() => onClose(win.id)}
            className="p-1 rounded-md hover:bg-rose-500/20 text-[var(--text-muted)] hover:text-rose-400 transition"
            title="Close"
            aria-label="Close window"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Window Body / Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative select-text">
        {children}
      </div>

      {/* Resize Grip (bottom-right corner) */}
      {!win.isMaximized && (
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-50 flex items-end justify-end p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 6 6" fill="currentColor">
            <circle cx="5" cy="5" r="0.8" />
            <circle cx="5" cy="2.5" r="0.8" />
            <circle cx="2.5" cy="5" r="0.8" />
          </svg>
        </div>
      )}
    </div>
  );
}
