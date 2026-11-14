/* Motor de audio de Loop: corre en el hilo de audio (AudioWorklet).
   Secuenciador con precisión de muestra + voces + mixer + FX + master.
   El hilo principal manda el proyecto "compilado" (eventos por pista) y los samples. */

const TAU = Math.PI * 2;
const STEPS = 64;
const MAXV = 12, MAXV_HARD = 16; // voces por pista: arriba de 12, la más vieja se apaga con un fundido corto (sin clic)

/* ---------- utilidades DSP ---------- */
function autoAt(a, k0, k1, fr) { return a[k0] + (a[k1] - a[k0]) * fr; }
function readFrac(buf, w, d) { let x = w - d; while (x < 0) x += 2048; const xi = x | 0, fr = x - xi; return buf[xi] + (buf[(xi + 1) & 2047] - buf[xi]) * fr; }
const SS7 = [-1, -0.5717, -0.1775, 0, 0.181, 0.5651, 0.9768]; // reparto del detune del supersaw clásico (7 voces)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const dbToGain = (db) => Math.pow(10, db / 20);
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, g, sr) {
    const A = Math.pow(10, g / 40), w = TAU * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else if (type === 'ls') { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + s); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s); a0 = (A + 1) + (A - 1) * cs + s; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s; }
    else if (type === 'hs') { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s); a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}
/* Filtro de estado variable TPT (Zavalishin): estable con modulación rápida */
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; }
  lp(x, g, k) {
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.ic2, v1 = a1 * this.ic1 + a2 * v3, v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2; return v2;
  }
}

/* ---------- voces ---------- */
/* apaga una voz en ~4 ms en vez de cortarla seco (un corte seco suena como un clic) */
function fastRelease(v, sr) {
  if (!v.on) return;
  const k = Math.exp(-1 / (sr * 0.004));
  if (v.stage !== undefined) { v.stage = 2; v.rK = k; v.len = Math.min(v.len, v.t); }
  else { v.hold = Math.min(v.hold, v.n); v.fade = k; }
}
class SampleVoice {
  constructor() { this.on = false; }
  start(buf, rate, vel, dec, pan, sr, from) {
    this.buf = buf; this.pos = from ? Math.floor(from * buf.length) : 0; this.rate = rate; this.g = vel; this.on = true;
    this.hold = dec >= 0.99 ? 1e12 : buf.length * (0.15 + dec * 0.8) / rate;
    this.fade = Math.exp(-1 / (sr * 0.02)); this.n = 0;
    this.pl = Math.cos((pan + 1) * Math.PI / 4); this.pr = Math.sin((pan + 1) * Math.PI / 4);
  }
  render(L, R, a, b, cm, gps, pm) {
    const d = this.buf, len = d.length, rt = this.rate * (pm || 1);
    for (let i = a; i < b; i++) {
      const p = this.pos, ip = p | 0;
      if (ip + 1 >= len) { this.on = false; return; }
      const s = (d[ip] + (d[ip + 1] - d[ip]) * (p - ip)) * this.g;
      L[i] += s * this.pl; R[i] += s * this.pr;
      this.pos += rt;
      if (++this.n > this.hold) { this.g *= this.fade; if (this.g < 1e-4) { this.on = false; return; } }
    }
  }
}

