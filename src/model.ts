/* Modelo de datos, teoría musical, presets y compilación a eventos para el motor. */
import { GENRES, MEL_STYLES, GENRE_WEIGHTS, parseDrum, parseBass, parseGate } from './genres';
export { GENRES };

export type Synth = {
  wave: 'saw' | 'square' | 'tri' | 'sine' | 'fm'; unison: number; detune: number; cutoff: number; reso: number;
  envAmt: number; fdecay: number; attack: number; decay: number; sustain: number; release: number; gain: number;
  octave?: number; sub?: number; fmRatio?: number; fmIndex?: number; fmDecay?: number; poles4?: boolean;
  pro?: Pro; // si está, suena el sinte pro (estilo Serum) en vez del clásico
};
/* ---------- sinte pro ---------- */
export type WTable = 'basic' | 'harm' | 'vocal' | 'metal';
export type ProOsc = { on: boolean; table: WTable; pos: number; oct: number; semi: number; fine: number; uni: number; det: number; width: number; level: number };
export type ModSrc = 'lfo1' | 'lfo2' | 'env2' | 'vel' | 'note';
export type ModDst = 'cut' | 'res' | 'pitch' | 'posA' | 'posB' | 'fm' | 'vol' | 'pan';
export type ProEnv = { a: number; d: number; s: number; r: number };
export type ProLfo = { shape: 'sine' | 'tri' | 'saw' | 'sqr' | 'rand'; rate: number; trig: boolean };
export type Pro = {
  a: ProOsc; b: ProOsc; sub: number; subOct: -1 | -2; noise: number; fm: number;
  fType: 'lp12' | 'lp24' | 'hp' | 'bp' | 'notch'; cut: number; res: number; drive: number; fEnv: number; fKey: number;
  env1: ProEnv; env2: ProEnv; lfo1: ProLfo; lfo2: ProLfo;
  mods: { src: ModSrc; dst: ModDst; amt: number }[];
  mono: boolean; legato: boolean; glide: number; gain: number;
};
export const WTABLES: [WTable, string][] = [['basic', 'Básica'], ['harm', 'Armónicos'], ['vocal', 'Vocal'], ['metal', 'Metálica']];
export const MOD_SRC: [ModSrc, string][] = [['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['env2', 'Env 2'], ['vel', 'Velocidad'], ['note', 'Nota']];
export const MOD_DST: [ModDst, string][] = [['cut', 'Filtro'], ['res', 'Reso'], ['pitch', 'Tono'], ['posA', 'Forma A'], ['posB', 'Forma B'], ['fm', 'FM'], ['vol', 'Volumen'], ['pan', 'Pan']];
export const LFO_RATES: [number, string][] = [[64, '4 c'], [32, '2 c'], [16, '1 c'], [8, '1/2'], [4, '1/4'], [2, '1/8'], [1, '1/16'], [0.5, '1/32']];
const osc = (o: Partial<ProOsc> = {}): ProOsc => ({ on: true, table: 'basic', pos: 0.5, oct: 0, semi: 0, fine: 0, uni: 1, det: 0, width: 0.5, level: 1, ...o });
const off = (o: Partial<ProOsc> = {}) => osc({ on: false, ...o });
export const mkPro = (o: Partial<Pro> = {}): Pro => ({
  a: osc(), b: off(), sub: 0, subOct: -1, noise: 0, fm: 0, fType: 'lp12', cut: 4000, res: 0.15, drive: 0, fEnv: 0, fKey: 0,
  env1: { a: 0.005, d: 0.4, s: 0.7, r: 0.25 }, env2: { a: 0.001, d: 0.3, s: 0, r: 0.2 },
  lfo1: { shape: 'sine', rate: 16, trig: false }, lfo2: { shape: 'tri', rate: 4, trig: true }, mods: [], mono: false, legato: false, glide: 0.06, gain: 0.3, ...o,
});
/* pasa un sonido clásico al sinte pro, sonando lo más parecido posible */
export function proFrom(s: Synth): Pro {
  const pos = { sine: 0, tri: 0.25, saw: 0.5, square: 0.75, fm: 0 }[s.wave] ?? 0.5, oc = s.octave || 0;
  const p = mkPro({
    a: osc({ pos, oct: oc, uni: s.wave === 'fm' ? 1 : s.unison, det: s.detune, width: s.unison > 1 ? 0.6 : 0 }),
    sub: s.sub ?? 0, fType: s.poles4 ? 'lp24' : 'lp12', cut: s.cutoff, res: s.reso, fEnv: +(Math.log2(1 + 8 * s.envAmt) / 5).toFixed(3),
    env1: { a: s.attack, d: s.decay, s: s.sustain, r: s.release }, env2: { a: 0.001, d: s.fdecay, s: 0, r: 0.2 }, gain: s.gain,
  });
  if (s.wave === 'fm') {
    const r = s.fmRatio ?? 1, semis = Math.round(12 * Math.log2(r));
    p.b = osc({ pos: 0, oct: oc + Math.floor(semis / 12), semi: semis % 12 });
    p.mods = [{ src: 'env2', dst: 'fm', amt: +((s.fmIndex ?? 1) / 5).toFixed(3) }]; p.env2 = { a: 0.001, d: s.fmDecay ?? 0.3, s: 0.05, r: 0.2 };
    if (s.envAmt) p.mods.push({ src: 'env2', dst: 'cut', amt: 0 });
  }
  return p;
}
/* sonidos pro armados desde cero */
const M = (src: ModSrc, dst: ModDst, amt: number) => ({ src, dst, amt });
export const PRO_PRESETS: Record<string, { label: string; for: TrackType[]; p: Pro }> = {
  ssaw: { label: 'Supersaw pro', for: ['melody', 'chords', 'arp'], p: mkPro({ a: osc({ pos: 0.5, uni: 7, det: 30, width: 0.9 }), b: osc({ pos: 0.75, oct: -1, uni: 3, det: 12, level: 0.35 }), cut: 7000, res: 0.1, env1: { a: 0.006, d: 0.5, s: 0.8, r: 0.35 }, gain: 0.494 }) },
  reese: { label: 'Reese que gruñe', for: ['bass'], p: mkPro({ a: osc({ pos: 0.5, uni: 2, det: 22, width: 0.3 }), b: osc({ pos: 0.5, fine: 14, uni: 2, det: 18, width: 0.3 }), sub: 0.55, fType: 'lp24', cut: 520, res: 0.3, drive: 0.45, lfo1: { shape: 'sine', rate: 8, trig: false }, mods: [M('lfo1', 'cut', 0.18), M('lfo1', 'posA', 0.15)], mono: true, legato: true, glide: 0.05, env1: { a: 0.008, d: 0.3, s: 0.9, r: 0.1 }, gain: 1.413 }) },
  wobble: { label: 'Wobble', for: ['bass'], p: mkPro({ a: osc({ table: 'harm', pos: 0.65 }), b: osc({ table: 'vocal', pos: 0.4, level: 0.6 }), sub: 0.6, fType: 'lp24', cut: 320, res: 0.5, drive: 0.35, lfo1: { shape: 'tri', rate: 4, trig: false }, mods: [M('lfo1', 'cut', 0.55), M('lfo1', 'posB', 0.5)], mono: true, legato: true, glide: 0.04, env1: { a: 0.005, d: 0.3, s: 0.9, r: 0.08 }, gain: 1.353 }) },
  acid: { label: 'Acid pro', for: ['bass', 'arp'], p: mkPro({ a: osc({ pos: 0.5, oct: -1 }), fType: 'lp24', cut: 230, res: 0.82, drive: 0.35, fEnv: 0.6, env2: { a: 0.001, d: 0.16, s: 0, r: 0.1 }, mods: [M('vel', 'cut', 0.25)], mono: true, legato: false, glide: 0.05, env1: { a: 0.002, d: 0.3, s: 0.6, r: 0.04 }, gain: 1.341 }) },
  sub808: { label: 'Sub 808', for: ['bass'], p: mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0.25, oct: 1, level: 0.15 }), fType: 'lp12', cut: 1800, res: 0.05, drive: 0.25, env2: { a: 0.001, d: 0.09, s: 0, r: 0.1 }, mods: [M('env2', 'pitch', 0.25)], mono: true, legato: true, glide: 0.08, env1: { a: 0.003, d: 0.8, s: 0.6, r: 0.15 }, gain: 1.245 }) },
  pluckVox: { label: 'Pluck vocal', for: ['arp', 'melody'], p: mkPro({ a: osc({ table: 'vocal', pos: 0.25, uni: 2, det: 10, width: 0.6 }), cut: 1400, res: 0.25, fEnv: 0.45, env2: { a: 0.001, d: 0.22, s: 0, r: 0.2 }, mods: [M('env2', 'posA', 0.5)], env1: { a: 0.002, d: 0.35, s: 0, r: 0.25 }, gain: 1.847 }) },
  digiArp: { label: 'Arpegio digital', for: ['arp', 'melody'], p: mkPro({ a: osc({ table: 'harm', pos: 0.2 }), b: osc({ pos: 0.75, oct: 1, level: 0.25 }), cut: 5000, res: 0.2, lfo1: { shape: 'saw', rate: 64, trig: false }, mods: [M('lfo1', 'posA', -0.4), M('env2', 'cut', 0.25)], env1: { a: 0.002, d: 0.25, s: 0.1, r: 0.2 }, gain: 1.215 }) },
  lead: { label: 'Lead con vibrato', for: ['melody', 'arp'], p: mkPro({ a: osc({ pos: 0.58, uni: 3, det: 14, width: 0.5 }), b: osc({ pos: 0.75, oct: 1, fine: 6, level: 0.4 }), cut: 3800, res: 0.2, lfo1: { shape: 'sine', rate: 2, trig: true }, env2: { a: 0.4, d: 0.5, s: 1, r: 0.3 }, mods: [M('lfo1', 'pitch', 0.012), M('env2', 'posA', 0.15)], mono: true, legato: true, glide: 0.06, env1: { a: 0.01, d: 0.4, s: 0.8, r: 0.3 }, gain: 0.436 }) },
  bell: { label: 'Campana metálica', for: ['melody', 'arp', 'chords'], p: mkPro({ a: osc({ table: 'metal', pos: 0.4 }), b: osc({ pos: 0, oct: 1, semi: 7 }), fType: 'lp12', cut: 9000, res: 0.05, env2: { a: 0.001, d: 0.6, s: 0, r: 0.6 }, mods: [M('env2', 'fm', 0.35), M('env2', 'posA', 0.3)], env1: { a: 0.001, d: 1.3, s: 0, r: 0.9 }, gain: 1.154 }) },
  pad: { label: 'Pad que respira', for: ['chords'], p: mkPro({ a: osc({ table: 'harm', pos: 0.45, uni: 5, det: 20, width: 1 }), b: osc({ pos: 0.25, oct: 1, uni: 2, det: 8, level: 0.3 }), cut: 2400, res: 0.12, lfo1: { shape: 'sine', rate: 32, trig: false }, lfo2: { shape: 'tri', rate: 64, trig: false }, mods: [M('lfo1', 'cut', 0.18), M('lfo2', 'posA', 0.3)], env1: { a: 1.1, d: 1, s: 0.85, r: 1.6 }, gain: 1.346 }) },
  choir: { label: 'Coro vocal', for: ['chords', 'melody'], p: mkPro({ a: osc({ table: 'vocal', pos: 0.5, uni: 4, det: 14, width: 0.9 }), cut: 3500, res: 0.1, lfo1: { shape: 'sine', rate: 32, trig: false }, mods: [M('lfo1', 'posA', 0.35)], env1: { a: 0.7, d: 1, s: 0.85, r: 1.3 }, gain: 1.274 }) },
  stab: { label: 'Stab filtrado', for: ['chords'], p: mkPro({ a: osc({ pos: 0.5, uni: 3, det: 12, width: 0.6 }), b: osc({ pos: 0.75, uni: 2, det: 8, level: 0.5 }), fType: 'lp24', cut: 500, res: 0.4, fEnv: 0.5, env2: { a: 0.001, d: 0.14, s: 0, r: 0.1 }, env1: { a: 0.003, d: 0.25, s: 0, r: 0.12 }, gain: 1.06 }) },
};
/* automatización: qué se puede mover a lo largo de los 4 compases y en qué rango */
export type AutoKey = 'lp' | 'vol' | 'rev' | 'dly' | 'drive' | 'pan' | 'hp';
export const AUTO_PARAMS: { k: AutoKey; label: string; lo: number; hi: number; fmt: (v: number) => string }[] = [
  { k: 'lp', label: 'Filtro', lo: 0.3, hi: 1, fmt: (v) => { const f = 200 * Math.pow(100, v); return v >= 0.995 ? 'abierto' : f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + ' Hz'; } },
  { k: 'vol', label: 'Volumen', lo: 0.15, hi: 1, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'rev', label: 'Reverb', lo: 0, hi: 0.8, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'dly', label: 'Delay', lo: 0, hi: 0.8, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'drive', label: 'Saturación', lo: 0, hi: 0.8, fmt: (v) => Math.round(v * 100) + '%' },
  { k: 'pan', label: 'Pan', lo: 0.1, hi: 0.9, fmt: (v) => (Math.abs(v - 0.5) < 0.03 ? 'centro' : v < 0.5 ? 'izq ' + Math.round((0.5 - v) * 200) : 'der ' + Math.round((v - 0.5) * 200)) },
  { k: 'hp', label: 'Corta graves', lo: 0, hi: 0.65, fmt: (v) => (v < 0.01 ? 'no' : Math.round(20 * Math.pow(100, v)) + ' Hz') },
];
export const AUTO_SHAPES = [
  { k: 'up', label: 'Sube' }, { k: 'down', label: 'Baja' }, { k: 'tri', label: 'Sube y baja' },
  { k: 'wave', label: 'Onda por compás' }, { k: 'pump', label: 'Bombeo' }, { k: 'last', label: 'Último tiempo' },
] as const;
export function autoShape(shape: string, lo: number, hi: number): number[] {
  return Array.from({ length: 64 }, (_, i) => {
    const x = i / 63; let u = 0;
    if (shape === 'up') u = Math.pow(x, 1.6);
    else if (shape === 'down') u = Math.pow(1 - x, 1.6);
    else if (shape === 'tri') u = 1 - Math.abs(x * 2 - 1);
    else if (shape === 'wave') u = 0.5 - 0.5 * Math.cos((Math.PI * 2 * i) / 16);
    else if (shape === 'pump') u = (i % 4) / 3;
    else if (shape === 'last') u = i >= 60 ? 1 : 0;
    return +(lo + (hi - lo) * u).toFixed(3);
  });
}
export type TrackType = 'drum' | 'bass' | 'arp' | 'chords' | 'melody' | 'vocal';
export type Note = { s: number; n: number; l: number };
export type Track = {
  id: string; name: string; color: string; type: TrackType;
  steps: number[]; // 16 pasos: 0 apagado, 1 golpe, 2 acento
  sound: string; // sample (batería) o preset (sintes)
  pitch: number; decay: number;
  vol: number; pan: number; mute: boolean; solo: boolean; rev: number; dly: number; duck: number;
  synth?: Synth;
  arp?: { mode: string; rate: '16' | '8' | 'tr'; oct: number; gate: boolean[] };
  chordMode?: 'pad' | 'stab' | 'gate';
  chordLen?: number; // largo de cada golpe de acorde en pasos (stab y gate)
  bassLine?: number[]; // bajo: semitonos sobre la fundamental en cada paso (0, 12 = octava, 7 = quinta…)
  bassLen?: number; // bajo: largo de cada nota en pasos
  eq?: EqBand[]; // EQ de la pista: 4 bandas [grave (estante), medio 1, medio 2, agudo (estante)]
  fx?: { drive?: number; hp?: number; lp?: number; chorus?: number; crush?: number; phaser?: number }; // inserto: saturación, bitcrusher, pasa altos, pasa bajos, phaser, chorus
  groove?: number[]; // atraso de cada uno de los 16 pasos, en fracción de semicorchea
  rollEdited?: boolean; // ya se tocaron a mano las notas del piano roll
  group?: string; // id del grupo al que pertenece
  roll?: boolean; // bajo, arpegio o acordes editados a mano en el piano roll: suenan las notas de `notes` en vez de lo generado
  auto?: Partial<Record<AutoKey, number[]>>; // automatización: 64 valores 0..1 (uno por paso de los 4 compases)
  vox?: { from: number; rev: boolean; has: boolean; pos?: number }; // voz grabada: recorte del inicio (0..1), al revés, si ya hay audio y en qué paso de los 64 arranca
  notes?: Note[]; // melodía: s = paso 0-63, n = nota MIDI, l = largo en pasos
  autoMelody?: boolean; // true mientras la melodía sea la generada por el nombre (se regenera si cambia la armonía)
};
/* ---------- escenas: lo que cambia entre A, B, C y D (patrones, notas, encendido y automatización; la mezcla es la misma) ---------- */
export const SCENES = ['A', 'B', 'C', 'D'];
const SK = ['steps', 'mute', 'arp', 'notes', 'roll', 'rollEdited', 'bassLine', 'bassLen', 'chordMode', 'chordLen', 'auto', 'autoMelody'] as const;
export type SceneSnap = { t: Record<string, Partial<Track>>; macros?: Project['macros']; macroAuto?: Project['macroAuto']; fill?: boolean };
const cl = <T,>(o: T): T => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
export function snapScene(p: Project): SceneSnap {
  const t: Record<string, Partial<Track>> = {};
  p.tracks.forEach((x) => { const o: any = {}; SK.forEach((k) => { if (x[k] !== undefined) o[k] = cl(x[k]); }); t[x.id] = o; });
  return { t, macros: cl(p.macros), macroAuto: cl(p.macroAuto), fill: p.fill };
}
function loadScene(p: Project, s: SceneSnap) {
  p.tracks.forEach((x) => { const o = s.t[x.id]; if (!o) return; SK.forEach((k) => { (x as any)[k] = cl((o as any)[k]); }); });
  p.macros = cl(s.macros); p.macroAuto = cl(s.macroAuto); p.fill = s.fill;
}
/* pasa a otra escena: guarda la actual y carga la otra (si está vacía, arranca como copia de la actual) */
export function switchScene(p: Project, to: string) {
  const cur = p.scene ?? 'A'; if (cur === to) return;
  p.scenes = { ...p.scenes, [cur]: snapScene(p) };
  const s = p.scenes[to]; if (s) loadScene(p, s); p.scene = to;
}
export const sceneUsed = (p: Project, k: string) => k === (p.scene ?? 'A') || !!p.scenes?.[k];
export function nextScene(p: Project) { const cur = SCENES.indexOf(p.scene ?? 'A'); for (let i = 1; i <= 4; i++) { const k = SCENES[(cur + i) % 4]; if (sceneUsed(p, k)) return k; } return p.scene ?? 'A'; }
export function clearScene(p: Project, k: string) { if (k === (p.scene ?? 'A')) return; const sc = { ...p.scenes }; delete sc[k]; p.scenes = sc; }

