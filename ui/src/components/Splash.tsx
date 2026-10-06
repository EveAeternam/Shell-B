import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_SPLASH, ambienceShot, ambienceSuppressed, loadAmbience, reducedMotion } from '../ambience';
import '../ambience.css';

const SEEN = 'shellb.splashed';
const LENGTH = 2700;  // ms, keep in step with the sb-splash-* keyframes

const shot = ambienceShot() === 'splash';  // held still on its final frame

function shouldPlay() {
  if (shot) return true;
  if (ambienceSuppressed()) return false;
  const mode = loadAmbience().splash;
  if (mode === 'off') return false;
  if (mode === 'session') {
    try { if (sessionStorage.getItem(SEEN)) return false; } catch { /* private mode */ }
  }
  return true;
}

// Startup animation: a synthwave horizon rises, the B tile lands, then the whole thing lifts away.
// Rendered beside the app (not in front of its mount), so the app loads underneath while it plays.
export function Splash() {
  const [run, setRun] = useState(() => (shouldPlay() ? 1 : 0));
  const [leaving, setLeaving] = useState(false);
  const calm = shot || reducedMotion();
  const skip = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const replay = () => { setLeaving(false); setRun(r => r + 1); };
    window.addEventListener(PREVIEW_SPLASH, replay);
    return () => window.removeEventListener(PREVIEW_SPLASH, replay);
  }, []);

  useEffect(() => {
    if (!run || shot) return;
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode */ }
    const t = setTimeout(() => setLeaving(true), calm ? 900 : LENGTH - 500);
    return () => clearTimeout(t);
  }, [run, calm]);

  useEffect(() => {
    if (!run) return;
    if (leaving) { const t = setTimeout(() => setRun(0), 480); return () => clearTimeout(t); }
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); skip(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [run, leaving, skip]);

  if (!run) return null;
  return (
    <div key={run} className={'sb-splash' + (leaving ? ' sb-leaving' : '') + (calm ? ' sb-calm' : '')} onClick={skip} aria-hidden>
      <div className="sb-splash-stars" />
      <div className="sb-splash-sun" />
      <div className="sb-splash-floor"><div className="sb-splash-grid" /></div>
      <div className="sb-splash-center">
        <div className="sb-splash-tile">B</div>
        <div className="sb-splash-word" data-text="SHELL:B">SHELL:B</div>
        <div className="sb-splash-bar"><span /></div>
      </div>
      <div className="sb-splash-skip">click or press any key to skip</div>
    </div>
  );
}
