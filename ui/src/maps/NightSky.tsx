// Photorealistic Celestial Night Sky & Cosmic Environment for Globe Mode.
// Renders ~2,500 astronomical stars, major named navigational stars, spectral colors,
// the Milky Way galactic dust band with galactic center bulge, and planetary atmospheric limb glow.
import { useEffect, useRef } from 'react';
import type * as ML from 'maplibre-gl';

interface NightSkyProps {
  globe: boolean;
  map: ML.Map | null;
  bodyId: string;
  enabled?: boolean;
}

interface Star {
  ra: number;   // Right ascension in radians [0, 2pi]
  dec: number;  // Declination in radians [-pi/2, +pi/2]
  mag: number;  // Visual magnitude (-1.5 to 6.5)
  color: string;
  size: number;
  twinklePhase: number;
  twinkleSpeed: number;
  name?: string;
}

// 40 Brightest & Navigational Stars with accurate astronomical RA/Dec & spectral types
const BRIGHT_STARS: { name: string; raDeg: number; decDeg: number; mag: number; color: string }[] = [
  { name: 'Sirius', raDeg: 101.287, decDeg: -16.716, mag: -1.46, color: '#a8c5ff' },    // Canis Major (A1V)
  { name: 'Canopus', raDeg: 95.988, decDeg: -52.696, mag: -0.74, color: '#f0f5ff' },    // Carina (A9II)
  { name: 'Rigil Kentaurus', raDeg: 219.902, decDeg: -60.834, mag: -0.27, color: '#fff1c5' }, // Alpha Centauri (G2V)
  { name: 'Arcturus', raDeg: 213.915, decDeg: 19.182, mag: -0.05, color: '#ffb366' },   // Boötes (K1.5III)
  { name: 'Vega', raDeg: 279.234, decDeg: 38.784, mag: 0.03, color: '#e8f0ff' },       // Lyra (A0V)
  { name: 'Capella', raDeg: 79.172, decDeg: 45.998, mag: 0.08, color: '#ffe699' },      // Auriga (G3III)
  { name: 'Rigel', raDeg: 78.634, decDeg: -8.202, mag: 0.13, color: '#b3d1ff' },       // Orion (B8Ia)
  { name: 'Procyon', raDeg: 114.825, decDeg: 5.225, mag: 0.38, color: '#fff5db' },      // Canis Minor (F5IV)
  { name: 'Betelgeuse', raDeg: 88.793, decDeg: 7.407, mag: 0.42, color: '#ff5c33' },    // Orion (M1-2Ia-ab red supergiant)
  { name: 'Achernar', raDeg: 24.429, decDeg: -57.237, mag: 0.46, color: '#a3c2ff' },    // Eridanus (B6Vep)
  { name: 'Hadar', raDeg: 210.956, decDeg: -60.373, mag: 0.61, color: '#a8c5ff' },      // Beta Centauri (B1III)
  { name: 'Altair', raDeg: 297.696, decDeg: 8.868, mag: 0.77, color: '#f5f7ff' },      // Aquila (A7V)
  { name: 'Acrux', raDeg: 186.650, decDeg: -63.099, mag: 0.76, color: '#99beff' },      // Southern Cross (B0.5IV)
  { name: 'Aldebaran', raDeg: 68.980, decDeg: 16.509, mag: 0.86, color: '#ffa347' },    // Taurus (K5III orange giant)
  { name: 'Antares', raDeg: 247.352, decDeg: -26.432, mag: 0.96, color: '#ff4d26' },    // Scorpius (M1.5Iab red supergiant)
  { name: 'Spica', raDeg: 201.298, decDeg: -11.161, mag: 0.97, color: '#a3c2ff' },      // Virgo (B1III-IV)
  { name: 'Pollux', raDeg: 116.273, decDeg: 28.026, mag: 1.14, color: '#ffd180' },     // Gemini (K0III)
  { name: 'Fomalhaut', raDeg: 344.413, decDeg: -29.622, mag: 1.16, color: '#f0f4ff' },  // Piscis Austrinus (A3V)
  { name: 'Deneb', raDeg: 310.358, decDeg: 45.280, mag: 1.25, color: '#e8efff' },       // Cygnus (A2Ia)
  { name: 'Mimosa', raDeg: 191.930, decDeg: -59.689, mag: 1.25, color: '#99beff' },     // Beta Crucis (B0.5III)
  { name: 'Regulus', raDeg: 152.093, decDeg: 11.967, mag: 1.35, color: '#b3d1ff' },     // Leo (B7V)
  { name: 'Adhara', raDeg: 104.656, decDeg: -28.972, mag: 1.50, color: '#9ebfff' },     // Canis Major (B2II)
  { name: 'Shaula', raDeg: 263.402, decDeg: -37.104, mag: 1.62, color: '#9ebfff' },     // Scorpius (B2IV)
  { name: 'Castor', raDeg: 113.650, decDeg: 31.888, mag: 1.58, color: '#e8efff' },      // Gemini (A1V)
  { name: 'Gacrux', raDeg: 187.791, decDeg: -57.113, mag: 1.64, color: '#ff7043' },     // Gamma Crucis (M3.5III)
  { name: 'Bellatrix', raDeg: 81.283, decDeg: 6.350, mag: 1.64, color: '#99beff' },     // Orion (B2III)
  { name: 'Elnath', raDeg: 81.573, decDeg: 28.608, mag: 1.65, color: '#adc8ff' },       // Taurus (B7III)
  { name: 'Miaplacidus', raDeg: 138.300, decDeg: -69.717, mag: 1.68, color: '#e8efff' },// Carina (A1III)
  { name: 'Alnilam', raDeg: 84.053, decDeg: -1.202, mag: 1.69, color: '#99beff' },      // Orion Belt (B0Ia)
  { name: 'Alnitak', raDeg: 85.190, decDeg: -1.943, mag: 1.77, color: '#99beff' },      // Orion Belt (O9.5Ib)
  { name: 'Alioth', raDeg: 193.507, decDeg: 55.960, mag: 1.77, color: '#edf2ff' },      // Ursa Major (A1III-IV)
  { name: 'Dubhe', raDeg: 165.932, decDeg: 61.751, mag: 1.79, color: '#ffe699' },       // Ursa Major (K0III)
  { name: 'Mirfak', raDeg: 51.080, decDeg: 49.861, mag: 1.80, color: '#fff5db' },       // Perseus (F5Ib)
  { name: 'Wezen', raDeg: 107.098, decDeg: -26.393, mag: 1.82, color: '#fff5db' },      // Canis Major (F8Ia)
  { name: 'Sargas', raDeg: 264.329, decDeg: -42.998, mag: 1.87, color: '#fff5db' },     // Scorpius (F1II)
  { name: 'Alkaid', raDeg: 206.885, decDeg: 49.313, mag: 1.86, color: '#9ebfff' },      // Ursa Major (B3V)
  { name: 'Avior', raDeg: 125.628, decDeg: -59.510, mag: 1.86, color: '#ffa347' },      // Carina (K3III)
  { name: 'Menkalinan', raDeg: 89.873, decDeg: 44.947, mag: 1.90, color: '#e8efff' },   // Auriga (A1mIV)
  { name: 'Atria', raDeg: 252.166, decDeg: -69.028, mag: 1.92, color: '#ffb366' },      // Triangulum Australe (K2IIb-IIIa)
  { name: 'Polaris', raDeg: 37.954, decDeg: 89.264, mag: 1.98, color: '#fff5db' },      // Ursa Minor (F7Ib North Star)
];

