/* Modelo de datos, teoría musical, presets y compilación a eventos para el motor. */
import { GENRES, MEL_STYLES, GENRE_WEIGHTS, parseDrum, parseBass, parseGate, styleOf } from './genres';
export { GENRES, styleOf };

export type Synth = {
  wave: 'saw' | 'square' | 'tri' | 'sine' | 'fm'; unison: number; detune: number; cutoff: number; reso: number;
  envAmt: number; fdecay: number; attack: number; decay: number; sustain: number; release: number; gain: number;
  octave?: number; sub?: number; fmRatio?: number; fmIndex?: number; fmDecay?: number; poles4?: boolean;
};
export type TrackType = 'drum' | 'bass' | 'arp' | 'chords' | 'melody';
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
  notes?: Note[]; // melodía: s = paso 0-63, n = nota MIDI, l = largo en pasos
  autoMelody?: boolean; // true mientras la melodía sea la generada por el nombre (se regenera si cambia la armonía)
};
export type Project = {
  name: string; genre: string; style?: string; bpm: number; swing: number; kit: string;
  seq: number[]; chords: { name: string; tones: string[]; midi: number[] }[];
  tracks: Track[];
  fx: { revSize: number; revDamp: number; revRet: number; dlyFb: number; dlyRet: number; duck: number };
  master: { eq: number[]; target: number; auto: boolean; ceiling: number };
  seed?: number;
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
export function applyHarmony(p: Project, salt = '') {
  const h = harmonyFromName(p.name, p.harmony ?? 'tonal', salt, GENRES[p.genre] ? styleOf(p.genre, p.style).harm : {});
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
  const st = MEL_STYLES[GENRES[p.genre] ? styleOf(p.genre, p.style).mel.style : 'qa'] ?? MEL_STYLES.qa, LO = st.lo, HI = st.hi, hook = st.form === 'hook';
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
  bell: { label: 'Campana', for: ['arp', 'melody'], p: S({ wave: 'fm', fmRatio: 3.5, fmIndex: 3, fmDecay: 0.5, cutoff: 9000, reso: 0.05, decay: 1.2, release: 0.8, gain: 0.4, octave: 1 }) },
  super: { label: 'Supersaw', for: ['arp', 'chords', 'melody'], p: S({ unison: 5, detune: 22, cutoff: 3800, reso: 0.12, envAmt: 0.5, fdecay: 0.35, attack: 0.008, decay: 0.5, sustain: 0.25, release: 0.35, gain: 0.26 }) },
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
  tranceLead: { label: 'Lead trance', for: ['melody', 'arp'], p: S({ unison: 6, detune: 28, cutoff: 6500, reso: 0.12, envAmt: 0.3, fdecay: 0.4, attack: 0.005, decay: 0.4, sustain: 0.75, release: 0.3, gain: 0.2 }) },
  trancePluck: { label: 'Pluck trance', for: ['arp', 'melody'], p: S({ unison: 5, detune: 20, cutoff: 900, reso: 0.25, envAmt: 2.4, fdecay: 0.16, decay: 0.22, release: 0.15, gain: 0.34 }) },
  tranceGate: { label: 'Pad gate', for: ['chords'], p: S({ unison: 6, detune: 24, cutoff: 4200, reso: 0.1, envAmt: 0.3, fdecay: 0.15, attack: 0.003, decay: 0.3, sustain: 0.85, release: 0.04, gain: 0.13 }) },
  tranceBass: { label: 'Rolling', for: ['bass'], p: S({ sub: 0.5, cutoff: 380, reso: 0.3, envAmt: 2, fdecay: 0.09, decay: 0.15, sustain: 0.2, release: 0.04, gain: 0.5 }) },
  acid303: { label: 'Acid 303', for: ['arp', 'bass'], p: S({ cutoff: 230, reso: 0.9, envAmt: 3, fdecay: 0.14, attack: 0.002, decay: 0.3, sustain: 0.6, release: 0.03, gain: 0.4, octave: -1 }) },
  technoSub: { label: 'Sub techno', for: ['bass'], p: S({ wave: 'tri', sub: 0.6, cutoff: 260, reso: 0.15, envAmt: 0.6, fdecay: 0.1, attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.08, gain: 0.6 }) },
  techStab: { label: 'Stab techno', for: ['chords'], p: S({ unison: 3, detune: 12, cutoff: 650, reso: 0.4, envAmt: 2.2, fdecay: 0.12, attack: 0.002, decay: 0.2, sustain: 0, release: 0.1, gain: 0.3 }) },
  housePiano: { label: 'Piano house', for: ['chords', 'melody', 'arp'], p: S({ wave: 'fm', fmRatio: 2, fmIndex: 2.2, fmDecay: 0.25, cutoff: 7000, reso: 0.05, attack: 0.002, decay: 0.9, sustain: 0.1, release: 0.3, gain: 0.36 }) },
  houseBass: { label: 'Bajo house', for: ['bass'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 1.6, fmDecay: 0.12, sub: 0.3, cutoff: 1800, reso: 0.05, decay: 0.3, sustain: 0.35, release: 0.06, gain: 0.55 }) },
  deepRhodes: { label: 'Rhodes', for: ['chords', 'melody'], p: S({ wave: 'fm', fmRatio: 1, fmIndex: 1.2, fmDecay: 0.6, cutoff: 3200, reso: 0.05, attack: 0.004, decay: 1.6, sustain: 0.3, release: 0.6, gain: 0.34 }) },
  deepBass: { label: 'Sub redondo', for: ['bass'], p: S({ wave: 'sine', sub: 0.2, cutoff: 900, reso: 0.05, attack: 0.008, decay: 0.6, sustain: 0.8, release: 0.15, gain: 0.5 }) },
  melodicPluck: { label: 'Pluck oscuro', for: ['arp', 'melody'], p: S({ unison: 2, detune: 10, cutoff: 450, reso: 0.4, envAmt: 2.6, fdecay: 0.2, decay: 0.35, release: 0.3, gain: 0.32, poles4: true }) },
  psyBass: { label: 'Bajo psy', for: ['bass'], p: S({ sub: 0.35, cutoff: 420, reso: 0.35, envAmt: 2.4, fdecay: 0.06, attack: 0.001, decay: 0.09, sustain: 0.1, release: 0.03, gain: 0.6 }) },
  psyAcid: { label: 'Acid psy', for: ['arp', 'melody'], p: S({ cutoff: 380, reso: 0.93, envAmt: 3.4, fdecay: 0.1, attack: 0.002, decay: 0.2, sustain: 0.5, release: 0.03, gain: 0.32 }) },
  psyLead: { label: 'Lead psy', for: ['melody', 'arp'], p: S({ wave: 'square', unison: 2, detune: 14, cutoff: 1400, reso: 0.55, envAmt: 2.2, fdecay: 0.08, decay: 0.12, sustain: 0.3, release: 0.05, gain: 0.2 }) },
  techHouseBass: { label: 'Bajo tech house', for: ['bass'], p: S({ sub: 0.55, cutoff: 480, reso: 0.35, envAmt: 1.6, fdecay: 0.1, attack: 0.002, decay: 0.18, sustain: 0.35, release: 0.05, gain: 0.5 }) },
  mauBass: { label: 'Bajo bounce', for: ['bass'], p: S({ wave: 'square', unison: 2, detune: 10, sub: 0.6, cutoff: 600, reso: 0.45, envAmt: 2.4, fdecay: 0.09, attack: 0.001, decay: 0.15, sustain: 0.25, release: 0.04, gain: 0.42, poles4: true }) },
  anymaArp: { label: 'Arp cinemático', for: ['arp', 'melody'], p: S({ unison: 4, detune: 16, cutoff: 1100, reso: 0.3, envAmt: 2.2, fdecay: 0.14, decay: 0.2, sustain: 0.05, release: 0.18, gain: 0.3 }) },
  anymaLead: { label: 'Lead cinemático', for: ['melody', 'arp'], p: S({ unison: 4, detune: 14, cutoff: 2400, reso: 0.35, envAmt: 0.8, fdecay: 0.25, attack: 0.01, decay: 0.5, sustain: 0.8, release: 0.4, gain: 0.22, poles4: true }) },
  progPluck: { label: 'Pluck progressive', for: ['arp', 'melody'], p: S({ wave: 'square', unison: 2, detune: 9, cutoff: 800, reso: 0.3, envAmt: 1.8, fdecay: 0.2, decay: 0.28, release: 0.22, gain: 0.26 }) },
};
export const STAB = (p: Synth): Synth => ({ ...p, attack: 0.004, decay: 0.3, sustain: 0, release: 0.15, gain: p.gain * 1.6, envAmt: Math.max(p.envAmt, 0.8), fdecay: 0.2 });

