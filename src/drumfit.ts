/* Ajuste automático de la batería sintetizada al sonido que ya tenía el instrumento (pedido de Luc: al pasar de sample a sintetizado debe sonar igual,
   y desde ahí se retoca). Se arranca del preset más parecido y se mueven los parámetros hasta que la envolvente y el espectro del sintetizador se parezcan
   a los del sample. `renderDrum` es una copia mono de `DrumVoice` (worklet.js) con ruido de semilla fija, para que cada prueba dé lo mismo: si cambiás una, cambiá la otra. */
import type { DrumP } from './model';

export function renderDrum(P: DrumP, sr: number, n: number): Float32Array {
  const out = new Float32Array(n); let rA = 2463534242 | 0; let ph = 0, i1 = 0, i2 = 0, j1 = 0, j2 = 0; const mph = [0.11, 0.37, 0.52, 0.68, 0.81, 0.93];
  const gn = Math.tan(Math.PI * Math.min(P.nf, sr * 0.45) / sr), k = 1 / Math.max(0.2, P.nq), a1 = 1 / (1 + gn * (gn + k)), a2 = gn * a1, a3 = gn * a2;
  const hgn = Math.tan(Math.PI * Math.min(7000, sr * 0.45) / sr), hk = 1.4, h1 = 1 / (1 + hgn * (hgn + hk)), h2 = hgn * h1, h3 = hgn * h2;
  const MF = [205.3, 304.4, 369.6, 522.7, 540, 800];
  const endN = Math.min(sr * 4, sr * (Math.max(P.body > 0 ? P.bd : 0, P.nz > 0 ? P.nd : 0, P.mt > 0 ? P.md : 0) * 7 + 60) / 1000);
  for (let i = 0; i < n; i++) {
    if (i >= endN) break; const ms = (i * 1000) / sr; let s = 0;
    if (P.body > 0) { const f = P.f1 + (P.f0 - P.f1) * Math.exp(-ms / P.pd); ph += f / sr; if (ph >= 1) ph -= 1; const att = ms < 0.4 ? ms / 0.4 : 1; s += Math.sin(6.283185307179586 * ph) * Math.exp(-ms / P.bd) * P.body * att; }
    let x = rA; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; rA = x; const w = x / 2147483648;
    if (P.ck > 0 && ms < 4) s += w * Math.exp(-ms / 1.2) * P.ck;
    if (P.nz > 0) {
      const v3 = w - i2, v1 = a1 * i1 + a2 * v3, v2 = i2 + a2 * i1 + a3 * v3; i1 = 2 * v1 - i1; i2 = 2 * v2 - i2;
      const nf = P.nm === 'lp' ? v2 : P.nm === 'bp' ? v1 * k : w - k * v1 - v2;
      let env: number; if (P.bursts > 1) { env = 0; const last = (P.bursts - 1) * 9; for (let q = 0; q < P.bursts - 1; q++) { const t0 = q * 9; if (ms >= t0) env = Math.max(env, Math.exp(-(ms - t0) / 3.2)); } if (ms >= last) env = Math.max(env, Math.exp(-(ms - last) / P.nd)); } else env = Math.exp(-ms / P.nd);
      s += nf * env * P.nz;
    }
    if (P.mt > 0) {
      let m = 0; for (let q = 0; q < 6; q++) { mph[q] += MF[q] / sr; if (mph[q] >= 1) mph[q] -= 1; m += mph[q] < 0.5 ? 1 : -1; }
      m /= 6; const v3 = m - j2, v1 = h1 * j1 + h2 * v3, v2 = j2 + h2 * j1 + h3 * v3; j1 = 2 * v1 - j1; j2 = 2 * v2 - j2;
      s += (m - hk * v1 - v2) * Math.exp(-ms / P.md) * P.mt * 0.8;
    }
    if (P.drive > 0) { const dk = 1 + P.drive * 6; s = Math.tanh(s * dk) / Math.sqrt(dk); }
    out[i] = s * P.lvl;
  }
  return out;
}