// Generate deterministic background starfield (~2,400 stars)
function createStarCatalog(): Star[] {
  const stars: Star[] = [];

  // Add bright navigational stars first
  for (const b of BRIGHT_STARS) {
    stars.push({
      ra: (b.raDeg * Math.PI) / 180,
      dec: (b.decDeg * Math.PI) / 180,
      mag: b.mag,
      color: b.color,
      size: Math.max(1.8, 3.4 - b.mag * 0.4),
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.5 + Math.random() * 1.5,
      name: b.name,
    });
  }

  // Linear congruential pseudorandom generator for deterministic, consistent star distribution
  let seed = 421337;
  const lcg = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const spectralPalette = [
    { color: '#9ebdff', weight: 0.12 }, // O/B blue
    { color: '#c0d4ff', weight: 0.18 }, // A light blue
    { color: '#eef2ff', weight: 0.35 }, // F/A white
    { color: '#fff3db', weight: 0.18 }, // G yellow-white
    { color: '#ffe0b2', weight: 0.11 }, // K orange
    { color: '#ffab91', weight: 0.06 }, // M orange-red
  ];

  const pickColor = () => {
    const r = lcg();
    let acc = 0;
    for (const p of spectralPalette) {
      acc += p.weight;
      if (r <= acc) return p.color;
    }
    return '#eef2ff';
  };

  // Generate ~2,400 fainter stars down to mag 6.5
  for (let i = 0; i < 2400; i++) {
    // Uniform spherical distribution: RA in [0, 2pi], Dec with cosine distribution
    const ra = lcg() * Math.PI * 2;
    const sinDec = lcg() * 2 - 1;
    const dec = Math.asin(sinDec);

    // Magnitude distribution heavily weighted towards fainter stars (realistic astronomical luminosity function)
    const mag = 2.2 + Math.pow(lcg(), 0.55) * 4.3;
    const size = Math.max(0.6, 2.0 - mag * 0.22);
    const color = pickColor();

    stars.push({
      ra,
      dec,
      mag,
      color,
      size,
      twinklePhase: lcg() * Math.PI * 2,
      twinkleSpeed: 0.8 + lcg() * 2.2,
    });
  }

  return stars;
}