/* ---------- variación: otro patrón para la pista, de las variantes del género o cambiando unos golpes ---------- */
export function varyTrack(p: Project, t: Track): string {
  const G = GENRES[p.genre], n = ((t as any).vari ?? 0) + 1; (t as any).vari = n;
  const r = seeded(clean(p.name || 'Loop') + '#var:' + t.id + ':' + n), same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  const cycle = <T,>(list: T[], cur: (x: T) => boolean) => { if (list.length < 2) return null; const i = list.findIndex(cur); return list[(i + 1 + Math.floor(r() * (list.length - 1))) % list.length]; };
  if (t.type === 'drum') {
    const opts = G && ['kick', 'clap', 'hat', 'open', 'perc'].includes(t.id) ? [...new Map(G.drums.map((d) => [d[t.id as 'kick'], parseDrum(d[t.id as 'kick'])])).values()].filter((x) => x.some(Boolean)) : [];
    const pick = cycle(opts, (x) => same(x, t.steps));
    if (pick && !same(pick, t.steps)) { t.steps = [...pick]; return 'otro patrón del género'; }
    const st = [...t.steps], kick = t.sound === 'kick';
    for (let k = 0; k < 3; k++) { const i = Math.floor(r() * 16); if (kick && i % 4 === 0) continue; st[i] = st[i] ? (i % 4 === 0 ? st[i] : 0) : r() < 0.5 ? 3 : 1; }
    t.steps = st; return 'cambié algunos golpes';
  }
  if (t.type === 'bass') {
    const pick = G ? cycle(G.bass, (b) => same(parseBass(b.line).steps, t.steps) && same(parseBass(b.line).line, t.bassLine)) : null;
    if (pick) { const pb = parseBass(pick.line); t.steps = pb.steps; t.bassLine = pb.line; t.bassLen = pick.l; return 'otra línea de bajo del género'; }
    const ln = [...(t.bassLine ?? Array(16).fill(0))]; for (let k = 0; k < 3; k++) { const i = 1 + Math.floor(r() * 15); if (t.steps[i]) ln[i] = pick0(r, [0, 12, 7, 10, 0]); }
    t.bassLine = ln; return 'cambié algunas notas';
  }
  if (t.type === 'arp' && t.arp) {
    const pick = G ? cycle(G.arp, (a) => a.mode === t.arp!.mode && a.rate === t.arp!.rate && a.oct === t.arp!.oct) : null;
    if (pick) { t.arp = { mode: pick.mode, rate: pick.rate, oct: pick.oct, gate: pick.mode === 'acid' ? acidPattern(p).gate : pick.gate ? parseGate(pick.gate) : Array(16).fill(true) }; return 'otro arpegio del género'; }
    const modes = ['name', 'up', 'down', 'pp', 'chord', 'chordpp'].filter((m) => m !== t.arp!.mode); t.arp = { ...t.arp, mode: pick0(r, modes) }; return 'otro orden de notas';
  }
  if (t.type === 'chords') {
    const pick = G ? cycle(G.chords, (c) => c.mode === (t.chordMode ?? 'pad') && (!c.steps || same(parseDrum(c.steps).map((v) => (v ? 1 : 0)), t.steps))) : null;
    if (pick) { t.chordMode = pick.mode; t.steps = pick.steps ? parseDrum(pick.steps).map((v) => (v ? 1 : 0)) : R([0]); t.chordLen = pick.len; return 'otro ritmo de acordes del género'; }
    t.chordMode = t.chordMode === 'pad' ? 'stab' : 'pad'; if (!t.steps.some(Boolean)) t.steps = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]; return 'otro modo de acordes';
  }
  if (t.type === 'melody') { t.notes = generateMelody(p, 'v' + n); t.autoMelody = true; return 'melodía nueva'; }
  return '';
}
const pick0 = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const FILL_SOUNDS = ['snare', 'snare808', 'snareSoft', 'clap', 'rim', 'rim2'];

