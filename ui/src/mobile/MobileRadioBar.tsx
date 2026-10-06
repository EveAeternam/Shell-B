import { useEffect, useState } from 'react';
import { Play, Pause, Radio, SkipForward } from 'lucide-react';
import clsx from 'clsx';
import { dj, type DJState } from '../dj/engine';

interface Props {
  onOpenRadio: () => void;
}

export function MobileRadioBar({ onOpenRadio }: Props) {
  const [st, setSt] = useState<DJState>(dj.state);

  useEffect(() => dj.subscribe(setSt), []);

  if (!st.playing && !st.song) return null;

  return (
    <div className="shrink-0 px-3 pb-1 pt-0">
      <div
        onClick={onOpenRadio}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[var(--bg-secondary)] border border-[#ff2e97]/30 hover:border-[#ff2e97]/60 shadow-lg cursor-pointer transition select-none group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#ff2e97]/15 flex items-center justify-center text-[#ff2e97] shrink-0">
            <Radio className={clsx('w-3.5 h-3.5', st.playing && 'animate-pulse')} />
          </div>

          <div className="min-w-0 flex flex-col">
            <span className="text-xs font-semibold truncate text-[var(--text-primary)] group-hover:text-[#ff2e97] transition">
              {st.song?.title ?? 'Shell:B FM'}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] truncate flex items-center gap-1.5 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
              {st.song ? `${st.song.style} · ${st.bpm} BPM` : 'Procedural Station'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => dj.toggle()}
            className="p-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
            aria-label={st.playing ? 'Pause radio' : 'Play radio'}
          >
            {st.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
          <button
            onClick={() => dj.skip('blend')}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            aria-label="Skip track"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
