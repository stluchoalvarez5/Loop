/* Motor de audio de Loop: corre en el hilo de audio (AudioWorklet).
   Secuenciador con precisión de muestra + voces + mixer + FX + master.
   El hilo principal manda el proyecto "compilado" (eventos por pista) y los samples. */

const TAU = Math.PI * 2;
const STEPS = 64;
const MAXV = 12;

/* ---------- utilidades DSP ---------- */
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
class SampleVoice {
  constructor() { this.on = false; }
  start(buf, rate, vel, dec, pan, sr) {
    this.buf = buf; this.pos = 0; this.rate = rate; this.g = vel; this.on = true;
    this.hold = dec >= 0.99 ? 1e12 : buf.length * (0.15 + dec * 0.8) / rate;
    this.fade = Math.exp(-1 / (sr * 0.02)); this.n = 0;
    this.pl = Math.cos((pan + 1) * Math.PI / 4); this.pr = Math.sin((pan + 1) * Math.PI / 4);
  }
  render(L, R, a, b) {
    const d = this.buf, len = d.length;
    for (let i = a; i < b; i++) {
      const p = this.pos, ip = p | 0;
      if (ip + 1 >= len) { this.on = false; return; }
      const s = (d[ip] + (d[ip + 1] - d[ip]) * (p - ip)) * this.g;
      L[i] += s * this.pl; R[i] += s * this.pr;
      this.pos += this.rate;
      if (++this.n > this.hold) { this.g *= this.fade; if (this.g < 1e-4) { this.on = false; return; } }
    }
  }
}