/* ---------- batería ---------- */
export const KITS: Record<string, { label: string; map: Record<string, string> }> = {
  tr909: { label: '909', map: { kick: 'kA909', clap: 'clap1', hat: 'hat1', open: 'open', snare: 'snare', rim: 'rim' } },
  tr909h: { label: '909 Duro', map: { kick: 'kBh', clap: 'clap2', hat: 'hatH', open: 'openH', snare: 'snareH', rim: 'rim' } },
  tr808: { label: '808', map: { kick: 'k808', clap: 'clap808', hat: 'hat808', open: 'open808', snare: 'snare808', rim: 'rim' } },
};
export const DRUM_SOUNDS: Record<string, string> = {
  kick: 'Kick', clap: 'Clap', snare: 'Snare', snare808: 'Snare 808', hat: 'Hat', open: 'Open hat', ride: 'Ride', rim: 'Rim', crash: 'Crash',
  cowbell: 'Cowbell', clave: 'Clave', conga: 'Conga', shaker: 'Shaker', tamb: 'Pandereta', maraca: 'Maraca',
  tomL: 'Tom grave', tomM: 'Tom medio', tomH: 'Tom agudo', rim2: 'Rim fuerte', snareSoft: 'Snare suave',
};
export const DRUM_GROUPS: [string, string[]][] = [['Bombo', ['kick']], ['Golpes', ['clap', 'snare', 'snare808', 'snareSoft', 'rim', 'rim2']], ['Platillos', ['hat', 'open', 'ride', 'crash']], ['Percusión', ['cowbell', 'clave', 'conga', 'shaker', 'tamb', 'maraca']], ['Toms', ['tomL', 'tomM', 'tomH']]];
export const sampleKey = (kit: string, sound: string) => KITS[kit]?.map[sound] ?? sound;

