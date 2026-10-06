import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Loader2, Mic, MicOff, SkipForward, X } from 'lucide-react';
import { api } from '../api';
import { nextChunks, speakable } from '../speech';
import type { Block, Message } from '../types';

// Hands-free voice mode (backlog C7). One loop over the chat:
//   listen (mic + a simple energy VAD) → transcribe (HERMES Whisper) → send with `voice: true` (the server asks for a
//   short, speakable reply) → read the reply aloud sentence by sentence while it streams (HERMES Kokoro) → listen.
// Talking while it speaks or thinks interrupts it (barge-in): playback stops and an unfinished reply is stopped.
// The mic stream uses the browser's echo cancellation, and the VAD wants more energy while audio is playing.

type Phase = 'starting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'error';

const TICK = 40;            // ms between VAD checks (setInterval: keeps working in a background tab)
const START_MS = 160;       // this much loud audio starts an utterance
const END_MS = 900;         // this much quiet ends it
const MAX_UTTER_MS = 45000;
const IDLE_RESTART_MS = 15000;  // recorder restarted after this long without speech, so clips stay short

const LABEL: Record<Phase, string> = {
  starting: 'Starting the mic…', listening: 'Listening', hearing: 'Hearing you…', transcribing: 'Transcribing…',
  thinking: 'Thinking…', speaking: 'Speaking: talk to interrupt', muted: 'Mic paused', error: 'Voice mode stopped',
};

const replyText = (m?: Message) => (m?.blocks ?? []).filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n\n')
  || m?.content || '';

