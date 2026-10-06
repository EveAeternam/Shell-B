import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Activity, BarChart2, Radio, Zap } from 'lucide-react';
import { dj } from '../dj/engine';

interface WaveformVisualizerProps {
  active: boolean;
  className?: string;
}

type VisualizerMode = 'spectrum' | 'waveform' | 'radar';

export function WaveformVisualizer({ active, className }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<VisualizerMode>('spectrum');
  const [peakL, setPeakL] = useState(0);
  const [peakR, setPeakR] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const fftData = new Uint8Array(512);
    const waveData = new Uint8Array(1024);
    const peaks = new Float32Array(64).fill(0);

    const render = () => {
      const w = (canvas.width = canvas.offsetWidth * window.devicePixelRatio);
      const h = (canvas.height = canvas.offsetHeight * window.devicePixelRatio);
      ctx.clearRect(0, 0, w, h);

      const analyser = dj.analyser;
      if (analyser && active) {
        analyser.getByteFrequencyData(fftData);
        analyser.getByteTimeDomainData(waveData);

        // Compute peak levels
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += (waveData[i] - 128) ** 2;
        const rms = Math.min(1, Math.sqrt(sum / 256) / 45);
        setPeakL(rms);
        setPeakR(rms * (0.92 + Math.random() * 0.16));
      } else {
        fftData.fill(0);
        waveData.fill(128);
        setPeakL(0);
        setPeakR(0);
      }

      if (mode === 'spectrum') {
        // Frequency Spectrum Analyzer
        const numBars = 48;
        const barWidth = (w / numBars) * 0.75;
        const gap = (w / numBars) * 0.25;

        for (let i = 0; i < numBars; i++) {
          const dataIndex = Math.floor(Math.pow(i / numBars, 1.4) * (fftData.length / 2));
          const val = active ? fftData[dataIndex] / 255 : 0;
          const barHeight = Math.max(4, val * h * 0.88);

          // Update peak drops
          if (val > peaks[i]) peaks[i] = val;
          else peaks[i] = Math.max(0, peaks[i] - 0.012);

          const x = i * (barWidth + gap) + gap / 2;
          const y = h - barHeight;

          // Gradient bar
          const grad = ctx.createLinearGradient(0, y, 0, h);
          grad.addColorStop(0, '#f43f5e'); // Pink
          grad.addColorStop(0.5, '#ec4899');
          grad.addColorStop(1, '#8b5cf6'); // Violet

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
          ctx.fill();

          // Peak Cap
          if (peaks[i] > 0.05) {
            const peakY = h - peaks[i] * h * 0.88 - 3;
            ctx.fillStyle = '#fbcfe8';
            ctx.fillRect(x, peakY, barWidth, 2);
          }
        }
      } else if (mode === 'waveform') {
        // Neon Oscilloscope Beam
        ctx.lineWidth = 3 * window.devicePixelRatio;
        ctx.strokeStyle = '#06b6d4';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 12;

        ctx.beginPath();
        const slice = w / waveData.length;
        for (let i = 0; i < waveData.length; i++) {
          const v = waveData[i] / 128.0;
          const y = (v * h) / 2;
          const x = i * slice;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        // Circular Radar / Vectorscope
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(cx, cy) * 0.75;

        // Circular background grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Pulsing radial bars
        const points = 48;
        ctx.strokeStyle = '#a855f7';
        ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
        ctx.lineWidth = 2 * window.devicePixelRatio;
        ctx.beginPath();

        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const dataIndex = Math.floor(Math.abs(Math.sin(angle)) * (fftData.length / 4));
          const val = active ? (fftData[dataIndex] / 255) * radius * 0.45 : 0;
          const r = radius * 0.6 + val;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [active, mode]);

  return (
    <div
      className={clsx(
        'relative flex flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/90 backdrop-blur-md p-3 shadow-xl overflow-hidden',
        className
      )}
    >
      {/* Top Header & Visualizer Controls */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-pink-400" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold">
            Live Master Output Visualizer
          </span>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1 text-[10px] font-mono">
          <button
            onClick={() => setMode('spectrum')}
            className={clsx(
              'px-2 py-0.5 rounded-md border transition',
              mode === 'spectrum'
                ? 'border-pink-500 bg-pink-500/20 text-pink-300 font-bold'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white'
            )}
          >
            Spectrum
          </button>
          <button
            onClick={() => setMode('waveform')}
            className={clsx(
              'px-2 py-0.5 rounded-md border transition',
              mode === 'waveform'
                ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300 font-bold'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white'
            )}
          >
            Scope
          </button>
          <button
            onClick={() => setMode('radar')}
            className={clsx(
              'px-2 py-0.5 rounded-md border transition',
              mode === 'radar'
                ? 'border-violet-500 bg-violet-500/20 text-violet-300 font-bold'
                : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white'
            )}
          >
            Radar
          </button>
        </div>
      </div>

      {/* Canvas Viewport + Stereo VU Meters */}
      <div className="flex items-center gap-2.5 h-28 sm:h-36 relative">
        <canvas ref={canvasRef} className="flex-1 h-full w-full rounded-xl bg-neutral-950/80 shadow-inner" />

        {/* Stereo VU Meter Strips */}
        <div className="flex items-center gap-1 h-full py-1 shrink-0">
          {/* Left Meter */}
          <div className="w-2 h-full rounded-full bg-neutral-900 border border-neutral-800 p-0.5 flex flex-col justify-end overflow-hidden">
            <div
              className="w-full rounded-full transition-all duration-75"
              style={{
                height: `${peakL * 100}%`,
                background:
                  peakL > 0.85
                    ? '#f43f5e'
                    : peakL > 0.65
                    ? '#fbbf24'
                    : '#10b981',
              }}
            />
          </div>

          {/* Right Meter */}
          <div className="w-2 h-full rounded-full bg-neutral-900 border border-neutral-800 p-0.5 flex flex-col justify-end overflow-hidden">
            <div
              className="w-full rounded-full transition-all duration-75"
              style={{
                height: `${peakR * 100}%`,
                background:
                  peakR > 0.85
                    ? '#f43f5e'
                    : peakR > 0.65
                    ? '#fbbf24'
                    : '#10b981',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
