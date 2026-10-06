import { api, req } from './api';

// Turning chat Markdown into speech: what to say (speakable), how to cut it (nextChunks), and read-aloud playback that
// starts after the first sentence and fetches the next pieces from HERMES while the current one plays.

/** The part of a reply worth saying out loud. Prefix-stable while the reply streams: an unclosed code fence cuts it. */
export function speakable(md: string): string {
  let t = md;
  const open = (t.match(/```/g) ?? []).length % 2 === 1;
  if (open) t = t.slice(0, t.lastIndexOf('```'));
  t = t.replace(/```[\s\S]*?```/g, ' (the code is in the chat) ')
    .replace(/^\s*\|.*\|\s*$/gm, '')                      // table rows
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')              // links, rich links
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1.')                  // headings become their own sentence
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')            // list markers
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|~~|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (an equation) ');
  return t;
}

/** Splits off complete sentences after `from`; with `final`, the rest too. Returns [chunks, new offset]. */
export function nextChunks(text: string, from: number, final: boolean): [string[], number] {
  const out: string[] = [];
  let pos = from;
  const re = /[.!?…:;](?=\s|$)|\n+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  let cut = from;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end === text.length && !final) break;  // a stop at the very end may still grow ("3.5")
    if (text.slice(cut, end).trim().length >= 24 || /\n/.test(m[0])) {
      out.push(text.slice(cut, end));
      cut = end;
    }
  }
  pos = cut;
  if (final && text.slice(pos).trim()) { out.push(text.slice(pos)); pos = text.length; }
  return [out.map(s => s.replace(/\s+/g, ' ').trim()).filter(s => /\w/.test(s)), pos];
}