export type MacroKey = 'energy' | 'dark' | 'space' | 'groove';
export type EqBand = { f: number; g: number; q: number }; // frecuencia (Hz), ganancia (dB) y ancho (Q, solo en las campanas)
export const EQ_DEF: EqBand[] = [{ f: 90, g: 0, q: 0.7 }, { f: 450, g: 0, q: 1 }, { f: 2500, g: 0, q: 1 }, { f: 9000, g: 0, q: 0.7 }];
export type Group = { id: string; name: string; mute?: boolean; solo?: boolean };
export type Project = {
  name: string; genre: string; bpm: number; swing: number; kit: string;
  groups?: Group[]; // grupos de instrumentos: se mutean o se ponen en solo todos juntos
  seq: number[]; chords: { name: string; tones: string[]; midi: number[] }[];
  tracks: Track[];
  fx: { revSize: number; revDamp: number; revRet: number; dlyFb: number; dlyRet: number; duck: number };
  master: { eq: number[]; target: number; auto: boolean; ceiling: number };
  seed?: number;
  id?: string; title?: string; // lugar donde se guarda y nombre que se muestra en Mis loops (el nombre musical es `name`)
  edited?: boolean;
  scene?: string; scenes?: Record<string, SceneSnap>; // escenas A..D: variaciones del patrón que cambian al terminar la vuelta
  chain?: boolean; // encadenar escenas: al terminar cada vuelta pasa a la siguiente que tenga algo
  fill?: boolean;
  arrangement?: string[];
  manual?: Manual; // armado desde cero: tonalidad y acordes elegidos a mano (en vez de salir del nombre) // orden de escenas para exportar el tema (una vuelta de 4 compases por letra) // redoble de batería en los últimos 2 tiempos del compás 4 // se tocó algo después de generarlo: generar otro nombre no lo pisa, va a un lugar nuevo
  macros?: { energy: number; dark: number; space: number; groove: number }; // 0..1, 0.5 = como lo dejó el género
  macroAuto?: Partial<Record<MacroKey, number[]>>; // automatización de las macros: 64 valores 0..1, mandan sobre el fader
  harmony?: 'tonal' | 'puro'; // tonal: se busca la tonalidad del nombre; puro: solo las notas exactas de las letras
  key?: string; progression?: string; scale?: number[]; tonic?: number; letterNotes?: { ch: string; note: string; moved: boolean }[];
};

/* ---------- teoría: cada letra es una tonalidad (24 = 12 mayores + 12 menores) ----------
   A..L = mayores en orden cromático: A=DO, B=DO#, C=RE, D=RE#, E=MI, F=FA, G=FA#, H=SOL, I=SOL#, J=LA, K=LA#, L=SI.
   M..X = menores: M=DOm, N=DO#m, O=REm, P=RE#m, Q=MIm, R=FAm, S=FA#m, T=SOLm, U=SOL#m, V=LAm, W=LA#m, X=SIm.
   Y=DO y Z=DO# (vuelve a empezar). */
export const NOTE_ES = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];
const NOTE_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
export const letterIdx = (ch: string) => (ch.charCodeAt(0) - 65) % 24;
export const letterPc = (ch: string) => letterIdx(ch) % 12;
export const letterMinor = (ch: string) => letterIdx(ch) >= 12;
export const letterNote = (ch: string) => NOTE_ES[letterPc(ch)] + (letterMinor(ch) ? 'm' : '');
export const noteName = (m: number) => NOTE_ES[((m % 12) + 12) % 12];
/* tipos de acorde: intervalos desde la fundamental, sufijo y "puntaje" (qué tan completo y musical es) */
const CHORDS: [number[], string, number][] = [
  [[0, 4, 7, 11], 'maj7', 10], [[0, 3, 7, 10], 'm7', 10], [[0, 4, 7, 10], '7', 8], [[0, 3, 7], 'm', 9], [[0, 4, 7], '', 9],
  [[0, 2, 7], 'sus2', 7], [[0, 5, 7], 'sus4', 7], [[0, 4, 7, 9], '6', 7], [[0, 3, 7, 9], 'm6', 6], [[0, 3, 6, 10], 'm7b5', 5], [[0, 3, 6], 'dim', 4], [[0, 4, 8], 'aug', 3],
  [[0, 7], '5', 2], [[0, 3], '(m3)', 1], [[0, 4], '(3)', 1], [[0, 5], '(4)', 1], [[0, 2], '(2)', 0.5],
];
type Ch = { root: number; ivs: number[]; name: string; score: number };
function buildChords(order: number[]) {
  const set = new Set(order), roots = [...new Set(order)];
  const best: Ch[] = [];
  roots.forEach((r) => { for (const [ivs, suf, sc] of CHORDS) if (ivs.every((i) => set.has((r + i) % 12))) { best.push({ root: r, ivs, name: NOTE_EN[r] + suf, score: sc }); break; } });
  if (!best.length) best.push({ root: roots[0], ivs: [0, 12], name: NOTE_EN[roots[0]] + ' (8va)', score: 0 });
  const good = best.filter((c) => c.score >= 6);
  const tonic = good.length ? good[0] : [...best].sort((a, b) => b.score - a.score)[0]; // el primer acorde "lindo" según el orden de las letras
  const PRI = [5, 7, 9, 3, 8, 10, 2, 4, 1, 6, 11];
  const rank = (c: Ch) => PRI.indexOf((c.root - tonic.root + 12) % 12) - c.score * 0.6;
  let rest = best.filter((c) => c !== tonic && c.score >= 6).sort((a, b) => rank(a) - rank(b));
  if (rest.length < 3) rest = rest.concat(best.filter((c) => c !== tonic && c.score < 6).sort((a, b) => rank(a) - rank(b)));
  rest = rest.slice(0, 3);
  if (rest.length === 3) return [tonic, ...rest];
  if (rest.length === 2) return [tonic, rest[0], rest[1], tonic];
  if (rest.length === 1) return [tonic, rest[0], tonic, rest[0]];
  return [tonic, tonic, tonic, tonic];
}
function voice(c: Ch) { let root = 48 + c.root; if (root > 56) root -= 12; const out = c.ivs.map((i) => root + i); if (out.length < 3) out.push(root + 12); return out; }
/* Puro: cada letra es un acorde (mayor o menor). La progresión son los primeros 4 acordes distintos del nombre. */
function pureHarmony(c: string) {
  const ls = [...c], seen: string[] = [], prog: Ch[] = [];
  for (const ch of ls) { const k = letterNote(ch); if (seen.includes(k)) continue; seen.push(k); const root = letterPc(ch), mi = letterMinor(ch); prog.push({ root, ivs: [0, mi ? 3 : 4, 7], name: NOTE_EN[root] + (mi ? 'm' : ''), score: 9 }); if (prog.length === 4) break; }
  while (prog.length < 4) prog.push(prog[prog.length % Math.max(1, seen.length)] ?? prog[0]);
  return { letters: c, seq: ls.map((ch) => 60 + letterPc(ch)), chords: prog.map((ch) => ({ name: ch.name, tones: ch.ivs.map((i) => NOTE_ES[(ch.root + i) % 12]), midi: voice(ch) })),
    scale: [...new Set(ls.map(letterPc))], tonic: letterPc(ls[0]),
    key: 'sin tonalidad (cada letra es un acorde)', progression: prog.map((x) => x.name).join(' – '), letterNotes: ls.map((ch) => ({ ch, note: letterNote(ch), moved: false })) };
}