const STAR_CATALOG = createStarCatalog();

// Planetary Atmospheric Limb Haze Definitions
// Uses physically accurate scale: Earth's Kármán line (100 km) is ~1.57% of Earth's 6,371 km radius.
// Visually, Rayleigh/Mie scattering creates a crisp, delicate 1.8% - 4.2% luminous limb hugging the silhouette.
const ATMOSPHERE_PALETTES: Record<string, { thickness: number; inner: string; mid: string; outer: string }> = {
  earth: {
    thickness: 0.028,                    // ~180 km scale (tight, photorealistic)
    inner: 'rgba(56, 189, 248, 0.70)',   // Luminous electric cyan at limb
    mid: 'rgba(14, 165, 233, 0.35)',     // Rich azure
    outer: 'rgba(2, 56, 110, 0.0)',      // Deep space fade
  },
  mars: {
    thickness: 0.018,                    // Thin atmosphere (~60 km scale)
    inner: 'rgba(251, 146, 60, 0.50)',   // Butterscotch / rust dust
    mid: 'rgba(194, 65, 12, 0.22)',      // Terracotta
    outer: 'rgba(124, 45, 18, 0.0)',
  },
  venus: {
    thickness: 0.038,                    // Dense sulfuric cloud deck
    inner: 'rgba(250, 204, 21, 0.65)',   // Sulfuric golden glow
    mid: 'rgba(202, 138, 4, 0.30)',
    outer: 'rgba(113, 63, 18, 0.0)',
  },
  titan: {
    thickness: 0.042,                    // Dense nitrogen/methane photochemical haze
    inner: 'rgba(249, 115, 22, 0.60)',   // Vibrant orange smog
    mid: 'rgba(217, 119, 6, 0.28)',
    outer: 'rgba(120, 53, 15, 0.0)',
  },
};

