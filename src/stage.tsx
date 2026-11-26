/* Escenario visual: el círculo en 3D (túnel de anillos), en un canvas con requestAnimationFrame.
   Lee los analizadores del motor (engine.aL / aR) y el último golpe de bombo (engine.beat); nada de estado de Preact por cuadro. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Engine } from './engine/engine';

const C = { bg: '#0c0c0c', line: '#1f1f1f', yel: '#e9c46a' };
/* paletas: color del anillo de adelante (f) y del fondo (b) como [tono, saturación, luminosidad]; "Arcoíris" cambia de tono con el tiempo y la profundidad */
export const PALS: { n: string; f: [number, number, number]; b: [number, number, number]; rb?: boolean }[] = [
  { n: 'Ámbar', f: [255, 175, 60], b: [70, 120, 150] }, // el de siempre
  { n: 'Neón', f: [255, 60, 200], b: [40, 220, 255] },
  { n: 'Ácido', f: [150, 255, 40], b: [150, 60, 255] },
  { n: 'Fuego', f: [255, 220, 70], b: [150, 20, 30] },
  { n: 'Hielo', f: [170, 240, 255], b: [40, 70, 180] },
  { n: 'Arcoíris', f: [255, 80, 80], b: [80, 80, 255], rb: true },
];
const rd = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };
const wr = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ } };

