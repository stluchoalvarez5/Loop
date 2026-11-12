/* Controlador del motor: crea el AudioContext, carga el worklet y los samples, y le manda el proyecto compilado. */
import workletUrl from './worklet.js?url';
import { compile, type Project } from '../model';

const FILES: Record<string, string> = {
  kA909: 'BT0A0DA', kBh: 'BTAAADA', clap1: 'HANDCLP1', clap2: 'HANDCLP2', hat1: 'HHCD2', hatH: 'HHCD0', open: 'HHOD6', openH: 'HHOD4',
  ride: 'RIDED6', snare: 'ST3T3S7', snareH: 'ST7T7SA', rim: 'RIM63', crash: 'CSHD8',
  tomL: 'LT3D7', tomM: 'MT3D7', tomH: 'HT3D7', rim2: 'RIM127', snareSoft: 'ST0T3S3',
};

type Meter = { peak: number; lufs: number; auto: number; gr: number; tracks: number[] };

export class Engine {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  ready: Promise<void> | null = null;
  playing = false;
  aL: AnalyserNode | null = null;
  aR: AnalyserNode | null = null;
  beat = { t: 0, step: -1 }; // último golpe de bombo (performance.now) para que los visuales latan
  onStep: (s: number) => void = () => {};
  stepTaps = new Set<(s: number, frame: number) => void>();
  onMeter: (m: Meter) => void = () => {};
  private pending: Project | null = null;

  init() {
    if (this.ready) return this.ready;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.ready = (async () => {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(ctx.destination);
      // tomas para los visuales: un analizador por canal (osciloscopio XY, onda y espectro)
      const split = ctx.createChannelSplitter(2); node.connect(split);
      const mk = () => { const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.78; return a; };
      this.aL = mk(); this.aR = mk(); split.connect(this.aL, 0); split.connect(this.aR, 1);
      node.port.onmessage = (e) => { const m = e.data; if (m.type === 'step') { this.onStep(m.step); this.stepTaps.forEach((f) => f(m.step, m.frame)); } else if (m.type === 'meter') this.onMeter(m); };
      this.node = node;
      await this.loadSamples();
      Object.keys(this.sampleData).filter((k) => k.startsWith('vox:')).forEach((k) => this.send(k, this.sampleData[k])); // voces cargadas antes de arrancar el audio
      if (this.pending) this.update(this.pending);
    })();
    return this.ready;
  }

  sampleData: Record<string, Float32Array> = {};
  private send(key: string, data: Float32Array) { this.sampleData[key] = data; const copy = data.slice(); this.node!.port.postMessage({ type: 'sample', key, data: copy }, [copy.buffer]); }