/** The first sentence alone (so audio starts fast), then sentences joined into ~300-character pieces for smoother prosody. */
function pieces(text: string): string[] {
  const [sentences] = nextChunks(speakable(text), 0, true);
  const out: string[] = [];
  for (const s of sentences) {
    const last = out.length > 1 ? out[out.length - 1] : '';
    if (last && last.length + s.length < 300) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}

export type ReadState = 'idle' | 'loading' | 'playing';
const AHEAD = 2;  // pieces fetched ahead of the one playing
let current: { stop: () => void } | null = null;

/** Reads `text` aloud; starting another read stops this one. Returns a stop function. */
export function readAloud(text: string, onState: (s: ReadState) => void, opts?: Parameters<typeof api.tts>[1]): () => void {
  current?.stop();
  const parts = pieces(text);
  const fetched: Promise<Blob | null>[] = [];
  const el = new Audio();
  let i = 0;
  let stopped = false;
  const fetchUpTo = (n: number) => {
    while (fetched.length < Math.min(parts.length, n)) fetched.push(api.tts(parts[fetched.length], opts).catch(() => null));
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    el.pause();
    if (el.src) URL.revokeObjectURL(el.src);
    el.removeAttribute('src');
    if (current?.stop === stop) current = null;
    onState('idle');
  };
  const next = async () => {
    if (stopped) return;
    if (i >= parts.length) { stop(); return; }
    fetchUpTo(i + 1 + AHEAD);
    const blob = await fetched[i++];
    if (stopped) return;
    if (!blob) { next(); return; }
    if (el.src) URL.revokeObjectURL(el.src);
    el.src = URL.createObjectURL(blob);
    try { await el.play(); onState('playing'); } catch { stop(); }
  };
  el.onended = next;
  current = { stop };
  onState('loading');
  if (!parts.length) stop(); else next();
  return stop;
}

// ── voice library (Settings → Speech): HERMES → Qwen3-TTS service, hermes/qwen/server.py ──────────────────────────

/** RVC conversion settings: the model (hermes/rvc-models/<model>) and how it's applied */
export interface RvcSettings { model: string; pitch: number; index_rate: number; protect: number }
export interface RvcModel { name: string; index: boolean; sizeMb: number; usedBy: string[] }

/** a library voice; its TTS voice id is `qwen:${id}`. An "rvc" voice speaks through `base` and has no reference of its own */
export interface LibraryVoice {
  id: string; label: string; description: string; style: string; fx: Record<string, number>;
  source: 'design' | 'samples' | 'rvc'; refText: string; ref: string; samples: string[]; created?: number | null;
  rvc?: RvcSettings | null; base?: string | null;
}
type VoiceRow = (LibraryVoice | { id: string; label: string; designed?: undefined });
export interface FxParam { key: string; label: string; min: number; max: number; step: number; off: number }

const Q = '/api/tts/qwen';
const jsonBody = (b: unknown) => ({ body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
const form = async <T>(path: string, fd: FormData): Promise<T> => {
  const r = await fetch(path, { method: 'POST', body: fd });
  if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail ?? d; } catch { /* not json */ } throw new Error(d); }
  return r.json();
};

export interface LexiconEntry { from: string; to: string; regex?: boolean; builtin?: boolean; note?: string }

/** pronunciation list (hermes/tts.py): applied to every engine before speaking */
export const lexicon = {
  get: () => req<{ builtin: LexiconEntry[]; entries: LexiconEntry[] }>('/api/tts/lexicon'),
  save: (entries: LexiconEntry[]) => req<{ entries: LexiconEntry[] }>('/api/tts/lexicon', { method: 'PUT', ...jsonBody(entries) }),
  /** what the engines will actually read */
  apply: (text: string) => req<{ text: string }>('/api/tts/lexicon/apply', { method: 'POST', ...jsonBody({ text }) }),
};

export const voiceLib = {
  list: () => req<{ voices: VoiceRow[] }>(`${Q}/voices`)
    .then(r => r.voices.filter((v): v is LibraryVoice => 'designed' in v && !!v.designed)),
  /** Qwen's built-in speakers (possible bases for an RVC voice) */
  presets: () => req<{ voices: VoiceRow[] }>(`${Q}/voices`).then(r => r.voices.filter(v => !('designed' in v && v.designed))),
  /** one line through a voice with unsaved settings; the editor's preview */
  preview: async (voice: string, text: string, o: { fx?: Record<string, number>; style?: string; rvc?: RvcSettings | null; base?: string | null }) => {
    const r = await fetch(`${Q}/tts`, {
      method: 'POST',
      ...jsonBody({ text, speaker: voice, fx: o.fx, style: o.style, rvc: o.rvc === null ? {} : o.rvc, base: o.base || undefined }),
    });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail ?? d; } catch { /* not json */ } throw new Error(d); }
    return r.blob();
  },
  rvcModels: () => req<{ available: boolean; models: RvcModel[] }>(`${Q}/rvc/models`),
  importRvcModel: (name: string, zip: File) => {
    const fd = new FormData();
    fd.append('name', name); fd.append('file', zip);
    return form<{ name: string }>(`${Q}/rvc/models`, fd);
  },
  deleteRvcModel: (name: string) => req<{ ok: boolean }>(`${Q}/rvc/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  createRvcVoice: (o: { name: string; model: string; base: string; pitch: number; style?: string; description?: string }) =>
    req<LibraryVoice>(`${Q}/voices/rvc`, { method: 'POST', ...jsonBody(o) }),
  fx: () => req<{ params: FxParam[]; presets: Record<string, Record<string, number>> }>(`${Q}/fx`),
  referenceUrl: (v: LibraryVoice) => `${Q}/voices/${v.id}/reference?v=${encodeURIComponent(v.ref)}`,
  sampleUrl: (v: LibraryVoice, name: string) => `${Q}/voices/${v.id}/samples/${encodeURIComponent(name)}`,
  /** audition a voice made from a description; keep it with save(draft) or replaceReference(id, draft) */
  design: async (description: string, fx?: Record<string, number>) => {
    const r = await fetch(`${Q}/design`, { method: 'POST', ...jsonBody({ description, fx }) });
    if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail ?? d; } catch { /* not json */ } throw new Error(d); }
    return { audio: await r.blob(), draft: r.headers.get('X-Draft-Id') ?? '' };
  },
  save: (draft: string, name: string, fx?: Record<string, number>) =>
    req<{ id: string }>(`${Q}/voices`, { method: 'POST', ...jsonBody({ draft, name, fx }) }),
  replaceReference: (id: string, draft: string) => req<LibraryVoice>(`${Q}/voices/${id}/reference`, { method: 'POST', ...jsonBody({ draft }) }),
  patch: (id: string, patch: Partial<Pick<LibraryVoice, 'label' | 'description' | 'style' | 'fx' | 'refText' | 'base'>> & { rvc?: RvcSettings | Record<string, never> }) =>
    req<LibraryVoice>(`${Q}/voices/${id}`, { method: 'PATCH', ...jsonBody(patch) }),
  duplicate: (id: string) => req<LibraryVoice>(`${Q}/voices/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => req<{ ok: boolean }>(`${Q}/voices/${id}`, { method: 'DELETE' }),
  fromSamples: (name: string, files: File[], description = '') => {
    const fd = new FormData();
    fd.append('name', name); fd.append('description', description);
    files.forEach(f => fd.append('files', f));
    return form<LibraryVoice>(`${Q}/voices/from-samples`, fd);
  },
  addSamples: (id: string, files: File[], rebuild: boolean) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('rebuild', String(rebuild));
    return form<{ added: string[]; voice: LibraryVoice }>(`${Q}/voices/${id}/samples`, fd);
  },
  deleteSample: (id: string, name: string) => req<{ ok: boolean }>(`${Q}/voices/${id}/samples/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  rebuild: (id: string) => req<LibraryVoice>(`${Q}/voices/${id}/rebuild`, { method: 'POST' }),
};
