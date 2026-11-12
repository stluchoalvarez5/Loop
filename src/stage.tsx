/* Escenario visual minimalista: onda, espectro y círculo, en un canvas con requestAnimationFrame.
   Lee los analizadores del motor (engine.aL / aR) y el último golpe de bombo (engine.beat); nada de estado de Preact por cuadro. */
import { useEffect, useRef } from 'preact/hooks';
import type { Engine } from './engine/engine';

export type StageMode = 'wave' | 'spectrum' | 'circle';
const C = { bg: '#0c0c0c', line: '#1f1f1f', yel: '#e9c46a', grn: '#6fbf86', red: '#e5655b' };

export function Stage({ engine, mode, bpm, playing, hud, onTap }: { engine: Engine; mode: StageMode; bpm: number; playing: boolean; hud: { name: string; key: string; genre: string }; onTap: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, bpm, playing });
  live.current = { mode, bpm, playing };

  useEffect(() => {
    const c = cv.current!; const ctx = c.getContext('2d')!;
    let raf = 0, W = 0, H = 0, dpr = 1;
    const td = new Float32Array(2048), td2 = new Float32Array(2048), fd = new Uint8Array(1024), sm = new Float32Array(48);
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = c.clientWidth; H = c.clientHeight; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(c);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const L = live.current, a = engine.aL, b = engine.aR, on = L.playing && !!a;
      const pulse = on ? Math.exp(-((now - engine.beat.t) / 1000) * 6) : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      if (on) { a!.getFloatTimeDomainData(td); b!.getFloatTimeDomainData(td2); a!.getByteFrequencyData(fd); }

      // 16 pasos abajo: el actual en amarillo
      const st = on ? engine.beat.step % 16 : -1, dw = (W - 24) / 16;
      for (let i = 0; i < 16; i++) { ctx.fillStyle = i === st ? C.yel : i % 4 === 0 ? '#2e2e2e' : '#1e1e1e'; ctx.fillRect(12 + i * dw + 1, H - 30, dw - 2, 3); }

      const top = 34, bot = H - 40, mid = (top + bot) / 2, hh = (bot - top) / 2;
      if (L.mode === 'wave') {
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, mid); ctx.lineTo(W - 12, mid); ctx.stroke();
        ctx.strokeStyle = on ? `rgba(236,236,236,${0.75 + pulse * 0.25})` : '#3a3a3a'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = 0; i < 512; i++) { const x = 12 + (i / 511) * (W - 24), v = on ? td[i * 4] : Math.sin(i / 30 + now / 700) * 0.03; const y = mid - v * hh * 1.6; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      } else if (L.mode === 'spectrum') {
        const n = 48, bw = (W - 24) / n;
        for (let i = 0; i < n; i++) {
          const f0 = Math.floor(Math.pow(1024, i / n) * 0.9), f1 = Math.max(f0 + 1, Math.floor(Math.pow(1024, (i + 1) / n) * 0.9));
          let v = 0; if (on) { for (let j = f0; j < f1 && j < 1024; j++) v = Math.max(v, fd[j]); v /= 255; }
          sm[i] += (v - sm[i]) * 0.35;
          const h = Math.max(2, Math.pow(sm[i], 1.5) * (bot - top));
          ctx.fillStyle = i < n * 0.25 ? C.red : i < n * 0.6 ? C.yel : C.grn; ctx.globalAlpha = 0.85;
          ctx.fillRect(12 + i * bw + 1, bot - h, bw - 2, h);
        }
        ctx.globalAlpha = 1;
      } else {
        // círculo: la onda de cada canal enrollada en un anillo (izquierdo amarillo, derecho verde), el centro late con el bombo
        const cx = W / 2, cy = mid, R = Math.min(W, bot - top) * 0.36 * (1 + pulse * 0.05);
        const ring = (buf: Float32Array, col: string, r0: number, dir: number) => {
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let i = 0; i <= 360; i++) { const t = (i / 360) * Math.PI * 2 + (dir * now) / 6000, v = on ? buf[(i % 360) * 5] : Math.sin(t * 5 + now / 600) * 0.03; const r = r0 * (1 + v * 1.2); const px = cx + Math.cos(t) * r, py = cy + Math.sin(t) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.closePath(); ctx.stroke();
        };
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.stroke();
        ring(td, on ? C.yel : '#4a4a4a', R, 1); ring(td2, on ? C.grn : '#333', R * 0.66, -1);
        ctx.fillStyle = C.red; ctx.globalAlpha = 0.25 + pulse * 0.75; ctx.beginPath(); ctx.arc(cx, cy, 3 + pulse * 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <button type="button" class="stage" onClick={onTap} aria-label={playing ? 'Parar' : 'Reproducir'}>
      <canvas ref={cv} aria-hidden="true" />
      <div class="hud">
        <div class="hud-t"><b>{hud.name}</b><span>{bpm} BPM</span></div>
        <div class="hud-b"><span>{hud.genre}</span><span>{hud.key}</span></div>
        {!playing && <div class="hud-start"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg></div>}
      </div>
    </button>
  );
}