  private async loadSamples() {
    const ctx = this.ctx!;
    const base = import.meta.env.BASE_URL + 'samples/';
    await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      try { const ab = await (await fetch(base + f + '.WAV')).arrayBuffer(); const b = await ctx.decodeAudioData(ab); this.send(k, mono(b)); } catch { /* sin ese sample */ }
    }));
    const shots = await synthShots(ctx.sampleRate);
    Object.entries(shots).forEach(([k, b]) => this.send(k, mono(b)));
    // kit Lo-Fi: copias del 909 pasadas por un bitcrusher (menos muestras y menos bits), filtradas y saturadas
    ([['lofiKick', 'kA909', 0.9], ['lofiClap', 'clap1', 0.8], ['lofiHat', 'hat1', 0.7], ['lofiOpen', 'open', 0.7], ['lofiSnare', 'snare', 0.8]] as const).forEach(([k, src, pk]) => { const d = this.sampleData[src]; if (d) this.send(k, crush(d, pk)); });
  }

  /* voz grabada: se guarda la versión normal y la invertida; si el audio está a otra frecuencia de muestreo, se remuestrea */
  setVox(id: string, data: Float32Array, sr: number) {
    const target = this.ctx?.sampleRate ?? 48000, ratio = sr / target;
    let d = data;
    if (Math.abs(ratio - 1) > 1e-3) { const n = Math.floor(data.length / ratio); d = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * ratio, xi = x | 0, f = x - xi; d[i] = data[xi] + ((data[xi + 1] ?? 0) - data[xi]) * f; } }
    const r = d.slice().reverse();
    this.sampleData['vox:' + id] = d; this.sampleData['vox:' + id + ':r'] = r;
    if (this.node) { this.send('vox:' + id, d); this.send('vox:' + id + ':r', r); }
  }
  get sr() { return this.ctx?.sampleRate ?? 48000; }
  update(p: Project) {
    if (!this.node) { this.pending = p; return; }
    this.node.port.postMessage({ type: 'project', project: compile(p) });
  }
  /* iPhone: el audio tiene que destrabarse dentro del mismo toque (sin esperar nada antes) y, para que suene
     aunque el celu esté en modo silencio, la sesión de audio tiene que ser de "reproducción" y no "ambiente". */
  private silent: HTMLAudioElement | null = null;
  unlock() {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    try { (navigator as any).audioSession && ((navigator as any).audioSession.type = 'playback'); } catch { /* Safari viejo */ }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!this.silent) {
      // un audio HTML en silencio y en bucle hace que iOS trate la página como reproductor (ignora la tecla de silencio)
      const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      const a = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' }))); a.loop = true; a.setAttribute('playsinline', ''); this.silent = a;
    }
    this.silent.play().catch(() => {});
  }
  /* grabar la sesión: todo lo que sale por el master (lo que escuchás), en vivo, como audio de 16 bits */
  private sess: { rec: AudioWorkletNode; mute: GainNode; chunks: { l: Int16Array; r: Int16Array }[]; frames: number } | null = null;
  get sessionFrames() { return this.sess?.frames ?? 0; }
  async startSession(p: Project) {
    this.unlock(); await this.init(); const ctx = this.ctx!;
    const rec = new AudioWorkletNode(ctx, 'loop-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
    const mute = ctx.createGain(); mute.gain.value = 0; this.node!.connect(rec); rec.connect(mute); mute.connect(ctx.destination);
    const s = { rec, mute, chunks: [] as { l: Int16Array; r: Int16Array }[], frames: 0 }; this.sess = s;
    const q = (a: Float32Array) => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const x = a[i] * 32767; o[i] = x > 32767 ? 32767 : x < -32768 ? -32768 : x; } return o; };
    rec.port.onmessage = (e) => { const { L, R } = e.data as { L: Float32Array; R: Float32Array }; s.chunks.push({ l: q(L), r: q(R) }); s.frames += L.length; };
    rec.port.postMessage({ type: 'start' });
    if (!this.playing) await this.play(p);
  }
  async stopSession() {
    const s = this.sess; if (!s) return null; this.sess = null;
    s.rec.port.postMessage({ type: 'stop' }); await new Promise((r) => setTimeout(r, 120)); // deja llegar el último pedazo
    try { this.node!.disconnect(s.rec); } catch { /* */ } s.rec.disconnect(); s.mute.disconnect();
    return { sr: this.ctx!.sampleRate, chunks: s.chunks, frames: s.frames };
  }
  get state() { return this.ctx?.state ?? 'none'; }
  async play(p: Project, from = 0) {
    this.unlock(); await this.init(); await this.ctx!.resume(); this.update(p);
    this.node!.port.postMessage({ type: 'play', from }); this.playing = true;
  }
  /* graba exactamente 4 compases alineados al loop: si está parado, arranca con un compás de cuenta (el 4) y graba desde el 1;
     si está sonando, espera al próximo compás 1. Compensa la latencia de salida y de entrada. */
  async recordLoop(p: Project, onInfo: (msg: string, level: number) => void, cancel: { stop?: () => void }) {
    await this.init(); const ctx = this.ctx!; await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 } });
    const src = ctx.createMediaStreamSource(stream), rec = new AudioWorkletNode(ctx, 'loop-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain(); mute.gain.value = 0; src.connect(rec); rec.connect(mute); mute.connect(ctx.destination);
    const sr = ctx.sampleRate, loopN = Math.round(64 * sr * 60 / p.bpm / 4);
    const inLat = (stream.getAudioTracks()[0]?.getSettings() as any)?.latency ?? 0.01;
    const shift = Math.round(((ctx as any).outputLatency ?? 0) * sr + ctx.baseLatency * sr + inLat * sr);
    const out = new Float32Array(loopN); let start = -1, level = 0, bar = 0;
    return await new Promise<Float32Array | null>((resolve) => {
      const done = (ok: boolean) => { this.stepTaps.delete(tap); rec.port.postMessage({ type: 'stop' }); src.disconnect(); rec.disconnect(); stream.getTracks().forEach((t) => t.stop()); resolve(ok ? out : null); };
      cancel.stop = () => done(false);
      const tap = (s: number, frame: number) => {
        if (start < 0 && s === 0) start = frame + shift;
        if (start < 0) onInfo('Arranca en ' + (4 - Math.floor(s / 16)), level); else { bar = Math.floor(s / 16) + 1; onInfo('Grabando · compás ' + bar + ' de 4', level); }
      };
      this.stepTaps.add(tap);
      rec.port.onmessage = (e) => {
        const { frame, L: data } = e.data as { frame: number; L: Float32Array };
        let m = 0; for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i])); level = level * 0.8 + m * 0.2;
        if (start < 0) return;
        for (let i = 0; i < data.length; i++) { const k = frame + i - start; if (k >= 0 && k < loopN) out[k] = data[i]; }
        if (frame + data.length >= start + loopN) done(true);
      };
      rec.port.postMessage({ type: 'start' });
      if (!this.playing) this.play(p, 48); // un compás de cuenta antes del 1
    });
  }
  stop() { this.node?.port.postMessage({ type: 'stop' }); this.playing = false; }
  preview(id: string, note: number) { this.node?.port.postMessage({ type: 'preview', id, note }); }
}

