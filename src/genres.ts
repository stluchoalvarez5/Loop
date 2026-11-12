/* Recetas de producción por género.
   Cada género define tempo, armonía (modo, progresiones típicas, extensiones), batería con acentos y golpes suaves,
   línea de bajo, forma de tocar los acordes, arpegio, estilo de melodía, sonidos, efectos y sidechain.
   Las listas son alternativas: el nombre elige una con su semilla (mismo nombre + mismo género = mismo loop).

   Notación de batería (16 pasos): '.' nada, 'x' golpe, 'X' acento, 'g' golpe suave (ghost).
   Notación de bajo: '.' nada, 'r' fundamental, 'R' fundamental acentuada, 'o' octava arriba, 'f' quinta, 's' séptima menor, 'b' octava abajo. */

export type DrumPat = { kick: string; clap: string; hat: string; open: string; perc: string };
export type BassPat = { line: string; l: number };
export type ChordPat = { mode: 'pad' | 'stab' | 'gate'; steps?: string; len?: number };
export type ArpPat = { mode: string; rate: '16' | '8' | 'tr'; oct: number; gate?: string };
export type Genre = {
  name: string; bpm: [number, number]; swing: [number, number]; kit: string[];
  harm: { mode?: 'maj' | 'min'; ext: number; tpl?: { maj?: number[][]; min?: number[][] } };
  drums: DrumPat[]; clap: string[]; perc: string[]; kick: { pitch: number; decay: number };
  bass: BassPat[]; bassSound: string[];
  chords: ChordPat[]; chordSound: string[];
  arp: ArpPat[]; arpSound: string[];
  mel: { style: string; sound: string[] };
  fx: { revSize: number; revDamp: number; revRet: number; dlyFb: number; dlyRet: number; duck: number };
  mix: Record<'arp' | 'chords' | 'melody' | 'bass', { vol: number; rev: number; dly: number; duck: number }>;
  ins: Partial<Record<string, Ins>>; // inserto por pista: saturación, filtros y chorus
  groove: Partial<Record<string, number[]>>; // microtiming por pista: atraso de cada paso en fracción de semicorchea
};
export type Ins = { drive?: number; hp?: number; lp?: number; chorus?: number };
/* groove: patrón de 4 semicorcheas repetido (0 = en la grilla) */
const gr = (a: number[]) => Array.from({ length: 16 }, (_, i) => a[i % 4]);

