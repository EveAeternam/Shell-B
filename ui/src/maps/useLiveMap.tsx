// One MapLibre map inside a chat card, with every failure visible. Shared by the map and flight cards.
//  - built only while the card is near the viewport, and torn down when it scrolls far away: browsers allow ~16 live
//    WebGL contexts and silently blank the oldest, so a long chat full of maps must not hold one per card
//  - the installed-worlds catalog is re-read on every build, so a download finishing (or a file going away) shows up
//  - no silent hangs: a map that hasn't loaded in 20 s, a lost GL context or missing tiles all say so, with Retry
import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as ML from 'maplibre-gl';
import { Loader2, Map as MapIcon, RotateCw } from 'lucide-react';
import { fetchBodies, loadMapLib, styleFor, type MapBody, type MapLib } from './core';
import { useDarkTheme } from './MapCard';

export type LiveMapState =
  | { phase: 'waiting' | 'loading' | 'ready'; body?: MapBody }
  | { phase: 'missing' | 'error'; message: string; body?: MapBody };

interface Opts {
  bodyId?: string;
  globe?: boolean;
  options?: Partial<ML.MapOptions>;
  /** called after each (re)build once the style has loaded; add sources, layers and handlers here */
  onReady: (lib: MapLib, map: ML.Map, body: MapBody) => void;
}

const LOAD_TIMEOUT = 20000;

export function useLiveMap(box: RefObject<HTMLDivElement | null>, { bodyId = 'earth', globe = false, options, onReady }: Opts) {
  const dark = useDarkTheme();
  const [state, setState] = useState<LiveMapState>({ phase: 'waiting' });
  const [near, setNear] = useState(false);
  const [nonce, setNonce] = useState(0);
  const ready = useRef(onReady);
  ready.current = onReady;
  const opts = useRef(options);
  opts.current = options;

  // near the viewport? (generous margin so scrolling back is instant, but far-away cards release their context)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [box]);

  useEffect(() => {
    if (!near || !box.current) return;
    let map: ML.Map | null = null, gone = false;
    const fail = (phase: 'missing' | 'error', message: string, body?: MapBody) => {
      if (gone) return;
      setState({ phase, message, body });
      map?.remove(); map = null;
    };
    const timer = setTimeout(() => fail('error', 'The map didn’t finish loading.'), LOAD_TIMEOUT);
    setState(s => ({ phase: 'loading', body: s.body }));
    (async () => {
      const all = await fetchBodies(true);
      const body = all.find(b => b.id === bodyId || b.name.toLowerCase() === bodyId);
      const name = bodyId.charAt(0).toUpperCase() + bodyId.slice(1);
      if (!body) return fail('missing', `There’s no ${name} map installed yet.`);
      if (!body.available) {
        return fail('missing', body.downloading != null
          ? `The ${body.name} map is still downloading (${Math.round(body.downloading * 100)}%).` : `The ${body.name} map isn’t installed yet.`, body);
      }
      const lib = await loadMapLib();
      const style = await styleFor(body, dark, globe);
      if (gone || !box.current) return;
      map = new lib.Map({
        container: box.current, style, attributionControl: { compact: true }, cooperativeGestures: true,
        center: [0, 20], zoom: 1, maxZoom: body.type === 'vector' ? 18 : body.maxzoom + 2, ...opts.current,
      });
      const m = map;
      m.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      m.getCanvas().addEventListener('webglcontextlost', () => fail('error', 'The browser reclaimed this map’s graphics context.', body));
      m.on('error', e => {
        const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
        // the archive itself unreadable (deleted, 404) is fatal; a single missing tile is not
        if (/\b(404|416)\b|PMTiles|Wrong magic number/i.test(msg)) fail('error', `The ${body.name} tiles couldn’t be read (${msg.slice(0, 80)}).`, body);
      });
      m.on('load', () => {
        if (gone || map !== m) return;
        clearTimeout(timer);
        try {
          ready.current(lib, m, body);
          setState({ phase: 'ready', body });
        } catch (e) { fail('error', `Drawing on the map failed: ${(e as Error).message}`, body); }
      });
    })().catch(e => fail('error', `The map couldn’t start: ${(e as Error)?.message ?? e}`));
    return () => { gone = true; clearTimeout(timer); map?.remove(); map = null; };
  }, [near, nonce, dark, globe, bodyId]);  // eslint-disable-line react-hooks/exhaustive-deps

  return { state, retry: () => setNonce(n => n + 1) };
}

/** What a card shows over its map while it isn't ready. */
export function MapStatus({ state, retry, idleText }: { state: LiveMapState; retry: () => void; idleText?: string }) {
  if (state.phase === 'ready') return null;
  if (state.phase !== 'missing' && state.phase !== 'error') {
    return (
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <span className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />{idleText ?? 'Loading map…'}
        </span>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 grid place-items-center p-4">
      <div className="max-w-xs text-center">
        <MapIcon className="w-4 h-4 mx-auto text-[var(--text-muted)]" />
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{state.message}</p>
        {state.phase === 'error' && (
          <button onClick={retry}
            className="mt-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]">
            <RotateCw className="w-3 h-3" /> Reload map
          </button>
        )}
      </div>
    </div>
  );
}