function crush(src: Float32Array, pk: number) {
  const out = new Float32Array(src.length), hold = 4, q = 2 ** 7; let h = 0, lp = 0, m = 0;
  for (let i = 0; i < src.length; i++) { if (i % hold === 0) h = Math.round(src[i] * q) / q; lp += (h - lp) * 0.35; out[i] = Math.tanh(lp * 1.8); m = Math.max(m, Math.abs(out[i])); }
  if (m > 0) for (let i = 0; i < out.length; i++) out[i] *= pk / m;
  return out;
}
function mono(b: AudioBuffer) {
  const out = new Float32Array(b.length), c0 = b.getChannelData(0), c1 = b.numberOfChannels > 1 ? b.getChannelData(1) : c0;
  for (let i = 0; i < b.length; i++) out[i] = (c0[i] + c1[i]) * 0.5;
  return out;
}

/* Percusiones sintetizadas (808, cowbell, clave, conga, shaker, pandereta, maraca): se renderizan una sola vez. */
async function synthShots(sr: number) {
  const noise = (c: BaseAudioContext, sec: number) => { const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  const shot = async (sec: number, build: (c: OfflineAudioContext, o: AudioNode, N: AudioBuffer) => void) => { const c = new OfflineAudioContext(1, Math.ceil(sr * sec), sr); build(c, c.destination, noise(c, sec)); return c.startRendering(); };
  const env = (c: BaseAudioContext, t: number, a: number, pk: number, d: number) => { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(d, a + 0.005)); return g; };
  const nz = (c: BaseAudioContext, o: AudioNode, N: AudioBuffer, t: number, d: number, type: BiquadFilterType, fr: number, q: number, pk: number, a = 0.001) => { const s = c.createBufferSource(); s.buffer = N; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = fr; f.Q.value = q; const g = env(c, t, a, pk, d); s.connect(f); f.connect(g); g.connect(o); s.start(t); s.stop(t + d + 0.02); };
  const hat = (c: BaseAudioContext, o: AudioNode, d: number, pk: number) => { const sum = c.createGain(); sum.gain.value = 0.25; [205.3, 304.4, 369.6, 522.7, 540, 800].forEach((fr) => { const s = c.createOscillator(); s.type = 'square'; s.frequency.value = fr * 2.1; s.connect(sum); s.start(0); s.stop(d + 0.05); }); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const g = env(c, 0, 0.001, pk, d); sum.connect(bp); bp.connect(hp); hp.connect(g); g.connect(o); };
  const S: Record<string, AudioBuffer> = {};
  const norm = (b: AudioBuffer, pk = 0.95) => { const d = b.getChannelData(0); let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= pk / m; return b; };
  S.k808 = await shot(1.4, (c, o) => { const os = c.createOscillator(); os.frequency.setValueAtTime(160, 0); os.frequency.exponentialRampToValueAtTime(52, 0.07); os.frequency.exponentialRampToValueAtTime(47, 1.2); const g = c.createGain(); g.gain.setValueAtTime(1, 0); g.gain.setTargetAtTime(0, 0.05, 0.35); const ws = c.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 511.5 - 1) * 1.6); ws.curve = cv; os.connect(g); g.connect(ws); ws.connect(o); os.start(0); os.stop(1.4); });
  S.clap808 = norm(await shot(0.6, (c, o, N) => [0, 0.009, 0.019, 0.03].forEach((t, i) => nz(c, o, N, t, i < 3 ? 0.012 : 0.3, 'bandpass', 1100, 1.4, 0.9, 0.0008))), 0.85);
  S.hat808 = norm(await shot(0.15, (c, o) => hat(c, o, 0.06, 1.6)), 0.75);
  S.open808 = norm(await shot(0.6, (c, o) => hat(c, o, 0.45, 1.3)), 0.65);
  S.snare808 = norm(await shot(0.45, (c, o, N) => { [[238, 0.55, 0.11], [476, 0.3, 0.07]].forEach(([fr, pk, d]) => { const s = c.createOscillator(); s.frequency.setValueAtTime(fr * 1.25, 0); s.frequency.exponentialRampToValueAtTime(fr, 0.012); const g = env(c, 0, 0.0008, pk, d); s.connect(g); g.connect(o); s.start(0); s.stop(d + 0.03); }); nz(c, o, N, 0, 0.26, 'highpass', 1800, 0.7, 0.5, 0.002); }), 0.85);
  S.cowbell = await shot(0.5, (c, o) => { const sum = c.createGain(); [540, 800].forEach((fr) => { const s = c.createOscillator(); s.type = 'square'; s.frequency.value = fr; s.connect(sum); s.start(0); s.stop(0.45); }); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5; const g = c.createGain(); g.gain.setValueAtTime(0.6, 0); g.gain.exponentialRampToValueAtTime(0.15, 0.04); g.gain.exponentialRampToValueAtTime(0.0001, 0.42); sum.connect(bp); bp.connect(g); g.connect(o); });
  S.clave = await shot(0.1, (c, o) => { const s = c.createOscillator(); s.frequency.value = 2500; const g = env(c, 0, 0.0005, 0.7, 0.045); s.connect(g); g.connect(o); s.start(0); s.stop(0.08); });
  S.conga = await shot(0.4, (c, o, N) => { const s = c.createOscillator(); s.frequency.setValueAtTime(330, 0); s.frequency.exponentialRampToValueAtTime(240, 0.05); const g = env(c, 0, 0.001, 0.8, 0.28); s.connect(g); g.connect(o); s.start(0); s.stop(0.35); nz(c, o, N, 0, 0.01, 'bandpass', 2500, 1, 0.25); });
  S.shaker = await shot(0.12, (c, o, N) => nz(c, o, N, 0, 0.07, 'bandpass', 6500, 1.4, 0.7, 0.012));
  S.shaker = (() => { const d = S.shaker.getChannelData(0); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); if (m) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / m; return S.shaker; })();
  S.maraca = await shot(0.06, (c, o, N) => nz(c, o, N, 0, 0.035, 'highpass', 5000, 0.7, 0.6, 0.004));
  S.tamb = await shot(0.3, (c, o, N) => [0, 0.016].forEach((t, i) => { nz(c, o, N, t, 0.12, 'bandpass', 8500, 2, i ? 0.5 : 0.7); const sum = c.createGain(); sum.gain.value = 0.05; [3200, 4700, 6100, 7300].forEach((fr) => { const s = c.createOscillator(); s.type = 'square'; s.frequency.value = fr; s.connect(sum); s.start(t); s.stop(t + 0.12); }); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000; const g = env(c, t, 0.001, 1, 0.1); sum.connect(hp); hp.connect(g); g.connect(o); }));
  /* ---- kits por género: bombos, clap con sala, snap y hats sintetizados (propios, sin licencias de terceros) ---- */
  const curve = (k: number) => { const cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = Math.tanh(x * k) / Math.tanh(k); } return cv; };
  type KickOpt = { f0: number; f1: number; fe: number; tp: number; dur: number; tau: number; hold: number; click: number; clickF: number; drive: number; rumble?: number };
  const kick = (c: OfflineAudioContext, o: AudioNode, N: AudioBuffer, k: KickOpt) => {
    const bus = c.createGain(); const ws = c.createWaveShaper(); ws.curve = curve(k.drive); ws.oversample = '4x'; bus.connect(ws); ws.connect(o);
    const os = c.createOscillator(); os.frequency.setValueAtTime(k.f0, 0); os.frequency.exponentialRampToValueAtTime(k.f1, k.tp); os.frequency.exponentialRampToValueAtTime(k.fe, k.dur);
    const g = c.createGain(); g.gain.setValueAtTime(1, 0); g.gain.setTargetAtTime(0, k.hold, k.tau); os.connect(g); g.connect(bus); os.start(0); os.stop(k.dur);
    if (k.click) { nz(c, bus, N, 0, 0.006, 'highpass', k.clickF, 0.7, k.click, 0.0003); const b = c.createOscillator(); b.frequency.setValueAtTime(k.clickF * 0.5, 0); b.frequency.exponentialRampToValueAtTime(k.f0, 0.008); const bg = env(c, 0, 0.0003, k.click * 0.6, 0.012); b.connect(bg); bg.connect(bus); b.start(0); b.stop(0.03); }
    if (k.rumble) { // rumble de techno: la cola del bombo pasada por una sala, filtrada y saturada
      const ir = c.createBuffer(2, Math.ceil(c.sampleRate * 0.9), c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.22)); }
      const cv = c.createConvolver(); cv.buffer = ir; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 1.2; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 35;
      const rg = c.createGain(); rg.gain.setValueAtTime(0, 0); rg.gain.linearRampToValueAtTime(k.rumble, 0.09); const rs = c.createWaveShaper(); rs.curve = curve(3);
      g.connect(cv); cv.connect(lp); lp.connect(hp); hp.connect(rg); rg.connect(rs); rs.connect(o);
    }
  };
  // trance: corto, con mucho click y cuerpo medio, para dejar lugar al bajo rolling
  S.kTrance = norm(await shot(0.45, (c, o, N) => kick(c, o, N, { f0: 330, f1: 88, fe: 52, tp: 0.03, dur: 0.5, hold: 0.07, tau: 0.085, click: 0.9, clickF: 3500, drive: 2.4 })), 0.5);
  // techno: grave, largo, saturado y con rumble
  S.kTechno = norm(await shot(1.1, (c, o, N) => kick(c, o, N, { f0: 240, f1: 60, fe: 48, tp: 0.045, dur: 1.1, hold: 0.08, tau: 0.11, click: 0.55, clickF: 2500, drive: 3.2, rumble: 0.35 })), 0.5);
  // melodic: sub redondo y largo, click suave
  S.kMelodic = norm(await shot(0.9, (c, o, N) => kick(c, o, N, { f0: 180, f1: 56, fe: 46, tp: 0.045, dur: 0.8, hold: 0.08, tau: 0.12, click: 0.35, clickF: 2200, drive: 1.6 })), 0.5);
  // progressive: redondo y apretado
  S.kProg = norm(await shot(0.6, (c, o, N) => kick(c, o, N, { f0: 220, f1: 62, fe: 50, tp: 0.04, dur: 0.6, hold: 0.07, tau: 0.09, click: 0.55, clickF: 3000, drive: 2 })), 0.5);
  // clap con sala (techno)
  S.clapVerb = norm(await shot(0.9, (c, o, N) => {
    const bus = c.createGain(); bus.connect(o); [0, 0.008, 0.017, 0.027].forEach((t, i) => nz(c, bus, N, t, i < 3 ? 0.01 : 0.18, 'bandpass', 1300, 1.2, 0.9, 0.0006));
    const ir = c.createBuffer(2, Math.ceil(c.sampleRate * 0.8), c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * 0.18)); }
    const cv = c.createConvolver(); cv.buffer = ir; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600; const wg = c.createGain(); wg.gain.value = 0.35; bus.connect(cv); cv.connect(hp); hp.connect(wg); wg.connect(o);
  }), 0.8);
  // snap (melodic): chasquido seco
  S.snap = norm(await shot(0.25, (c, o, N) => { nz(c, o, N, 0, 0.05, 'bandpass', 2300, 2.5, 1, 0.0004); nz(c, o, N, 0.004, 0.12, 'bandpass', 1500, 1, 0.35, 0.002); }), 0.75);
  // hats: apretado y brillante (trance), oscuro y suave (melodic / deep)
  S.hatTight = norm(await shot(0.08, (c, o, N) => { nz(c, o, N, 0, 0.035, 'highpass', 9000, 0.7, 1, 0.0003); hat(c, o, 0.03, 0.8); }), 0.9);
  // ---- kit Synthwave 80s: bombo con punch, snare y clap con reverb compuerta (gated reverb), el sonido de los 80 ----
  const gated = (c: OfflineAudioContext, src: AudioNode, o: AudioNode, len: number, amt: number) => {
    const ir = c.createBuffer(2, Math.ceil(c.sampleRate * len), c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - 0.25 * i / d.length); }
    const cv = c.createConvolver(); cv.buffer = ir; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250; const g = c.createGain(); g.gain.value = amt; src.connect(cv); cv.connect(hp); hp.connect(g); g.connect(o);
  };
  S.k80s = norm(await shot(0.5, (c, o, N) => kick(c, o, N, { f0: 260, f1: 72, fe: 54, tp: 0.035, dur: 0.5, hold: 0.06, tau: 0.09, click: 0.7, clickF: 3200, drive: 2.6 })), 0.5);
  S.snareGated = norm(await shot(0.45, (c, o, N) => {
    const bus = c.createGain(); bus.connect(o);
    [[190, 0.8, 0.12], [330, 0.35, 0.06]].forEach(([fr, pk, d]) => { const s2 = c.createOscillator(); s2.frequency.setValueAtTime(fr * 1.4, 0); s2.frequency.exponentialRampToValueAtTime(fr, 0.015); const g = env(c, 0, 0.0008, pk, d); s2.connect(g); g.connect(bus); s2.start(0); s2.stop(d + 0.03); });
    nz(c, bus, N, 0, 0.18, 'bandpass', 3500, 0.6, 0.7, 0.001); gated(c, bus, o, 0.24, 0.5);
  }), 0.85);
  S.clapGated = norm(await shot(0.45, (c, o, N) => { const bus = c.createGain(); bus.connect(o); [0, 0.009, 0.019, 0.03].forEach((t, i) => nz(c, bus, N, t, i < 3 ? 0.01 : 0.12, 'bandpass', 1200, 1.2, 0.9, 0.0006)); gated(c, bus, o, 0.22, 0.45); }), 0.85);
  // ---- kit Electro: bombo corto tipo 808, snare "zap" y hats metálicos ----
  S.kElectro = norm(await shot(0.5, (c, o, N) => kick(c, o, N, { f0: 190, f1: 62, fe: 50, tp: 0.03, dur: 0.5, hold: 0.05, tau: 0.09, click: 0.25, clickF: 2500, drive: 1.5 })), 0.5);
  S.snareZap = norm(await shot(0.3, (c, o, N) => { const z = c.createOscillator(); z.type = 'triangle'; z.frequency.setValueAtTime(1600, 0); z.frequency.exponentialRampToValueAtTime(140, 0.05); const g = env(c, 0, 0.0005, 0.9, 0.09); z.connect(g); g.connect(o); z.start(0); z.stop(0.12); nz(c, o, N, 0, 0.14, 'highpass', 2500, 0.7, 0.45, 0.001); }), 0.8);
  S.hatDark = norm(await shot(0.12, (c, o, N) => nz(c, o, N, 0, 0.085, 'bandpass', 7000, 0.9, 1, 0.002)), 0.95);
  return S;
}