class SynthVoice {
  constructor() { this.on = false; this.f = new SVF(); this.f2 = new SVF(); this.ph = new Float64Array(7); }
  start(p, note, vel, lenSamp, sr, pan) {
    this.p = p; this.sr = sr; this.on = true; this.t = 0; this.len = lenSamp; this.vel = vel;
    this.freq = mtof(note + (p.octave || 0) * 12); this.tf = this.freq; this.env = 0; this.stage = 0; this.fenv = vel > 0.95 ? 1.6 : 1; // acento: abre más el filtro
    this.gk = 1 - Math.exp(-1 / (sr * 0.045));
    const n = Math.max(1, Math.min(7, p.unison | 0));
    for (let k = 0; k < n; k++) this.ph[k] = Math.random();
    this.n = n; this.fm = 0; this.mph = 0; this.sph = 0;
    this.pl = Math.cos((pan + 1) * Math.PI / 4); this.pr = Math.sin((pan + 1) * Math.PI / 4);
    this.aI = 1 / Math.max(1, p.attack * sr); this.dK = Math.exp(-1 / Math.max(1, p.decay * sr * 0.3));
    this.rK = Math.exp(-1 / Math.max(1, p.release * sr * 0.3)); this.fK = Math.exp(-1 / Math.max(1, p.fdecay * sr * 0.3));
    this.mK = Math.exp(-1 / Math.max(1, (p.fmDecay || 0.3) * sr * 0.3)); this.mEnv = 1;
  }
  /* slide (303): la voz que suena se desliza a la nota nueva sin volver a atacar */
  glideTo(p, note, vel, lenSamp) { this.tf = mtof(note + (p.octave || 0) * 12); this.len = this.t + lenSamp; this.vel = vel; }
  render(L, R, a, b, cm, gps, pm) {
    const p = this.p, sr = this.sr, n = this.n, wave = p.wave, cut = p.cutoff * (cm || 1);
    const k = 2 - 2 * Math.min(0.97, p.reso);
    for (let i = a; i < b; i++) {
      // envolvente ADSR
      if (this.stage === 0) { this.env += this.aI; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
      else if (this.stage === 1) { this.env = p.sustain + (this.env - p.sustain) * this.dK; if (this.t >= this.len) this.stage = 2; }
      else { this.env *= this.rK; if (this.env < 1e-4) { this.on = false; return; } }
      if (this.stage === 0 && this.t >= this.len) this.stage = 2;
      this.fenv *= this.fK; this.mEnv *= this.mK;
      if (this.tf !== this.freq) this.freq += (this.tf - this.freq) * this.gk;
      // osciladores
      let s = 0;
      const base = this.freq * (pm || 1);
      if (wave === 'fm') {
        const dt = base / sr;
        this.mph += dt * p.fmRatio; if (this.mph >= 1) this.mph -= 1;
        const mod = Math.sin(TAU * this.mph) * p.fmIndex * this.mEnv;
        this.ph[0] += dt; if (this.ph[0] >= 1) this.ph[0] -= 1;
        s = Math.sin(TAU * this.ph[0] + mod);
      } else {
        for (let u = 0; u < n; u++) {
          const det = n === 7 ? SS7[u] * p.detune : n > 1 ? (u / (n - 1) - 0.5) * 2 * p.detune : 0;
          const f = base * Math.pow(2, det / 1200), dt = f / sr;
          let t = this.ph[u] + dt; if (t >= 1) t -= 1; this.ph[u] = t;
          let o;
          if (wave === 'saw') o = 2 * t - 1 - polyblep(t, dt);
          else if (wave === 'square') { o = t < 0.5 ? 1 : -1; o += polyblep(t, dt); o -= polyblep((t + 0.5) % 1, dt); }
          else if (wave === 'tri') o = 1 - 4 * Math.abs(t - 0.5);
          else o = Math.sin(TAU * t);
          s += o;
        }
        s /= Math.sqrt(n);
        if (p.sub) { this.sph += base / sr / 2; if (this.sph >= 1) this.sph -= 1; s += Math.sin(TAU * this.sph) * p.sub; }
      }
      // filtro con envolvente
      const fc = Math.min(sr * 0.45, cut * (1 + p.envAmt * 8 * this.fenv));
      const g = Math.tan(Math.PI * fc / sr);
      s = this.f.lp(s, g, k);
      if (p.poles4) s = this.f2.lp(s, g, 1.414);
      s *= this.env * this.vel * p.gain;
      L[i] += s * this.pl; R[i] += s * this.pr;
      this.t++;
    }
  }
}

/* ---------- sinte pro (estilo Serum) ----------
   2 osciladores con tabla de onda (posición = "Forma"), unísono estéreo, sub, ruido, FM de B a A,
   filtro multimodo (SVF), 2 envolventes, 2 LFO sincronizados y una matriz de modulación.
   La modulación se calcula cada 16 muestras; el audio, muestra a muestra. */
const WT_N = 2048, WT_CAP = [128, 64, 32, 16, 8, 4, 2, 1];
const WT = {}; // tabla -> { F: cuadros, m: [mip][cuadro] Float32Array(WT_N) }
const SINT = new Float32Array(WT_N); for (let i = 0; i < WT_N; i++) SINT[i] = Math.sin(TAU * i / WT_N);
const gauss = (x, m, w) => Math.exp(-((x - m) * (x - m)) / (2 * w * w));
const VOW = [[3.5, 6], [2, 9], [1.5, 11], [2.5, 4.5], [1.5, 4], [3.5, 6]]; // a e i o u a (en armónicos)
/* coeficientes de cada forma básica, en fase con el seno: seno, triángulo, sierra, cuadrada, pulso angosto */
function keyCoef(i, k, o) {
  o[0] = 0; o[1] = 0;
  if (i === 0) { if (k === 1) o[0] = 1; }
  else if (i === 1) { if (k % 2) o[0] = (8 / (Math.PI * Math.PI)) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k); }
  else if (i === 2) o[0] = (2 / Math.PI) * (k % 2 ? 1 : -1) / k;
  else if (i === 3) { if (k % 2) o[0] = 4 / (Math.PI * k); }
  else { const w = 0.12, a = 2 / (Math.PI * k); o[0] = a * (1 - Math.cos(TAU * k * w)); o[1] = a * Math.sin(TAU * k * w); }
}
const KA = [0, 0], KB = [0, 0];
function wtCoef(kind, fr, k, o) {
  o[0] = 0; o[1] = 0;
  if (kind === 'basic') { const x = fr * 4, i = Math.min(3, Math.floor(x + 1e-9)), f = x - i; keyCoef(i, k, KA); keyCoef(i + 1, k, KB); o[0] = KA[0] + (KB[0] - KA[0]) * f; o[1] = KA[1] + (KB[1] - KA[1]) * f; return; }
  if (k > 32) return;
  if (kind === 'harm') { const n = 1 + fr * 31; o[0] = Math.max(0, Math.min(1, n - k + 1)) / k; }
  else if (kind === 'vocal') { const x = fr * 5, i = Math.min(4, x | 0), f = x - i, f1 = VOW[i][0] + (VOW[i + 1][0] - VOW[i][0]) * f, f2 = VOW[i][1] + (VOW[i + 1][1] - VOW[i][1]) * f; o[0] = (gauss(k, f1, 1.1) + 0.7 * gauss(k, f2, 1.6) + 0.04) / Math.sqrt(k); }
  else if (kind === 'metal') o[0] = ((k % 2 ? 1 : 0.35) / Math.pow(k, 0.7)) * (0.15 + 0.85 * Math.abs(Math.cos(Math.PI * k * (0.08 + fr * 0.42))));
}
/* tablas limitadas en banda: un juego de cuadros por cada tope de armónicos, así las notas agudas no ensucian */
function ensureWT(kind) {
  if (!kind || WT[kind]) return;
  const F = kind === 'basic' ? 9 : 8, H = 128, m = WT_CAP.map(() => []), c = [0, 0], q = WT_N / 4;
  for (let f = 0; f < F; f++) {
    const fr = f / (F - 1), ws = new Float32Array(H + 1), wc = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) { wtCoef(kind, fr, k, c); ws[k] = c[0]; wc[k] = c[1]; }
    let g = 0;
    WT_CAP.forEach((cap, mi) => {
      const a = new Float32Array(WT_N);
      for (let k = 1; k <= cap; k++) { const s = ws[k], co = wc[k]; if (!s && !co) continue; for (let i = 0, ph = 0; i < WT_N; i++, ph += k) { const j = ph & (WT_N - 1); a[i] += s * SINT[j] + (co ? co * SINT[(j + q) & (WT_N - 1)] : 0); } }
      if (mi === 0) { for (let i = 0; i < WT_N; i++) g = Math.max(g, Math.abs(a[i])); g = g > 0 ? 1 / g : 1; }
      for (let i = 0; i < WT_N; i++) a[i] *= g;
      m[mi].push(a);
    });
  }
  WT[kind] = { F, m };
}
const FTYPE = { lp12: 0, lp24: 0, hp: 1, bp: 2, notch: 3 };
const LFO_SH = { sine: 0, tri: 1, saw: 2, sqr: 3, rand: 4 };
class ProVoice {
  constructor() {
    this.on = false; this.pro = true;
    this.phA = new Float64Array(7); this.phB = new Float64Array(7); this.rA = new Float32Array(7); this.rB = new Float32Array(7);
    this.lA = new Float32Array(7); this.gA = new Float32Array(7); this.lB = new Float32Array(7); this.gB = new Float32Array(7);
    this.fs = new Float64Array(8); this.lp = new Float64Array(2); this.lv = new Float32Array(2); // estados del filtro: L1 L2 R1 R2 (y la segunda etapa)
    this.m = { cut: 0, res: 0, pitch: 0, posA: 0, posB: 0, fm: 0, vol: 0, pan: 0 };
  }
  uni(o, r, l, g) {
    const n = Math.max(1, Math.min(7, o.uni | 0));
    for (let u = 0; u < n; u++) {
      const off = n === 7 ? SS7[u] : n > 1 ? (u / (n - 1)) * 2 - 1 : 0;
      r[u] = Math.pow(2, (off * (o.det || 0)) / 1200);
      const pn = n > 1 ? off * (o.width ?? 0.5) : 0; l[u] = Math.cos((pn + 1) * Math.PI / 4); g[u] = Math.sin((pn + 1) * Math.PI / 4);
    }
    return n;
  }
  start(p, note, vel, lenSamp, sr, pan) {
    const P = p.pro; this.p = p; this.P = P; this.sr = sr; this.on = true; this.t = 0; this.len = lenSamp; this.vel = vel; this.note = note; this.pan = pan;
    this.freq = this.tf = mtof(note); this.env = 0; this.stage = 0; this.e2 = 0; this.s2 = 0; this.cc = 0;
    const A = P.a, B = P.b;
    this.nA = A.on ? this.uni(A, this.rA, this.lA, this.gA) : 0; this.nB = B.on ? this.uni(B, this.rB, this.lB, this.gB) : 0;
    for (let u = 0; u < 7; u++) { this.phA[u] = Math.random(); this.phB[u] = Math.random(); }
    this.mA = Math.pow(2, (A.oct || 0) + (A.semi || 0) / 12 + (A.fine || 0) / 1200); this.mB = Math.pow(2, (B.oct || 0) + (B.semi || 0) / 12 + (B.fine || 0) / 1200);
    ensureWT(A.table); ensureWT(B.table); this.tA = WT[A.table] || WT.basic; this.tB = WT[B.table] || WT.basic; this.sph = 0;
    const E1 = P.env1, E2 = P.env2;
    this.aI = 1 / Math.max(1, E1.a * sr); this.dK = Math.exp(-1 / Math.max(1, E1.d * sr * 0.3)); this.rK = Math.exp(-1 / Math.max(1, E1.r * sr * 0.3));
    this.aI2 = 1 / Math.max(1, E2.a * sr); this.dK2 = Math.exp(-1 / Math.max(1, E2.d * sr * 0.3)); this.rK2 = Math.exp(-1 / Math.max(1, E2.r * sr * 0.3));
    this.gk = 1 - Math.exp(-16 / (sr * Math.max(0.005, P.glide || 0.04)));
    this.lp[0] = 0; this.lp[1] = 0; this.lv[0] = Math.random() * 2 - 1; this.lv[1] = Math.random() * 2 - 1;
    this.fmMode = (P.fm || 0) > 0 || P.mods.some((md) => md.dst === 'fm' && md.amt); // con FM, B modula al A y no suena solo
    this.ft = FTYPE[P.fType] ?? 0; this.f24 = P.fType === 'lp24'; this.fs.fill(0);
  }
  glideTo(p, note, vel, lenSamp) { this.tf = mtof(note); this.note = note; this.len = this.t + lenSamp; this.vel = vel; if (this.stage === 2) { this.stage = 1; } }
  lfo(i, L, gps, n) {
    const rate = Math.max(0.125, L.rate || 16), sh = LFO_SH[L.shape] ?? 0; let ph;
    if (L.trig) { ph = this.lp[i] + n / (this.sr * 60 / (this.bpm || 124) / 4 * rate); ph -= Math.floor(ph); if (sh === 4 && ph < this.lp[i]) this.lv[i] = Math.random() * 2 - 1; this.lp[i] = ph; }
    else { ph = gps / rate; ph -= Math.floor(ph); if (sh === 4 && ph < this.lp[i]) this.lv[i] = Math.random() * 2 - 1; this.lp[i] = ph; }
    if (sh === 0) return Math.sin(TAU * ph);
    if (sh === 1) return 1 - 4 * Math.abs(ph - 0.5);
    if (sh === 2) return 1 - 2 * ph;
    if (sh === 3) return ph < 0.5 ? 1 : -1;
    return this.lv[i];
  }
  control(cm, gps, n) {
    const P = this.P, m = this.m, sr = this.sr;
    m.cut = 0; m.res = 0; m.pitch = 0; m.posA = 0; m.posB = 0; m.fm = 0; m.vol = 0; m.pan = 0;
    const l1 = this.lfo(0, P.lfo1, gps, n), l2 = this.lfo(1, P.lfo2, gps, n), mods = P.mods;
    for (let k = 0; k < mods.length; k++) {
      const md = mods[k]; if (!md.amt) continue;
      const v = md.src === 'lfo1' ? l1 : md.src === 'lfo2' ? l2 : md.src === 'env2' ? this.e2 : md.src === 'vel' ? this.vel : md.src === 'note' ? (this.note - 60) / 24 : 0;
      if (m[md.dst] !== undefined) m[md.dst] += v * md.amt;
    }
    if (this.tf !== this.freq) this.freq += (this.tf - this.freq) * this.gk;
    const pm = (m.pitch ? Math.pow(2, m.pitch) : 1) * (this.tpm || 1), f0 = this.freq * pm; // tono: 1 = una octava; tpm = tono de la pista (afinación, vibrato, automatización)
    this.dA = f0 * this.mA / sr; this.dB = f0 * this.mB / sr;
    this.pA = Math.min(1, Math.max(0, P.a.pos + m.posA)); this.pB = Math.min(1, Math.max(0, P.b.pos + m.posB));
    // cuadro de la tabla (según la forma) y tope de armónicos (según la nota más aguda del unísono)
    let h = 0.45 / (this.dA * 1.06), mi = 0; while (mi < 7 && WT_CAP[mi] > h) mi++;
    let fx = this.pA * (this.tA.F - 1), fi = Math.min(this.tA.F - 2, fx | 0); this.A0 = this.tA.m[mi][fi]; this.A1 = this.tA.m[mi][fi + 1]; this.Af = fx - fi;
    h = 0.45 / (this.dB * 1.06); mi = 0; while (mi < 7 && WT_CAP[mi] > h) mi++;
    fx = this.pB * (this.tB.F - 1); fi = Math.min(this.tB.F - 2, fx | 0); this.B0 = this.tB.m[mi][fi]; this.B1 = this.tB.m[mi][fi + 1]; this.Bf = fx - fi;
    this.fmA = Math.max(0, (P.fm || 0) + m.fm) * 5 / TAU;
    let fc = P.cut * Math.pow(2, this.e2 * (P.fEnv || 0) * 5 + m.cut * 5 + ((this.note - 60) / 12) * (P.fKey || 0)) * (cm || 1);
    fc = Math.min(sr * 0.45, Math.max(20, fc));
    const g = Math.tan(Math.PI * fc / sr), k = 2 - 2 * Math.min(0.98, Math.max(0, P.res + m.res));
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    this.b1 = 1 / (1 + g * (g + 1.414)); this.b2 = g * this.b1; this.b3 = g * this.b2;
    const vg = Math.max(0, 1 + m.vol) * P.gain * this.vel, pn = Math.max(-1, Math.min(1, this.pan + m.pan));
    this.ol = vg * Math.cos((pn + 1) * Math.PI / 4); this.or = vg * Math.sin((pn + 1) * Math.PI / 4);
  }
  render(L, R, a, b, cm, gps, pm) {
    this.tpm = pm || 1;
    const P = this.P, sub = P.sub || 0, noise = P.noise || 0, lvA = P.a.level ?? 1, lvB = P.b.level ?? 1, drv = P.drive || 0, dk = 1 + drv * 8, dg = (1 + drv) / dk;
    const nA = this.nA, nB = this.nB, iA = nA ? 1 / Math.sqrt(nA) : 0, iB = nB ? 1 / Math.sqrt(nB) : 0, ft = this.ft, f24 = this.f24, sdiv = P.subOct === -2 ? 4 : 2;
    let i = a;
    while (i < b) {
      const e = Math.min(b, i + 16); this.control(cm, gps + (i - a) / (this.sr * 60 / (this.bpm || 124) / 4), e - i);
      const dA = this.dA, dB = this.dB, A0 = this.A0, A1 = this.A1, Af = this.Af, B0 = this.B0, B1 = this.B1, Bf = this.Bf, fmA = this.fmA, fmm = this.fmMode;
      const a1 = this.a1, a2 = this.a2, a3 = this.a3, k = this.k, b1 = this.b1, b2 = this.b2, b3 = this.b3, S = this.fs, MK = WT_N - 1;
      for (; i < e; i++) {
        // envolventes
        if (this.stage === 0) { this.env += this.aI; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
        else if (this.stage === 1) { this.env = P.env1.s + (this.env - P.env1.s) * this.dK; if (this.t >= this.len) this.stage = 2; }
        else { this.env *= this.rK; if (this.env < 1e-4) { this.on = false; return; } }
        if (this.stage === 0 && this.t >= this.len) this.stage = 2;
        if (this.stage < 2) { if (this.s2 === 0) { this.e2 += this.aI2; if (this.e2 >= 1) { this.e2 = 1; this.s2 = 1; } } else this.e2 = P.env2.s + (this.e2 - P.env2.s) * this.dK2; }
        else this.e2 *= this.rK2;
        // oscilador B (también modula al A)
        let bl = 0, br = 0, bm = 0;
        for (let u = 0; u < nB; u++) {
          let t = this.phB[u] + dB * this.rB[u]; if (t >= 1) t -= 1; this.phB[u] = t;
          const x = t * WT_N, xi = x | 0, xf = x - xi, i0 = xi & MK, i1 = (xi + 1) & MK, va = B0[i0] + (B0[i1] - B0[i0]) * xf, o = va + (B1[i0] + (B1[i1] - B1[i0]) * xf - va) * Bf;
          bm += o; bl += o * this.lB[u]; br += o * this.gB[u];
        }
        bl *= iB * lvB; br *= iB * lvB; bm *= iB;
        let al = 0, ar = 0;
        for (let u = 0; u < nA; u++) {
          let t = this.phA[u] + dA * this.rA[u]; if (t >= 1) t -= 1; this.phA[u] = t;
          if (fmA) { t += fmA * bm; t -= Math.floor(t); }
          const x = t * WT_N, xi = x | 0, xf = x - xi, i0 = xi & MK, i1 = (xi + 1) & MK, va = A0[i0] + (A0[i1] - A0[i0]) * xf, o = va + (A1[i0] + (A1[i1] - A1[i0]) * xf - va) * Af;
          al += o * this.lA[u]; ar += o * this.gA[u];
        }
        al *= iA * lvA; ar *= iA * lvA;
        let xl = al + (fmm ? 0 : bl), xr = ar + (fmm ? 0 : br);
        if (sub) { this.sph += dA / sdiv; if (this.sph >= 1) this.sph -= 1; const sv = Math.sin(TAU * this.sph) * sub; xl += sv; xr += sv; }
        if (noise) { const nv = (Math.random() * 2 - 1) * noise; xl += nv; xr += nv; }
        if (drv) { xl = Math.tanh(xl * dk) * dg; xr = Math.tanh(xr * dk) * dg; }
        // filtro de estado variable (TPT), izquierda y derecha
        let v3 = xl - S[1], v1 = a1 * S[0] + a2 * v3, v2 = S[1] + a2 * S[0] + a3 * v3; S[0] = 2 * v1 - S[0]; S[1] = 2 * v2 - S[1];
        let yl = ft === 0 ? v2 : ft === 1 ? xl - k * v1 - v2 : ft === 2 ? v1 * k : xl - k * v1;
        v3 = xr - S[3]; v1 = a1 * S[2] + a2 * v3; v2 = S[3] + a2 * S[2] + a3 * v3; S[2] = 2 * v1 - S[2]; S[3] = 2 * v2 - S[3];
        let yr = ft === 0 ? v2 : ft === 1 ? xr - k * v1 - v2 : ft === 2 ? v1 * k : xr - k * v1;
        if (f24) {
          v3 = yl - S[5]; v1 = b1 * S[4] + b2 * v3; v2 = S[5] + b2 * S[4] + b3 * v3; S[4] = 2 * v1 - S[4]; S[5] = 2 * v2 - S[5]; yl = v2;
          v3 = yr - S[7]; v1 = b1 * S[6] + b2 * v3; v2 = S[7] + b2 * S[6] + b3 * v3; S[6] = 2 * v1 - S[6]; S[7] = 2 * v2 - S[7]; yr = v2;
        }
        const env = this.env;
        L[i] += yl * env * this.ol; R[i] += yr * env * this.or;
        this.t++;
      }
    }
  }
}

/* ---------- FX ---------- */
class Freeverb {
  constructor(sr) {
    const sc = sr / 44100, C = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], A = [556, 441, 341, 225], SP = 23;
    const mk = (l) => ({ b: new Float32Array(Math.max(2, Math.round(l * sc))), i: 0, f: 0 });
    this.cL = C.map(mk); this.cR = C.map((l) => mk(l + SP)); this.aL = A.map(mk); this.aR = A.map((l) => mk(l + SP));
    this.room = 0.82; this.damp = 0.3; this.pre = new Float32Array(Math.round(sr * 0.02)); this.pi = 0;
    this.hp = new Biquad(); this.hp.set('hp', 250, 0.7, 0, sr); this.lpL = 0; this.lpR = 0; this.lpa = 1 - Math.exp(-TAU * 7000 / sr);
  }
  run(x) {
    const d = this.pre, o = d[this.pi]; d[this.pi] = this.hp.run(x) * 0.03; if (++this.pi >= d.length) this.pi = 0;
    const fb = this.room * 0.28 + 0.7, d1 = this.damp * 0.4, d2 = 1 - d1;
    let l = 0, r = 0;
    for (let k = 0; k < 8; k++) {
      let c = this.cL[k], y = c.b[c.i]; c.f = y * d2 + c.f * d1; c.b[c.i] = o + c.f * fb; if (++c.i >= c.b.length) c.i = 0; l += y;
      c = this.cR[k]; y = c.b[c.i]; c.f = y * d2 + c.f * d1; c.b[c.i] = o + c.f * fb; if (++c.i >= c.b.length) c.i = 0; r += y;
    }
    for (let k = 0; k < 4; k++) {
      let a = this.aL[k], bo = a.b[a.i]; a.b[a.i] = l + bo * 0.5; if (++a.i >= a.b.length) a.i = 0; l = bo - l;
      a = this.aR[k]; bo = a.b[a.i]; a.b[a.i] = r + bo * 0.5; if (++a.i >= a.b.length) a.i = 0; r = bo - r;
    }
    this.lpL += this.lpa * (l - this.lpL); this.lpR += this.lpa * (r - this.lpR);
    this.outL = this.lpL; this.outR = this.lpR;
  }
}
class PingPong {
  constructor(sr) { this.sr = sr; this.bl = new Float32Array(sr * 2); this.br = new Float32Array(sr * 2); this.i = 0; this.lpL = 0; this.lpR = 0; this.a = 1 - Math.exp(-TAU * 3200 / sr); this.hp = new Biquad(); this.hp.set('hp', 300, 0.7, 0, sr); this.fb = 0.45; this.setTime(0.3, 0.4); }
  setTime(l, r) { this.dl = Math.min(this.bl.length - 1, Math.round(l * this.sr)); this.dr = Math.min(this.br.length - 1, Math.round(r * this.sr)); }
  run(x) {
    const N = this.bl.length, il = (this.i - this.dl + N) % N, ir = (this.i - this.dr + N) % N;
    const yl = this.bl[il], yr = this.br[ir];
    this.lpL += this.a * (yl - this.lpL); this.lpR += this.a * (yr - this.lpR);
    this.bl[this.i] = this.hp.run(x) + this.lpR * this.fb; this.br[this.i] = this.lpL * this.fb;
    if (++this.i >= N) this.i = 0;
    this.outL = yl; this.outR = yr;
  }
}