const R = (on: number[], acc: number[] = []) => { const s = Array(16).fill(0); on.forEach((i) => (s[i] = 1)); acc.forEach((i) => (s[i] = 2)); return s; };

const COLORS: Record<string, string> = { kick: '#ff5a36', clap: '#ffb020', hat: '#f2e94e', open: '#9be15d', perc: '#2fd8b4', bass: '#3fa7ff', arp: '#8b6cff', chords: '#ff5fb3' };
const mkTrack = (id: string, name: string, type: TrackType, sound: string, extra: Partial<Track> = {}): Track => ({
  id, name, color: COLORS[id], type, steps: Array(16).fill(0), sound, pitch: 0, decay: 1, vol: 0.8, pan: 0, mute: false, solo: false, rev: 0, dly: 0, duck: 0, ...extra,
});

const PALETTE = ['#ff5a36', '#ffb020', '#f2e94e', '#9be15d', '#2fd8b4', '#3fa7ff', '#8b6cff', '#ff5fb3', '#ff8a5c', '#5ce1e6', '#c38bff', '#ffd166'];
export function newTrack(p: Project, type: TrackType, sound?: string): Track {
  const n = p.tracks.length, id = type + '-' + Date.now().toString(36), color = PALETTE[n % PALETTE.length];
  if (type === 'drum') return mkTrack(id, DRUM_SOUNDS[sound ?? 'conga'] ?? 'Percu', 'drum', sound ?? 'conga', { color, vol: 0.6, rev: 0.15 });
  if (type === 'bass') return mkTrack(id, 'Bajo 2', 'bass', sound ?? 'fmBass', { color, vol: 0.7, duck: 0.5 });
  if (type === 'chords') return mkTrack(id, 'Acordes 2', 'chords', sound ?? 'airy', { color, vol: 0.55, rev: 0.4, duck: 0.4, chordMode: 'pad', steps: [1, ...Array(15).fill(0)] });
  if (type === 'arp') return mkTrack(id, 'Arpegio 2', 'arp', sound ?? 'bell', { color, vol: 0.55, rev: 0.35, dly: 0.3, duck: 0.3, arp: { mode: 'up', rate: '8', oct: 2, gate: Array(16).fill(true) } });
  return mkTrack(id, 'Melodía', 'melody', sound ?? 'lead', { color, vol: 0.6, rev: 0.3, dly: 0.25, duck: 0.3, notes: generateMelody(p, id), autoMelody: true });
}
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
  };
  applyGenre(p, genre);
  return p;
}
/* aplica la receta completa del género. La semilla es nombre + género (+ versión): el mismo nombre en trance suena siempre igual */
export function applyGenre(p: Project, g: string, variant = 0, style?: string) {
  if (!GENRES[g]) return;
  const r = seeded(clean(p.name || 'Loop') + '#g:' + g + '#' + variant + '#' + (style ?? ''));
  if (!style || !GENRES[g].styles[style]) style = pick(r, Object.keys(GENRES[g].styles)); // sin estilo elegido, lo elige el nombre
  const G = styleOf(g, style); p.genre = g; p.style = style;
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
export function projectFromName(name: string, variant = 0): Project {
  const r = seeded(clean(name) + '#' + variant);
  const g = wpick(r, GENRE_WEIGHTS);
  const p = newProject(name, g);
  // melodía de 4 compases propia del nombre
  const mel = newTrack(p, 'melody'); mel.id = 'melody'; mel.color = '#ffd166';
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
export const arpPlays = (t: Track, i: number) => { const a = t.arp!; if (!a.gate[i]) return false; if (a.rate === '8') return i % 2 === 0; if (a.rate === 'tr') return i % 4 !== 1; return true; };
export function arpPreview(p: Project, t: Track) { const f = arpNotes(p, t); return (s: number) => f(s); }

export function compile(p: Project) {
  const anyGain = (v: number) => v * v * 1.6;
  const kickId = (p.tracks.find((t) => t.type === 'drum' && t.sound === 'kick' && !t.mute) ?? p.tracks.find((t) => t.type === 'drum' && t.sound === 'kick'))?.id;
  const tracks = p.tracks.map((t) => {
    const ev: any[][] = Array.from({ length: 64 }, () => []);
    let kind = 'synth', synth: Synth | undefined, sample: string | undefined;
    if (t.type === 'drum') {
      kind = 'sample'; sample = sampleKey(p.kit, t.sound);
      for (let s = 0; s < 64; s++) { const v = t.steps[s % 16]; if (v) ev[s].push({ v: v === 2 ? 1 : v === 3 ? 0.38 : 0.72 }); }
    } else if (t.type === 'bass') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.bassSaw.p;
      for (let s = 0; s < 64; s++) {
        const v = t.steps[s % 16]; if (!v) continue; let m = p.chords[Math.floor(s / 16)].midi[0]; while (m > 47) m -= 12; while (m < 36) m += 12;
        ev[s].push({ n: m - 12 + (t.bassLine?.[s % 16] ?? 0), v: v === 2 ? 1 : 0.8, l: t.bassLen ?? 0.85 });
      }
    } else if (t.type === 'arp') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.pluck.p; const f = arpNotes(p, t);
      if (t.arp!.mode === 'acid') {
        const ac = acidPattern(p);
        for (let s = 0; s < 64; s++) { const i = s % 16; if (!t.arp!.gate[i]) continue; const nx = (i + 1) % 16, tie = t.arp!.gate[nx] && ac.slide[nx];
          ev[s].push({ n: f(s), v: ac.acc[i] ? 1 : 0.7, l: tie ? 1.15 : 0.6, g: ac.slide[i] && t.arp!.gate[(i + 15) % 16] ? 1 : 0 }); }
      } else for (let s = 0; s < 64; s++) if (arpPlays(t, s % 16)) ev[s].push({ n: f(s), v: s % 4 === 0 ? 0.95 : 0.78, l: t.arp!.rate === '8' ? 1.8 : 0.9 });
    } else if (t.type === 'melody') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.lead.p;
      (t.notes ?? []).forEach((nt) => { if (nt.s >= 0 && nt.s < 64) ev[nt.s].push({ n: nt.n, v: 0.85, l: Math.max(0.5, nt.l - 0.1) }); });
    } else {
      const base = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.strings.p;
      if (t.chordMode === 'stab') { synth = t.chordLen && t.chordLen > 1.2 ? base : STAB(base); for (let s = 0; s < 64; s++) if (t.steps[s % 16]) p.chords[Math.floor(s / 16)].midi.forEach((m) => ev[s].push({ n: m, v: 0.8, l: t.chordLen ?? 1 })); }
      else if (t.chordMode === 'gate') { synth = { ...base, attack: Math.min(base.attack, 0.004), release: Math.min(base.release, 0.05) }; for (let s = 0; s < 64; s++) if (t.steps[s % 16]) p.chords[Math.floor(s / 16)].midi.forEach((m) => ev[s].push({ n: m - 12, v: 0.8, l: t.chordLen ?? 0.8 })); }
      else { synth = base; for (let b = 0; b < 4; b++) p.chords[b].midi.forEach((m) => ev[b * 16].push({ n: m - 12, v: 0.8, l: 15.5 })); }
    }
    return {
      id: t.id, kind, sample, synth, ev, pitch: t.pitch, decay: t.decay, gain: anyGain(t.vol), pan: t.pan, mute: t.mute, solo: t.solo,
      rev: t.rev, dly: t.dly, duck: t.id === kickId ? 0 : t.duck, isKick: t.id === kickId, play: true,
      mono: t.type === 'bass' || (t.type === 'arp' && t.arp?.mode === 'acid'),
      spread: t.type === 'chords' ? 0.5 : t.type === 'arp' ? 0.15 : 0, human: t.type === 'drum' ? 0.12 : 0.05,
    };
  });
  return { bpm: p.bpm, swing: p.swing, fx: p.fx, master: p.master, tracks };
}