class SynthVoice {
  constructor() { this.on = false; this.f = new SVF(); this.f2 = new SVF(); this.ph = new Float64Array(6); }
  start(p, note, vel, lenSamp, sr, pan) {
    this.p = p; this.sr = sr; this.on = true; this.t = 0; this.len = lenSamp; this.vel = vel;
    this.freq = mtof(note + (p.octave || 0) * 12); this.env = 0; this.stage = 0; this.fenv = 1;
    const n = Math.max(1, Math.min(6, p.unison | 0));
    for (let k = 0; k < n; k++) this.ph[k] = Math.random();
    this.n = n; this.fm = 0; this.mph = 0; this.sph = 0;
    this.pl = Math.cos((pan + 1) * Math.PI / 4); this.pr = Math.sin((pan + 1) * Math.PI / 4);
    this.aI = 1 / Math.max(1, p.attack * sr); this.dK = Math.exp(-1 / Math.max(1, p.decay * sr * 0.3));
    this.rK = Math.exp(-1 / Math.max(1, p.release * sr * 0.3)); this.fK = Math.exp(-1 / Math.max(1, p.fdecay * sr * 0.3));
    this.mK = Math.exp(-1 / Math.max(1, (p.fmDecay || 0.3) * sr * 0.3)); this.mEnv = 1;
  }
  render(L, R, a, b) {
    const p = this.p, sr = this.sr, n = this.n, wave = p.wave;
    const k = 2 - 2 * Math.min(0.97, p.reso);
    for (let i = a; i < b; i++) {
      // envolvente ADSR
      if (this.stage === 0) { this.env += this.aI; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
      else if (this.stage === 1) { this.env = p.sustain + (this.env - p.sustain) * this.dK; if (this.t >= this.len) this.stage = 2; }
      else { this.env *= this.rK; if (this.env < 1e-4) { this.on = false; return; } }
      if (this.stage === 0 && this.t >= this.len) this.stage = 2;
      this.fenv *= this.fK; this.mEnv *= this.mK;
      // osciladores
      let s = 0;
      const base = this.freq;
      if (wave === 'fm') {
        const dt = base / sr;
        this.mph += dt * p.fmRatio; if (this.mph >= 1) this.mph -= 1;
        const mod = Math.sin(TAU * this.mph) * p.fmIndex * this.mEnv;
        this.ph[0] += dt; if (this.ph[0] >= 1) this.ph[0] -= 1;
        s = Math.sin(TAU * this.ph[0] + mod);
      } else {
        for (let u = 0; u < n; u++) {
          const det = n > 1 ? (u / (n - 1) - 0.5) * 2 * p.detune : 0;
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
      const fc = Math.min(sr * 0.45, p.cutoff * (1 + p.envAmt * 8 * this.fenv));
      const g = Math.tan(Math.PI * fc / sr);
      s = this.f.lp(s, g, k);
      if (p.poles4) s = this.f2.lp(s, g, 1.414);
      s *= this.env * this.vel * p.gain;
      L[i] += s * this.pl; R[i] += s * this.pr;
      this.t++;
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


/* ---------- Modo DJ: isolator de 3 bandas con kills, filtro LP/HP y tres envíos: reverb, delay y dub echo ---------- */
class DJDelay {
  /* delay estéreo con realimentación cruzada; el dub echo además satura y oscurece cada repetición */
  constructor(sr, steps, fb, lpHz, hpHz, sat) {
    this.sr = sr; this.steps = steps; this.fb = fb; this.sat = sat;
    this.bl = new Float32Array(sr * 3); this.br = new Float32Array(sr * 3); this.i = 0; this.D = sr * 0.3;
    this.a = 1 - Math.exp(-TAU * lpHz / sr); this.lpL = 0; this.lpR = 0;
    this.hpL = new Biquad(); this.hpR = new Biquad(); this.hpL.set('hp', hpHz, 0.7, 0, sr); this.hpR.set('hp', hpHz, 0.7, 0, sr);
    this.inG = 0; this.on = 0; this.tail = 0; this.oL = 0; this.oR = 0;
  }
  setBpm(bpm) { this.D = Math.min(this.bl.length - 1, Math.round(this.sr * 60 / bpm / 4 * this.steps)); }
  active() { return this.inG > 1e-4 || this.tail > 0; }
  run(l, r) {
    this.inG += (this.on - this.inG) * 0.003;
    const N = this.bl.length, j = (this.i - this.D + N) % N, yl = this.bl[j], yr = this.br[j];
    this.lpL += this.a * (yl - this.lpL); this.lpR += this.a * (yr - this.lpR);
    let fl = this.hpL.run(this.lpL) * this.fb, fr = this.hpR.run(this.lpR) * this.fb;
    if (this.sat) { fl = Math.tanh(fl * 1.4) / 1.4; fr = Math.tanh(fr * 1.4) / 1.4; }
    this.bl[this.i] = l * this.inG + fr; this.br[this.i] = r * this.inG + fl;
    if (++this.i >= N) this.i = 0;
    this.oL = yl; this.oR = yr; this.tail = this.on ? this.sr * 10 : this.tail - 1;
  }
}
class DJ {
  constructor(sr) {
    this.sr = sr; const mk = () => new Biquad();
    this.lp = [mk(), mk(), mk(), mk()]; this.hp = [mk(), mk(), mk(), mk()];
    this.lp.forEach((b) => b.set('lp', 250, 0.7071, 0, sr)); this.hp.forEach((b) => b.set('hp', 2500, 0.7071, 0, sr));
    this.g = [1, 1, 1]; this.gt = [1, 1, 1];
    this.f = 0; this.ft = 0; this.fL = new SVF(); this.fR = new SVF(); this.fg = 1; this.fk = 1.3; this.fmode = 0;
    this.rev = new Freeverb(sr); this.rev.room = 0.93; this.rev.damp = 0.25; this.rin = 0; this.ron = 0; this.rTail = 0;
    this.delay = new DJDelay(sr, 2, 0.45, 6500, 150, false);   // 1/8, limpio
    this.dub = new DJDelay(sr, 3, 0.74, 1800, 280, true);      // 3/16, oscuro, saturado y con mucha repetición
    this.oL = 0; this.oR = 0; this.busy = false;
  }
  setBpm(bpm) { this.delay.setBpm(bpm); this.dub.setBpm(bpm); }
  set(m) {
    const db = (v) => Math.pow(10, v / 20);
    this.gt = [m.kill[0] ? 0 : db(m.eq[0]), m.kill[1] ? 0 : db(m.eq[1]), m.kill[2] ? 0 : db(m.eq[2])];
    this.ft = m.filter; this.ron = m.fx.reverb ? 1 : 0; this.delay.on = m.fx.delay ? 1 : 0; this.dub.on = m.fx.dub ? 1 : 0;
  }
  onStep() {}
  block() {
    this.f += (this.ft - this.f) * 0.15; const f = this.f;
    if (f < -0.02) { this.fmode = -1; const fc = 20000 * Math.pow(120 / 20000, -f); this.fg = Math.tan(Math.PI * Math.min(fc, this.sr * 0.45) / this.sr); }
    else if (f > 0.02) { this.fmode = 1; const fc = 20 * Math.pow(6000 / 20, f); this.fg = Math.tan(Math.PI * fc / this.sr); }
    else this.fmode = 0;
    const neutral = this.gt[0] === 1 && this.gt[1] === 1 && this.gt[2] === 1 && Math.abs(this.ft) < 0.02 && !this.ron && !this.delay.on && !this.dub.on;
    const settled = Math.abs(this.g[0] - 1) + Math.abs(this.g[1] - 1) + Math.abs(this.g[2] - 1) < 1e-3 && Math.abs(this.f) < 0.02;
    this.busy = !(neutral && settled && this.rTail <= 0 && !this.delay.active() && !this.dub.active());
  }
  run(l, r) {
    // isolator: graves + medios + agudos = señal original cuando todo está en 0 dB
    const loL = this.lp[1].run(this.lp[0].run(l)), loR = this.lp[3].run(this.lp[2].run(r));
    const restL = l - loL, restR = r - loR;
    const hiL = this.hp[1].run(this.hp[0].run(restL)), hiR = this.hp[3].run(this.hp[2].run(restR));
    const g = this.g, gt = this.gt; for (let k = 0; k < 3; k++) g[k] += (gt[k] - g[k]) * 0.003;
    l = loL * g[0] + (restL - hiL) * g[1] + hiL * g[2]; r = loR * g[0] + (restR - hiR) * g[1] + hiR * g[2];
    // filtro DJ (un solo control: izquierda pasa-bajos, derecha pasa-altos)
    if (this.fmode !== 0) {
      const G = this.fg, k = this.fk, a1 = 1 / (1 + G * (G + k)), a2 = G * a1, a3 = G * a2;
      for (let c = 0; c < 2; c++) {
        const F = c ? this.fR : this.fL, x = c ? r : l;
        const v3 = x - F.ic2, v1 = a1 * F.ic1 + a2 * v3, v2 = F.ic2 + a2 * F.ic1 + a3 * v3;
        F.ic1 = 2 * v1 - F.ic1; F.ic2 = 2 * v2 - F.ic2;
        const y = this.fmode < 0 ? v2 : x - k * v1 - v2;
        if (c) r = y; else l = y;
      }
    }
    // envíos: al soltar el botón deja de entrar sonido y la cola se apaga sola
    let wl = 0, wr = 0;
    if (this.delay.active()) { this.delay.run(l, r); wl += this.delay.oL * 0.7; wr += this.delay.oR * 0.7; }
    if (this.dub.active()) { this.dub.run(l, r); wl += this.dub.oL * 0.85; wr += this.dub.oR * 0.85; }
    this.rin += (this.ron - this.rin) * 0.003;
    if (this.rin > 1e-4 || this.rTail > 0) { this.rev.run((l + r) * 0.5 * this.rin * 1.4); wl += this.rev.outL * 1.2; wr += this.rev.outR * 1.2; this.rTail = this.ron ? this.sr * 8 : this.rTail - 1; }
    this.oL = l + wl; this.oR = r + wr;
  }
}

/* ---------- master ---------- */
class KWeight { constructor(sr) { this.a = new Biquad(); this.a.set('hs', 1500, 0.7071, 4, sr); this.b = new Biquad(); this.b.set('hp', 38, 0.5, 0, sr); } run(x) { return this.b.run(this.a.run(x)); } }

class LoopEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate; this.samples = {}; this.tracks = []; this.playing = false; this.pos = 0; this.step = -1;
    this.bpm = 124; this.swing = 0; this.compiled = null;
    this.rev = new Freeverb(this.sr); this.dly = new PingPong(this.sr);
    this.eq = Array.from({ length: 8 }, () => [new Biquad(), new Biquad()]); this.eqGains = new Float32Array(8); this.setEq([0, 0, 0, 0, 0, 0, 0, 0]);
    this.kwL = new KWeight(this.sr); this.kwR = new KWeight(this.sr);
    this.ms = 0; this.msK = Math.exp(-1 / (this.sr * 3)); this.auto = 1; this.target = -14; this.autoOn = true;
    this.compEnv = 0; this.limG = 1; this.LA = 64; this.laL = new Float32Array(this.LA); this.laR = new Float32Array(this.LA); this.laI = 0;
    this.pkWin = new Float32Array(this.LA); this.ceil = dbToGain(-1);
    this.duck = 1; this.duckTarget = 1; this.meterN = 0; this.peak = 0; this.revRet = 0.8; this.dlyRet = 0.6;
    this.buf = { L: new Float32Array(128), R: new Float32Array(128), rL: new Float32Array(128), rR: new Float32Array(128), dL: new Float32Array(128), dR: new Float32Array(128), tL: new Float32Array(128), tR: new Float32Array(128), kd: new Float32Array(128) };
    this.dj = new DJ(this.sr); this.stepAt = -1;
    this.port.onmessage = (e) => this.onMsg(e.data);
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
      const old = this.tracks; this.compiled = m.project; this.bpm = m.project.bpm; this.swing = m.project.swing;
      this.tracks = m.project.tracks.map((t) => { const o = old.find((x) => x.id === t.id); return { ...t, voices: o ? o.voices : [], vi: o ? o.vi : 0, duckEnv: 1, meter: 0 }; });
      const s16 = 60 / this.bpm / 4; this.dly.setTime(s16 * 3, s16 * 4); this.dj.setBpm(this.bpm); this.dly.fb = m.project.fx.dlyFb;
      this.rev.room = m.project.fx.revSize; this.rev.damp = m.project.fx.revDamp; this.revRet = m.project.fx.revRet; this.dlyRet = m.project.fx.dlyRet;
      this.target = m.project.master.target; this.autoOn = m.project.master.auto; this.ceil = dbToGain(m.project.master.ceiling);
      this.setEq(m.project.master.eq);
      return;
    }
    if (m.type === 'play') { this.playing = true; this.pos = 0; this.next = 0; this.nextT = 0; this.step = -1; return; }
    if (m.type === 'stop') { this.playing = false; this.tracks.forEach((t) => t.voices.forEach((v) => { if (v.stage !== undefined) v.stage = 2; else v.g *= 0.2; })); return; }
    if (m.type === 'dj') { this.dj.set(m); return; }
    if (m.type === 'preview') { const t = this.tracks.find((x) => x.id === m.id); if (t) this.trigger(t, { n: m.note, v: 1, l: 4 }, 0); }
  }
  stepLen() { return this.sr * 60 / this.bpm / 4; }
  trigger(t, ev, offset) {
    let v = t.voices.find((x) => !x.on);
    if (!v) { if (t.voices.length < MAXV) { v = t.kind === 'sample' ? new SampleVoice() : new SynthVoice(); t.voices.push(v); } else { v = t.voices[t.vi++ % t.voices.length]; } }
    const pan = (t.spread || 0) * (Math.random() * 2 - 1);
    if (t.kind === 'sample') {
      const key = ev.k || t.sample, buf = this.samples[key]; if (!buf) return;
      const hum = 1 + (Math.random() * 2 - 1) * (t.human || 0);
      v.start(buf, Math.pow(2, (t.pitch || 0) / 12), ev.v * hum, t.decay ?? 1, pan, this.sr);
      v.delay = offset;
    } else {
      v.start(t.synth, ev.n, ev.v, ev.l * this.stepLen(), this.sr, pan);
      v.delay = offset;
    }
    if (t.isKick) this.duckHit = offset;
  }
  process(inputs, outputs) {
    const out = outputs[0], OL = out[0], OR = out[1] || out[0], N = OL.length, B = this.buf;
    for (const k in B) { if (B[k].length !== N) B[k] = new Float32Array(N); else B[k].fill(0); }
    const tracks = this.tracks, sr = this.sr;
    // secuenciador: disparos dentro de este bloque
    this.duckHit = -1; this.stepAt = -1;
    if (this.playing && this.compiled) {
      const sl = this.stepLen(), loopLen = sl * STEPS, swOff = (st) => (st % 2 ? this.swing * sl * 0.33 : 0);
      for (let i = 0; i < N; i++) {
        while (this.pos >= this.nextT) {
          const st = this.next; this.step = st;
          for (const t of tracks) { if (!t.play) continue; const evs = t.ev[st]; if (evs) for (const ev of evs) this.trigger(t, ev, i); }
          this.port.postMessage({ type: 'step', step: st }); this.stepAt = i;
          this.next = st + 1;
          if (this.next >= STEPS) { this.next = 0; this.pos -= loopLen; }
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
      for (let i = 0; i < N; i++) { if (i === this.duckHit) e = 1; kickDuck[i] = e; e *= rel; }
      this.duckEnv = e;
    }
    const anySolo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      B.tL.fill(0); B.tR.fill(0);
      for (const v of t.voices) {
        if (!v.on) continue;
        const a = v.delay || 0; v.delay = 0; v.render(B.tL, B.tR, a, N);
      }
      const audible = !t.mute && (!anySolo || t.solo);
      const g = audible ? t.gain : 0, gl = g * Math.cos((t.pan + 1) * Math.PI / 4) * 1.414, gr = g * Math.sin((t.pan + 1) * Math.PI / 4) * 1.414;
      let pk = 0;
      for (let i = 0; i < N; i++) {
        const dk = 1 - (t.duck || 0) * kickDuck[i];
        const l = B.tL[i] * gl * dk, r = B.tR[i] * gr * dk;
        B.L[i] += l; B.R[i] += r; B.rL[i] += (l + r) * 0.5 * t.rev; B.dL[i] += (l + r) * 0.5 * t.dly;
        const a = Math.abs(l) + Math.abs(r); if (a > pk) pk = a;
      }
      t.meter = Math.max(pk * 0.5, t.meter * 0.92);
    }
    // FX + master
    const rr = this.revRet, dr = this.dlyRet, fxDuck = this.compiled ? this.compiled.fx.duck : 0;
    const dj = this.dj; dj.block();
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
      if (this.autoOn && this.playing && this.ms > 1e-7) {
        const lufs = -0.691 + 10 * Math.log10(this.ms), want = Math.min(dbToGain(6), Math.max(dbToGain(-18), dbToGain(this.target - lufs)));
        this.auto += (want - this.auto) * (want < this.auto ? 2e-5 : 4e-6);
      }
      l *= this.auto; r *= this.auto;
      if (dj.busy) { if (i === this.stepAt) dj.onStep(); dj.run(l, r); l = dj.oL; r = dj.oR; } else if (i === this.stepAt) dj.onStep();
      // limitador con lookahead
      const I = this.laI, dl = this.laL[I], drr = this.laR[I];
      this.laL[I] = l; this.laR[I] = r; this.pkWin[I] = Math.max(Math.abs(l), Math.abs(r)); this.laI = (I + 1) % this.LA;
      let m = 0; for (let k = 0; k < this.LA; k += 4) if (this.pkWin[k] > m) m = this.pkWin[k];
      const need = m > this.ceil ? this.ceil / m : 1;
      this.limG = need < this.limG ? need : this.limG + (need - this.limG) * 0.0004;
      let ol = dl * this.limG, or = drr * this.limG;
      const c = this.ceil;
      if (ol > c) ol = c; else if (ol < -c) ol = -c; if (or > c) or = c; else if (or < -c) or = -c;
      OL[i] = ol; OR[i] = or;
      const ap = Math.max(Math.abs(ol), Math.abs(or)); if (ap > this.peak) this.peak = ap;
    }
    if (++this.meterN >= 30) {
      this.meterN = 0;
      this.port.postMessage({ type: 'meter', peak: this.peak, lufs: this.ms > 1e-9 ? -0.691 + 10 * Math.log10(this.ms) : -70, auto: 20 * Math.log10(this.auto), gr: 20 * Math.log10(this.limG), tracks: this.tracks.map((t) => t.meter) });
      this.peak *= 0.5;
    }
    return true;
  }
}
registerProcessor('loop-engine', LoopEngine);
