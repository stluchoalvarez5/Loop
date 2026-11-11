/* Modelo de datos, teoría musical, presets y compilación a eventos para el motor. */

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
  chordMode?: 'pad' | 'stab';
  notes?: Note[]; // melodía: s = paso 0-63, n = nota MIDI, l = largo en pasos
};
export type Project = {
  name: string; genre: string; bpm: number; swing: number; kit: string;
  seq: number[]; chords: { name: string; tones: string[]; midi: number[] }[];
  tracks: Track[];
  fx: { revSize: number; revDamp: number; revRet: number; dlyFb: number; dlyRet: number; duck: number };
  master: { eq: number[]; target: number; auto: boolean; ceiling: number };
  seed?: number;
  harmony?: 'tonal' | 'puro'; // tonal: se busca la tonalidad del nombre; puro: solo las notas exactas de las letras
  key?: string; progression?: string; letterNotes?: { ch: string; note: string; moved: boolean }[];
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
function tonalHarmony(c: string, salt = '') {
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
  const ranked = [...TEMPLATES[best.mode]].map((tp) => [tScore(tp), tp] as [number, number[]]).sort((a, b) => b[0] - a[0]);
  const tpl = ranked[(Number(salt) || 0) % 3][1]; // "Otra versión" recorre las 3 progresiones que mejor le quedan al nombre
  const chordAt = (d: number) => {
    const root = scale[d], third = scale[(d + 2) % 7], fifth = scale[(d + 4) % 7], sev = scale[(d + 6) % 7];
    const iv = (x: number) => (x - root + 12) % 12, ivs = [0, iv(third), iv(fifth)];
    const q3 = ivs[1] === 4 ? 'maj' : 'min', dim = ivs[2] === 6;
    let name = NOTE_EN[root] + (dim ? 'dim' : q3 === 'min' ? 'm' : '');
    if (present.has(sev)) { ivs.push(iv(sev)); const s7 = iv(sev); name = NOTE_EN[root] + (dim ? 'm7b5' : q3 === 'maj' ? (s7 === 11 ? 'maj7' : '7') : 'm7'); }
    return { name, tones: ivs.map((i) => NOTE_ES[(root + i) % 12]), midi: voice({ root, ivs, name, score: 0 }) };
  };
  const roman = best.mode === 'maj' ? ROMAN_MAJ : ROMAN_MIN;
  return {
    letters: c, seq: snapped.map((pc) => 60 + pc), chords: tpl.map(chordAt),
    key: NOTE_ES[best.t] + (best.mode === 'maj' ? ' mayor' : ' menor'), progression: tpl.map((d) => roman[d]).join(' – '),
    letterNotes: [...c].map((ch, i) => ({ ch, note: NOTE_ES[snapped[i]] + (mins[i] ? 'm' : ''), moved: snapped[i] !== pcs[i] })),
  };
}
export function harmonyFromName(raw: string, mode: 'tonal' | 'puro' = 'tonal', salt = '') {
  const c = clean(raw) || 'LOOP';
  return mode === 'puro' ? pureHarmony(c) : tonalHarmony(c, salt);
}
export function applyHarmony(p: Project, salt = '') {
  const h = harmonyFromName(p.name, p.harmony ?? 'tonal', salt);
  p.seq = h.seq; p.chords = h.chords; p.key = h.key; p.progression = h.progression; p.letterNotes = h.letterNotes;
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

/* ---------- géneros ---------- */
const R = (on: number[], acc: number[] = []) => { const s = Array(16).fill(0); on.forEach((i) => (s[i] = 1)); acc.forEach((i) => (s[i] = 2)); return s; };
const ALL = [...Array(16).keys()];
export const GENRES: Record<string, any> = {
  prog: { name: 'Progressive', bpm: 124, swing: 0, kit: 'tr909', arp: 'pluck', mode: 'name', rate: '16', oct: 2, chords: 'strings', chordMode: 'pad', bass: 'bassSaw',
    st: { kick: R([0, 4, 8, 12]), clap: R([4, 12]), hat: R([2, 6, 10, 14]), open: R([]), perc: R([3, 6, 10, 13]), bass: R([2, 6, 10, 14]) }, perc: 'rim', fx: { rev: 0.32, dly: 0.28 } },
  house: { name: 'House', bpm: 124, swing: 0.22, kit: 'tr909', arp: 'organ', mode: 'name', rate: '8', oct: 1, chords: 'warm', chordMode: 'stab', chordSteps: R([2, 5, 10, 13]), bass: 'bassSaw',
    st: { kick: R([0, 4, 8, 12]), clap: R([4, 12]), hat: R([2, 6, 10, 14]), open: R([2, 6, 10, 14]), perc: R(ALL, [2, 6, 10, 14]), bass: R([3, 6, 10, 14]) }, perc: 'tamb', fx: { rev: 0.18, dly: 0.12 } },
  deep: { name: 'Deep House', bpm: 120, swing: 0.32, kit: 'tr808', arp: 'keys', mode: 'up', rate: '8', oct: 2, chords: 'warm', chordMode: 'stab', chordSteps: R([3, 7, 10, 14]), bass: 'bassSub',
    st: { kick: R([0, 4, 8, 12]), clap: R([4, 12]), hat: R([2, 6, 10, 14]), open: R([14]), perc: R([1, 3, 5, 7, 9, 11, 13, 15]), bass: R([3, 7, 11, 14]) }, perc: 'shaker', fx: { rev: 0.35, dly: 0.2 } },
  techno: { name: 'Techno', bpm: 132, swing: 0, kit: 'tr909h', arp: 'acid', mode: 'jump', rate: '16', oct: 2, chords: 'choir', chordMode: 'pad', bass: 'bassSub',
    st: { kick: R([0, 4, 8, 12]), clap: R([4, 12]), hat: R(ALL, [2, 6, 10, 14]), open: R([2, 6, 10, 14]), perc: R([3, 5, 10, 11, 14]), bass: R([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]) }, perc: 'rim', fx: { rev: 0.2, dly: 0.18 } },
  melodic: { name: 'Melodic Techno', bpm: 124, swing: 0, kit: 'tr909', arp: 'super', mode: 'up', rate: '16', oct: 2, chords: 'strings', chordMode: 'pad', bass: 'reese',
    st: { kick: R([0, 4, 8, 12]), clap: R([]), hat: R([2, 6, 10, 14]), open: R([]), perc: R([3, 6, 10, 13]), bass: R([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]) }, perc: 'clave', fx: { rev: 0.38, dly: 0.3 } },
  trance: { name: 'Trance', bpm: 138, swing: 0, kit: 'tr909h', arp: 'super', mode: 'pp', rate: '16', oct: 3, chords: 'strings', chordMode: 'pad', bass: 'bassSaw',
    st: { kick: R([0, 4, 8, 12]), clap: R([4, 12]), hat: R([2, 6, 10, 14]), open: R([2, 6, 10, 14]), perc: R([]), bass: R([2, 3, 6, 7, 10, 11, 14, 15]) }, perc: 'rim', fx: { rev: 0.32, dly: 0.26 } },
};

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
  const seq = [...new Set(p.seq)].sort((a, b) => a - b), notes: Note[] = [];
  [0, 3, 6, 10, 12].forEach((st, i) => notes.push({ s: st, n: seq[(i * 2) % seq.length] + 12, l: i === 4 ? 4 : 2 }));
  return mkTrack(id, 'Melodía', 'melody', sound ?? 'lead', { color, vol: 0.6, rev: 0.3, dly: 0.25, duck: 0.3, notes });
}
export const nameScale = (p: Project, octs = 2) => { const b = [...new Set(p.seq.map((m) => ((m % 12) + 12) % 12))].sort((a, c) => a - c), out: number[] = []; for (let o = 0; o < octs; o++) b.forEach((pc) => out.push(60 + pc + 12 * o)); return out.sort((a, c) => a - c); };

export function newProject(name = '', genre = 'prog'): Project {
  const h = harmonyFromName(name, 'tonal');
  const p: Project = {
    name, genre, bpm: 124, swing: 0, kit: 'tr909', seq: h.seq, chords: h.chords, harmony: 'tonal', key: h.key, progression: h.progression, letterNotes: h.letterNotes,
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
export function applyGenre(p: Project, g: string) {
  const G = GENRES[g]; p.genre = g; p.bpm = G.bpm; p.swing = G.swing; p.kit = G.kit;
  const T = (id: string) => p.tracks.find((t) => t.id === id) ?? mkTrack(id, '', 'drum', 'kick');
  ['kick', 'clap', 'hat', 'open', 'perc', 'bass'].forEach((id) => (T(id).steps = [...G.st[id]]));
  T('perc').sound = G.perc; T('bass').sound = G.bass; T('arp').sound = G.arp; T('chords').sound = G.chords;
  T('arp').arp = { mode: G.mode, rate: G.rate, oct: G.oct, gate: Array(16).fill(true) };
  T('chords').chordMode = G.chordMode; T('chords').steps = G.chordSteps ? [...G.chordSteps] : R([0]);
  T('arp').rev = G.fx.rev * 1.2; T('arp').dly = G.fx.dly * 1.2; T('chords').rev = G.fx.rev * 1.3;
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
const STYLE: Record<string, any> = {
  prog: { arp: ['pluck', 'bell', 'keys', 'marimba'], mode: { name: 3, mirror: 2, up: 1, jump: 1 }, oct: [2, 2, 3], rate: ['16', '16', 'tr'], chords: ['strings', 'glass', 'choir'], bass: ['bassSaw', 'bassSub', 'reese'], kit: ['tr909', 'tr909', 'tr808'], perc: ['rim', 'clave', 'shaker'] },
  house: { arp: ['organ', 'keys', 'pluck', 'chip'], mode: { name: 3, mirror: 1, up: 1 }, oct: [1, 1, 2], rate: ['8', 'tr', '16'], chords: ['warm', 'glass'], bass: ['bassSaw', 'bassSub'], kit: ['tr909', 'tr909', 'tr808'], perc: ['tamb', 'conga', 'cowbell', 'shaker'] },
  deep: { arp: ['keys', 'bell', 'marimba'], mode: { up: 2, name: 2, mirror: 1 }, oct: [1, 2, 2], rate: ['8', 'tr'], chords: ['warm', 'glass', 'choir'], bass: ['bassSub', 'reese'], kit: ['tr808', 'tr909'], perc: ['shaker', 'rim', 'clave', 'maraca'] },
  techno: { arp: ['acid', 'pluck', 'chip'], mode: { jump: 2, name: 2, rand: 1, mirror: 1 }, oct: [1, 2, 2], rate: ['16', '16', 'tr'], chords: ['choir', 'strings'], bass: ['bassSub', 'acid', 'reese'], kit: ['tr909h', 'tr909h', 'tr808'], perc: ['rim', 'conga'] },
  melodic: { arp: ['super', 'pluck', 'bell'], mode: { up: 2, name: 2, pp: 1, mirror: 1 }, oct: [2, 2, 3], rate: ['16', '16', 'tr'], chords: ['strings', 'choir', 'glass'], bass: ['reese', 'bassSub'], kit: ['tr909', 'tr808'], perc: ['clave', 'rim', 'shaker'] },
  trance: { arp: ['super', 'pluck'], mode: { pp: 2, up: 2, name: 1 }, oct: [2, 3], rate: ['16'], chords: ['strings', 'glass'], bass: ['bassSaw', 'reese'], kit: ['tr909h', 'tr909'], perc: ['rim'] },
};
const GATES = [null, null, null, [3, 7, 11, 15], [2, 10], [5, 13], [1, 5, 9, 13], [3, 6, 11, 14]];
export function projectFromName(name: string, variant = 0): Project {
  const r = seeded(clean(name) + '#' + variant);
  const g = wpick(r, { prog: 3, melodic: 3, deep: 2, house: 2, trance: 2, techno: 1 }), st = STYLE[g];
  const p = newProject(name, g); if (variant) applyHarmony(p, String(variant)); const T = (id: string) => p.tracks.find((t) => t.id === id) ?? mkTrack(id, '', 'drum', 'kick');
  const arp = T('arp'); arp.sound = pick(r, st.arp);
  arp.arp = { mode: wpick(r, st.mode), rate: pick(r, st.rate), oct: pick(r, st.oct), gate: Array(16).fill(true) };
  const gt = pick(r, GATES); if (gt) gt.forEach((i) => (arp.arp!.gate[i] = false));
  T('chords').sound = pick(r, st.chords); T('bass').sound = pick(r, st.bass); p.kit = pick(r, st.kit); T('perc').sound = pick(r, st.perc);
  p.bpm = GENRES[g].bpm + Math.round((r() - 0.5) * 4);
  if (GENRES[g].swing) p.swing = +(GENRES[g].swing * (0.8 + r() * 0.4)).toFixed(2);
  T('perc').mute = r() < 0.4; if (g !== 'techno' && g !== 'trance') T('open').mute = r() < 0.5;
  [0, 4, 8, 12].forEach((i) => { if (T('bass').steps[i] && r() < 0.25) T('bass').steps[i] = 2; });
  p.seed = r();
  return p;
}

/* ---------- compilación: proyecto → eventos por paso (64 pasos = 4 compases) ---------- */
function arpNotes(p: Project, t: Track) {
  const a = t.arp!, nm = p.seq.length ? p.seq : [69], L = nm.length, oc = (o: number) => 12 * (o % a.oct);
  const up = () => { const b = [...new Set(nm)].sort((x, y) => x - y), o: number[] = []; for (let k = 0; k < a.oct; k++) b.forEach((m) => o.push(m + 12 * k)); return o; };
  const r = seeded(p.name + '#arp');
  const rs = Array.from({ length: 64 }, () => { const u = up(); return u[Math.floor(r() * u.length)]; });
  return (s: number) => {
    switch (a.mode) {
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
      for (let s = 0; s < 64; s++) { const v = t.steps[s % 16]; if (v) ev[s].push({ v: v === 2 ? 1 : 0.72 }); }
    } else if (t.type === 'bass') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.bassSaw.p;
      for (let s = 0; s < 64; s++) { const v = t.steps[s % 16]; if (!v) continue; let m = p.chords[Math.floor(s / 16)].midi[0]; while (m > 47) m -= 12; while (m < 36) m += 12; ev[s].push({ n: m - 12, v: v === 2 ? 1 : 0.8, l: 0.85 }); }
    } else if (t.type === 'arp') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.pluck.p; const f = arpNotes(p, t);
      for (let s = 0; s < 64; s++) if (arpPlays(t, s % 16)) ev[s].push({ n: f(s), v: s % 4 === 0 ? 0.95 : 0.78, l: t.arp!.rate === '8' ? 1.8 : 0.9 });
    } else if (t.type === 'melody') {
      synth = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.lead.p;
      (t.notes ?? []).forEach((nt) => { if (nt.s >= 0 && nt.s < 64) ev[nt.s].push({ n: nt.n, v: 0.85, l: Math.max(0.5, nt.l - 0.1) }); });
    } else {
      const base = t.synth ?? SYNTHS[t.sound]?.p ?? SYNTHS.strings.p;
      if (t.chordMode === 'stab') { synth = STAB(base); for (let s = 0; s < 64; s++) if (t.steps[s % 16]) p.chords[Math.floor(s / 16)].midi.forEach((m) => ev[s].push({ n: m, v: 0.8, l: 1 })); }
      else { synth = base; for (let b = 0; b < 4; b++) p.chords[b].midi.forEach((m) => ev[b * 16].push({ n: m - 12, v: 0.8, l: 15.5 })); }
    }
    return {
      id: t.id, kind, sample, synth, ev, pitch: t.pitch, decay: t.decay, gain: anyGain(t.vol), pan: t.pan, mute: t.mute, solo: t.solo,
      rev: t.rev, dly: t.dly, duck: t.id === kickId ? 0 : t.duck, isKick: t.id === kickId, play: true,
      spread: t.type === 'chords' ? 0.5 : t.type === 'arp' ? 0.15 : 0, human: t.type === 'drum' ? 0.12 : 0.05,
    };
  });
  return { bpm: p.bpm, swing: p.swing, fx: p.fx, master: p.master, tracks };
}