export const GENRES: Record<string, Genre> = {
  /* Trance: 138, menor siempre, i–VI–III–VII, bajo "rolling" en semicorcheas fuera del bombo, pad con trance gate,
     arpegio que recorre el acorde, lead supersaw de himno y reverb grande. */
  trance: {
    name: 'Trance', bpm: [136, 140], swing: [0, 0], kit: ['trance'],
    harm: { mode: 'min', ext: -1, tpl: { min: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 5, 6], [0, 5, 6, 4], [0, 6, 5, 6]] } },
    drums: [
      { kick: 'X...x...X...x...', clap: '....X.......X...', hat: 'g.g.g.g.g.g.g.g.', open: '..X...X...X...X.', perc: '...............g' },
      { kick: 'X...x...X...x...', clap: '....X.......X...', hat: 'gggxgggxgggxgggx', open: '..X...X...X...X.', perc: '..x...x...x...x.' },
      { kick: 'X...x...X...x...', clap: '....X.......X..g', hat: 'g.x.g.x.g.x.g.x.', open: '..X...X...X...X.', perc: '....x.......x...' },
    ],
    clap: ['clap'], perc: ['ride', 'rim', 'snare'], kick: { pitch: 0, decay: 0.55 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.6 }, { line: '.rro.rro.rro.rro', l: 0.6 }, { line: '.Rrr.Rrr.Rrr.Rrr', l: 0.55 }],
    bassSound: ['tranceBass'],
    chords: [{ mode: 'gate', steps: 'x.xx.xx.x.xx.xx.', len: 0.8 }, { mode: 'gate', steps: 'xx.xx.xx.xx.xx.x', len: 0.8 }, { mode: 'gate', steps: 'x.x.x.x.x.x.x.x.', len: 1.2 }, { mode: 'pad' }],
    chordSound: ['tranceGate', 'super'],
    arp: [{ mode: 'chord', rate: '16', oct: 2 }, { mode: 'chordpp', rate: '16', oct: 2 }, { mode: 'chord', rate: '16', oct: 3 }],
    arpSound: ['trancePluck', 'pluckHi'],
    mel: { style: 'anthem', sound: ['tranceLead', 'super'] },
    ins: { chords: { hp: 280, chorus: 0.5 }, arp: { hp: 320, chorus: 0.25 }, melody: { drive: 0.15, chorus: 0.35 }, bass: { drive: 0.25, hp: 38 }, open: { hp: 5000 } },
    groove: {},
    fx: { revSize: 0.9, revDamp: 0.25, revRet: 0.95, dlyFb: 0.45, dlyRet: 0.7, duck: 0.5 },
    mix: { arp: { vol: 0.65, rev: 0.4, dly: 0.35, duck: 0.55 }, chords: { vol: 0.75, rev: 0.35, dly: 0.1, duck: 0.7 }, melody: { vol: 0.5, rev: 0.45, dly: 0.3, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.8 } },
  },
  /* Techno: 130-134, menor, acorde casi fijo (vamp), bombo largo y grave, hats en semicorcheas con acentos,
     línea acid 303 con slides y acentos, stab oscuro con dub delay y bajo sub. */
  techno: {
    name: 'Techno', bpm: [130, 134], swing: [0, 0.06], kit: ['techno'],
    harm: { mode: 'min', ext: 7, tpl: { min: [[0, 0, 0, 0], [0, 0, 5, 6], [0, 0, 3, 3], [0, 0, 0, 6]] } },
    drums: [
      { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'ggXgggXgggXgggXg', open: '..x...x...x...x.', perc: '...x..x....x..x.' },
      { kick: 'X...X...X...X..g', clap: '............x...', hat: 'gXgggXgggXgggXgg', open: '..x...x...x...x.', perc: '..x..x.x..x..x..' },
      { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'xgXgxgXgxgXgxgXg', open: '..X.......X.....', perc: '.x..x.x..x..x.x.' },
    ],
    clap: ['clap', 'rim2'], perc: ['rim', 'tomL', 'conga', 'ride'], kick: { pitch: -2, decay: 1 },
    bass: [{ line: '..r...r...r...r.', l: 1.4 }, { line: '.rr..rr..rr..rr.', l: 0.7 }, { line: '..rr..rr..rr..rr', l: 0.8 }],
    bassSound: ['technoSub', 'bassSub'],
    chords: [{ mode: 'stab', steps: '...x......x.....', len: 1 }, { mode: 'stab', steps: '..x.....x..x....', len: 1 }, { mode: 'stab', steps: '.......x.......x', len: 1 }],
    chordSound: ['techStab'],
    arp: [{ mode: 'acid', rate: '16', oct: 2 }],
    arpSound: ['acid303'],
    mel: { style: 'hook', sound: ['pluckHi', 'chip'] },
    ins: { bass: { drive: 0.45, lp: 380 }, chords: { drive: 0.35, hp: 220 }, arp: { drive: 0.55 }, melody: { drive: 0.3, hp: 300 }, clap: { hp: 250 }, perc: { drive: 0.2 } },
    groove: { hat: gr([0, 0.02, 0, 0.04]), perc: gr([0, 0.03, 0.02, 0.05]) },
    fx: { revSize: 0.75, revDamp: 0.45, revRet: 0.8, dlyFb: 0.58, dlyRet: 0.8, duck: 0.45 },
    mix: { arp: { vol: 0.5, rev: 0.12, dly: 0.25, duck: 0.5 }, chords: { vol: 0.5, rev: 0.3, dly: 0.55, duck: 0.5 }, melody: { vol: 0.5, rev: 0.25, dly: 0.35, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.6 } },
  },
  /* House: 122-126 con swing, acordes de séptima en stabs sincopados de piano/órgano, bajo con saltos de octava,
     hats abiertos a contratiempo, pandereta y shaker en semicorcheas. */
  house: {
    name: 'House', bpm: [122, 126], swing: [0.18, 0.28], kit: ['house'],
    harm: { ext: 7, tpl: { maj: [[0, 3, 5, 4], [5, 3, 0, 4], [1, 4, 0, 0], [0, 5, 3, 4]], min: [[0, 3, 6, 5], [0, 6, 5, 6], [0, 3, 4, 0], [0, 5, 3, 4]] } },
    drums: [
      { kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'g.g.g.g.g.g.g.g.', open: '..X...X...X...X.', perc: 'gxgxgxgxgxgxgxgx' },
      { kick: 'X...X...X...X...', clap: '....X.......X.g.', hat: 'ggxgggxgggxgggxg', open: '..X...X...X...X.', perc: '..x..x....x..x..' },
      { kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'xgxgxgxgxgxgxgxg', open: '..X...X...X...X.', perc: 'x.gxx.gxx.gxx.gx' },
    ],
    clap: ['clap'], perc: ['tamb', 'shaker', 'conga', 'cowbell'], kick: { pitch: 0, decay: 0.85 },
    bass: [{ line: '..ro..r...ro..r.', l: 0.8 }, { line: '...r..o...r..fo.', l: 0.7 }, { line: '..r.o.r...r.o.f.', l: 0.7 }],
    bassSound: ['houseBass', 'bassSaw'],
    chords: [{ mode: 'stab', steps: '..x..x....x..x..', len: 1.5 }, { mode: 'stab', steps: '...x..x...x..x..', len: 1.5 }, { mode: 'stab', steps: '..x...x...x...x.', len: 1.2 }],
    chordSound: ['housePiano', 'organ'],
    arp: [{ mode: 'name', rate: '8', oct: 1, gate: 'x.x...x.x.x...x.' }, { mode: 'mirror', rate: '8', oct: 2, gate: 'x...x.x...x.x...' }],
    arpSound: ['organ', 'pluckHi'],
    mel: { style: 'house', sound: ['housePiano', 'organ', 'pluckHi'] },
    ins: { chords: { hp: 180, chorus: 0.2 }, bass: { drive: 0.2 }, arp: { hp: 250 }, melody: { chorus: 0.15 }, perc: { hp: 400 } },
    groove: { hat: gr([0, 0.05, 0.03, 0.08]), perc: gr([0, 0.06, 0.03, 0.09]), clap: gr([0, 0, 0.04, 0]) },
    fx: { revSize: 0.6, revDamp: 0.4, revRet: 0.7, dlyFb: 0.35, dlyRet: 0.55, duck: 0.3 },
    mix: { arp: { vol: 0.45, rev: 0.2, dly: 0.15, duck: 0.3 }, chords: { vol: 0.6, rev: 0.22, dly: 0.12, duck: 0.35 }, melody: { vol: 0.5, rev: 0.25, dly: 0.2, duck: 0.3 }, bass: { vol: 0.75, rev: 0, dly: 0, duck: 0.45 } },
  },
  /* Deep House: 118-122, mucho swing, acordes de novena (Rhodes), ii–V–I, bajo sub redondo y largo,
     batería 808 suave con shaker, melodía espaciada. */
  deep: {
    name: 'Deep House', bpm: [118, 122], swing: [0.28, 0.38], kit: ['deep'],
    harm: { ext: 9, tpl: { maj: [[1, 4, 0, 5], [1, 4, 0, 0], [0, 5, 1, 4], [3, 2, 1, 4]], min: [[0, 3, 0, 3], [0, 3, 6, 2], [3, 4, 0, 0], [0, 6, 5, 3]] } },
    drums: [
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '..............g.', perc: 'gxgxgxgxgxgxgxgx' },
      { kick: 'X...x...X...x.g.', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.', open: '......g.......g.', perc: '.g.x.g.x.g.x.g.x' },
      { kick: 'X...x...X...x...', clap: '....x..g....x...', hat: '..xg..xg..xg..xg', open: '..............x.', perc: 'g.g.g.g.g.g.g.g.' },
    ],
    clap: ['rim', 'clap', 'snareSoft'], perc: ['shaker', 'maraca', 'conga'], kick: { pitch: 0, decay: 0.35 },
    bass: [{ line: 'r..r......r..f..', l: 2.2 }, { line: '...r...r..r...o.', l: 1.6 }, { line: 'r.....r...r..r..', l: 2.5 }],
    bassSound: ['deepBass', 'bassSub'],
    chords: [{ mode: 'stab', steps: '...x......x.....', len: 3 }, { mode: 'stab', steps: '..x....x..x.....', len: 2.5 }, { mode: 'stab', steps: 'x.....x.....x...', len: 4 }],
    chordSound: ['deepRhodes', 'keys'],
    arp: [{ mode: 'up', rate: '8', oct: 2, gate: 'x...x...x.x.....' }, { mode: 'name', rate: 'tr', oct: 1, gate: 'x..x..x.......x.' }],
    arpSound: ['marimba', 'pluck'],
    mel: { style: 'sparse', sound: ['flute', 'keys'] },
    ins: { chords: { chorus: 0.45, lp: 5000 }, bass: { lp: 650 }, melody: { chorus: 0.3 }, arp: { lp: 6000 } },
    groove: { hat: gr([0, 0.06, 0.04, 0.1]), perc: gr([0, 0.07, 0.04, 0.1]), clap: gr([0, 0, 0.06, 0]) },
    fx: { revSize: 0.78, revDamp: 0.55, revRet: 0.85, dlyFb: 0.4, dlyRet: 0.6, duck: 0.3 },
    mix: { arp: { vol: 0.35, rev: 0.4, dly: 0.3, duck: 0.3 }, chords: { vol: 0.62, rev: 0.35, dly: 0.15, duck: 0.35 }, melody: { vol: 0.48, rev: 0.4, dly: 0.25, duck: 0.3 }, bass: { vol: 0.8, rev: 0, dly: 0, duck: 0.4 } },
  },
  /* Melodic Techno: 122-126, menor y oscuro, pad largo, bajo rolling con reese, arpegio de acorde con pluck oscuro,
     melodía de notas largas y mucha reverb y delay. */
  melodic: {
    name: 'Melodic Techno', bpm: [122, 126], swing: [0, 0], kit: ['melodic'],
    harm: { mode: 'min', ext: 0, tpl: { min: [[0, 5, 3, 6], [0, 2, 6, 5], [0, 0, 5, 5], [0, 6, 5, 4], [0, 3, 0, 5]] } },
    drums: [
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '................', perc: '...x..x....x..g.' },
      { kick: 'X...x...X...x...', clap: '............x...', hat: 'g.x.g.x.g.x.g.x.', open: '..............g.', perc: 'g..x..g..x..g.x.' },
      { kick: 'X...x...X...x...', clap: '....g.......x...', hat: '..xg..xg..xg..xg', open: '................', perc: '..g...x...g...x.' },
    ],
    clap: ['clap', 'rim', 'snareSoft'], perc: ['clave', 'rim', 'shaker', 'tomM'], kick: { pitch: -1, decay: 0.9 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.7 }, { line: '..rr..rr..rr..rr', l: 0.8 }, { line: '.rr..rr..rr..rro', l: 0.7 }],
    bassSound: ['reese', 'bassSaw'],
    chords: [{ mode: 'pad' }, { mode: 'pad' }, { mode: 'gate', steps: 'x.......x.......', len: 6 }],
    chordSound: ['dark', 'strings', 'choir'],
    arp: [{ mode: 'chord', rate: '16', oct: 2 }, { mode: 'chordpp', rate: '16', oct: 2 }, { mode: 'up', rate: '16', oct: 2 }],
    arpSound: ['melodicPluck', 'pluck'],
    mel: { style: 'long', sound: ['lead', 'glass'] },
    ins: { arp: { hp: 220, drive: 0.2 }, chords: { hp: 160, chorus: 0.4 }, bass: { drive: 0.3, lp: 750 }, melody: { drive: 0.2, chorus: 0.25 } },
    groove: { perc: gr([0, 0.04, 0.02, 0.05]) },
    fx: { revSize: 0.92, revDamp: 0.3, revRet: 1, dlyFb: 0.5, dlyRet: 0.75, duck: 0.55 },
    mix: { arp: { vol: 0.45, rev: 0.45, dly: 0.4, duck: 0.5 }, chords: { vol: 0.62, rev: 0.5, dly: 0.1, duck: 0.6 }, melody: { vol: 0.45, rev: 0.5, dly: 0.35, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.7 } },
  },
  /* Progressive: 122-126, armonía del nombre (mayor o menor), plucks que dibujan las letras, bajo a contratiempo,
     pad de cuerdas y percusión suave. */
  prog: {
    name: 'Progressive', bpm: [122, 126], swing: [0, 0.05], kit: ['prog'],
    harm: { ext: 0 },
    drums: [
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '................', perc: 'gggxgggxgggxgggx' },
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.', open: '..............x.', perc: '...x..x....x..x.' },
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '......g.......g.', perc: 'g.g.g.g.g.g.g.g.' },
    ],
    clap: ['clap', 'snareSoft'], perc: ['shaker', 'rim', 'clave'], kick: { pitch: 0, decay: 0.8 },
    bass: [{ line: '..r...r...r...r.', l: 0.9 }, { line: '..rr..rr..rr..rr', l: 0.7 }, { line: '..r..rr...r..ro.', l: 0.8 }],
    bassSound: ['bassSaw', 'pluckBass'],
    chords: [{ mode: 'pad' }, { mode: 'stab', steps: '..x.....x.....x.', len: 2 }],
    chordSound: ['strings', 'glass', 'airy'],
    arp: [{ mode: 'name', rate: '16', oct: 2 }, { mode: 'mirror', rate: '16', oct: 2 }, { mode: 'name', rate: 'tr', oct: 2 }],
    arpSound: ['progPluck', 'pluck', 'marimba'],
    mel: { style: 'qa', sound: ['lead', 'pluckHi'] },
    ins: { arp: { hp: 260, chorus: 0.2 }, chords: { hp: 200, chorus: 0.4 }, bass: { drive: 0.15, hp: 35 }, melody: { chorus: 0.2 } },
    groove: { hat: gr([0, 0.02, 0.01, 0.03]), perc: gr([0, 0.03, 0.01, 0.04]) },
    fx: { revSize: 0.82, revDamp: 0.35, revRet: 0.9, dlyFb: 0.42, dlyRet: 0.7, duck: 0.4 },
    mix: { arp: { vol: 0.5, rev: 0.4, dly: 0.35, duck: 0.45 }, chords: { vol: 0.65, rev: 0.45, dly: 0.05, duck: 0.5 }, melody: { vol: 0.6, rev: 0.35, dly: 0.25, duck: 0.35 }, bass: { vol: 0.85, rev: 0, dly: 0, duck: 0.55 } },
  },
};