export function Stage({ engine, bpm, playing, hud, onTap }: { engine: Engine; bpm: number; playing: boolean; hud: { name: string; key: string; genre: string }; onTap: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null), box = useRef<HTMLDivElement>(null);
  const [pal, setPal] = useState(() => Math.max(0, Math.min(PALS.length - 1, rd('loop.stageColor', 0)))), [psy, setPsy] = useState(() => rd('loop.stagePsy', 0)), [moved, setMoved] = useState(false);
  const view = useRef({ yaw: 0, vel: 0, tilt: 0.52, zoom: 1, down: 0 }); // vista que mueve el usuario: giro, inclinación y zoom
  const live = useRef({ bpm, playing, pal, psy });
  live.current = { bpm, playing, pal, psy };
  const onTapRef = useRef(onTap); onTapRef.current = onTap;
  const resetView = () => { const v = view.current; v.yaw = 0; v.vel = 0; v.tilt = 0.52; v.zoom = 1; setMoved(false); };

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

    const cc = { h: 0, s: 0, l: 0 };
    // color según profundidad q (1 = adelante, 0 = fondo), paleta y desfase de tono
    const col = (q: number, now: number, hs: number, P: typeof PALS[number]) => {
      if (P.rb) { cc.h = (now / 35 + q * 260 + hs) % 360; cc.s = 95; cc.l = 58; return cc; }
      // se mezcla en RGB (adelante → fondo) y se pasa a tono / saturación / luminosidad para poder girar el tono en modo psicodélico
      const r = (P.b[0] + (P.f[0] - P.b[0]) * q) / 255, g = (P.b[1] + (P.f[1] - P.b[1]) * q) / 255, bl = (P.b[2] + (P.f[2] - P.b[2]) * q) / 255;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn, l = (mx + mn) / 2; let h = 0;
      if (d > 1e-6) { h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
      cc.h = (h + hs) % 360; cc.s = d < 1e-6 ? 0 : (d / (1 - Math.abs(2 * l - 1))) * 100; cc.l = l * 100; return cc;
    };
    let wasPsy = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const L = live.current, V = view.current, a = engine.aL, b = engine.aR, on = L.playing && !!a, P = PALS[L.pal] ?? PALS[0], psy = L.psy ? 1 : 0;
      const pulse = on ? Math.exp(-((now - engine.beat.t) / 1000) * 6) : 0;
      // inercia del giro cuando se suelta el dedo
      if (!V.down) { V.yaw += V.vel; V.vel *= 0.95; if (Math.abs(V.vel) < 0.00005) V.vel = 0; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (psy) {
        // psicodélico: realimentación (la imagen anterior se agranda, gira un poco y se apaga) → estelas que se meten hacia el centro
        if (!wasPsy) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.globalAlpha = 0.9; ctx.translate(c.width / 2, c.height / 2); ctx.rotate(0.0035 + pulse * 0.012); const zf = 1.011 + pulse * 0.018; ctx.scale(zf, zf); ctx.translate(-c.width / 2, -c.height / 2);
        ctx.drawImage(c, 0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(12,12,12,0.1)'; ctx.fillRect(0, 0, c.width, c.height);
      } else { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, c.width, c.height); }
      wasPsy = psy;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (on) { a!.getFloatTimeDomainData(td); b!.getFloatTimeDomainData(td2); a!.getByteFrequencyData(fd); }
      const hs = psy ? (now / 55 + pulse * 50) % 360 : 0; // en modo psicodélico todo el color da vueltas

      // 16 pasos abajo: el actual con el color de adelante
      const st = on ? engine.beat.step % 16 : -1, dw = (W - 24) / 16; const c0f = { ...col(1, now, hs, P) }; // copia: col() devuelve siempre el mismo objeto
      for (let i = 0; i < 16; i++) { ctx.fillStyle = i === st ? `hsl(${c0f.h | 0},${c0f.s}%,${c0f.l}%)` : i % 4 === 0 ? '#2e2e2e' : '#1e1e1e'; ctx.fillRect(12 + i * dw + 1, H - 30, dw - 2, 3); }

      const top = 34, bot = H - 40, mid = (top + bot) / 2, hh = (bot - top) / 2;
      {
        // CÍRCULO EN 3D: túnel de anillos con perspectiva. Cada anillo es la onda de un instante; los nuevos aparecen adelante y se alejan al fondo.
        const cx = W / 2, cy = mid + hh * 0.18, vx = cx + Math.sin(now / 2600) * W * 0.07, vy = mid - hh * 0.62 * Math.min(1.6, V.tilt / 0.52); // vx, vy: punto de fuga (se mueve despacio: paralaje)
        const Rx = Math.min(W * 0.4, hh * 1.4) * V.zoom * (1 + pulse * (0.05 + psy * 0.06)), Ry = Rx * V.tilt, rot = now / 9000 + V.yaw;
        // captura un anillo nuevo ~ cada 55 ms (si no suena, una ondulación suave para que no se vea muerto)
        if (now - lastCap > 55) {
          lastCap = now; const w = ringW[head]; let e = 0;
          for (let k = 0; k <= NP; k++) { const i0 = (k % NP) * 16; let v = 0; if (on) { for (let j = 0; j < 8; j++) v += td[i0 + j * 2] + td2[i0 + j * 2]; v /= 16; } else v = Math.sin(k / NP * 6.283 * 3 + now / 500) * 0.04; w[k] = v; e += v * v; }
          w[NP] = w[0];
          ringE[head] = Math.sqrt(e / (NP + 1)); ringT[head] = now; head = (head + 1) % NR;
        }
        if (on && engine.beat.t !== lastBeatT) { lastBeatT = engine.beat.t; shock.push(now); if (shock.length > 4) shock.shift(); }
        // posiciones de cada anillo (de atrás para adelante)
        for (let n = 0; n < NR; n++) {
          const ri = (head + n) % NR, age = (now - ringT[ri]) / SPAN; if (age < 0 || age >= 1) continue;
          const s2 = 1 / (1 + 2.6 * age), px = ringX[ri], py = ringY[ri], w = ringW[ri];
          const rcx = vx + (cx - vx) * s2, rcy = vy + (cy - vy) * s2, rx = Rx * s2, ry = Ry * s2, amp = 0.3 + Math.min(0.5, ringE[ri] * 1.6) * (1 + psy * 0.5);
          const tw = psy ? age * Math.sin(now / 3200) * 2.4 : 0;
          for (let k = 0; k <= NP; k++) {
            const th = (k / NP) * 6.2832 + rot * (1 + age) + tw;
            let f = 1 + Math.max(-1, Math.min(1, w[k] * 1.6)) * amp * 0.5; if (psy) f += 0.1 * Math.sin((k / NP) * 6.2832 * 5 + now / 900 + age * 7) + 0.05 * Math.sin((k / NP) * 6.2832 * 8 - now / 600);
            px[k] = rcx + Math.cos(th) * rx * f; py[k] = rcy + Math.sin(th) * ry * f;
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        const KC = psy ? 3 : 1; // caleidoscopio: tres copias giradas 120° en modo psicodélico
        for (let kc = 0; kc < KC; kc++) {
          if (KC > 1) { ctx.save(); ctx.translate(cx, cy); ctx.rotate((kc * 6.2832) / KC); if (kc % 2) ctx.scale(1, -1); ctx.translate(-cx, -cy); }
          for (let n = 0; n < NR; n++) {
            const ri = (head + n) % NR, age = (now - ringT[ri]) / SPAN; if (age < 0 || age >= 1) continue;
            const s2 = 1 / (1 + 2.6 * age), px = ringX[ri], py = ringY[ri];
            const fade = Math.pow(1 - age, 1.25) * Math.min(1, age * 14 + 0.15); // aparece suave adelante y se apaga al fondo
            const q = 1 - age, k0 = col(q, now, hs, P); // color: de adelante al fondo
            ctx.strokeStyle = `hsla(${k0.h | 0},${k0.s | 0}%,${k0.l | 0}%,${(on ? 0.9 : 0.35) * fade * (KC > 1 ? 0.75 : 1)})`; ctx.lineWidth = 0.6 + (1.1 + psy * 0.9) * s2;
            ctx.beginPath(); for (let k = 0; k <= NP; k++) k ? ctx.lineTo(px[k], py[k]) : ctx.moveTo(px[k], py[k]); ctx.stroke();
          }
          if (KC > 1) ctx.restore();
        }
        // líneas que atraviesan el túnel (dan la sensación de profundidad): una cada 10 puntos, unidas de anillo en anillo
        ctx.lineWidth = 0.6;
        const kl = col(0.35, now, hs, P);
        for (let k = 0; k < NP; k += 10) {
          ctx.strokeStyle = `hsla(${kl.h | 0},${(kl.s * 0.4) | 0}%,${Math.min(75, kl.l + 15) | 0}%,${on ? 0.2 : 0.1})`; ctx.beginPath(); let started = false;
          for (let n = 0; n < NR; n++) { const ri = (head + n) % NR, age = (now - ringT[ri]) / SPAN; if (age < 0 || age >= 1) continue; started ? ctx.lineTo(ringX[ri][k], ringY[ri][k]) : (ctx.moveTo(ringX[ri][k], ringY[ri][k]), started = true); }
          ctx.stroke();
        }
        // ondas de choque con cada bombo: un aro que sale del centro hacia afuera
        const ks = col(0.9, now, hs, P);
        for (let n = shock.length - 1; n >= 0; n--) {
          const ag = (now - shock[n]) / 700; if (ag >= 1) { shock.splice(n, 1); continue; }
          ctx.strokeStyle = `hsla(${ks.h | 0},100%,${Math.min(80, ks.l + 12) | 0}%,${(1 - ag) * 0.7})`; ctx.lineWidth = 1.5 * (1 - ag) + 0.4; ctx.beginPath(); ctx.ellipse(cx, cy, Rx * (0.25 + ag * 1.15), Ry * (0.25 + ag * 1.15), 0, 0, 6.2832); ctx.stroke();
        }
        // espectro en el anillo del frente: barras que salen hacia afuera (graves, medios y agudos con tonos de la paleta)
        for (let k = 0; k < 64; k++) {
          const f0 = Math.floor(Math.pow(700, k / 64) * 0.9), f1 = Math.max(f0 + 1, Math.floor(Math.pow(700, (k + 1) / 64) * 0.9)); let v = 0;
          if (on) { for (let j = f0; j < f1 && j < 1024; j++) v = Math.max(v, fd[j]); v /= 255; }
          sm2[k] += (v - sm2[k]) * 0.4;
          const th = (k / 64) * 6.2832 - 1.5708 + rot, len = 0.04 + Math.pow(sm2[k], 1.4) * (0.22 + psy * 0.12), c0 = Math.cos(th), s0 = Math.sin(th);
          const kb = col(P.rb ? 1 - k / 64 : k < 16 ? 1 : k < 40 ? 0.5 : 0, now, hs + (P.rb ? 0 : 0), P);
          ctx.strokeStyle = `hsl(${kb.h | 0},${kb.s | 0}%,${Math.min(78, kb.l + 8) | 0}%)`; ctx.globalAlpha = on ? 0.4 + sm2[k] * 0.6 : 0.2; ctx.lineWidth = 1.6;
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
        const sw = (now / 1700) % 6.2832; ctx.strokeStyle = `hsla(${c0f.h | 0},100%,${c0f.l | 0}%,.75)`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(cx, cy, Rx * 1.52, Ry * 1.52, 0, sw, sw + 0.9); ctx.stroke();
        ctx.strokeStyle = 'rgba(140,160,175,.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    raf = requestAnimationFrame(draw);
    // gestos: un dedo gira (horizontal) e inclina (vertical), dos dedos acercan y giran, la rueda del mouse acerca; un toque quieto da play o stop
    const el = box.current!, ptrs = new Map<number, { x: number; y: number }>(); let sx = 0, sy = 0, travel = 0, pd = 0, pa = 0, tap0 = 0;
    const V = view.current;
    const pair = () => { const [p1, p2] = [...ptrs.values()]; return { d: Math.hypot(p2.x - p1.x, p2.y - p1.y), a: Math.atan2(p2.y - p1.y, p2.x - p1.x) }; };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.stage-ctl')) return;
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); V.down = ptrs.size; V.vel = 0;
      if (ptrs.size === 1) { sx = e.clientX; sy = e.clientY; travel = 0; tap0 = performance.now(); } else if (ptrs.size === 2) { const g = pair(); pd = g.d; pa = g.a; travel = 99; }
    };
    const move = (e: PointerEvent) => {
      const p0 = ptrs.get(e.pointerId); if (!p0) return;
      if (ptrs.size === 1) {
        const dx = e.clientX - p0.x, dy = e.clientY - p0.y; p0.x = e.clientX; p0.y = e.clientY; travel = Math.max(travel, Math.hypot(e.clientX - sx, e.clientY - sy));
        if (travel > 8) { V.yaw += dx * 0.009; V.vel = V.vel * 0.5 + dx * 0.0045; V.tilt = Math.max(0.12, Math.min(1.05, V.tilt + dy * 0.004)); setMoved(true); }
      } else if (ptrs.size === 2) {
        p0.x = e.clientX; p0.y = e.clientY; const g = pair();
        if (pd > 0) V.zoom = Math.max(0.5, Math.min(2.4, V.zoom * (g.d / pd))); let da = g.a - pa; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; V.yaw += da; pd = g.d; pa = g.a; setMoved(true);
      }
    };
    const up = (e: PointerEvent) => {
      if (!ptrs.delete(e.pointerId)) return; V.down = ptrs.size;
      if (ptrs.size === 0 && travel <= 8 && performance.now() - tap0 < 500) onTapRef.current();
      if (ptrs.size === 1) { const r = [...ptrs.values()][0]; sx = r.x; sy = r.y; travel = 99; }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); V.zoom = Math.max(0.5, Math.min(2.4, V.zoom * Math.exp(-e.deltaY * 0.0015))); setMoved(true); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('wheel', wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); };
  }, []);

  const pick = (n: number) => { setPal(n); wr('loop.stageColor', n); };
  return (
    <div ref={box} class="stage" role="button" tabIndex={0} aria-label={playing ? 'Parar' : 'Reproducir'} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}>
      <canvas ref={cv} aria-hidden="true" />
      <div class="hud">
        <div class="hud-t"><b>{hud.name}</b><span>{bpm} BPM</span></div>
        <div class="hud-b"><span>{hud.genre}</span><span>{hud.key}</span></div>
        {!playing && <div class="hud-start"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg></div>}
      </div>
      <div class="stage-ctl">
        <button type="button" class="sc" onClick={() => pick((pal + 1) % PALS.length)} aria-label={'Color: ' + PALS[pal].n + '. Tocá para cambiar'} title="Cambiar de color"><i class="sw" style={{ background: PALS[pal].rb ? 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' : `linear-gradient(135deg,rgb(${PALS[pal].f.join(',')}),rgb(${PALS[pal].b.join(',')}))` }} />{PALS[pal].n}</button>
        <button type="button" class={'sc' + (psy ? ' on' : '')} onClick={() => { const v = psy ? 0 : 1; setPsy(v); wr('loop.stagePsy', v); }} aria-pressed={!!psy} aria-label="Modo psicodélico" title="Psicodélico">Psico</button>
        {moved && <button type="button" class="sc" onClick={resetView} aria-label="Volver la vista al centro" title="Volver la vista">↺</button>}
      </div>
    </div>
  );
}