/* características de un golpe: envolvente en dB por ventanas (más finas al principio) y espectro en 24 bandas (Goertzel) del ataque y del cuerpo */
type Feat = { env: Float32Array; early: Float32Array; body: Float32Array; rms: number };
const WIN: number[] = []; { let t = 0; for (let i = 0; i < 10; i++) { WIN.push(t); t += 4; } for (let i = 0; i < 40; i++) { WIN.push(t); t += 12; } WIN.push(t); } // ms: 10 ventanas de 4 ms y 40 de 12 ms
const FQ = Array.from({ length: 24 }, (_, i) => 45 * Math.pow(16000 / 45, i / 23));
const db = (v: number) => 20 * Math.log10(v + 1e-7);
function goertz(x: Float32Array, a: number, b: number, f: number, sr: number) {
  const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; const n = Math.max(1, b - a);
  for (let i = a; i < b; i++) { const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / n), s0 = x[i] * hann + w * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - w * s1 * s2)) * 2 / n;
}
function features(x: Float32Array, sr: number): Feat {
  const ms = (m: number) => Math.min(x.length, Math.round(m * sr / 1000)), env = new Float32Array(WIN.length - 1);
  for (let i = 0; i < WIN.length - 1; i++) { const a = ms(WIN[i]), b = ms(WIN[i + 1]); let s = 0; for (let j = a; j < b; j++) s += x[j] * x[j]; env[i] = db(Math.sqrt(s / Math.max(1, b - a))); }
  const early = new Float32Array(24), body = new Float32Array(24);
  for (let q = 0; q < 24; q++) { const f = Math.min(FQ[q], sr * 0.45); early[q] = db(goertz(x, 0, ms(30), f, sr)); body[q] = db(goertz(x, ms(30), ms(250), f, sr)); }
  let s = 0; const e = ms(150); for (let j = 0; j < e; j++) s += x[j] * x[j];
  return { env, early, body, rms: Math.sqrt(s / Math.max(1, e)) };
}
function loss(t: Feat, c: Feat) {
  let l = 0, wsum = 0;
  for (let i = 0; i < t.env.length; i++) { const w = Math.max(0, Math.min(1, (t.env[i] + 75) / 45)); l += w * Math.min(30, Math.abs(c.env[i] - t.env[i])) * (i < 10 ? 1.4 : 1); wsum += w; }
  let ls = 0, ws = 0;
  for (let q = 0; q < 24; q++) { for (const [a, b] of [[t.early[q], c.early[q]], [t.body[q], c.body[q]]]) { const w = Math.max(0, Math.min(1, (a + 85) / 50)); ls += w * Math.min(30, Math.abs(b - a)); ws += w; } }
  return l / Math.max(1, wsum) + 1.3 * ls / Math.max(1, ws);
}

type Dim = { k: keyof DrumP; lo: number; hi: number; log: boolean };
const dimsFor = (P: DrumP): Dim[] => {
  const d: Dim[] = [{ k: 'ck', lo: 0, hi: 1.4, log: false }, { k: 'drive', lo: 0, hi: 1, log: false }];
  if (P.body > 0) d.push({ k: 'f0', lo: 40, hi: 700, log: true }, { k: 'f1', lo: 28, hi: 400, log: true }, { k: 'pd', lo: 2, hi: 150, log: true }, { k: 'bd', lo: 20, hi: 1400, log: true }, { k: 'body', lo: 0.1, hi: 1.5, log: false });
  if (P.nz > 0) d.push({ k: 'nz', lo: 0.05, hi: 1.6, log: false }, { k: 'nf', lo: 250, hi: 15000, log: true }, { k: 'nd', lo: 8, hi: 900, log: true }, { k: 'nq', lo: 0.3, hi: 3, log: true });
  if (P.mt > 0) d.push({ k: 'mt', lo: 0.1, hi: 1.6, log: false }, { k: 'md', lo: 15, hi: 600, log: true });
  return d;
};
const tx = (v: number, d: Dim) => (d.log ? Math.log(Math.max(d.lo, v) / d.lo) / Math.log(d.hi / d.lo) : (v - d.lo) / (d.hi - d.lo));
const fx = (u: number, d: Dim) => { const c = Math.max(0, Math.min(1, u)); return d.log ? d.lo * Math.pow(d.hi / d.lo, c) : d.lo + c * (d.hi - d.lo); };