/* ---------- modo armónico: tonalidad del nombre + círculo de quintas ---------- */
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // posición de cada nota en el círculo de quintas
const fifthDist = (a: number, b: number) => { const d = Math.abs(FIFTHS.indexOf(a) - FIFTHS.indexOf(b)); return Math.min(d, 12 - d); };
const ROMAN_MAJ = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'], ROMAN_MIN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];
const TEMPLATES: Record<'maj' | 'min', number[][]> = {
  maj: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [0, 3, 5, 4], [1, 4, 0, 5], [0, 3, 0, 4], [3, 4, 2, 5], [0, 2, 3, 4]],
  min: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6], [0, 5, 3, 6], [0, 2, 6, 5], [5, 6, 0, 0], [0, 3, 6, 2], [3, 6, 0, 5]],
};
export type HarmOpts = { mode?: 'maj' | 'min'; ext?: number; tpl?: { maj?: number[][]; min?: number[][] } };
function tonalHarmony(c: string, salt = '', o: HarmOpts = {}) {
  const pcs = [...c].map(letterPc), mins = [...c].map(letterMinor), w = new Array(12).fill(0);
  pcs.forEach((pc, i) => { const b = 1 + (i === 0 ? 1.5 : 0) + (i === pcs.length - 1 ? 0.4 : 0); w[pc] += b; w[(pc + (mins[i] ? 3 : 4)) % 12] += b * 0.45; w[(pc + 7) % 12] += b * 0.3; });
  const minorBias = (mins.filter(Boolean).length - mins.filter((x) => !x).length) * 0.35 + (mins[0] ? 0.8 : -0.8);
  // 1) elegir la tonalidad: la escala que más notas del nombre contiene (penaliza las de afuera)
  let best = { t: 0, mode: 'min' as 'maj' | 'min', sc: -1e9 };
  for (let t = 0; t < 12; t++) for (const mode of ['maj', 'min'] as const) {
    const sc = (mode === 'maj' ? MAJ : MIN).map((i) => (t + i) % 12);
    let v = 0; for (let pc = 0; pc < 12; pc++) v += sc.includes(pc) ? w[pc] : -1.3 * w[pc];
    v += w[t] * 0.9 + (t === pcs[0] ? 1.2 : 0) - fifthDist(t, pcs[0]) * 0.15 + (mode === 'min' ? minorBias : -minorBias);
    if (v > best.sc) best = { t, mode, sc: v };
  }
  // el género pide modo menor (o mayor): se pasa a la relativa, que tiene exactamente las mismas notas
  if (o.mode && o.mode !== best.mode) best = o.mode === 'min' ? { t: (best.t + 9) % 12, mode: 'min', sc: best.sc } : { t: (best.t + 3) % 12, mode: 'maj', sc: best.sc };
  const steps = best.mode === 'maj' ? MAJ : MIN, scale = steps.map((i) => (best.t + i) % 12);
  // 2) acomodar las notas de afuera al vecino más cercano de la escala (prefiere el que también está en el nombre)
  const inName = new Set(pcs);
  const snap = (pc: number) => {
    if (scale.includes(pc)) return pc;
    const up = (pc + 1) % 12, dn = (pc + 11) % 12, cand = [up, dn].filter((x) => scale.includes(x));
    return cand.sort((a, b) => (inName.has(b) ? 1 : 0) - (inName.has(a) ? 1 : 0) || fifthDist(a, best.t) - fifthDist(b, best.t))[0];
  };
  const snapped = pcs.map(snap), present = new Set(snapped);
  // 3) progresión: plantilla clásica de la tonalidad que más usa las notas del nombre
  const r = seeded(c + '#prog' + salt);
  const tScore = (tp: number[]) => tp.reduce((a, d) => a + (present.has(scale[d]) ? 1 : 0) + (present.has(scale[(d + 2) % 7]) ? 0.3 : 0), 0) + r() * 0.9;
  const ranked = [...(o.tpl?.[best.mode] ?? TEMPLATES[best.mode])].map((tp) => [tScore(tp), tp] as [number, number[]]).sort((a, b) => b[0] - a[0]);
  const tpl = ranked[(Number(salt) || 0) % Math.min(3, ranked.length)][1]; // "Otra versión" recorre las 3 progresiones que mejor le quedan al nombre
  const chordAt = (d: number) => {
    const root = scale[d], third = scale[(d + 2) % 7], fifth = scale[(d + 4) % 7], sev = scale[(d + 6) % 7];
    const iv = (x: number) => (x - root + 12) % 12, ivs = [0, iv(third), iv(fifth)];
    const q3 = ivs[1] === 4 ? 'maj' : 'min', dim = ivs[2] === 6;
    let name = NOTE_EN[root] + (dim ? 'dim' : q3 === 'min' ? 'm' : '');
    const ext = o.ext ?? 0;
    if ((present.has(sev) && ext >= 0) || ext >= 7) { ivs.push(iv(sev)); const s7 = iv(sev); name = NOTE_EN[root] + (dim ? 'm7b5' : q3 === 'maj' ? (s7 === 11 ? 'maj7' : '7') : 'm7'); }
    const ninth = scale[(d + 1) % 7];
    if (ext >= 9 && !dim && iv(ninth) === 2) { ivs.push(14); name = name.replace(/maj7$/, 'maj9').replace(/m7$/, 'm9').replace(/7$/, '9'); }
    return { name, tones: ivs.map((i) => NOTE_ES[(root + i) % 12]), midi: voice({ root, ivs, name, score: 0 }) };
  };
  const roman = best.mode === 'maj' ? ROMAN_MAJ : ROMAN_MIN;
  return {
    letters: c, seq: snapped.map((pc) => 60 + pc), chords: tpl.map(chordAt),
    scale, tonic: best.t,
    key: NOTE_ES[best.t] + (best.mode === 'maj' ? ' mayor' : ' menor'), progression: tpl.map((d) => roman[d]).join(' – '),
    letterNotes: [...c].map((ch, i) => ({ ch, note: NOTE_ES[snapped[i]] + (mins[i] ? 'm' : ''), moved: snapped[i] !== pcs[i] })),
  };
}
export function harmonyFromName(raw: string, mode: 'tonal' | 'puro' = 'tonal', salt = '', o: HarmOpts = {}) {
  const c = clean(raw) || 'LOOP';
  return mode === 'puro' ? pureHarmony(c) : tonalHarmony(c, salt, o);
}
/* ---------- desde cero: tonalidad y acordes elegidos a mano ---------- */
export type Manual = { tonic: number; mode: 'maj' | 'min'; degrees: number[]; ext: number }; // ext: 0 tríadas, 7 séptimas, 9 novenas
export const ROMAN = { maj: ROMAN_MAJ, min: ROMAN_MIN };
export const PROGS: Record<'maj' | 'min', [string, number[]][]> = {
  min: [['i – VI – III – VII', [0, 5, 2, 6]], ['i – VII – VI – v', [0, 6, 5, 4]], ['i – iv – VII – III', [0, 3, 6, 2]], ['i – VI – VII – i', [0, 5, 6, 0]], ['i – i – VI – VI', [0, 0, 5, 5]], ['i – iv – v – i', [0, 3, 4, 0]], ['Un solo acorde (i)', [0, 0, 0, 0]]],
  maj: [['I – V – vi – IV', [0, 4, 5, 3]], ['I – vi – IV – V', [0, 5, 3, 4]], ['vi – IV – I – V', [5, 3, 0, 4]], ['I – IV – I – V', [0, 3, 0, 4]], ['IV – V – iii – vi', [3, 4, 2, 5]], ['ii – V – I – I', [1, 4, 0, 0]], ['Un solo acorde (I)', [0, 0, 0, 0]]],
};
export function manualHarmony(m: Manual) {
  const scale = (m.mode === 'maj' ? MAJ : MIN).map((i) => (m.tonic + i) % 12), roman = m.mode === 'maj' ? ROMAN_MAJ : ROMAN_MIN;
  const chords = m.degrees.map((d) => {
    const root = scale[d], iv = (x: number) => (x - root + 12) % 12, ivs = [0, iv(scale[(d + 2) % 7]), iv(scale[(d + 4) % 7])];
    const minor = ivs[1] === 3, dim = ivs[2] === 6; let name = NOTE_EN[root] + (dim ? 'dim' : minor ? 'm' : '');
    if (m.ext >= 7) { const s7 = iv(scale[(d + 6) % 7]); ivs.push(s7); name = NOTE_EN[root] + (dim ? 'm7b5' : minor ? 'm7' : s7 === 11 ? 'maj7' : '7'); }
    if (m.ext >= 9 && !dim && iv(scale[(d + 1) % 7]) === 2) { ivs.push(14); name = name.replace(/maj7$/, 'maj9').replace(/m7$/, 'm9').replace(/7$/, '9'); }
    return { name, tones: ivs.map((i) => NOTE_ES[(root + i) % 12]), midi: voice({ root, ivs, name, score: 0 }) };
  });
  // notas de referencia (arpegio "Nombre" y melodías nuevas): fundamental y tercera de cada acorde
  const seq = m.degrees.flatMap((d) => [60 + scale[d], 60 + scale[(d + 2) % 7]]);
  return { letters: '', seq, chords, scale, tonic: m.tonic, key: NOTE_ES[m.tonic] + (m.mode === 'maj' ? ' mayor' : ' menor'), progression: m.degrees.map((d) => roman[d]).join(' – '), letterNotes: [] as { ch: string; note: string; moved: boolean }[] };
}
/* pasa un loop hecho con un nombre a armonía manual (misma tonalidad y mismos acordes, hasta donde entran en la escala) */
export function manualFrom(p: Project): Manual {
  if (p.manual) return p.manual;
  const mode: 'maj' | 'min' = /mayor/.test(p.key ?? '') ? 'maj' : 'min', tonic = p.tonic ?? 9, scale = (mode === 'maj' ? MAJ : MIN).map((i) => (tonic + i) % 12);
  const degrees = p.chords.slice(0, 4).map((c) => Math.max(0, scale.indexOf(((c.midi[0] % 12) + 12) % 12)));
  while (degrees.length < 4) degrees.push(0);
  return { tonic, mode, degrees, ext: p.chords.some((c) => /7|9/.test(c.name)) ? 7 : 0 };
}
/* loop vacío: sonidos, kit y mezcla del género, la armonía elegida y la grilla limpia (con o sin la batería del género) */
export function blankProject(m: Manual, genre: string, bpm: number, drums: boolean): Project {
  const p = newProject('', GENRES[genre] ? genre : 'deep');
  const mel = newTrack(p, 'melody'); mel.id = 'melody'; mel.color = '#f0d99a'; p.tracks.splice(p.tracks.findIndex((t) => t.id === 'arp') + 1, 0, mel);
  applyGenre(p, p.genre);
  p.manual = { ...m, degrees: [...m.degrees] }; applyHarmony(p);
  p.bpm = Math.max(60, Math.min(200, Math.round(bpm))); p.title = 'Desde cero';
  p.tracks.forEach((t) => {
    t.mute = false; t.groove = t.type === 'drum' && drums ? t.groove : undefined;
    if (t.type === 'drum') { if (!drums) t.steps = Array(16).fill(0); else if (!t.steps.some(Boolean)) t.mute = true; }
    if (t.type === 'bass') { t.steps = Array(16).fill(0); t.bassLine = Array(16).fill(0); }
    if (t.type === 'arp' && t.arp) t.arp = { ...t.arp, mode: 'chord', gate: Array(16).fill(false) };
    if (t.type === 'chords') { t.chordMode = 'stab'; t.steps = Array(16).fill(0); t.chordLen = 1; }
    if (t.type === 'melody') { t.notes = []; t.autoMelody = false; }
  });
  return p;
}

export function applyHarmony(p: Project, salt = '') {
  const h = p.manual ? manualHarmony(p.manual) : harmonyFromName(p.name, p.harmony ?? 'tonal', salt, GENRES[p.genre]?.harm);
  p.seq = h.seq; p.chords = h.chords; p.key = h.key; p.progression = h.progression; p.letterNotes = h.letterNotes; p.scale = h.scale; p.tonic = h.tonic;
  p.tracks.forEach((t) => { if (t.type === 'melody' && t.autoMelody) t.notes = generateMelody(p, salt); });
}

/* ---------- melodía de 4 compases generada por el nombre ----------
   Frase de pregunta y respuesta: compás 1 = motivo (el dibujo de las letras), compás 2 = respuesta con otro ritmo,
   compás 3 = el motivo más agudo, compás 4 = cierre que baja hasta la tónica. Los tiempos fuertes caen en notas del acorde. */