/* ---------- master ---------- */
class KWeight { constructor(sr) { this.a = new Biquad(); this.a.set('hs', 1500, 0.7071, 4, sr); this.b = new Biquad(); this.b.set('hp', 38, 0.5, 0, sr); } run(x) { return this.b.run(this.a.run(x)); } }

class LoopEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sr = sampleRate; this.samples = {}; this.tracks = []; this.playing = false; this.pos = 0; this.step = -1;
    this.bpm = 124; this.swing = 0; this.compiled = null;
    this.rev = new Freeverb(this.sr); this.dly = new PingPong(this.sr);
    this.eq = Array.from({ length: 8 }, () => [new Biquad(), new Biquad()]); this.eqGains = new Float32Array(8); this.setEq([0, 0, 0, 0, 0, 0, 0, 0]);
    this.kwL = new KWeight(this.sr); this.kwR = new KWeight(this.sr);
    this.ms = 0; this.msK = Math.exp(-1 / (this.sr * 3)); this.auto = 1; this.target = -14; this.autoOn = true;
    this.compEnv = 0; this.limG = 1; this.LA = 64; this.laL = new Float32Array(this.LA); this.laR = new Float32Array(this.LA); this.laI = 0;
    this.pkWin = new Float32Array(this.LA); this.pkBlk = new Float32Array(this.LA >> 3); this.ceil = dbToGain(-1); this.limAtk = 1 - Math.exp(-5 / this.LA);
    this.duck = 1; this.duckTarget = 1; this.meterN = 0; this.peak = 0; this.revRet = 0.8; this.dlyRet = 0.6;
    this.buf = { L: new Float32Array(128), R: new Float32Array(128), rL: new Float32Array(128), rR: new Float32Array(128), dL: new Float32Array(128), dR: new Float32Array(128), tL: new Float32Array(128), tR: new Float32Array(128), kd: new Float32Array(128) };
    this.stepAt = -1; this.clock = 0; this.freezeAt = 0; this.quiet = false;
    this.port.onmessage = (e) => this.onMsg(e.data);
    // modo exportación (OfflineAudioContext): el proyecto y los samples llegan en el constructor y arranca a sonar en la muestra 0
    const o = options && options.processorOptions;
    if (o && o.export) {
      this.samples = o.samples; this.onMsg({ type: 'project', project: o.project }); this.quiet = true; this.freezeAt = o.freezeAt || 0;
      this.arr = o.arr || null; this.arrI = -1; // tema: una escena compilada por vuelta, después de la vuelta de calentamiento
      this.playing = true; this.pos = 0; this.next = 0; this.nextT = 0;
    }
  }
  setEq(gains) {
    const F = [[63, 'ls'], [160, 'peak'], [400, 'peak'], [1000, 'peak'], [2500, 'peak'], [6300, 'peak'], [10000, 'peak'], [16000, 'hs']];
    let tot = 0;
    F.forEach(([f, t], k) => { this.eqGains[k] = gains[k] || 0; tot += Math.max(0, gains[k] || 0); this.eq[k][0].set(t, f, 1, gains[k] || 0, this.sr); this.eq[k][1].set(t, f, 1, gains[k] || 0, this.sr); });
    this.eqOn = gains.some((g) => g !== 0);
  }
  onMsg(m) {
    if (m.type === 'sample') { this.samples[m.key] = m.data; return; }
    if (m.type === 'project') {
      // escena en cola: se aplica justo cuando la vuelta vuelve al paso 0
      if (m.atLoop && this.playing) { this.pendingProj = m; return; }
      this.pendingProj = null;
      // cambio de tempo mientras suena: la posición se reescala, así sigue en el mismo paso (si no, se disparaba una ráfaga de notas)
      if (this.playing && this.compiled && m.project.bpm !== this.bpm) { const r = this.bpm / m.project.bpm; this.pos *= r; this.nextT *= r; }
      const old = this.tracks; this.compiled = m.project; this.bpm = m.project.bpm; this.swing = m.project.swing; this.mod = m.project.mod || null; this.swingA = m.project.swingA || null;
      this.tracks = m.project.tracks.map((t) => {
        const o = old.find((x) => x.id === t.id);
        const nt = { ...t, voices: o ? o.voices : [], vi: o ? o.vi : 0, last: o ? o.last : null, duckEnv: 1, meter: 0, ins: o ? o.ins : null, vph: o ? o.vph : 0, pgl: o ? o.pgl : undefined, pgr: o ? o.pgr : undefined };
        // inserto por pista: saturación, filtros pasa altos / pasa bajos y chorus (los buffers se reservan acá, nunca en process)
        const fx = t.fx || {};
        if (!nt.ins) nt.ins = { hpL: new Biquad(), hpR: new Biquad(), lpL: new Biquad(), lpR: new Biquad(), cb: null, ci: 0, cph: 0, ap: null, pph: 0, pfl: 0, pfr: 0, chL: 0, chR: 0, cn: 0 };
        const I = nt.ins; I.drive0 = I.drive = fx.drive || 0; I.hp = fx.hp || 0; I.lp = fx.lp || 0; I.chorus = fx.chorus || 0; I.crush = fx.crush || 0; I.phaser = fx.phaser || 0;
        // bitcrusher: menos bits (16 → 4) y menos frecuencia de muestreo (mantiene cada muestra hasta 16 veces)
        if (I.crush) { const c = I.crush; I.cq = Math.pow(2, 15 - c * 11); I.cds = 1 + Math.floor(c * c * 15); }
        // phaser: 4 pasa todo por canal (los estados se reservan una vez)
        if (I.phaser && !I.ap) I.ap = new Float64Array(8);
        // EQ de la pista: 4 bandas (grave en estante, dos campanas y agudo en estante); solo se procesan las que tienen ganancia
        const eq = t.eq || null; I.eqOn = false;
        if (eq) {
          if (!I.eqB) { I.eqB = [0, 1, 2, 3].map(() => [new Biquad(), new Biquad()]); I.eqA = new Uint8Array(4); }
          for (let k = 0; k < 4; k++) { const b = eq[k], on = !!(b && Math.abs(b.g) > 0.05); I.eqA[k] = on ? 1 : 0; if (on) { const ty = k === 0 ? 'ls' : k === 3 ? 'hs' : 'peak', q = k === 0 || k === 3 ? 0.707 : (b.q || 1); I.eqB[k][0].set(ty, b.f, q, b.g, this.sr); I.eqB[k][1].set(ty, b.f, q, b.g, this.sr); I.eqOn = true; } }
        }
        if (I.hp) { I.hpL.set('hp', I.hp, 0.707, 0, this.sr); I.hpR.set('hp', I.hp, 0.707, 0, this.sr); }
        if (I.lp) { I.lpL.set('lp', I.lp, 0.707, 0, this.sr); I.lpR.set('lp', I.lp, 0.707, 0, this.sr); }
        if (I.chorus && !I.cb) { I.cb = [new Float32Array(2048), new Float32Array(2048)]; }
        I.dk = 1 + I.drive * 10; I.dg = (1 + I.drive) / I.dk;
        if (t.synth && t.synth.pro) { ensureWT('basic'); ensureWT(t.synth.pro.a.table); ensureWT(t.synth.pro.b.table); }
        return nt;
      });
      const s16 = 60 / this.bpm / 4; this.dly.setTime(s16 * 3, s16 * 4); this.dly.fb = m.project.fx.dlyFb;
      this.rev.room = m.project.fx.revSize; this.rev.damp = m.project.fx.revDamp; this.revRet = m.project.fx.revRet; this.dlyRet = m.project.fx.dlyRet;
      this.target = m.project.master.target; this.autoOn = m.project.master.auto; this.ceil = dbToGain(m.project.master.ceiling);
      this.setEq(m.project.master.eq);
      return;
    }
    if (m.type === 'play') { const f = m.from | 0, sl = this.stepLen(); this.playing = true; this.pos = f * sl; this.next = f; this.nextT = f * sl; this.step = -1; return; }
    if (m.type === 'stop') { this.playing = false; this.tracks.forEach((t) => t.voices.forEach((v) => { if (v.stage !== undefined) v.stage = 2; else fastRelease(v, this.sr); })); return; }
    if (m.type === 'preview') { const t = this.tracks.find((x) => x.id === m.id); if (t) this.trigger(t, { n: m.note, v: 1, l: 4 }, 0); }
  }
  stepLen() { return this.sr * 60 / this.bpm / 4; }
  trigger(t, ev, offset) {
    if (t.mono && t.kind !== 'sample') {
      // monofónico: con slide, la voz activa se desliza; si no, se sueltan las voces anteriores
      const cur = t.last && t.last.on && t.last.stage < 2 ? t.last : null;
      if (cur && (ev.g || (t.synth.pro && t.synth.pro.legato)) && !!cur.pro === !!t.synth.pro) { cur.glideTo(t.synth, ev.n, ev.v, ev.l * this.stepLen()); return; }
      for (const x of t.voices) if (x.on && x.stage < 2) { x.len = Math.min(x.len, x.t + offset); if (x.stage === 0) x.stage = 2; }
    }
    // la voz tiene que ser del tipo de la pista: sampler, sinte clásico o sinte pro
    const pro = t.kind !== 'sample' && !!(t.synth && t.synth.pro), mk = () => (t.kind === 'sample' ? new SampleVoice() : pro ? new ProVoice() : new SynthVoice());
    let v = t.voices.find((x) => !x.on && !!x.pro === pro);
    if (!v) {
      if (t.voices.length < MAXV) { v = mk(); t.voices.push(v); }
      else {
        // ya hay muchas sonando: la más vieja se suelta con un fundido corto y la nota nueva va en otra voz
        const k = t.vi++ % t.voices.length; fastRelease(t.voices[k], this.sr);
        if (t.voices.length < MAXV_HARD) { v = mk(); t.voices.push(v); }
        else { v = t.voices[k]; if (!!v.pro !== pro) { v = mk(); t.voices[k] = v; } }
      }
    }
    const pan = (t.spread || 0) * (Math.random() * 2 - 1);
    if (t.kind === 'sample') {
      const key = ev.k || t.sample, buf = this.samples[key]; if (!buf) return;
      // voz: corta la anterior (choke) para que una palabra no se pise con la siguiente
      if (t.choke) for (const x of t.voices) if (x.on && x !== v) x.hold = Math.min(x.hold, x.n + offset);
      const hum = 1 + (Math.random() * 2 - 1) * (t.human || 0);
      v.start(buf, Math.pow(2, (t.pitch || 0) / 12), ev.v * hum, t.decay ?? 1, pan, this.sr, t.from || 0);
      v.delay = offset;
    } else {
      v.bpm = this.bpm; v.start(t.synth, ev.n, ev.v, ev.l * this.stepLen(), this.sr, pan);
      v.delay = offset; t.last = v;
    }
    if (t.isKick && offset < 128 && !t.mute && (!this.anySolo || t.solo)) this.duckHit = offset; // un bombo que no se escucha no hace sidechain
  }
  process(inputs, outputs) {
    const out = outputs[0], OL = out[0], OR = out[1] || out[0], N = OL.length, B = this.buf;
    for (const k in B) { if (B[k].length !== N) B[k] = new Float32Array(N); else B[k].fill(0); }
    let tracks = this.tracks; const sr = this.sr;
    // secuenciador: disparos dentro de este bloque
    this.duckHit = -1; this.stepAt = -1; this.anySolo = tracks.some((t) => t.solo);
    if (this.playing && this.compiled) {
      const sl = this.stepLen(), loopLen = sl * STEPS, swA = this.swingA, swOff = (st) => (st % 2 ? (swA ? swA[st] : this.swing) * sl * 0.33 : 0);
      for (let i = 0; i < N; i++) {
        while (this.pos >= this.nextT) {
          const st = this.next; this.step = st;
          for (const t of tracks) { if (!t.play) continue; const evs = t.ev[st]; if (!evs || !evs.length) continue; const off = t.groove ? Math.round(t.groove[st % t.groove.length] * sl) : 0; for (const ev of evs) this.trigger(t, ev, i + off); }
          if (!this.quiet) this.port.postMessage({ type: 'step', step: st, frame: currentFrame + i }); this.stepAt = i;
          this.next = st + 1;
          if (this.next >= STEPS) { this.next = 0; this.pos -= loopLen; if (this.pendingProj) { const pp = this.pendingProj; this.onMsg({ type: 'project', project: pp.project }); tracks = this.tracks; } else if (this.arr) { const np = this.arr[++this.arrI]; if (np) { this.onMsg({ type: 'project', project: np }); tracks = this.tracks; } } }
          this.nextT = this.next * sl + swOff(this.next);
        }
        this.pos++;
      }
    }
    // pistas
    const kickDuck = B.kd; kickDuck.fill(0);
    if (this.duckHit >= 0 || this.duckEnv !== undefined) {
      const rel = Math.exp(-1 / (sr * (60 / this.bpm) * 0.12));
      let e = this.duckEnv ?? 0;
      // el bombo no hunde el volumen en una sola muestra (eso es un clic): baja en ~4 ms y vuelve despacio
      const atk = 1 - Math.exp(-1 / (sr * 0.004));
      for (let i = 0; i < N; i++) { if (i === this.duckHit) this.duckA = true; if (this.duckA) { e += (1 - e) * atk; if (e > 0.985) this.duckA = false; } else e *= rel; kickDuck[i] = e; }
      this.duckEnv = e;
    }
    const anySolo = tracks.some((t) => t.solo);
    const on = this.playing && this.compiled, slen = this.stepLen(), ps = Math.max(0, this.pos / slen), k0 = Math.floor(ps) % STEPS, k1 = (k0 + 1) % STEPS, fr = ps - Math.floor(ps);
    // macros automatizadas: curvas globales de 64 pasos (brillo, saturación, envíos, tamaño de la reverb, repeticiones del delay)
    const MD = on ? this.mod : null;
    const mCut = MD && MD.cut ? autoAt(MD.cut, k0, k1, fr) : 1, mEn = MD && MD.en ? autoAt(MD.en, k0, k1, fr) : 0;
    const mSk = MD && MD.sk ? autoAt(MD.sk, k0, k1, fr) : 1, mSadd = MD && MD.sadd ? autoAt(MD.sadd, k0, k1, fr) : 0;
    if (MD && MD.room) this.rev.room = autoAt(MD.room, k0, k1, fr);
    if (MD && MD.fb) this.dly.fb = autoAt(MD.fb, k0, k1, fr);
    for (const t of tracks) {
      B.tL.fill(0); B.tR.fill(0);
      const cm = t.cutAmt && mCut !== 1 ? Math.pow(mCut, t.cutAmt) : 1;
      // tono de la pista (semitonos): afinación (los samples ya la usan al disparar), fino, automatización (±12) y vibrato
      let pst = (t.kind === 'sample' ? 0 : t.pitch || 0) + (t.fine || 0) / 100;
      if (on && t.auto && t.auto.pitch) pst += (autoAt(t.auto.pitch, k0, k1, fr) * 2 - 1) * 12;
      if (t.vib && t.vib.d) { t.vph = (t.vph || 0) + (N * t.vib.r) / sr; if (t.vph >= 1) t.vph -= Math.floor(t.vph); pst += t.vib.d * Math.sin(TAU * t.vph); }
      const pm = pst ? Math.pow(2, pst / 12) : 1;
      for (const v of t.voices) {
        if (!v.on) continue;
        const a = v.delay || 0;
        if (a >= N) { v.delay = a - N; continue; } // golpe atrasado por el groove: todavía no empieza
        v.delay = 0; v.render(B.tL, B.tR, a, N, cm, ps + a / slen, pm);
      }
      const I = t.ins;
      // automatización: valor de cada parámetro en este momento de los 4 compases (interpolado entre pasos)
      let aVol = 1, aRev = t.rev, aDly = t.dly, aPan = t.pan;
      const A = t.auto;
      if (A && on) {
        if (A.vol) aVol = autoAt(A.vol, k0, k1, fr);
        if (A.rev) aRev = autoAt(A.rev, k0, k1, fr);
        if (A.dly) aDly = autoAt(A.dly, k0, k1, fr);
        if (A.pan) aPan = autoAt(A.pan, k0, k1, fr) * 2 - 1;
        if (I) {
          if (A.lp) { const f = 200 * Math.pow(100, autoAt(A.lp, k0, k1, fr)); if (Math.abs(f - (I.lp || 20000)) > I.lp * 0.004) { I.lp = f; I.lpL.set('lp', f, 0.707, 0, sr); I.lpR.set('lp', f, 0.707, 0, sr); } }
          if (A.hp) { const v = autoAt(A.hp, k0, k1, fr), f = 20 * Math.pow(100, v); if (v < 0.01) I.hp = 0; else if (Math.abs(f - (I.hp || 0)) > f * 0.004) { I.hp = f; I.hpL.set('hp', f, 0.707, 0, sr); I.hpR.set('hp', f, 0.707, 0, sr); } }
        }
      }
      // saturación: la de la pista (o su automatización) más la que suma la macro Energía automatizada
      if (I && (on && (A && A.drive || t.macDrive && MD && MD.en))) {
        let dv = A && A.drive ? autoAt(A.drive, k0, k1, fr) : I.drive0;
        if (t.macDrive && mEn > 0) dv = Math.min(1, dv + mEn * 0.6);
        if (dv !== I.drive) { I.drive = dv; I.dk = 1 + dv * 10; I.dg = (1 + dv) / I.dk; }
      }
      if (I && (I.drive || I.hp || I.lp || I.chorus || I.crush || I.phaser || I.eqOn)) {
        const cb = I.cb, cr = I.chorus, dinc = 0.55 / sr, cq = I.cq, cds = I.cds, ph = I.phaser, ap = I.ap;
        const pinc = ph ? this.bpm / 60 / 8 / sr : 0, pfb = ph * 0.55; // phaser: una vuelta cada 2 compases
        for (let i = 0; i < N; i++) {
          let l = B.tL[i], r = B.tR[i];
          if (I.drive) { l = Math.tanh(l * I.dk) * I.dg; r = Math.tanh(r * I.dk) * I.dg; }
          if (I.crush) {
            if (I.cn <= 0) { I.chL = Math.round(l * cq) / cq; I.chR = Math.round(r * cq) / cq; I.cn = cds; }
            I.cn--; l = I.chL; r = I.chR;
          }
          if (I.hp) { l = I.hpL.run(l); r = I.hpR.run(r); }
          if (I.lp) { l = I.lpL.run(l); r = I.lpR.run(r); }
          if (I.eqOn) { const EB = I.eqB, EA = I.eqA; for (let k = 0; k < 4; k++) if (EA[k]) { l = EB[k][0].run(l); r = EB[k][1].run(r); } }
          if (ph && ap) {
            I.pph += pinc; if (I.pph >= 1) I.pph -= 1;
            // barrido exponencial 250 Hz .. 3,5 kHz; el canal derecho va un cuarto de vuelta corrido
            const sL = 0.5 - 0.5 * Math.cos(TAU * I.pph), sR = 0.5 - 0.5 * Math.sin(TAU * I.pph);
            const wL = Math.PI * 250 * Math.pow(14, sL) / sr, wR = Math.PI * 250 * Math.pow(14, sR) / sr;
            const aL = (1 - wL) / (1 + wL), aR = (1 - wR) / (1 + wR);
            let xl = l + I.pfl * pfb, xr = r + I.pfr * pfb;
            for (let k = 0; k < 4; k++) { const yl = -aL * xl + ap[k]; ap[k] = xl + aL * yl; xl = yl; const yr = -aR * xr + ap[k + 4]; ap[k + 4] = xr + aR * yr; xr = yr; }
            I.pfl = xl; I.pfr = xr;
            l = l + (xl - l) * 0.5 * ph; r = r + (xr - r) * 0.5 * ph;
          }
          if (cr && cb) {
            const w = I.ci; cb[0][w] = l; cb[1][w] = r; I.ci = (w + 1) & 2047;
            I.cph += dinc; if (I.cph >= 1) I.cph -= 1;
            const md = Math.sin(TAU * I.cph) * 0.0035 * sr, base = 0.012 * sr;
            const wl = readFrac(cb[0], w, base + md), wr = readFrac(cb[1], w, base - md);
            l = l * (1 - cr * 0.4) + wr * cr * 0.7; r = r * (1 - cr * 0.4) + wl * cr * 0.7;
          }
          B.tL[i] = l; B.tR[i] = r;
        }
      }
      if (MD && MD.sk) { aRev = Math.min(1, aRev * mSk + (t.spAdd && mSadd > 0 ? mSadd : 0)); aDly = Math.min(1, aDly * mSk); }
      const audible = !t.mute && (!anySolo || t.solo);
      const g = audible ? t.gain * aVol : 0, gl = g * Math.cos((aPan + 1) * Math.PI / 4) * 1.414, gr = g * Math.sin((aPan + 1) * Math.PI / 4) * 1.414;
      // rampa dentro del bloque para que la automatización de volumen y paneo no haga "escalones"
      const gl0 = t.pgl ?? gl, gr0 = t.pgr ?? gr, inv = 1 / N; t.pgl = gl; t.pgr = gr;
      let pk = 0;
      for (let i = 0; i < N; i++) {
        const dk = 1 - (t.duck || 0) * kickDuck[i], q = i * inv;
        const l = B.tL[i] * (gl0 + (gl - gl0) * q) * dk, r = B.tR[i] * (gr0 + (gr - gr0) * q) * dk;
        B.L[i] += l; B.R[i] += r; B.rL[i] += (l + r) * 0.5 * aRev; B.dL[i] += (l + r) * 0.5 * aDly;
        const a = Math.abs(l) + Math.abs(r); if (a > pk) pk = a;
      }
      t.meter = Math.max(pk * 0.5, t.meter * 0.92);
    }
    // FX + master
    const rr = this.revRet, dr = this.dlyRet, fxDuck = this.compiled ? this.compiled.fx.duck : 0;
    for (let i = 0; i < N; i++) {
      this.dly.run(B.dL[i]); this.rev.run(B.rL[i] + (this.dly.outL + this.dly.outR) * 0.25);
      const dk = 1 - fxDuck * kickDuck[i];
      let l = B.L[i] + (this.rev.outL * rr + this.dly.outL * dr) * dk;
      let r = B.R[i] + (this.rev.outR * rr + this.dly.outR * dr) * dk;
      if (this.eqOn) for (let k = 0; k < 8; k++) { if (this.eqGains[k] !== 0) { l = this.eq[k][0].run(l); r = this.eq[k][1].run(r); } }
      // compresor "glue" suave
      const lvl = Math.max(Math.abs(l), Math.abs(r));
      this.compEnv = lvl > this.compEnv ? this.compEnv + (lvl - this.compEnv) * 0.01 : this.compEnv * 0.99995;
      const cdb = 20 * Math.log10(this.compEnv + 1e-9), over = cdb + 16, cg = over > 0 ? dbToGain(-over * 0.4) : 1;
      l *= cg; r *= cg;
      // sonoridad (K-weighting) y ganancia automática
      const kl = this.kwL.run(l), kr = this.kwR.run(r);
      if (this.playing) this.ms = this.ms * this.msK + (kl * kl + kr * kr) * (1 - this.msK);
      this.clock++;
      if (this.autoOn && this.playing && this.ms > 1e-7 && !(this.freezeAt && this.clock > this.freezeAt)) {
        const lufs = -0.691 + 10 * Math.log10(this.ms), want = Math.min(dbToGain(6), Math.max(dbToGain(-18), dbToGain(this.target - lufs)));
        this.auto += (want - this.auto) * (want < this.auto ? 2e-5 : 4e-6);
      }
      l *= this.auto; r *= this.auto;
      // limitador con lookahead
      const I = this.laI, dl = this.laL[I], drr = this.laR[I];
      this.laL[I] = l; this.laR[I] = r; const ap0 = Math.max(Math.abs(l), Math.abs(r)); this.pkWin[I] = ap0; const bi = I >> 3; this.pkBlk[bi] = (I & 7) === 0 ? ap0 : Math.max(this.pkBlk[bi], ap0); this.laI = (I + 1) % this.LA;
      let m = 0; const W = this.pkBlk; for (let k = 0; k < W.length; k++) if (W[k] > m) m = W[k]; // pico de toda la ventana, por tramos de 8 muestras (antes se salteaban 3 de cada 4)
      const need = m > this.ceil ? this.ceil / m : 1;
      this.limG = need < this.limG ? this.limG + (need - this.limG) * this.limAtk : this.limG + (need - this.limG) * 0.0004; // baja en forma suave dentro de la anticipación
      let ol = dl * this.limG, or = drr * this.limG;
      const c = this.ceil;
      if (ol > c) ol = c; else if (ol < -c) ol = -c; if (or > c) or = c; else if (or < -c) or = -c;
      OL[i] = ol; OR[i] = or;
      const ap = Math.max(Math.abs(ol), Math.abs(or)); if (ap > this.peak) this.peak = ap;
    }
    if (!this.quiet && ++this.meterN >= 30) {
      this.meterN = 0;
      this.port.postMessage({ type: 'meter', peak: this.peak, lufs: this.ms > 1e-9 ? -0.691 + 10 * Math.log10(this.ms) : -70, auto: 20 * Math.log10(this.auto), gr: 20 * Math.log10(this.limG), tracks: this.tracks.map((t) => t.meter) });
      this.peak *= 0.5;
    }
    return true;
  }
}
registerProcessor('loop-engine', LoopEngine);

/* grabador del micrófono: manda los bloques con su número de muestra (currentFrame), así la voz queda alineada al loop */
/* grabador: junta 16 bloques (2048 muestras) por mensaje, en estéreo; sirve para el micrófono y para grabar la sesión */
class LoopRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.n = 0; this.f0 = 0; this.L = new Float32Array(2048); this.R = new Float32Array(2048);
    this.port.onmessage = (e) => { if (e.data.type === 'start') { this.on = true; this.n = 0; } else { this.flush(); this.on = false; } }; }
  flush() { if (!this.n) return; const L = this.L.slice(0, this.n), R = this.R.slice(0, this.n); this.port.postMessage({ frame: this.f0, L, R }, [L.buffer, R.buffer]); this.n = 0; }
  process(inputs) {
    const a = inputs[0], l = a && a[0];
    if (this.on && l) {
      const r = a[1] || l;
      if (this.n === 0) this.f0 = currentFrame;
      this.L.set(l, this.n); this.R.set(r, this.n); this.n += l.length;
      if (this.n + 128 > 2048) this.flush();
    }
    return true;
  }
}
registerProcessor('loop-rec', LoopRec);