export function NightSky({ globe, map, bodyId, enabled = true }: NightSkyProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (!globe || !enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let destroyed = false;

    const syncSize = () => {
      if (!canvas || !canvas.parentElement) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const clientW = canvas.parentElement.clientWidth;
      const clientH = canvas.parentElement.clientHeight;
      if (clientW > 0 && clientH > 0) {
        if (canvas.width !== clientW * dpr || canvas.height !== clientH * dpr) {
          canvas.width = clientW * dpr;
          canvas.height = clientH * dpr;
        }
      }
    };
    syncSize();
    window.addEventListener('resize', syncSize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      ro = new ResizeObserver(syncSize);
      ro.observe(canvas.parentElement);
    }

    if (map) {
      map.on('resize', syncSize);
      map.on('render', syncSize);
    }

    const render = () => {
      if (destroyed || !canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const clientW = parent.clientWidth;
      const clientH = parent.clientHeight;
      if (clientW <= 0 || clientH <= 0) return;

      if (canvas.width !== clientW * dpr || canvas.height !== clientH * dpr) {
        canvas.width = clientW * dpr;
        canvas.height = clientH * dpr;
      }

      const w = clientW;
      const h = clientH;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // 1. Deep Cosmic Background (Subtle space gradients & interstellar nebula dust)
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.1, w * 0.5, h * 0.5, w * 0.85);
      bgGrad.addColorStop(0, '#03050c');
      bgGrad.addColorStop(0.45, '#020308');
      bgGrad.addColorStop(1, '#000104');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Camera orientation angles from MapLibre
      let bearing = 0;
      let pitch = 0;
      let centerLng = 0;
      let centerLat = 0;
      let zoom = 1.4;

      if (map) {
        try {
          bearing = (map.getBearing() * Math.PI) / 180;
          pitch = (map.getPitch() * Math.PI) / 180;
          const c = map.getCenter();
          centerLng = (c.lng * Math.PI) / 180;
          centerLat = (c.lat * Math.PI) / 180;
          zoom = map.getZoom();
        } catch {
          // Map might be disposing or reinitializing
        }
      }

      // 2. The Milky Way Galactic Belt
      // The Milky Way arches across the sky at an inclination of ~60° to celestial equator.
      // We draw soft luminous nebula clouds along the galactic plane.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      const mwAngle = -bearing * 0.35 + centerLng * 0.25;
      const mwGrad = ctx.createLinearGradient(0, 0, w, h);
      mwGrad.addColorStop(0.0, 'rgba(6, 12, 38, 0.0)');
      mwGrad.addColorStop(0.3, 'rgba(15, 23, 56, 0.18)');
      mwGrad.addColorStop(0.45, 'rgba(30, 27, 75, 0.28)'); // Violet dust lane
      mwGrad.addColorStop(0.52, 'rgba(56, 36, 94, 0.35)'); // Galactic core bulge
      mwGrad.addColorStop(0.60, 'rgba(23, 37, 84, 0.24)');
      mwGrad.addColorStop(1.0, 'rgba(4, 9, 26, 0.0)');

      ctx.translate(w * 0.5, h * 0.5);
      ctx.rotate(mwAngle + 0.45);
      ctx.fillStyle = mwGrad;
      ctx.fillRect(-w * 1.2, -h * 0.35, w * 2.4, h * 0.7);

      // Galactic core glow (Sagittarius/Scorpius bulge)
      const coreGrad = ctx.createRadialGradient(w * 0.1, -h * 0.05, 5, w * 0.1, -h * 0.05, w * 0.35);
      coreGrad.addColorStop(0, 'rgba(99, 102, 241, 0.22)');
      coreGrad.addColorStop(0.5, 'rgba(168, 85, 247, 0.12)');
      coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(w * 0.1, -h * 0.05, w * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 3. Astronomical Starfield with Celestial Tracking
      const now = performance.now() * 0.001;
      const fovRad = Math.PI * 0.45; // ~80° horizontal field of view
      const viewScale = w / fovRad;

      // Rotation matrix based on camera bearing, pitch, and world center
      // Projects celestial coordinates (RA, Dec) onto the view plane
      const yaw = bearing - centerLng * 0.4;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);

      ctx.save();
      for (const star of STAR_CATALOG) {
        // Celestial sphere unit vector (equatorial frame)
        const sx = Math.cos(star.dec) * Math.cos(star.ra);
        const sy = Math.sin(star.dec);
        const sz = Math.cos(star.dec) * Math.sin(star.ra);

        // Rotate by yaw
        const x1 = sx * cosYaw - sz * sinYaw;
        const y1 = sy;
        const z1 = sx * sinYaw + sz * cosYaw;

        // Rotate by pitch
        const x2 = x1;
        const y2 = y1 * cosPitch - z1 * sinPitch;
        const z2 = y1 * sinPitch + z1 * cosPitch;

        // Only draw stars in the forward hemisphere of the celestial sphere
        if (z2 <= 0.05) continue;

        // Perspective projection to screen
        const px = w * 0.5 + (x2 / z2) * (viewScale * 0.7);
        const py = h * 0.5 - (y2 / z2) * (viewScale * 0.7);

        // Screen bounds check with margin
        if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;

        // Realistic stellar twinkling (sinusoidal brightness modulation)
        const twinkle = 0.82 + 0.18 * Math.sin(now * star.twinkleSpeed + star.twinklePhase);
        const r = star.size * (0.9 + 0.1 * twinkle);
        const alpha = Math.min(1, Math.max(0.2, (1.0 - star.mag * 0.12) * twinkle));

        ctx.fillStyle = star.color;
        ctx.globalAlpha = alpha;

        // Bright navigational stars get soft glow halos
        if (star.mag <= 1.5) {
          const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, r * 3.5);
          glowGrad.addColorStop(0, star.color);
          glowGrad.addColorStop(0.35, star.color);
          glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = glowGrad;
          ctx.beginPath();
          ctx.arc(px, py, r * 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Diffraction cross spikes for top brilliant stars (Sirius, Canopus, Rigel, Vega)
          if (star.mag <= 0.2) {
            ctx.strokeStyle = star.color;
            ctx.lineWidth = 0.6;
            ctx.globalAlpha = alpha * 0.45;
            const spikeLen = r * 4.5;
            ctx.beginPath();
            ctx.moveTo(px - spikeLen, py);
            ctx.lineTo(px + spikeLen, py);
            ctx.moveTo(px, py - spikeLen);
            ctx.lineTo(px, py + spikeLen);
            ctx.stroke();
          }

          ctx.fillStyle = star.color;
        }

        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 4. Photorealistic Atmospheric Limb Glow
      // When viewing an atmospheric world (Earth, Mars, Venus, Titan) in Globe mode,
      // render an authentic Rayleigh limb haze tightly hugging the exact spherical
      // silhouette of the 3D globe.
      const atmos = ATMOSPHERE_PALETTES[bodyId.toLowerCase()];
      if (atmos && map && zoom < 4.8) {
        try {
          const transform = (map as any).transform;
          const matrix = transform?.modelViewProjectionMatrix;
          const cam = transform?.cameraPosition;

          // Always align with the map transform's active viewport dimensions
          const mapW = transform?.width || w;
          const mapH = transform?.height || h;

          const cameraToCenterDistance =
            transform?.cameraToCenterDistance ??
            (0.5 / Math.tan((transform?.fovInRadians ?? (36.87 * Math.PI / 180)) / 2) * mapH);

          if (cameraToCenterDistance) {
            // Distance from sphere center (0,0,0) to camera in unit sphere units
            const dUnit = cam
              ? Math.hypot(cam[0], cam[1], cam[2])
              : (cameraToCenterDistance / Math.max(1, (512 * Math.pow(2, zoom)) / (2 * Math.PI) / Math.max(0.05, Math.cos(centerLat)))) + 1.0;

            // When outside the unit sphere, compute exact apparent screen radius
            if (dUnit > 1.01) {
              const tanTheta = 1.0 / Math.sqrt(dUnit * dUnit - 1.0);
              const radiusPx = cameraToCenterDistance * tanTheta;

              // Exact screen center of the globe from MapLibre's MVP matrix
              let scX = mapW * 0.5;
              let scY = mapH * 0.5;
              if (matrix && matrix[15] > 0.001) {
                const cx = matrix[12];
                const cy = matrix[13];
                const cw = matrix[15];
                scX = ((cx / cw) * 0.5 + 0.5) * mapW;
                scY = ((-cy / cw) * 0.5 + 0.5) * mapH;
              }

              if (radiusPx > 25 && radiusPx < Math.max(mapW, mapH) * 4) {
                // Fade smoothly when zooming in close (zoom 3.5 -> 4.8)
                const zoomFade = Math.max(0, Math.min(1, (4.8 - zoom) / 1.3));

                ctx.save();
                ctx.globalAlpha = zoomFade;
                ctx.globalCompositeOperation = 'screen';

                // Inner radius sits just 0.8% inside the limb so the opaque globe
                // masks the interior while ensuring zero dark seam or antialiasing gap.
                const innerR = radiusPx * 0.992;
                // Outer radius extends only ~1.8% to 4.2% above the surface (accurate physical scale)
                const outerR = radiusPx * (1.0 + atmos.thickness);

                const limbGrad = ctx.createRadialGradient(
                  scX, scY, innerR,
                  scX, scY, outerR
                );

                limbGrad.addColorStop(0.0, atmos.inner);
                limbGrad.addColorStop(0.20, atmos.inner);
                limbGrad.addColorStop(0.55, atmos.mid);
                limbGrad.addColorStop(1.0, atmos.outer);

                ctx.fillStyle = limbGrad;
                ctx.beginPath();
                ctx.arc(scX, scY, outerR, 0, Math.PI * 2);
                ctx.arc(scX, scY, innerR, 0, Math.PI * 2, true);
                ctx.fill();

                ctx.restore();
              }
            }
          }
        } catch {
          // Projection fallback
        }
      }

      ctx.restore();
    };

    // Animation frame loop
    const loop = () => {
      render();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);

    return () => {
      destroyed = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', syncSize);
      if (ro) ro.disconnect();
      if (map) {
        map.off('resize', syncSize);
        map.off('render', syncSize);
      }
    };
  }, [globe, map, bodyId, enabled]);

  if (!globe || !enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
