/* Escenario visual: el círculo en 3D (túnel de anillos), en un canvas con requestAnimationFrame.
   Lee los analizadores del motor (engine.aL / aR) y el último golpe de bombo (engine.beat); nada de estado de Preact por cuadro. */
import { useEffect, useRef } from 'preact/hooks';
import type { Engine } from './engine/engine';

const C = { bg: '#0c0c0c', line: '#1f1f1f', yel: '#e9c46a', grn: '#6fbf86', red: '#e5655b' };

export function Stage({ engine, bpm, playing, hud, onTap }: { engine: Engine; bpm: number; playing: boolean; hud: { name: string; key: string; genre: string }; onTap: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ bpm, playing });
  live.current = { bpm, playing };

  useEffect(() => {
    const c = cv.current!; const ctx = c.getContext('2d')!;
    let raf = 0, W = 0, H = 0, dpr = 1;
    const td = new Float32Array(2048), td2 = new Float32Array(2048), fd = new Uint8Array(1024);
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = c.clientWidth; H = c.clientHeight; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(c);
    // círculo en 3D: una pila de anillos (cada uno es la onda de un instante) que se alejan hacia el fondo, con perspectiva
    const NR = 34, NP = 120, SPAN = 1900; // anillos, puntos por anillo, milisegundos que tarda un anillo en llegar al fondo
    const ringW = Array.from({ length: NR }, () => new Float32Array(NP + 1)), ringT = new Float64Array(NR).fill(-1e9), ringE = new Float32Array(NR);
    const ringX = Array.from({ length: NR }, () => new Float32Array(NP + 1)), ringY = Array.from({ length: NR }, () => new Float32Array(NP + 1));
    let head = 0, lastCap = 0, lastBeatT = 0; const shock: number[] = [], sm2 = new Float32Array(64);

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
      {
        // CÍRCULO EN 3D: túnel de anillos con perspectiva. Cada anillo es la onda de un instante; los nuevos aparecen adelante y se alejan al fondo.
        const cx = W / 2, cy = mid + hh * 0.18, vx = cx + Math.sin(now / 2600) * W * 0.07, vy = mid - hh * 0.62; // vx, vy: punto de fuga (se mueve despacio: paralaje)
        const Rx = Math.min(W * 0.4, hh * 1.4) * (1 + pulse * 0.05), Ry = Rx * 0.52, rot = now / 9000;
        // captura un anillo nuevo ~ cada 55 ms (si no suena, una ondulación suave para que no se vea muerto)
        if (now - lastCap > 55) {
          lastCap = now; const w = ringW[head]; let e = 0;
          for (let k = 0; k <= NP; k++) { const i0 = (k % NP) * 16; let v = 0; if (on) { for (let j = 0; j < 8; j++) v += td[i0 + j * 2] + td2[i0 + j * 2]; v /= 16; } else v = Math.sin(k / NP * 6.283 * 3 + now / 500) * 0.04; w[k] = v; e += v * v; } // promedio de 8 muestras: onda suave, sin dientes
          w[NP] = w[0];
          ringE[head] = Math.sqrt(e / (NP + 1)); ringT[head] = now; head = (head + 1) % NR;
        }
        if (on && engine.beat.t !== lastBeatT) { lastBeatT = engine.beat.t; shock.push(now); if (shock.length > 4) shock.shift(); }
        ctx.globalCompositeOperation = 'lighter';
        // anillos de atrás para adelante
        for (let n = 0; n < NR; n++) {
          const ri = (head + n) % NR, age = (now - ringT[ri]) / SPAN; if (age < 0 || age >= 1) continue;
          const s2 = 1 / (1 + 2.6 * age), px = ringX[ri], py = ringY[ri], w = ringW[ri];
          const rcx = vx + (cx - vx) * s2, rcy = vy + (cy - vy) * s2, rx = Rx * s2, ry = Ry * s2, amp = 0.3 + Math.min(0.5, ringE[ri] * 1.6);
          for (let k = 0; k <= NP; k++) { const th = (k / NP) * 6.2832 + rot * (1 + age); const f = 1 + Math.max(-1, Math.min(1, w[k] * 1.6)) * amp * 0.5; px[k] = rcx + Math.cos(th) * rx * f; py[k] = rcy + Math.sin(th) * ry * f; }
          const fade = Math.pow(1 - age, 1.25) * Math.min(1, age * 14 + 0.15); // aparece suave adelante y se apaga al fondo
          const q = 1 - age; // color: ámbar adelante → azul grisáceo al fondo
          const r = Math.round(70 + 185 * q), g = Math.round(120 + 55 * q), bl = Math.round(150 - 90 * q);
          ctx.strokeStyle = `rgba(${r},${g},${bl},${(on ? 0.9 : 0.35) * fade})`; ctx.lineWidth = 0.6 + 1.1 * s2;
          ctx.beginPath(); for (let k = 0; k <= NP; k++) k ? ctx.lineTo(px[k], py[k]) : ctx.moveTo(px[k], py[k]); ctx.stroke();
        }
        // líneas que atraviesan el túnel (dan la sensación de profundidad): una cada 10 puntos, unidas de anillo en anillo
        ctx.lineWidth = 0.6;
        for (let k = 0; k < NP; k += 10) {
          ctx.strokeStyle = `rgba(150,175,190,${on ? 0.2 : 0.1})`; ctx.beginPath(); let started = false;
          for (let n = 0; n < NR; n++) { const ri = (head + n) % NR, age = (now - ringT[ri]) / SPAN; if (age < 0 || age >= 1) continue; started ? ctx.lineTo(ringX[ri][k], ringY[ri][k]) : (ctx.moveTo(ringX[ri][k], ringY[ri][k]), started = true); }
          ctx.stroke();
        }
        // ondas de choque con cada bombo: un aro que sale del centro hacia afuera
        for (let n = shock.length - 1; n >= 0; n--) {
          const ag = (now - shock[n]) / 700; if (ag >= 1) { shock.splice(n, 1); continue; }
          ctx.strokeStyle = `rgba(255,190,110,${(1 - ag) * 0.7})`; ctx.lineWidth = 1.5 * (1 - ag) + 0.4; ctx.beginPath(); ctx.ellipse(cx, cy, Rx * (0.25 + ag * 1.15), Ry * (0.25 + ag * 1.15), 0, 0, 6.2832); ctx.stroke();
        }
        // espectro en el anillo del frente: barras que salen hacia afuera (graves rojo, medios amarillo, agudos verde)
        for (let k = 0; k < 64; k++) {
          const f0 = Math.floor(Math.pow(700, k / 64) * 0.9), f1 = Math.max(f0 + 1, Math.floor(Math.pow(700, (k + 1) / 64) * 0.9)); let v = 0;
          if (on) { for (let j = f0; j < f1 && j < 1024; j++) v = Math.max(v, fd[j]); v /= 255; }
          sm2[k] += (v - sm2[k]) * 0.4;
          const th = (k / 64) * 6.2832 - 1.5708 + rot, len = 0.04 + Math.pow(sm2[k], 1.4) * 0.22, c0 = Math.cos(th), s0 = Math.sin(th);
          ctx.strokeStyle = k < 16 ? C.red : k < 40 ? C.yel : C.grn; ctx.globalAlpha = on ? 0.4 + sm2[k] * 0.6 : 0.2; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(cx + c0 * Rx * 1.1, cy + s0 * Ry * 1.1); ctx.lineTo(cx + c0 * Rx * (1.1 + len), cy + s0 * Ry * (1.1 + len)); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // marco técnico: escala con marcas que gira despacio, arco de barrido y cruz del centro
        ctx.lineWidth = 1;
        for (let k = 0; k < 72; k++) {
          const th = (k / 72) * 6.2832 - rot * 1.6, big = k % 6 === 0, r0 = 1.52, r1 = big ? 1.62 : 1.57;
          ctx.strokeStyle = big ? 'rgba(170,190,205,.5)' : 'rgba(120,140,155,.28)';
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(th) * Rx * r0, cy + Math.sin(th) * Ry * r0); ctx.lineTo(cx + Math.cos(th) * Rx * r1, cy + Math.sin(th) * Ry * r1); ctx.stroke();
        }
        const sw = (now / 1700) % 6.2832; ctx.strokeStyle = 'rgba(255,170,80,.75)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(cx, cy, Rx * 1.52, Ry * 1.52, 0, sw, sw + 0.9); ctx.stroke();
        ctx.strokeStyle = 'rgba(140,160,175,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
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
