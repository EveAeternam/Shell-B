import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Square, Trash2, Volume2, Wand2 } from 'lucide-react';
import { api } from '../api';
import { readAloud, voiceLib, type ReadState } from '../speech';
import type { Settings, TtsVoice } from '../types';
import { btn } from './common';

const SAMPLE = "Hi, I'm Shell:B. Here's how I'll sound when I read replies aloud, or talk with you in voice mode.";

/** Settings → General: read-aloud voice (grouped by engine), speed, and a preview. */
export function VoiceRows({ settings, save, Row }: {
  settings: Settings; save: (patch: Partial<Settings>) => void;
  Row: (p: { label: string; hint?: string; children: React.ReactNode }) => React.ReactElement;
}) {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [engines, setEngines] = useState<{ id: string; label: string }[]>([]);
  const [designing, setDesigning] = useState(false);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ReadState>('idle');
  const stop = useRef<(() => void) | null>(null);
  const [speed, setSpeed] = useState(settings.ttsSpeed ?? 1);
  useEffect(() => setSpeed(settings.ttsSpeed ?? 1), [settings.ttsSpeed]);
  useEffect(() => {
    api.voices().then(v => {
      setVoices(v.details ?? v.voices.map(id => ({ id, label: id, engine: 'kokoro' })));
      setEngines(v.engines ?? [{ id: 'kokoro', label: 'Kokoro' }]);
    }).catch(() => setVoices([]));
  }, [reload]);
  useEffect(() => () => stop.current?.(), []);

  const preview = (voice = settings.ttsVoice, s = speed) => {
    if (state !== 'idle' && voice === settings.ttsVoice && s === speed) { stop.current?.(); return; }
    stop.current = readAloud(SAMPLE, setState, { voice, speed: s });
  };
  const known = voices.some(v => v.id === settings.ttsVoice);
  const current = voices.find(v => v.id === settings.ttsVoice);
  const remove = async () => {
    if (!current?.designed || !confirm(`Delete the voice "${current.label}"?`)) return;
    await voiceLib.remove(current.id);
    setReload(n => n + 1);
    save({});
  };
  const expressive = settings.ttsVoice.startsWith('qwen:');
  const [style, setStyle] = useState(settings.ttsStyle ?? '');
  useEffect(() => setStyle(settings.ttsStyle ?? ''), [settings.ttsStyle]);

  return (
    <>
      <Row label="Voice" hint="HERMES voice for read-aloud and voice mode">
        <div className="flex items-center gap-2">
          <select className={btn.input} value={settings.ttsVoice} disabled={!voices.length}
            onChange={e => { save({ ttsVoice: e.target.value }); preview(e.target.value); }}>
            {!known && <option value={settings.ttsVoice}>{settings.ttsVoice}</option>}
            {engines.map(e => {
              const vs = voices.filter(v => v.engine === e.id);
              return vs.length ? (
                <optgroup key={e.id} label={e.label}>
                  {vs.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
          <button className={btn.icon} title={state === 'idle' ? 'Preview the voice' : 'Stop'} onClick={() => preview()}>
            {state === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : state === 'playing' ? <Square className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {current?.designed && (
            <button className={btn.icon} title="Delete this designed voice" onClick={remove}><Trash2 className="w-4 h-4" /></button>
          )}
          <button className={clsx(btn.icon, designing && 'text-[var(--accent)]')} title="Design a new voice from a description"
            onClick={() => setDesigning(d => !d)}><Wand2 className="w-4 h-4" /></button>
        </div>
      </Row>
      {current?.description && (
        <p className="-mt-2 mb-3 text-xs text-[var(--text-muted)] italic">{current.description}</p>
      )}
      {designing && (
        <VoiceDesigner onSaved={id => { setDesigning(false); setReload(n => n + 1); save({ ttsVoice: id }); }} />
      )}
      {expressive && (
        <Row label="Tone" hint="How the expressive voice should sound, in your words. The first read after a while loads the model (~30 s)">
          <div className="flex items-center gap-2">
            <input className={clsx(btn.input, 'w-72')} value={style} placeholder="Warm, natural and conversational."
              onChange={e => setStyle(e.target.value)}
              onBlur={() => style !== (settings.ttsStyle ?? '') && save({ ttsStyle: style })}
              onKeyDown={e => { if (e.key === 'Enter') { save({ ttsStyle: style }); stop.current = readAloud(SAMPLE, setState, { style }); } }} />
          </div>
        </Row>
      )}
      <Row label="Speaking speed" hint={expressive ? 'Expressive voices only roughly follow this' : 'Read-aloud and voice mode'}>
        <div className="flex items-center gap-2">
          <input type="range" min={0.7} max={1.5} step={0.05} value={speed} className="w-36 accent-[var(--accent)]"
            onChange={e => setSpeed(Number(e.target.value))}
            onPointerUp={() => { save({ ttsSpeed: speed }); preview(settings.ttsVoice, speed); }}
            onKeyUp={() => save({ ttsSpeed: speed })} />
          <span className={clsx('text-xs tabular-nums w-10', speed === 1 ? 'text-[var(--text-muted)]' : '')}>{speed.toFixed(2)}×</span>
        </div>
      </Row>
    </>
  );
}

const IDEAS = [
  'A warm, bright young woman with a light Scottish accent, cheerful and quick-witted.',
  'An elegant older Englishwoman, precise and dry, like a museum curator who has seen everything.',
  'A soft-spoken, dreamy woman with a gentle, breathy voice, calm and soothing.',
];

/** Describe a voice → audition it (Qwen3-TTS VoiceDesign, ~5 s, ~30 s when the model is cold) → keep the one you like. */
function VoiceDesigner({ onSaved }: { onSaved: (id: string) => void }) {
  const [description, setDescription] = useState('');
  const [robot, setRobot] = useState(false);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'' | 'design' | 'save'>('');
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const effect = robot ? 'glados' : '';

  const audition = async () => {
    setBusy('design'); setError(''); setDraft('');
    try {
      const r = await voiceLib.design(description, effect ? { [effect]: 1 } : undefined);
      audio.current?.pause();
      audio.current = new Audio(URL.createObjectURL(r.audio));
      await audio.current.play();
      setDraft(r.draft);
    } catch (e) { setError(String(e instanceof Error ? e.message : e).slice(0, 200)); }
    setBusy('');
  };
  const keep = async () => {
    setBusy('save'); setError('');
    try { onSaved((await voiceLib.save(draft, name || 'My voice', effect ? { [effect]: 1 } : undefined)).id); } catch (e) { setError(String(e)); }
    setBusy('');
  };

  return (
    <div className="mb-4 rounded-lg border border-[var(--border-subtle)] p-3 space-y-2">
      <div className="text-sm font-medium">Design a voice</div>
      <p className="text-xs text-[var(--text-muted)]">
        Describe who is speaking: age, accent, pitch, personality. Each audition is a new take, so try a few and keep the one you like.
      </p>
      <textarea className={clsx(btn.input, 'w-full h-20 resize-y')} value={description} placeholder={IDEAS[0]}
        onChange={e => { setDescription(e.target.value); setDraft(''); }} />
      <div className="flex flex-wrap gap-1">
        {IDEAS.map(i => (
          <button key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-left"
            onClick={() => { setDescription(i); setDraft(''); }}>{i.split(',')[0]}</button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={robot} onChange={e => { setRobot(e.target.checked); setDraft(''); }} />
        Synthetic AI effect (pitch-snapped, metallic, like GLaDOS)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn.subtle} disabled={!description.trim() || !!busy} onClick={audition}>
          {busy === 'design' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
          {draft ? 'Try another take' : 'Audition'}
        </button>
        {draft && (
          <>
            <button className={btn.icon} title="Play again" onClick={() => { if (audio.current) { audio.current.currentTime = 0; audio.current.play(); } }}>
              <Volume2 className="w-4 h-4" />
            </button>
            <input className={clsx(btn.input, 'w-40')} value={name} placeholder="Name" onChange={e => setName(e.target.value)} />
            <button className={btn.primary} disabled={!!busy} onClick={keep}>
              {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />}Keep this voice
            </button>
          </>
        )}
      </div>
      {busy === 'design' && <p className="text-xs text-[var(--text-muted)]">Making a take… the first one loads the designer model (about 30 s).</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