export function generateMelody(p: Project, salt = ''): Note[] {
  const r = seeded(clean(p.name || 'Loop') + '#mel' + salt);
  const scale = (p.scale && p.scale.length ? p.scale : [...new Set(p.seq.map((m) => ((m % 12) + 12) % 12))]);
  const tonic = p.tonic ?? ((p.seq[0] ?? 60) % 12);
  const st = MEL_STYLES[GENRES[p.genre]?.mel.style ?? 'qa'] ?? MEL_STYLES.qa, LO = st.lo, HI = st.hi, hook = st.form === 'hook';
  const pool: number[] = []; for (let m = LO; m <= HI; m++) if (scale.includes(m % 12)) pool.push(m);
  const nearestIdx = (m: number) => { let bi = 0; pool.forEach((x, i) => { if (Math.abs(x - m) < Math.abs(pool[bi] - m)) bi = i; }); return bi; };
  const nearPc = (pc: number, ref: number) => { let best = pool[0], d = 1e9; pool.forEach((x) => { if (x % 12 === pc && Math.abs(x - ref) < d) { d = Math.abs(x - ref); best = x; } }); return best; };
  let motif = p.seq.slice(0, 6).map((m) => ((m % 12) + 12) % 12);
  if (new Set(motif).size < 3) { const sc = [...scale].sort((a, b) => ((a - tonic + 12) % 12) - ((b - tonic + 12) % 12)); motif = [...clean(p.name || 'Loop')].slice(0, 6).map((ch, i) => sc[(ch.charCodeAt(0) + i * 2) % sc.length]); }
  const RH = st.rh, rA = pick(r, RH); let rB = pick(r, RH); if (rB === rA) rB = RH[(RH.indexOf(rA) + 1) % RH.length];
  const bars = hook ? [rA, rA, rA, pick(r, st.cad)] : [rA, rB, rA, pick(r, st.cad)];
  const notes: Note[] = []; let prev = Math.round((LO + HI) / 2) + (r() < 0.5 ? 0 : 3);
  bars.forEach((rh, b) => {
    const chordPcs = p.chords[b].midi.map((m) => m % 12), offset = hook ? 0 : b === 1 ? 2 : b === 3 ? 1 : 0;
    rh.forEach(([st, len], k) => {
      let m: number;
      if (b === 3 && k === rh.length - 1) m = nearPc(tonic, prev); // cierre en la tónica
      else {
        m = nearPc(motif[(k + offset) % motif.length] ?? tonic, prev);
        if (b === 2 && !hook) m = pool[Math.min(pool.length - 1, nearestIdx(m) + 2)]; // el motivo, una tercera más arriba
        if (b === 3 && !hook) { const i = nearestIdx(prev); m = pool[Math.max(0, i - 1 - (k % 2))]; } // baja por grados
        if ((st === 0 || st === 8) && !chordPcs.includes(m % 12)) { const up = pool[Math.min(pool.length - 1, nearestIdx(m) + 1)], dn = pool[Math.max(0, nearestIdx(m) - 1)]; m = chordPcs.includes(up % 12) ? up : chordPcs.includes(dn % 12) ? dn : m; }
      }
      if (Math.abs(m - prev) > 7) { const alt = m + (m > prev ? -12 : 12); if (alt >= LO && alt <= HI) m = alt; }
      m = Math.max(LO, Math.min(HI, m));
      notes.push({ s: b * 16 + st, n: m, l: len }); prev = m;
    });
  });
  return notes;
}

/* ---------- presets de sonido ---------- */
const S = (o: Partial<Synth>): Synth => ({ wave: 'saw', unison: 1, detune: 0, cutoff: 2000, reso: 0.2, envAmt: 0, fdecay: 0.3, attack: 0.003, decay: 0.3, sustain: 0, release: 0.2, gain: 0.35, ...o });
export const SYNTHS: Record<string, { label: string; for: TrackType[]; p: Synth }> = {
  pluck: { label: 'Pluck', for: ['arp', 'melody'], p: S({ unison: 2, detune: 8, cutoff: 700, reso: 0.35, envAmt: 1.4, fdecay: 0.22, decay: 0.3, release: 0.2, gain: 0.32 }) },
  super: { label: 'Supersaw', for: ['arp', 'chords', 'melody'], p: S({ unison: 7, detune: 22, cutoff: 3800, reso: 0.12, envAmt: 0.5, fdecay: 0.35, attack: 0.008, decay: 0.5, sustain: 0.25, release: 0.35, gain: 0.26 }) },
  acid: { label: 'Acid', for: ['arp', 'bass'], p: S({ cutoff: 280, reso: 0.86, envAmt: 2.6, fdecay: 0.16, decay: 0.25, release: 0.08, gain: 0.32, octave: -1 }) },
  keys: { label: 'Keys', for: ['arp', 'chords', 'melody'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 1.7, fmDecay: 0.35, cutoff: 6000, reso: 0.05, decay: 1.4, sustain: 0.15, release: 0.5, gain: 0.42 }) },
  organ: { label: 'Órgano', for: ['arp', 'chords', 'melody'], p: S({ wave: 'tri', unison: 2, detune: 4, sub: 0.5, cutoff: 4500, reso: 0.05, attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.1, gain: 0.32 }) },
  marimba: { label: 'Marimba', for: ['arp', 'melody'], p: S({ wave: 'fm', fmRatio: 4, fmIndex: 1.3, fmDecay: 0.04, cutoff: 9000, reso: 0.05, attack: 0.001, decay: 0.35, release: 0.2, gain: 0.55 }) },
  chip: { label: 'Chip', for: ['arp', 'melody'], p: S({ wave: 'square', cutoff: 7000, reso: 0.05, attack: 0.001, decay: 0.2, sustain: 0.5, release: 0.05, gain: 0.2 }) },
  bassSaw: { label: 'Saw', for: ['bass'], p: S({ sub: 0.6, cutoff: 520, reso: 0.3, envAmt: 0.9, fdecay: 0.2, decay: 0.3, sustain: 0.5, release: 0.08, gain: 0.45 }) },
  bassSub: { label: 'Sub', for: ['bass'], p: S({ wave: 'sine', cutoff: 2000, reso: 0.05, attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.08, gain: 0.8 }) },
  reese: { label: 'Reese', for: ['bass'], p: S({ unison: 2, detune: 18, sub: 0.4, cutoff: 650, reso: 0.2, attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.1, gain: 0.38, poles4: true }) },
  lead: { label: 'Lead', for: ['melody', 'arp'], p: S({ unison: 3, detune: 12, cutoff: 3200, reso: 0.2, envAmt: 0.6, fdecay: 0.3, attack: 0.008, decay: 0.4, sustain: 0.7, release: 0.25, gain: 0.24 }) },
  brass: { label: 'Brass', for: ['melody', 'chords'], p: S({ unison: 2, detune: 8, cutoff: 900, reso: 0.15, envAmt: 1.6, fdecay: 0.25, attack: 0.04, decay: 0.4, sustain: 0.6, release: 0.2, gain: 0.26 }) },
  flute: { label: 'Flauta', for: ['melody'], p: S({ wave: 'tri', cutoff: 3500, reso: 0.05, attack: 0.06, decay: 0.3, sustain: 0.8, release: 0.25, gain: 0.45 }) },
  pluckHi: { label: 'Pluck brillante', for: ['arp', 'melody'], p: S({ wave: 'square', unison: 2, detune: 6, cutoff: 1800, reso: 0.25, envAmt: 2, fdecay: 0.12, decay: 0.2, release: 0.15, gain: 0.22 }) },
  fmBass: { label: 'FM', for: ['bass'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 2.4, fmDecay: 0.18, cutoff: 3000, reso: 0.05, decay: 0.35, sustain: 0.4, release: 0.08, gain: 0.6 }) },
  pluckBass: { label: 'Pluck', for: ['bass'], p: S({ sub: 0.5, cutoff: 350, reso: 0.4, envAmt: 2.2, fdecay: 0.1, decay: 0.2, sustain: 0.1, release: 0.06, gain: 0.5 }) },
  airy: { label: 'Aire', for: ['chords'], p: S({ unison: 4, detune: 25, cutoff: 3000, reso: 0.05, attack: 1.2, decay: 1, sustain: 0.8, release: 1.8, gain: 0.11 }) },
  dark: { label: 'Oscuro', for: ['chords'], p: S({ unison: 2, detune: 10, cutoff: 500, reso: 0.25, attack: 0.5, decay: 1, sustain: 0.8, release: 1.2, gain: 0.18, poles4: true }) },
  strings: { label: 'Cuerdas', for: ['chords'], p: S({ unison: 3, detune: 14, cutoff: 1400, reso: 0.1, envAmt: 0.2, fdecay: 1, attack: 0.6, decay: 1, sustain: 0.8, release: 1.2, gain: 0.14 }) },
  warm: { label: 'Cálido', for: ['chords'], p: S({ wave: 'square', unison: 2, detune: 6, cutoff: 900, reso: 0.1, attack: 0.4, decay: 1, sustain: 0.8, release: 1, gain: 0.14 }) },
  glass: { label: 'Vidrio', for: ['chords'], p: S({ wave: 'fm', fmRatio: 3, fmIndex: 0.8, fmDecay: 2, cutoff: 6000, reso: 0.05, attack: 0.3, decay: 1, sustain: 0.7, release: 1.2, gain: 0.2 }) },
  choir: { label: 'Coro', for: ['chords'], p: S({ wave: 'tri', unison: 3, detune: 10, cutoff: 2000, reso: 0.15, attack: 0.7, decay: 1, sustain: 0.8, release: 1.5, gain: 0.2 }) },
  // sonidos de género
  tranceLead: { label: 'Lead trance', for: ['melody', 'arp'], p: S({ unison: 7, detune: 28, cutoff: 6500, reso: 0.12, envAmt: 0.3, fdecay: 0.4, attack: 0.005, decay: 0.4, sustain: 0.75, release: 0.3, gain: 0.2 }) },
  trancePluck: { label: 'Pluck trance', for: ['arp', 'melody'], p: S({ unison: 7, detune: 20, cutoff: 900, reso: 0.25, envAmt: 2.4, fdecay: 0.16, decay: 0.22, release: 0.15, gain: 0.34 }) },
  tranceGate: { label: 'Pad gate', for: ['chords'], p: S({ unison: 7, detune: 24, cutoff: 4200, reso: 0.1, envAmt: 0.3, fdecay: 0.15, attack: 0.003, decay: 0.3, sustain: 0.85, release: 0.04, gain: 0.13 }) },
  tranceBass: { label: 'Rolling', for: ['bass'], p: S({ sub: 0.5, cutoff: 380, reso: 0.3, envAmt: 2, fdecay: 0.09, decay: 0.15, sustain: 0.2, release: 0.04, gain: 0.5 }) },
  acid303: { label: 'Acid 303', for: ['arp', 'bass'], p: S({ cutoff: 230, reso: 0.9, envAmt: 3, fdecay: 0.14, attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.03, gain: 0.4, octave: -1 }) },
  technoSub: { label: 'Sub techno', for: ['bass'], p: S({ wave: 'tri', sub: 0.6, cutoff: 260, reso: 0.15, envAmt: 0.6, fdecay: 0.1, attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.08, gain: 0.6 }) },
  techStab: { label: 'Stab techno', for: ['chords'], p: S({ unison: 3, detune: 12, cutoff: 650, reso: 0.4, envAmt: 2.2, fdecay: 0.12, attack: 0.002, decay: 0.2, sustain: 0, release: 0.1, gain: 0.3 }) },
  housePiano: { label: 'Piano house', for: ['chords', 'melody', 'arp'], p: S({ wave: 'fm', fmRatio: 2, fmIndex: 2.2, fmDecay: 0.25, cutoff: 7000, reso: 0.05, attack: 0.002, decay: 0.9, sustain: 0.1, release: 0.3, gain: 0.36 }) },
  houseBass: { label: 'Bajo house', for: ['bass'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 1.6, fmDecay: 0.12, sub: 0.3, cutoff: 1800, reso: 0.05, decay: 0.3, sustain: 0.35, release: 0.06, gain: 0.55 }) },
  deepRhodes: { label: 'Rhodes', for: ['chords', 'melody'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 1.2, fmDecay: 0.6, cutoff: 3200, reso: 0.05, attack: 0.004, decay: 1.6, sustain: 0.3, release: 0.6, gain: 0.34 }) },
  deepBass: { label: 'Sub redondo', for: ['bass'], p: S({ wave: 'sine', sub: 0.2, cutoff: 900, reso: 0.05, attack: 0.008, decay: 0.6, sustain: 0.8, release: 0.15, gain: 0.5 }) },
  melodicPluck: { label: 'Pluck oscuro', for: ['arp', 'melody'], p: S({ unison: 2, detune: 10, cutoff: 450, reso: 0.4, envAmt: 2.6, fdecay: 0.2, decay: 0.35, release: 0.3, gain: 0.32, poles4: true }) },
  progPluck: { label: 'Pluck progressive', for: ['arp', 'melody'], p: S({ wave: 'square', unison: 2, detune: 9, cutoff: 800, reso: 0.3, envAmt: 1.8, fdecay: 0.2, decay: 0.28, release: 0.22, gain: 0.26 }) },
};
export const STAB = (p: Synth): Synth => ({ ...p, attack: 0.004, decay: 0.3, sustain: 0, release: 0.15, gain: p.gain * 1.6, envAmt: Math.max(p.envAmt, 0.8), fdecay: 0.2 });

