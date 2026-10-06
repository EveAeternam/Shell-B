import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Check,
  Copy,
  Loader2,
  ShieldCheck,
  Square,
  Volume2,
} from 'lucide-react';
import type { Agent } from '../../types';
import { AgentAvatar, btn } from '../common';
import { readAloud, type ReadState } from '../../speech';

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={btn.icon}
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function SpeakButton({ text }: { text: string }) {
  const [state, setState] = useState<ReadState>('idle');
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const toggle = () => {
    if (state !== 'idle') stop.current?.();
    else stop.current = readAloud(text, setState);
  };
  return (
    <button
      className={btn.icon}
      title={state === 'idle' ? 'Read aloud (HERMES)' : 'Stop reading'}
      onClick={toggle}
    >
      {state === 'loading' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : state === 'playing' ? (
        <Square className="w-3.5 h-3.5" />
      ) : (
        <Volume2 className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/** "Verify with…": hands the chat to a cloud agent running the verify-chat skill (server/verify.py) */
export function VerifyButton({
  verifiers,
  busy,
  onVerify,
  label,
}: {
  verifiers: Agent[];
  busy: boolean;
  onVerify: (agentId: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!verifiers.length) return null;
  return (
    <span className="relative inline-flex" onMouseLeave={() => setOpen(false)}>
      <button
        className={label ? clsx(btn.subtle, 'text-[11px]') : btn.icon}
        title="Have a cloud agent verify this chat"
        disabled={busy}
        onClick={() => setOpen(o => !o)}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute z-20 bottom-full left-0 mb-1 min-w-[13rem] p-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-secondary)] shadow-lg">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Verify this chat with
          </div>
          {verifiers.map(a => (
            <button
              key={a.id}
              disabled={!!a.unavailable}
              title={a.unavailable || `${a.name} reads the whole chat, including tool calls and results`}
              onClick={() => {
                setOpen(false);
                onVerify(a.id);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <AgentAvatar agent={a} size={16} />
              <span className="flex-1">{a.name}</span>
              {a.unavailable && <span className="text-[10px] text-[var(--text-muted)]">off</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