/* estilos de melodía: ritmos del motivo, ritmos de cierre, registro y forma ('qa' = pregunta y respuesta, 'hook' = gancho repetido) */
type Rh = [number, number][];
export const MEL_STYLES: Record<string, { rh: Rh[]; cad: Rh[]; lo: number; hi: number; form: 'qa' | 'hook' }> = {
  qa: { lo: 62, hi: 81, form: 'qa',
    rh: [[[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]], [[0, 3], [3, 3], [6, 2], [8, 4], [14, 2]], [[0, 2], [4, 2], [6, 2], [8, 2], [10, 6]], [[2, 2], [4, 2], [6, 4], [12, 2], [14, 2]], [[0, 4], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 6], [6, 2], [8, 6], [14, 2]]],
    cad: [[[0, 2], [2, 2], [4, 2], [6, 10]], [[0, 4], [4, 4], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 3], [3, 3], [6, 2], [8, 8]]] },
  /* himno de trance: corcheas y el clásico 3-3-2, registro alto */
  anthem: { lo: 67, hi: 88, form: 'qa',
    rh: [[[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], [[0, 2], [2, 1], [3, 3], [6, 2], [8, 2], [10, 1], [11, 3], [14, 2]], [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4]]],
    cad: [[[0, 3], [3, 3], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]], [[0, 3], [3, 3], [6, 10]]] },
  /* techno: gancho corto y repetido, notas secas */
  hook: { lo: 60, hi: 76, form: 'hook',
    rh: [[[0, 1], [3, 1], [6, 1], [10, 1], [12, 1]], [[0, 1], [2, 1], [6, 1], [8, 1], [11, 1], [14, 1]], [[0, 1], [3, 1], [6, 2], [11, 1], [14, 1]], [[2, 1], [3, 1], [6, 1], [10, 1], [11, 1], [14, 1]]],
    cad: [[[0, 1], [3, 1], [6, 1], [8, 2], [12, 1]], [[0, 1], [3, 1], [6, 1], [10, 2]]] },
  /* house: sincopado, entra a contratiempo */
  house: { lo: 64, hi: 83, form: 'qa',
    rh: [[[0, 2], [3, 2], [6, 1], [8, 2], [11, 2], [14, 2]], [[2, 2], [6, 2], [10, 1], [11, 3], [14, 2]], [[0, 1], [3, 1], [6, 2], [10, 2], [13, 3]], [[3, 2], [6, 2], [8, 1], [11, 3], [14, 2]]],
    cad: [[[0, 2], [3, 2], [6, 10]], [[3, 3], [6, 2], [8, 8]]] },
  /* deep: pocas notas, mucho aire */
  sparse: { lo: 62, hi: 79, form: 'qa',
    rh: [[[0, 6], [8, 4], [14, 2]], [[2, 4], [8, 8]], [[0, 3], [6, 6], [14, 2]], [[3, 3], [10, 6]]],
    cad: [[[0, 4], [8, 8]], [[2, 4], [6, 10]]] },
  /* melodic techno: notas largas que flotan arriba de todo */
  long: { lo: 64, hi: 84, form: 'qa',
    rh: [[[0, 4], [4, 4], [8, 8]], [[0, 6], [6, 2], [8, 8]], [[0, 2], [2, 6], [8, 4], [12, 4]], [[0, 8], [8, 4], [12, 4]]],
    cad: [[[0, 4], [4, 12]], [[0, 8], [8, 8]]] },
};

/* pesos para elegir el género cuando se genera desde el nombre */
export const GENRE_WEIGHTS: Record<string, number> = { prog: 3, melodic: 3, deep: 2, house: 2, trance: 2, techno: 2 };

export const parseDrum = (s: string) => [...s].map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : c === 'g' ? 3 : 0));
const OFF: Record<string, number> = { r: 0, R: 0, o: 12, f: 7, s: 10, b: -12 };
export const parseBass = (s: string) => ({ steps: [...s].map((c) => (c === '.' ? 0 : c === 'R' ? 2 : 1)), line: [...s].map((c) => OFF[c] ?? 0) });
export const parseGate = (s: string) => [...s].map((c) => c !== '.');