/* ---------- batería ---------- */
export const KITS: Record<string, { label: string; map: Record<string, string> }> = {
  tr909: { label: '909', map: { kick: 'kA909', clap: 'clap1', hat: 'hat1', open: 'open', snare: 'snare', rim: 'rim' } },
  tr909h: { label: '909 Duro', map: { kick: 'kBh', clap: 'clap2', hat: 'hatH', open: 'openH', snare: 'snareH', rim: 'rim' } },
  tr808: { label: '808', map: { kick: 'k808', clap: 'clap808', hat: 'hat808', open: 'open808', snare: 'snare808', rim: 'rim' } },
  // kits por género
  trance: { label: 'Kit Trance', map: { kick: 'kTrance', clap: 'clap2', hat: 'hatTight', open: 'openH', snare: 'snareH', rim: 'rim' } },
  techno: { label: 'Kit Techno', map: { kick: 'kTechno', clap: 'clapVerb', hat: 'hatH', open: 'openH', snare: 'snareH', rim: 'rim' } },
  house: { label: 'Kit House', map: { kick: 'kA909', clap: 'clap1', hat: 'hat1', open: 'open', snare: 'snare', rim: 'rim' } },
  deep: { label: 'Kit Deep', map: { kick: 'k808', clap: 'clap808', hat: 'hatDark', open: 'open808', snare: 'snareSoft', rim: 'rim' } },
  melodic: { label: 'Kit Melodic', map: { kick: 'kMelodic', clap: 'snap', hat: 'hatDark', open: 'open808', snare: 'snareSoft', rim: 'rim' } },
  prog: { label: 'Kit Progressive', map: { kick: 'kProg', clap: 'clap1', hat: 'hat1', open: 'open', snare: 'snare', rim: 'rim' } },
  synth80: { label: 'Kit Synthwave 80s', map: { kick: 'k80s', clap: 'clapGated', hat: 'hatTight', open: 'openH', snare: 'snareGated', rim: 'rim' } },
  electro: { label: 'Kit Electro', map: { kick: 'kElectro', clap: 'clap808', hat: 'hat808', open: 'open808', snare: 'snareZap', rim: 'clave' } },
  lofi: { label: 'Kit Lo-Fi', map: { kick: 'lofiKick', clap: 'lofiClap', hat: 'lofiHat', open: 'lofiOpen', snare: 'lofiSnare', rim: 'rim' } },
};
export const DRUM_SOUNDS: Record<string, string> = {
  kick: 'Kick', clap: 'Clap', snare: 'Snare', snare808: 'Snare 808', hat: 'Hat', open: 'Open hat', ride: 'Ride', rim: 'Rim', crash: 'Crash',
  cowbell: 'Cowbell', clave: 'Clave', conga: 'Conga', shaker: 'Shaker', tamb: 'Pandereta', maraca: 'Maraca',
  tomL: 'Tom grave', tomM: 'Tom medio', tomH: 'Tom agudo', rim2: 'Rim fuerte', snareSoft: 'Snare suave',
};
export const DRUM_GROUPS: [string, string[]][] = [['Bombo', ['kick']], ['Golpes', ['clap', 'snare', 'snare808', 'snareSoft', 'rim', 'rim2']], ['Platillos', ['hat', 'open', 'ride', 'crash']], ['Percusión', ['cowbell', 'clave', 'conga', 'shaker', 'tamb', 'maraca']], ['Toms', ['tomL', 'tomM', 'tomH']]];
export const sampleKey = (kit: string, sound: string) => KITS[kit]?.map[sound] ?? sound;

const R = (on: number[], acc: number[] = []) => { const s = Array(16).fill(0); on.forEach((i) => (s[i] = 1)); acc.forEach((i) => (s[i] = 2)); return s; };

const COLORS: Record<string, string> = { kick: '#e5655b', clap: '#e98a5f', hat: '#e9c46a', open: '#d6cf7e', perc: '#a7c973', bass: '#6fbf86', arp: '#e3b04b', chords: '#8fc7a0' };
const mkTrack = (id: string, name: string, type: TrackType, sound: string, extra: Partial<Track> = {}): Track => ({
  id, name, color: COLORS[id], type, steps: Array(16).fill(0), sound, pitch: 0, decay: 1, vol: 0.8, pan: 0, mute: false, solo: false, rev: 0, dly: 0, duck: 0, ...extra,
});

const PALETTE = ['#e5655b', '#e98a5f', '#e9c46a', '#d6cf7e', '#a7c973', '#6fbf86', '#e3b04b', '#8fc7a0', '#c97a6e', '#b8d39a', '#f0d99a', '#5fa877'];
export function newTrack(p: Project, type: TrackType, sound?: string): Track {
  const n = p.tracks.length, id = type + '-' + Date.now().toString(36), color = PALETTE[n % PALETTE.length];
  if (type === 'vocal') { const t = mkTrack(id, 'Voz', 'vocal', 'vox', { color: '#e5655b', vol: 0.8, rev: 0.25, dly: 0.3, duck: 0.2 }); t.steps = Array(16).fill(0); t.steps[0] = 2; t.fx = { hp: 110 }; t.vox = { from: 0, rev: false, has: false, pos: 0 }; return t; }
  if (type === 'drum') return mkTrack(id, DRUM_SOUNDS[sound ?? 'conga'] ?? 'Percu', 'drum', sound ?? 'conga', { color, vol: 0.6, rev: 0.15 });
  if (type === 'bass') return mkTrack(id, 'Bajo 2', 'bass', sound ?? 'fmBass', { color, vol: 0.7, duck: 0.5 });
  if (type === 'chords') return mkTrack(id, 'Acordes 2', 'chords', sound ?? 'airy', { color, vol: 0.55, rev: 0.4, duck: 0.4, chordMode: 'pad', steps: [1, ...Array(15).fill(0)] });
  if (type === 'arp') return mkTrack(id, 'Arpegio 2', 'arp', sound ?? 'pluck', { color, vol: 0.55, rev: 0.35, dly: 0.3, duck: 0.3, arp: { mode: 'up', rate: '8', oct: 2, gate: Array(16).fill(true) } });
  return mkTrack(id, 'Melodía', 'melody', sound ?? 'lead', { color, vol: 0.6, rev: 0.3, dly: 0.25, duck: 0.3, notes: generateMelody(p, id), autoMelody: true });
}
/* pasa lo que hoy genera una pista (bajo, arpegio o acordes) a notas de piano roll, para editarlas a mano */
export function rollFromTrack(p: Project, t: Track): Note[] {
  const c = compile({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, roll: false, mute: false, solo: false } : x)) }).tracks.find((x) => x.id === t.id);
  const out: Note[] = [], seen = new Set<string>();
  c?.ev.forEach((evs: any[], s: number) => evs.forEach((e) => { if (e.n == null) return; const k = s + ':' + e.n; if (seen.has(k)) return; seen.add(k); out.push({ s, n: e.n, l: Math.max(1, Math.min(64 - s, Math.round(e.l + 0.15))) }); }));
  return out;
}
/* palabras con buen resultado (calculadas con la propia armonía de la app) para "Palabra aleatoria" */
export const WORDS: Record<string, string[]> = {
  Linda: ['Calma', 'Amor', 'Alma', 'Juego', 'Flor', 'Hielo', 'Eclipse', 'Dulce', 'Aurora', 'Cielo', 'Luna'],
  Divertida: ['Banana', 'Caramelo', 'Disco', 'Playa', 'Cumbia', 'Locura', 'Circo', 'Globo', 'Fiesta', 'Chispa', 'Feliz', 'Bonito'],
  Oscura: ['Sueño', 'Silencio', 'Lobo', 'Nube', 'Mar', 'Rumba', 'Tumba', 'Miedo', 'Ritual', 'Niebla', 'Tormenta', 'Sombra', 'Noche', 'Bosque', 'Vampiro'],
  'Oscura que suena alegre': ['Fantasma', 'Veneno', 'Cripta', 'Demonio', 'Infierno', 'Cuervo', 'Medianoche'],
};
export const nameScale = (p: Project, octs = 2) => { const b = [...new Set(p.seq.map((m) => ((m % 12) + 12) % 12))].sort((a, c) => a - c), out: number[] = []; for (let o = 0; o < octs; o++) b.forEach((pc) => out.push(60 + pc + 12 * o)); return out.sort((a, c) => a - c); };