export function VoiceMode({ reply, busy, onSend, onStop, onClose }: {
  /** the latest assistant message in the chat (streaming or done) */
  reply?: Message; busy: boolean; onSend: (text: string) => void; onStop: () => void; onClose: () => void;
}) {
  const [phase, setPhaseState] = useState<Phase>('starting');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const phaseRef = useRef<Phase>('starting');
  const setPhase = useCallback((p: Phase) => { phaseRef.current = p; setPhaseState(p); }, []);

  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Promise<Blob | null>[]>([]);
  const playing = useRef(false);
  // which reply we are reading, and how far into its speakable text
  const awaiting = useRef<{ before: string | undefined } | null>(null);
  const reading = useRef<{ id: string; pos: number; silenced: boolean } | null>(null);
  const pending = useRef<string | null>(null);  // heard while the previous turn was still stopping
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const replyRef = useRef(reply);
  replyRef.current = reply;
  const sendRef = useRef(onSend);   // App passes new functions every render; the mic loop must not restart for that
  sendRef.current = onSend;
  const stopRef = useRef(onStop);
  stopRef.current = onStop;

  // ── recording ────────────────────────────────────────────────────────────
  const startRecorder = useCallback(() => {
    if (!stream.current) return;
    try { recorder.current?.state === 'recording' && recorder.current.stop(); } catch { /* already stopped */ }
    chunks.current = [];
    const mr = new MediaRecorder(stream.current);
    mr.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    recorder.current = mr;
    mr.start(250);
  }, []);

  const finishUtterance = useCallback(async () => {
    const mr = recorder.current;
    if (!mr || mr.state !== 'recording') return;
    const done = new Promise<void>(r => { mr.onstop = () => r(); });
    mr.stop();
    await done;
    const blob = new Blob(chunks.current, { type: mr.mimeType });
    setPhase('transcribing');
    let text = '';
    try { text = (await api.stt(blob)).text.trim(); } catch { /* HERMES hiccup: just listen again */ }
    startRecorder();
    if (!text || /^[\W_]*$/.test(text)) { setPhase(busyRef.current ? 'thinking' : 'listening'); return; }
    setHeard(text);
    if (busyRef.current) { pending.current = text; setPhase('thinking'); return; }
    awaiting.current = { before: replyRef.current?.id };
    setPhase('thinking');
    sendRef.current(text);
  }, [setPhase, startRecorder]);

  // ── speaking ─────────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    queue.current = [];
    playing.current = false;
    if (audio.current) { audio.current.pause(); audio.current.src = ''; }
    if (reading.current) reading.current.silenced = true;
  }, []);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const next = queue.current.shift();
    if (!next) {
      const r = replyRef.current;
      const done = !busyRef.current && reading.current && r?.id === reading.current.id && r.status !== 'streaming';
      if (done && (phaseRef.current === 'speaking' || phaseRef.current === 'thinking')) setPhase('listening');
      return;
    }
    playing.current = true;
    const blob = await next.catch(() => null);
    if (!playing.current) return;  // interrupted while fetching
    if (!blob) { playing.current = false; playNext(); return; }
    const el = audio.current ?? (audio.current = new Audio());
    el.src = URL.createObjectURL(blob);
    el.onended = () => { URL.revokeObjectURL(el.src); playing.current = false; playNext(); };
    if (phaseRef.current !== 'hearing' && phaseRef.current !== 'transcribing') setPhase('speaking');
    try { await el.play(); } catch { playing.current = false; playNext(); }
  }, [setPhase]);

  // feed new sentences of the reply into the speech queue as they stream in
  useEffect(() => {
    if (!reply || reply.role !== 'assistant') return;
    if (awaiting.current && reply.id !== awaiting.current.before) {
      reading.current = { id: reply.id, pos: 0, silenced: false };
      awaiting.current = null;
    }
    const r = reading.current;
    if (!r || r.id !== reply.id || r.silenced) return;
    const final = reply.status !== 'streaming' && !busy;
    const [parts, pos] = nextChunks(speakable(replyText(reply)), r.pos, final);
    r.pos = pos;
    for (const p of parts) queue.current.push(api.tts(p).catch(() => null));
    playNext();
  }, [reply, busy, playNext]);

  // a sentence heard while the last turn was still being stopped goes out once it has
  useEffect(() => {
    if (busy || !pending.current) return;
    const text = pending.current;
    pending.current = null;
    awaiting.current = { before: replyRef.current?.id };
    setPhase('thinking');
    sendRef.current(text);
  }, [busy, setPhase]);

  // ── the loop: mic, VAD, barge-in ─────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        const ac = new AudioContext();
        ctx.current = ac;
        ac.resume().catch(() => {});
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        ac.createMediaStreamSource(s).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let floor = 0.004, loudMs = 0, quietMs = 0, utterMs = 0, idleMs = 0, warm = 0;
        startRecorder();
        setPhase('listening');
        timer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const rms = Math.sqrt(sum / buf.length);
          setLevel(l => l * 0.6 + Math.min(1, rms * 12) * 0.4);
          const p = phaseRef.current;
          if (p === 'muted' || p === 'transcribing' || p === 'error' || p === 'starting') return;
          const talking = playing.current;
          const thr = Math.max(talking ? floor * 6 : floor * 3, talking ? 0.035 : 0.012);
          if (warm < 500) { warm += TICK; floor = floor * 0.8 + rms * 0.2; return; }  // learn the room first
          if (p === 'hearing') {
            utterMs += TICK;
            quietMs = rms < thr * 0.7 ? quietMs + TICK : 0;
            if (quietMs >= END_MS || utterMs >= MAX_UTTER_MS) { quietMs = 0; utterMs = 0; finishUtterance(); }
            return;
          }
          if (rms < thr) {
            loudMs = 0;
            if (rms < floor * 2) floor = floor * 0.97 + rms * 0.03;
            idleMs += TICK;
            if (idleMs >= IDLE_RESTART_MS && p === 'listening') { idleMs = 0; startRecorder(); }
            return;
          }
          loudMs += TICK;
          if (loudMs < START_MS) return;
          // speech: barge in on whatever is happening
          loudMs = 0; idleMs = 0; utterMs = 0; quietMs = 0;
          if (talking || p === 'speaking' || p === 'thinking') {
            stopSpeaking();
            if (busyRef.current) stopRef.current();
            startRecorder();  // drop the echo recorded so far
          }
          setPhase('hearing');
        }, TICK);
      } catch (e) {
        setError(String(e).includes('Permission') || String(e).includes('NotAllowed') ? 'Microphone access was blocked.' : `Mic error: ${String(e)}`);
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
      try { recorder.current?.stop(); } catch { /* fine */ }
      stream.current?.getTracks().forEach(t => t.stop());
      ctx.current?.close().catch(() => {});
      stopSpeaking();
    };
  }, [finishUtterance, setPhase, startRecorder, stopSpeaking]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const muted = phase === 'muted';
  const toggleMute = () => {
    const tracks = stream.current?.getAudioTracks() ?? [];
    if (muted) { tracks.forEach(t => (t.enabled = true)); startRecorder(); setPhase(busy ? 'thinking' : 'listening'); }
    else {
      try { recorder.current?.state === 'recording' && recorder.current.stop(); } catch { /* fine */ }
      tracks.forEach(t => (t.enabled = false));
      setPhase('muted');
    }
  };
  const live = phase === 'hearing' || phase === 'listening';
  const orb = 1 + (live ? level * 0.55 : phase === 'speaking' ? 0.12 : 0);

  return (
    <div className="mb-2 flex items-center gap-3 px-3 py-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-lg">
      <div className="relative w-10 h-10 shrink-0 grid place-items-center">
        <span className={clsx('absolute inset-0 rounded-full transition-transform duration-75',
          phase === 'speaking' ? 'animate-pulse' : '', phase === 'error' ? 'bg-red-500/30' : muted ? 'bg-[var(--bg-tertiary)]' : 'bg-[var(--accent)]/30')}
          style={{ transform: `scale(${orb})`, background: phase === 'error' || muted ? undefined : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%)' }} />
        {phase === 'transcribing' || phase === 'thinking' || phase === 'starting'
          ? <Loader2 className="relative w-4 h-4 animate-spin text-[var(--text-secondary)]" />
          : muted ? <MicOff className="relative w-4 h-4 text-[var(--text-muted)]" /> : <Mic className="relative w-4 h-4 text-[var(--text-primary)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--text-primary)]">{phase === 'error' ? error : LABEL[phase]}</div>
        <div className="text-[11px] text-[var(--text-muted)] truncate">
          {heard ? <>You said: “{heard}”</> : 'Just talk. Pause when you’re done; talk over a reply to interrupt. Esc ends voice mode.'}
        </div>
      </div>
      {phase === 'speaking' && (
        <button className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" title="Skip the rest of this reply"
          onClick={() => { stopSpeaking(); setPhase(busy ? 'thinking' : 'listening'); }}>
          <SkipForward className="w-4 h-4" />
        </button>
      )}
      {phase !== 'error' && (
        <button className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" title={muted ? 'Resume listening' : 'Pause the mic'}
          onClick={toggleMute}>
          {muted ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>
      )}
      <button className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" title="End voice mode (Esc)" onClick={onClose}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
