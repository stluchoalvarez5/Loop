/* Escenario visual: sol synthwave con grilla en perspectiva, espectro y osciloscopio XY.
   Dibuja en un canvas con requestAnimationFrame leyendo los analizadores del motor (nada de estado de Preact por cuadro). */
import { useEffect, useRef } from 'preact/hooks';
import type { Engine } from './engine/engine';

export type StageMode = 'grid' | 'spectrum' | 'scope';

export function Stage({ engine, mode, bpm, playing, hud, onTap }: { engine: Engine; mode: StageMode; bpm: number; playing: boolean; hud: { name: string; key: string; genre: string }; onTap: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, bpm, playing });
  live.current = { mode, bpm, playing };

  useEffect(() => {
    const c = cv.current!; const ctx = c.getContext('2d')!;
    let raf = 0, W = 0, H = 0, dpr = 1, phase = 0, last = performance.now();
    const td = new Float32Array(2048), td2 = new Float32Array(2048), fd = new Uint8Array(1024);
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.55, s: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }));
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = c.clientWidth; H = c.clientHeight; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(c);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const L = live.current, a = engine.aL, b = engine.aR, on = L.playing && !!a;
      const since = (now - engine.beat.t) / 1000, pulse = on ? Math.exp(-since * 7) : 0;
      phase = (phase + dt * (on ? L.bpm / 60 : 0.25)) % 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (on) { a!.getFloatTimeDomainData(td); b!.getFloatTimeDomainData(td2); a!.getByteFrequencyData(fd); }

      if (L.mode === 'scope') {
        // osciloscopio XY: izquierda contra derecha, con persistencia de fósforo
        ctx.fillStyle = 'rgba(6,2,16,0.28)'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(157,92,255,0.18)'; ctx.lineWidth = 1;
        for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((W * i) / 8, 0); ctx.lineTo((W * i) / 8, H); ctx.stroke(); }
        for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, (H * i) / 6); ctx.lineTo(W, (H * i) / 6); ctx.stroke(); }
        // osciloscopio polar: la onda de cada canal enrollada en un círculo que gira y late con el bombo
        const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.3 * (1 + pulse * 0.12), rot = now / 4000;
        const ring = (buf: Float32Array, col: string, sh: string, k: number, r0: number) => {
          ctx.shadowBlur = 16; ctx.shadowColor = sh; ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
          for (let i = 0; i <= 512; i++) { const t = (i / 512) * Math.PI * 2 + rot * k, v = on ? buf[(i % 512) * 4] : Math.sin(t * 6 + now / 400) * 0.05; const r = r0 * (1 + v * 1.4); const px = cx + Math.cos(t) * r, py = cy + Math.sin(t) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.closePath(); ctx.stroke();
        };
        ring(td, 'rgba(140,248,255,0.95)', '#22e5ff', 1, R);
        ring(td2, 'rgba(255,120,200,0.9)', '#ff2e97', -1, R * 0.62);
        ctx.shadowBlur = 0;
        // goniómetro: el centro muestra el estéreo (vertical = mono, abierto = ancho)
        ctx.strokeStyle = 'rgba(255,228,92,0.85)'; ctx.lineWidth = 1.2; ctx.beginPath();
        if (on) for (let i = 0; i < 1024; i += 2) { const m = (td[i] + td2[i]) * 0.5, sd = (td[i] - td2[i]) * 0.5; const px = cx + sd * R * 1.6, py = cy - m * R * 1.6; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.stroke(); ctx.shadowBlur = 0;
        return;
      }

      // cielo
      const hz = H * 0.58;
      const sky = ctx.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#07021a'); sky.addColorStop(0.6, '#2a0b4d'); sky.addColorStop(1, '#5a1360');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz);
      for (const s of stars) { const tw = 0.5 + 0.5 * Math.sin(now / 600 + s.p); ctx.fillStyle = `rgba(255,255,255,${0.25 + tw * 0.6})`; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); }

      if (L.mode === 'grid') {
        // sol con franjas que late con el bombo
        const sr = Math.min(W, H) * 0.3 * (1 + pulse * 0.06), sx = W / 2, sy = hz - sr * 0.35;
        ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.clip();
        const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sg.addColorStop(0, '#ffe36b'); sg.addColorStop(0.5, '#ff8a3d'); sg.addColorStop(1, '#ff2e97');
        ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
        ctx.fillStyle = '#2a0b4d';
        for (let k = 0; k < 7; k++) { const y = sy + sr * (0.05 + k * 0.14) + ((phase * sr * 0.14) % (sr * 0.14)); const hgt = 2 + k * 1.6; ctx.fillRect(sx - sr, y, sr * 2, hgt); }
        ctx.restore();
        ctx.shadowBlur = 40 + pulse * 30; ctx.shadowColor = '#ff2e97'; ctx.strokeStyle = 'rgba(255,120,190,0.25)'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
        // montañas
        ctx.fillStyle = '#12052a'; ctx.strokeStyle = 'rgba(34,229,255,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, hz);
        const pk = [0.05, 0.6, 0.14, 0.35, 0.22, 0.75, 0.31, 0.4, 0.4, 0.9, 0.5, 0.3, 0.58, 0.85, 0.68, 0.45, 0.77, 0.7, 0.86, 0.35, 0.95, 0.6, 1, 0.2];
        for (let i = 0; i < pk.length; i += 2) ctx.lineTo(pk[i] * W, hz - pk[i + 1] * H * 0.16);
        ctx.lineTo(W, hz); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        // espectro con barras de neón sobre el horizonte
        const n = 44, bw = W / n;
        for (let i = 0; i < n; i++) {
          const f0 = Math.floor(Math.pow(1024, i / n) * 0.9), f1 = Math.max(f0 + 1, Math.floor(Math.pow(1024, (i + 1) / n) * 0.9));
          let v = 0; if (on) { for (let j = f0; j < f1 && j < 1024; j++) v = Math.max(v, fd[j]); v /= 255; } else v = 0.08 + 0.05 * Math.sin(now / 500 + i * 0.5);
          const h = Math.pow(v, 1.6) * hz * 0.92, g = ctx.createLinearGradient(0, hz - h, 0, hz);
          g.addColorStop(0, '#ff2e97'); g.addColorStop(1, '#22e5ff');
          ctx.fillStyle = g; ctx.shadowBlur = 10; ctx.shadowColor = '#ff2e97'; ctx.fillRect(i * bw + 1.5, hz - h, bw - 3, h);
        }
        ctx.shadowBlur = 0;
      }

      // piso: grilla en perspectiva que avanza con el tempo
      const fl = ctx.createLinearGradient(0, hz, 0, H); fl.addColorStop(0, '#1a0638'); fl.addColorStop(1, '#090214');
      ctx.fillStyle = fl; ctx.fillRect(0, hz, W, H - hz);
      const glow = 0.55 + pulse * 0.45;
      ctx.strokeStyle = `rgba(255,46,151,${glow})`; ctx.lineWidth = 1.3; ctx.shadowBlur = 8 + pulse * 10; ctx.shadowColor = '#ff2e97';
      for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.03, hz); ctx.lineTo(W / 2 + i * W * 0.42, H); ctx.stroke(); }
      for (let k = 0; k < 12; k++) { const z = (k + 1 - phase) / 12, y = hz + (H - hz) * Math.pow(z, 2.2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,46,151,0.9)'; ctx.fillRect(0, hz - 1, W, 2);

      // onda sobre el horizonte
      if (on) {
        ctx.strokeStyle = 'rgba(160,250,255,0.95)'; ctx.lineWidth = 1.6; ctx.shadowBlur = 12; ctx.shadowColor = '#22e5ff'; ctx.beginPath();
        for (let i = 0; i < 512; i++) { const x = (i / 511) * W, y = hz - 2 + td[i * 4] * H * 0.22; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke(); ctx.shadowBlur = 0;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <button type="button" class="stage" onClick={onTap} aria-label={playing ? 'Parar' : 'Reproducir'}>
      <canvas ref={cv} aria-hidden="true" />
      <div class="hud">
        <div class="hud-t"><span>1UP <b>{hud.name}</b></span><span>BPM <b>{bpm}</b></span></div>
        <div class="hud-b"><span>{hud.genre}</span><span>{hud.key}</span></div>
        {!playing && <div class="hud-start">TOCÁ PARA EMPEZAR</div>}
      </div>
    </button>
  );
}