export function newProject(name = '', genre = 'prog'): Project {
  const h = harmonyFromName(name, 'tonal');
  const p: Project = {
    name, genre, bpm: 124, swing: 0, kit: 'tr909', seq: h.seq, chords: h.chords, harmony: 'tonal', key: h.key, progression: h.progression, letterNotes: h.letterNotes, scale: h.scale, tonic: h.tonic,
    tracks: [
      mkTrack('kick', 'Kick', 'drum', 'kick', { vol: 0.9 }),
      mkTrack('clap', 'Clap', 'drum', 'clap', { vol: 0.7, rev: 0.25 }),
      mkTrack('hat', 'Hat', 'drum', 'hat', { vol: 0.55, pan: 0.15 }),
      mkTrack('open', 'Open', 'drum', 'open', { vol: 0.5, pan: -0.1, rev: 0.1 }),
      mkTrack('perc', 'Percu', 'drum', 'rim', { vol: 0.5, pan: 0.25, rev: 0.2 }),
      mkTrack('bass', 'Bajo', 'bass', 'bassSaw', { vol: 0.75, duck: 0.5 }),
      mkTrack('arp', 'Sinte', 'arp', 'pluck', { vol: 0.65, rev: 0.4, dly: 0.35, duck: 0.4, arp: { mode: 'name', rate: '16', oct: 2, gate: Array(16).fill(true) } }),
      mkTrack('chords', 'Acordes', 'chords', 'strings', { vol: 0.6, rev: 0.45, duck: 0.45, chordMode: 'pad' }),
    ],
    fx: { revSize: 0.8, revDamp: 0.35, revRet: 0.9, dlyFb: 0.42, dlyRet: 0.7, duck: 0.4 },
    master: { eq: [0, 0, 0, 0, 0, 0, 0, 0], target: -14, auto: true, ceiling: -1 },
    groups: [{ id: 'drums', name: 'Batería' }],
  };
  p.tracks.forEach((t) => { if (t.type === 'drum') t.group = 'drums'; });
  applyGenre(p, genre);
  return p;
}
/* aplica la receta completa del género. La semilla es nombre + género (+ versión): el mismo nombre en trance suena siempre igual */
export function applyGenre(p: Project, g: string, variant = 0) {
  const G = GENRES[g]; if (!G) return; p.genre = g;
  const r = seeded(clean(p.name || 'Loop') + '#g:' + g + '#' + variant);
  const T = (id: string) => p.tracks.find((t) => t.id === id);
  p.bpm = Math.round(G.bpm[0] + r() * (G.bpm[1] - G.bpm[0])); p.swing = +(G.swing[0] + r() * (G.swing[1] - G.swing[0])).toFixed(2);
  p.kit = pick(r, G.kit); p.fx = { ...G.fx };
  // batería
  const d = pick(r, G.drums);
  (['kick', 'clap', 'hat', 'open', 'perc'] as const).forEach((id) => { const t = T(id); if (t) { t.steps = parseDrum(d[id]); t.mute = !t.steps.some(Boolean); } });
  const kick = T('kick'); if (kick) { kick.pitch = G.kick.pitch; kick.decay = G.kick.decay; }
  const clap = T('clap'); if (clap) { clap.sound = pick(r, G.clap); clap.name = DRUM_SOUNDS[clap.sound] ?? 'Clap'; }
  const perc = T('perc'); if (perc) { perc.sound = pick(r, G.perc); perc.name = DRUM_SOUNDS[perc.sound] ?? 'Percu'; }
  const mix = (t: Track | undefined, m: { vol: number; rev: number; dly: number; duck: number }) => { if (t) { t.vol = m.vol; t.rev = m.rev; t.dly = m.dly; t.duck = m.duck; t.mute = false; t.synth = undefined; } };
  // bajo
  const bass = T('bass');
  if (bass) { const b = pick(r, G.bass), pb = parseBass(b.line); bass.steps = pb.steps; bass.bassLine = pb.line; bass.bassLen = b.l; bass.sound = pick(r, G.bassSound); mix(bass, G.mix.bass); }
  // acordes
  const ch = T('chords');
  if (ch) { const c = pick(r, G.chords); ch.chordMode = c.mode; ch.steps = c.steps ? parseDrum(c.steps).map((v) => (v ? 1 : 0)) : R([0]); ch.chordLen = c.len; ch.sound = pick(r, G.chordSound); mix(ch, G.mix.chords); }
  // arpegio
  const arp = T('arp');
  if (arp) { const a = pick(r, G.arp); arp.sound = pick(r, G.arpSound); arp.arp = { mode: a.mode, rate: a.rate, oct: a.oct, gate: a.gate ? parseGate(a.gate) : Array(16).fill(true) }; mix(arp, G.mix.arp);
    if (a.mode === 'acid') arp.arp.gate = acidPattern(p).gate; }
  // melodía
  const mel = T('melody'); if (mel) { mel.sound = pick(r, G.mel.sound); mix(mel, G.mix.melody); }
  // inserto y groove por pista según el género
  p.tracks.forEach((t) => { if (['kick', 'clap', 'hat', 'open', 'perc', 'bass', 'arp', 'chords', 'melody'].includes(t.id)) { t.fx = G.ins[t.id] ? { ...G.ins[t.id] } : undefined; t.groove = G.groove[t.id] ? [...G.groove[t.id]!] : undefined; } });
  applyHarmony(p, variant ? String(variant) : '');
}

