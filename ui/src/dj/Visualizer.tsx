import { useEffect, useRef } from 'react';
import { dj } from './engine';

// Full-window backdrop drawn while the DJ plays: a perspective neon floor that scrolls on the tempo and
// ripples outward on every kick, a sliced sunset sun that swells with the beat, a spectrum skyline on
// the horizon, and stars that twinkle with the hats. Sits at z-index -1 so it only shows through
// transparent parts of the app.

const ROWS = 26;
const COLS = 40;

export function Visualizer({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current!;
    const g = canvas.getContext('2d')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, dpr = 1, raf = 0;
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.28 }));
    const sky = new Float32Array(64);
    const spec = new Uint8Array(dj.analyser?.frequencyBinCount ?? 512);
    let hue = dj.palette()[0];

    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
    };
    resize();
    addEventListener('resize', resize);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const horizon = h * 0.6;
      const cx = w / 2;
      const kick = Math.exp(-dj.since('kick') * 7);
      const snare = Math.exp(-dj.since('snare') * 5);
      const hat = Math.exp(-dj.since('hat') * 16);
      const hues = dj.palette(); // each style has its own colours, cycled per chord
      const targetHue = hues[dj.chordIndex % hues.length];
      hue += ((((targetHue - hue) % 360) + 540) % 360 - 180) * 0.02;
      const beats = dj.beats();

      // spectrum → smoothed skyline heights, mirrored around the centre
      if (dj.analyser) {
        dj.analyser.getByteFrequencyData(spec);
        for (let i = 0; i < sky.length; i++) {
          const bin = Math.floor(Math.pow(i / sky.length, 1.7) * spec.length * 0.55) + 2;
          sky[i] += (spec[bin] / 255 - sky[i]) * 0.18;
        }
      }

      g.globalCompositeOperation = 'lighter';

      // stars
      for (const s of stars) {
        const tw = 0.35 + 0.35 * Math.sin(s.p + beats * 1.3) + hat * 0.5 * ((s.p * 10) % 1 > 0.6 ? 1 : 0);
        g.fillStyle = `rgba(230,210,255,${Math.max(0, tw) * 0.55})`;
        g.fillRect(s.x * w, s.y * horizon, s.r, s.r);
      }

      // sun
      const R = Math.min(w, h) * (0.17 + kick * 0.012);
      const sunY = horizon - R * 0.35;
      const halo = g.createRadialGradient(cx, sunY, R * 0.6, cx, sunY, R * 2.2);
      halo.addColorStop(0, `hsla(${hue},95%,60%,${0.16 + kick * 0.1})`);
      halo.addColorStop(1, 'hsla(300,90%,50%,0)');
      g.fillStyle = halo;
      g.fillRect(cx - R * 2.2, sunY - R * 2.2, R * 4.4, R * 4.4);
      g.save();
      g.beginPath();
      g.rect(0, 0, w, horizon);
      g.clip();
      const sunGrad = g.createLinearGradient(0, sunY - R, 0, sunY + R);
      sunGrad.addColorStop(0, 'rgba(255,214,102,0.55)');
      sunGrad.addColorStop(0.55, 'rgba(255,94,140,0.5)');
      sunGrad.addColorStop(1, 'rgba(190,50,220,0.45)');
      g.fillStyle = sunGrad;
      g.beginPath();
      g.arc(cx, sunY, R, 0, Math.PI * 2);
      g.fill();
      // retro slices drift downward with the beat
      g.globalCompositeOperation = 'destination-out';
      const slide = reduced ? 0 : (beats * 0.25) % 1;
      for (let k = 0; k < 9; k++) {
        const f = (k + slide) / 9;
        const top = sunY - R * 0.25;
        g.fillRect(cx - R, top + f * (horizon - top), R * 2, 1 + f * R * 0.06);
      }
      g.restore();
      g.globalCompositeOperation = 'lighter';

      // skyline from the spectrum
      g.beginPath();
      g.moveTo(0, horizon);
      const n = sky.length;
      for (let i = 0; i <= n * 2; i++) {
        const j = i <= n ? n - i : i - n;
        const v = sky[Math.min(n - 1, j)];
        const x = (i / (n * 2)) * w;
        const edge = 0.35 + 0.65 * Math.abs(i / n - 1); // taller toward the sides, low behind the sun
        g.lineTo(x, horizon - v * h * 0.16 * edge);
      }
      g.lineTo(w, horizon);
      g.closePath();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(14,6,30,0.75)';
      g.fill();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `hsla(${hue + 40},95%,65%,${0.35 + snare * 0.3})`;
      g.lineWidth = 1.2;
      g.stroke();

      // the floor: project a grid of world points with kick ripples, scrolling one row per beat
      const camH = 1.6, f = h * 0.9, spacing = 1, zNear = 0.7;
      const scroll = reduced ? 0 : (beats * 1.0) % spacing;
      const kicks = reduced ? [] : dj.recent('kick').slice(-4).map(tk => dj.ctx ? dj.ctx.currentTime - tk : 99);
      const heightAt = (x: number, z: number) => {
        let y = 0;
        for (const age of kicks) {
          if (age > 2.5) continue;
          const d = Math.hypot(x, z - 9);
          const r = age * 9;
          y += Math.exp(-((d - r) ** 2) / 1.6) * 0.42 * Math.exp(-age * 1.6);
        }
        return y;
      };
      const pts: { x: number; y: number; a: number }[][] = [];
      for (let ri = 0; ri < ROWS; ri++) {
        const z = zNear + ri * spacing - scroll;
        const row: { x: number; y: number; a: number }[] = [];
        for (let ci = 0; ci <= COLS; ci++) {
          const X = (ci - COLS / 2) * 1.3;
          const Y = heightAt(X, z);
          row.push({ x: cx + (X * f) / z / 1.8, y: horizon + ((camH - Y) * f) / z / 1.8, a: Math.min(1, Math.max(0, 1 - z / (ROWS * spacing))) });
        }
        pts.push(row);
      }
      const bright = 0.32 + kick * 0.35 + snare * 0.15;
      g.lineWidth = 1;
      for (let ri = 0; ri < ROWS; ri++) {
        const row = pts[ri];
        const a = row[0].a;
        g.strokeStyle = `hsla(${hue},90%,${62 + snare * 15}%,${bright * a * a})`;
        g.beginPath();
        row.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
      for (let ci = 0; ci <= COLS; ci++) {
        g.strokeStyle = `hsla(${hue - 30},85%,62%,${bright * 0.8})`;
        g.beginPath();
        for (let ri = ROWS - 1; ri >= 0; ri--) {
          const p = pts[ri][ci];
          if (ri === ROWS - 1) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
        }
        g.stroke();
      }
      // glow line on the horizon
      const hl = g.createLinearGradient(0, 0, w, 0);
      hl.addColorStop(0, 'rgba(255,46,151,0)');
      hl.addColorStop(0.5, `rgba(255,120,200,${0.5 + kick * 0.4})`);
      hl.addColorStop(1, 'rgba(255,46,151,0)');
      g.fillStyle = hl;
      g.fillRect(0, horizon - 1, w, 2);
      g.globalCompositeOperation = 'source-over';
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, [active]);

  return <canvas ref={ref} aria-hidden className={`dj-canvas${active ? ' dj-canvas-on' : ''}`} />;
}
