/* Controlador del motor: crea el AudioContext, carga el worklet y los samples, y le manda el proyecto compilado. */
import workletUrl from './worklet.js?url';
import { compile, type Project } from '../model';

const FILES: Record<string, string> = {
  kA909: 'BT0A0DA', kBh: 'BTAAADA', clap1: 'HANDCLP1', clap2: 'HANDCLP2', hat1: 'HHCD2', hatH: 'HHCD0', open: 'HHOD6', openH: 'HHOD4',
  ride: 'RIDED6', snare: 'ST3T3S7', snareH: 'ST7T7SA', rim: 'RIM63', crash: 'CSHD8',
};

type Meter = { peak: number; lufs: number; auto: number; gr: number; tracks: number[] };

export class Engine {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  ready: Promise<void> | null = null;
  playing = false;
  onStep: (s: number) => void = () => {};
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
      node.port.onmessage = (e) => { const m = e.data; if (m.type === 'step') this.onStep(m.step); else if (m.type === 'meter') this.onMeter(m); };
      this.node = node;
      await this.loadSamples();
      if (this.pending) this.update(this.pending);
    })();
    return this.ready;
  }

  private send(key: string, data: Float32Array) { this.node!.port.postMessage({ type: 'sample', key, data }, [data.buffer]); }

  private async loadSamples() {
    const ctx = this.ctx!;
    const base = import.meta.env.BASE_URL + 'samples/';
    await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      try { const ab = await (await fetch(base + f + '.WAV')).arrayBuffer(); const b = await ctx.decodeAudioData(ab); this.send(k, mono(b)); } catch { /* sin ese sample */ }
    }));
    const shots = await synthShots(ctx.sampleRate);
    Object.entries(shots).forEach(([k, b]) => this.send(k, mono(b)));
  }

  update(p: Project) {
    if (!this.node) { this.pending = p; return; }
    this.node.port.postMessage({ type: 'project', project: compile(p) });
  }
  async play(p: Project) {
    await this.init(); await this.ctx!.resume(); this.update(p);
    this.node!.port.postMessage({ type: 'play' }); this.playing = true;
  }
  stop() { this.node?.port.postMessage({ type: 'stop' }); this.playing = false; }
  preview(id: string, note: number) { this.node?.port.postMessage({ type: 'preview', id, note }); }
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
  S.k808 = await shot(1.4, (c, o) => { const os = c.createOscillator(); os.frequency.setValueAtTime(160, 0); os.frequency.exponentialRampToValueAtTime(52, 0.07); os.frequency.exponentialRampToValueAtTime(47, 1.2); const g = c.createGain(); g.gain.setValueAtTime(1, 0); g.gain.setTargetAtTime(0, 0.05, 0.35); const ws = c.createWaveShaper(), cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 511.5 - 1) * 1.6); ws.curve = cv; os.connect(g); g.connect(ws); ws.connect(o); os.start(0); os.stop(1.4); });
  S.clap808 = await shot(0.6, (c, o, N) => [0, 0.009, 0.019, 0.03].forEach((t, i) => nz(c, o, N, t, i < 3 ? 0.012 : 0.3, 'bandpass', 1100, 1.4, 0.9, 0.0008)));
  S.hat808 = await shot(0.15, (c, o) => hat(c, o, 0.06, 1.6));
  S.open808 = await shot(0.6, (c, o) => hat(c, o, 0.45, 1.3));
  S.snare808 = await shot(0.45, (c, o, N) => { [[238, 0.55, 0.11], [476, 0.3, 0.07]].forEach(([fr, pk, d]) => { const s = c.createOscillator(); s.frequency.setValueAtTime(fr * 1.25, 0); s.frequency.exponentialRampToValueAtTime(fr, 0.012); const g = env(c, 0, 0.0008, pk, d); s.connect(g); g.connect(o); s.start(0); s.stop(d + 0.03); }); nz(c, o, N, 0, 0.26, 'highpass', 1800, 0.7, 0.5, 0.002); });
  S.cowbell = await shot(0.5, (c, o) => { const sum = c.createGain(); [540, 800].forEach((fr) => { const s = c.createOscillator(); s.type = 'square'; s.frequency.value = fr; s.connect(sum); s.start(0); s.stop(0.45); }); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5; const g = c.createGain(); g.gain.setValueAtTime(0.6, 0); g.gain.exponentialRampToValueAtTime(0.15, 0.04); g.gain.exponentialRampToValueAtTime(0.0001, 0.42); sum.connect(bp); bp.connect(g); g.connect(o); });
  S.clave = await shot(0.1, (c, o) => { const s = c.createOscillator(); s.frequency.value = 2500; const g = env(c, 0, 0.0005, 0.7, 0.045); s.connect(g); g.connect(o); s.start(0); s.stop(0.08); });
  S.conga = await shot(0.4, (c, o, N) => { const s = c.createOscillator(); s.frequency.setValueAtTime(330, 0); s.frequency.exponentialRampToValueAtTime(240, 0.05); const g = env(c, 0, 0.001, 0.8, 0.28); s.connect(g); g.connect(o); s.start(0); s.stop(0.35); nz(c, o, N, 0, 0.01, 'bandpass', 2500, 1, 0.25); });
  S.shaker = await shot(0.12, (c, o, N) => nz(c, o, N, 0, 0.07, 'bandpass', 6500, 1.4, 0.7, 0.012));
  S.maraca = await shot(0.06, (c, o, N) => nz(c, o, N, 0, 0.035, 'highpass', 5000, 0.7, 0.6, 0.004));
  S.tamb = await shot(0.3, (c, o, N) => [0, 0.016].forEach((t, i) => { nz(c, o, N, t, 0.12, 'bandpass', 8500, 2, i ? 0.5 : 0.7); const sum = c.createGain(); sum.gain.value = 0.05; [3200, 4700, 6100, 7300].forEach((fr) => { const s = c.createOscillator(); s.type = 'square'; s.frequency.value = fr; s.connect(sum); s.start(t); s.stop(t + 0.12); }); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000; const g = env(c, t, 0.001, 1, 0.1); sum.connect(hp); hp.connect(g); g.connect(o); }));
  return S;
}