/* ---------- semilla por nombre: un loop distinto (y lindo) por nombre ---------- */
export function seeded(str: string) {
  let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; let a = h >>> 0;
  const f = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f(); f(); f(); return f;
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const wpick = (r: () => number, o: Record<string, number>) => { const ks = Object.keys(o), tot = ks.reduce((a, k) => a + o[k], 0); let x = r() * tot; for (const k of ks) { x -= o[k]; if (x <= 0) return k; } return ks[0]; };
export function projectFromName(name: string, variant = 0, genre = 'deep'): Project {
  // arranca siempre en Deep House (o en el género que se pida): el cambio al generar no es brusco
  const r = seeded(clean(name) + '#' + variant);
  const g = GENRES[genre] ? genre : 'deep';
  const p = newProject(name, g);
  // melodía de 4 compases propia del nombre
  const mel = newTrack(p, 'melody'); mel.id = 'melody'; mel.color = '#f0d99a';
  p.tracks.splice(p.tracks.findIndex((t) => t.id === 'arp') + 1, 0, mel);
  applyGenre(p, g, variant);
  p.seed = r();
  return p;
}

/* ---------- compilación: proyecto → eventos por paso (64 pasos = 4 compases) ---------- */
function arpNotes(p: Project, t: Track) {
  const a = t.arp!, nm = p.seq.length ? p.seq : [69], L = nm.length, oc = (o: number) => 12 * (o % a.oct);
  const up = () => { const b = [...new Set(nm)].sort((x, y) => x - y), o: number[] = []; for (let k = 0; k < a.oct; k++) b.forEach((m) => o.push(m + 12 * k)); return o; };
  const r = seeded(p.name + '#arp');
  const rs = Array.from({ length: 64 }, () => { const u = up(); return u[Math.floor(r() * u.length)]; });
  const ac = a.mode === 'acid' ? acidPattern(p) : null;
  const chordTones = (s: number, pp: boolean) => {
    const c = p.chords[Math.floor(s / 16) % 4]?.midi ?? [60]; const pcs = [...new Set(c.map((m) => ((m % 12) + 12) % 12))];
    const base = [...pcs].map((pc) => { let m = 57 + ((pc - 57) % 12 + 12) % 12; return m; }).sort((x, y) => x - y);
    const u: number[] = []; for (let k = 0; k < a.oct; k++) base.forEach((m) => u.push(m + 12 * k));
    const seq = pp && u.length > 2 ? u.concat(u.slice(1, -1).reverse()) : u;
    return seq[(s % 16) % seq.length];
  };
  return (s: number) => {
    switch (a.mode) {
      case 'chord': return chordTones(s, false);
      case 'chordpp': return chordTones(s, true);
      case 'acid': return ac!.n[s % 16];
      case 'up': { const u = up(); return u[s % u.length]; }
      case 'down': { const u = up().reverse(); return u[s % u.length]; }
      case 'pp': { const u = up(); if (u.length < 2) return u[0]; const c = u.concat(u.slice(1, -1).reverse()); return c[s % c.length]; }
      case 'mirror': { const c = nm.concat(nm.slice().reverse()); return c[s % c.length] + oc(Math.floor(s / c.length)); }
      case 'jump': return nm[s % L] + oc(s);
      case 'rand': return rs[s % 64];
      default: return nm[s % L] + oc(Math.floor(s / L));
    }
  };
}
/* línea acid tipo 303: casi todo en la tónica, saltos de octava, quinta y séptima, con acentos, slides y silencios */
export function acidPattern(p: Project) {
  const r = seeded(clean(p.name || 'Loop') + '#acid'), t = p.tonic ?? ((p.seq[0] ?? 60) % 12), sc = p.scale ?? [];
  const deg = (k: number) => (sc.length >= 7 ? ((sc[k] - t + 12) % 12) : [0, 2, 3, 5, 7, 8, 10][k]);
  const pool = [0, 0, 0, 0, 12, 12, deg(2), deg(4), deg(6), deg(4) + 12, -12 + deg(6)];
  const base = 48 + t > 55 ? 36 + t : 48 + t;
  const n: number[] = [], acc: boolean[] = [], slide: boolean[] = [], gate: boolean[] = [];
  for (let i = 0; i < 16; i++) {
    n.push(base + (i === 0 ? 0 : pick(r, pool))); acc.push(i % 4 === 0 ? r() < 0.6 : r() < 0.22);
    gate.push(i === 0 || r() > 0.22); slide.push(i > 0 && gate[i - 1] && r() < 0.25);
  }
  return { n, acc, slide, gate };
}
/* pasos de 16 (un compás que se repite) o de 64 (cuatro compases distintos): se lee siempre con el largo que tenga */
export const expand64 = <T,>(a: T[]): T[] => (a.length === 64 ? [...a] : Array.from({ length: 64 }, (_, i) => a[i % a.length]));
export const arpPlays = (t: Track, i: number) => { const a = t.arp!; if (!a.gate[i % a.gate.length]) return false; if (a.rate === '8') return i % 2 === 0; if (a.rate === 'tr') return i % 4 !== 1; return true; };
export function arpPreview(p: Project, t: Track) { const f = arpNotes(p, t); return (s: number) => f(s); }

/* macros: 4 controles que mueven muchos parámetros a la vez, sin tocar el proyecto (se aplican al compilar) */
export const MACROS = [
  { k: 'energy', label: 'Energía', color: '#e5655b' }, { k: 'dark', label: 'Oscuridad', color: '#9a9a9a' },
  { k: 'space', label: 'Espacio', color: '#6fbf86' }, { k: 'groove', label: 'Groove', color: '#e9c46a' },
] as const;
export function compile(p: Project) {
  const anyGain = (v: number) => v * v * 1.6;
  const M = p.macros ?? { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 };
  // macros automatizadas: su parte fija queda neutra y el movimiento va paso a paso (eventos) o como curva al motor (filtros, envíos)
  const MA = p.macroAuto && Object.keys(p.macroAuto).length ? p.macroAuto : undefined;
  const mAt = (k: MacroKey, s: number) => (MA?.[k] ? MA[k]![s] ?? 0.5 : M[k]) - 0.5;
  const e = MA?.energy ? 0 : M.energy - 0.5, dk = MA?.dark ? 0 : M.dark - 0.5, sp = MA?.space ? 0 : M.space - 0.5, gr = MA?.groove ? 0 : M.groove - 0.5;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const S64 = Array.from({ length: 64 }, (_, s) => s);
  const mod: Record<string, number[]> = {};
  if (MA?.energy || MA?.dark) mod.cut = S64.map((s) => +Math.pow(2, (MA.energy ? mAt('energy', s) : 0) * 1.4 - (MA.dark ? mAt('dark', s) : 0) * 2).toFixed(4));
  if (MA?.energy) mod.en = S64.map((s) => mAt('energy', s));
  if (MA?.space) {
    mod.sk = S64.map((s) => +Math.pow(2, mAt('space', s) * 2.6).toFixed(4)); mod.sadd = S64.map((s) => Math.max(0, mAt('space', s)) * 0.15);
    mod.room = S64.map((s) => clamp(p.fx.revSize + mAt('space', s) * 0.16, 0.3, 0.97)); mod.fb = S64.map((s) => clamp(p.fx.dlyFb + mAt('space', s) * 0.12, 0, 0.8));
  }
  const cm = Math.pow(2, e * 1.4 - dk * 2); // brillo de los sintes
  const shape = (sy: Synth | undefined, amt = 1) => sy && (cm !== 1) ? { ...sy, cutoff: clamp(sy.cutoff * Math.pow(cm, amt), 60, 16000), pro: sy.pro && { ...sy.pro, cut: clamp(sy.pro.cut * Math.pow(cm, amt), 30, 18000) } } : sy;
  const sendK = Math.pow(2, sp * 2.6);
  // un grupo muteado apaga a todos sus instrumentos; un grupo en solo los pone en solo (sin tocar el estado propio de cada pista)
  const G = new Map((p.groups ?? []).map((g) => [g.id, g]));
  const offOf = (t: Track) => t.mute || !!(t.group && G.get(t.group)?.mute), soloOf = (t: Track) => t.solo || !!(t.group && G.get(t.group)?.solo);
  const fillId = p.fill ? (FILL_SOUNDS.map((snd) => p.tracks.find((t) => t.type === 'drum' && t.sound === snd && !offOf(t))).find(Boolean) ?? p.tracks.find((t) => t.type === 'drum' && t.sound !== 'kick' && !offOf(t)))?.id : undefined;
  const kickId = (p.tracks.find((t) => t.type === 'drum' && t.sound === 'kick' && !offOf(t)) ?? p.tracks.find((t) => t.type === 'drum' && t.sound === 'kick'))?.id;
  const tracks = p.tracks.map((t) => {
    const ev: any[][] = Array.from({ length: 64 }, () => []);
    let kind = 'synth', synth: Synth | undefined, sample: string | undefined;
    if (t.type === 'vocal') {
      // la voz es un clip de hasta 4 compases: suena una vez por vuelta, desde su posición
      kind = 'sample'; sample = 'vox:' + t.id + (t.vox?.rev ? ':r' : '');
      ev[Math.max(0, Math.min(63, t.vox?.pos ?? 0))].push({ v: 0.9 });
    } else if (t.roll && (t.type === 'bass' || t.type === 'arp' || t.type === 'chords')) {
      // editada a mano en el piano roll
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? (t.type === 'bass' ? SYNTHS.bassSaw.p : t.type === 'arp' ? SYNTHS.pluck.p : SYNTHS.strings.p);
      (t.notes ?? []).forEach((nt) => { if (nt.s >= 0 && nt.s < 64) ev[nt.s].push({ n: nt.n, v: 0.85, l: Math.max(0.5, nt.l - (t.type === 'chords' ? 0.05 : 0.15)) }); });
    } else if (t.type === 'drum') {
      kind = 'sample'; sample = sampleKey(p.kit, t.sound);
      for (let s = 0; s < 64; s++) {
        const es = mAt('energy', s), ghost = clamp(0.38 * (1 + es * 1.2), 0.15, 0.7), v = t.steps[s % t.steps.length];
        if (v) ev[s].push({ v: v === 2 ? 1 : v === 3 ? ghost : 0.72 }); else if (t.id === 'hat' && es > 0.22 && s % 2 === 1) ev[s].push({ v: 0.22 + es * 0.3 });
      }
    } else if (t.type === 'bass') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.bassSaw.p;
      for (let s = 0; s < 64; s++) {
        const v = t.steps[s % t.steps.length]; if (!v) continue; let m = p.chords[Math.floor(s / 16)].midi[0]; while (m > 47) m -= 12; while (m < 36) m += 12;
        ev[s].push({ n: m - 12 + (t.bassLine ? t.bassLine[s % t.bassLine.length] ?? 0 : 0), v: v === 2 ? 1 : 0.8, l: t.bassLen ?? 0.85 });
      }
    } else if (t.type === 'arp') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.pluck.p; const f = arpNotes(p, t);
      if (t.arp!.mode === 'acid') {
        const ac = acidPattern(p);
        const G = (k: number) => t.arp!.gate[(((k % 64) + 64) % 64) % t.arp!.gate.length];
        for (let s = 0; s < 64; s++) { const i = s % 16; if (!G(s)) continue; const nx = (i + 1) % 16, tie = G(s + 1) && ac.slide[nx];
          ev[s].push({ n: f(s), v: ac.acc[i] ? 1 : 0.7, l: tie ? 1.15 : 0.6, g: ac.slide[i] && G(s - 1) ? 1 : 0 }); }
      } else for (let s = 0; s < 64; s++) if (arpPlays(t, s)) ev[s].push({ n: f(s), v: s % 4 === 0 ? 0.95 : 0.78, l: t.arp!.rate === '8' ? 1.8 : 0.9 });
    } else if (t.type === 'melody') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.lead.p;
      (t.notes ?? []).forEach((nt) => { if (nt.s >= 0 && nt.s < 64) ev[nt.s].push({ n: nt.n, v: 0.85, l: Math.max(0.5, nt.l - 0.1) }); });
    } else {
      const base = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.strings.p;
      if (t.chordMode === 'stab') { synth = t.chordLen && t.chordLen > 1.2 ? base : STAB(base); if (synth.pro && synth !== base) synth.pro = { ...base.pro!, env1: { a: 0.004, d: Math.min(base.pro!.env1.d, 0.4), s: 0, r: 0.15 } }; for (let s = 0; s < 64; s++) if (t.steps[s % t.steps.length]) p.chords[Math.floor(s / 16)].midi.forEach((m) => ev[s].push({ n: m, v: 0.8, l: t.chordLen ?? 1 })); }
      else if (t.chordMode === 'gate') { synth = { ...base, attack: Math.min(base.attack, 0.004), release: Math.min(base.release, 0.05), pro: base.pro && { ...base.pro, env1: { ...base.pro.env1, a: Math.min(base.pro.env1.a, 0.004), r: Math.min(base.pro.env1.r, 0.05) } } }; for (let s = 0; s < 64; s++) if (t.steps[s % t.steps.length]) p.chords[Math.floor(s / 16)].midi.forEach((m) => ev[s].push({ n: m - 12, v: 0.8, l: t.chordLen ?? 0.8 })); }
      else { synth = base; for (let b = 0; b < 4; b++) p.chords[b].midi.forEach((m) => ev[b * 16].push({ n: m - 12, v: 0.8, l: 15.5 })); }
    }
    if (t.id === fillId) for (let s = 56; s < 64; s++) ev[s] = [{ v: 0.3 + 0.7 * ((s - 56) / 7) ** 1.3 }]; // redoble: semicorcheas que crecen en los últimos 2 tiempos
    if (p.fill && t.type === 'drum' && t.sound !== 'kick' && t.id !== fillId && ['hat', 'open'].includes(t.sound)) for (let s = 60; s < 64; s++) ev[s] = [];
    if (t.type !== 'drum') synth = shape(synth, t.type === 'bass' ? 0.5 : 1);
    const fx = t.type !== 'drum' && e > 0 ? { ...t.fx, drive: clamp((t.fx?.drive ?? 0) + e * 0.6, 0, 1) } : t.fx;
    let groove: number[] | undefined;
    if (MA?.groove) {
      // groove automatizado: un atraso por cada uno de los 64 pasos
      const g64 = S64.map((s) => { const g = mAt('groove', s); return t.groove ? Math.max(0, t.groove[s % 16] * (1 + g * 2.4)) : g > 0.15 && t.type === 'drum' && t.id !== 'kick' && s % 2 ? g * 0.12 : 0; });
      groove = g64.some((x) => x > 0) ? g64 : undefined;
    } else groove = t.groove ? t.groove.map((x) => Math.max(0, x * (1 + gr * 2.4))) : gr > 0.15 && t.type === 'drum' && t.id !== 'kick' ? Array.from({ length: 16 }, (_, i) => (i % 2 ? gr * 0.12 : 0)) : undefined;
    return {
      id: t.id, kind, sample, synth, ev, pitch: t.pitch, decay: t.decay, gain: anyGain(t.vol), pan: t.pan, mute: offOf(t), solo: soloOf(t),
      rev: clamp(t.rev * sendK + (sp > 0 && t.type !== 'drum' && t.type !== 'bass' ? sp * 0.15 : 0), 0, 1), dly: clamp(t.dly * sendK, 0, 1), duck: t.id === kickId ? 0 : t.duck, isKick: t.id === kickId, play: true,
      auto: t.auto && Object.keys(t.auto).length ? t.auto : undefined,
      eq: t.eq && t.eq.some((b) => Math.abs(b.g) > 0.05) ? t.eq : undefined,
      mono: t.type === 'bass' || (t.type === 'arp' && t.arp?.mode === 'acid') || !!synth?.pro?.mono, fx, groove, choke: t.type === 'vocal', from: t.type === 'vocal' ? t.vox?.from ?? 0 : 0,
      spread: t.type === 'chords' ? 0.5 : t.type === 'arp' ? 0.15 : 0, human: t.type === 'drum' ? 0.12 : t.type === 'vocal' ? 0 : 0.05,
      cutAmt: t.type === 'drum' || t.type === 'vocal' ? 0 : t.type === 'bass' ? 0.5 : 1, macDrive: t.type !== 'drum', spAdd: t.type !== 'drum' && t.type !== 'bass',
    };
  });
  const swingA = MA?.groove ? S64.map((s) => clamp(p.swing + mAt('groove', s) * 0.36, 0, 0.45)) : undefined;
  return { bpm: p.bpm, swing: clamp(p.swing + gr * 0.36, 0, 0.45), swingA, mod: Object.keys(mod).length ? mod : undefined, fx: { ...p.fx, revSize: clamp(p.fx.revSize + sp * 0.16, 0.3, 0.97), dlyFb: clamp(p.fx.dlyFb + sp * 0.12, 0, 0.8) }, master: p.master, tracks };
}