/** Busca los parámetros del sintetizador que más se parecen a `target` (un golpe mono a `sr`). Parte de `starts` (los presets candidatos) y devuelve el mejor ajuste. */
export async function fitDrum(target: Float32Array, sr: number, starts: DrumP[], opt: { yieldEvery?: number; rounds?: number } = {}): Promise<{ p: DrumP; loss0: number; loss: number }> {
  // arranca donde empieza el sonido (el primer pico por encima del 2 %)
  let pk = 0; for (let i = 0; i < target.length; i++) pk = Math.max(pk, Math.abs(target[i])); let on = 0; while (on < target.length && Math.abs(target[on]) < pk * 0.02) on++;
  const len = Math.round(sr * 0.62), tg = target.subarray(on, on + len), tf = features(tg, sr), N = len;
  const score = (P: DrumP) => { const r = renderDrum({ ...P, lvl: 1 }, sr, N); let s = 0; const e = Math.round(sr * 0.15); for (let j = 0; j < e; j++) s += r[j] * r[j]; const rms = Math.sqrt(s / e) || 1e-9, g = tf.rms / rms; for (let j = 0; j < N; j++) r[j] *= g; return { l: loss(tf, features(r, sr)), g }; };
  // candidatos de partida: cada preset y, si tiene ruido, con cada tipo de filtro (pasa bajos, pasa banda, pasa altos)
  const cands: DrumP[] = []; for (const s of starts) { cands.push(s); if (s.nz > 0) for (const nm of ['lp', 'bp', 'hp'] as const) if (nm !== s.nm) cands.push({ ...s, nm }); }
  let best: DrumP | null = null, bl = 1e9, bg = 1, l0 = 1e9; // el mejor candidato de partida
  for (const s of cands) { const r = score(s); if (r.l < bl) { bl = r.l; best = { ...s }; bg = r.g; } }
  l0 = bl; let P = best!; const dims = dimsFor(P); let evals = 0; const every = opt.yieldEvery ?? 0;
  let step = 0.22; const rounds = opt.rounds ?? 11;
  for (let rd = 0; rd < rounds; rd++) {
    for (const d of dims) {
      const u0 = tx(P[d.k] as number, d);
      for (const dir of [1, -1]) {
        const cand = { ...P, [d.k]: fx(u0 + dir * step, d) } as DrumP; const r = score(cand); evals++;
        if (r.l < bl - 1e-4) { bl = r.l; P = cand; bg = r.g; break; }
      }
      if (every && evals % every === 0) await new Promise((r) => setTimeout(r, 0));
    }
    step *= 0.66;
  }
  // refinado: sacudidas al azar de varios parámetros a la vez (salen de los mínimos locales que no ve el ajuste de a uno)
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let t = 0; t < 70; t++) {
    const amp = 0.12 * (1 - t / 80), cand = { ...P } as any; for (const d of dims) if (rnd() < 0.5) cand[d.k] = fx(tx(P[d.k] as number, d) + (rnd() * 2 - 1) * amp, d);
    const r = score(cand as DrumP); evals++; if (r.l < bl - 1e-4) { bl = r.l; P = cand; bg = r.g; }
    if (every && evals % every === 0) await new Promise((r2) => setTimeout(r2, 0));
  }
  return { p: { ...P, lvl: +(bg).toFixed(3) }, loss0: l0, loss: bl };
}
