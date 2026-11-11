/* Recetas de producción por género.
   Cada género define tempo, armonía (modo, progresiones típicas, extensiones), batería con acentos y golpes suaves,
   línea de bajo, forma de tocar los acordes, arpegio, estilo de melodía, sonidos, efectos y sidechain.
   Las listas son alternativas: el nombre elige una con su semilla (mismo nombre + mismo género = mismo loop).
   Cada género tiene estilos inspirados en cómo producen ciertos artistas (tempo, batería, bajo, sonidos, armonía, espacio).
   Son referencias de producción: no se copian melodías, temas ni samples de nadie.

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
  styles: Record<string, Style>;
};
/* un estilo de artista pisa solo los campos que cambia respecto de la receta base del género */
export type Style = Partial<Omit<Genre, 'name' | 'styles'>> & { name: string; mixOver?: Partial<Genre['mix']> };
export const styleOf = (g: string, st?: string) => { const G = GENRES[g]; const S = (st && G.styles[st]) || ({} as Style); return { ...G, ...S, name: G.name, styleName: S.name, mix: { ...G.mix, ...(S.mixOver ?? {}) } } as Genre & { styleName?: string }; };

export const GENRES: Record<string, Genre> = {
  /* Trance: 136-140, menor, VI–VII–i, bajo rolling entre bombos, pad con gate, arpegio por el acorde, lead de himno. */
  trance: {
    name: 'Trance', bpm: [136, 140], swing: [0, 0], kit: ['tr909h', 'tr909'],
    harm: { mode: 'min', ext: -1, tpl: { min: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 5, 6], [0, 5, 6, 4], [0, 6, 5, 6]] } },
    drums: [
      { kick: 'X...x...X...x...', clap: '....X.......X...', hat: 'g.g.g.g.g.g.g.g.', open: '..X...X...X...X.', perc: '...............g' },
      { kick: 'X...x...X...x...', clap: '....X.......X...', hat: 'gggxgggxgggxgggx', open: '..X...X...X...X.', perc: '..x...x...x...x.' },
      { kick: 'X...x...X...x...', clap: '....X.......X..g', hat: 'g.x.g.x.g.x.g.x.', open: '..X...X...X...X.', perc: '....x.......x...' },
    ],
    clap: ['clap'], perc: ['ride', 'rim', 'snare'], kick: { pitch: 0, decay: 0.55 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.6 }, { line: '.rro.rro.rro.rro', l: 0.6 }, { line: '.Rrr.Rrr.Rrr.Rrr', l: 0.55 }],
    bassSound: ['tranceBass'],
    chords: [{ mode: 'gate', steps: 'x.xx.xx.x.xx.xx.', len: 0.8 }, { mode: 'gate', steps: 'xx.xx.xx.xx.xx.x', len: 0.8 }, { mode: 'gate', steps: 'x.x.x.x.x.x.x.x.', len: 1.2 }],
    chordSound: ['tranceGate'],
    arp: [{ mode: 'chord', rate: '16', oct: 2 }, { mode: 'chordpp', rate: '16', oct: 2 }, { mode: 'chord', rate: '16', oct: 3 }],
    arpSound: ['trancePluck'],
    mel: { style: 'anthem', sound: ['tranceLead'] },
    fx: { revSize: 0.9, revDamp: 0.25, revRet: 0.95, dlyFb: 0.45, dlyRet: 0.7, duck: 0.5 },
    mix: { arp: { vol: 0.55, rev: 0.4, dly: 0.35, duck: 0.55 }, chords: { vol: 0.6, rev: 0.35, dly: 0.1, duck: 0.7 }, melody: { vol: 0.5, rev: 0.45, dly: 0.3, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.8 } },
    styles: {
      /* uplifting de estadio: supersaw enorme, gate apretado, rolling bass, lead arriba de todo */
      armin: { name: 'Armin van Buuren', bpm: [138, 140], kit: ['tr909h'],
        chords: [{ mode: 'gate', steps: 'x.xx.xx.x.xx.xx.', len: 0.8 }, { mode: 'gate', steps: 'xx.xx.xx.xx.xx.x', len: 0.7 }],
        mel: { style: 'anthem', sound: ['tranceLead', 'super'] } },
      /* emotivo y épico: cuerdas, arpegio de ida y vuelta en 3 octavas, progresiones que suben a VI–VII */
      alyfila: { name: 'Aly & Fila', bpm: [136, 138], harm: { mode: 'min', ext: -1, tpl: { min: [[0, 5, 6, 4], [5, 6, 0, 0], [0, 5, 2, 6], [0, 3, 5, 6]] } },
        chords: [{ mode: 'pad' }, { mode: 'gate', steps: 'x.x.x.x.x.x.x.x.', len: 1.2 }], chordSound: ['strings', 'tranceGate'],
        arp: [{ mode: 'chordpp', rate: '16', oct: 3 }, { mode: 'chord', rate: '16', oct: 3 }], mel: { style: 'anthem', sound: ['tranceLead', 'lead'] },
        fx: { revSize: 0.95, revDamp: 0.2, revRet: 1, dlyFb: 0.5, dlyRet: 0.75, duck: 0.5 } },
      /* Anjunabeats: más lento y cálido, piano y plucks, bajo a contratiempo con octavas, menos rolling */
      abgt: { name: 'Above & Beyond', bpm: [130, 134], kit: ['tr909'], harm: { mode: 'min', ext: 0, tpl: { min: [[5, 2, 6, 0], [0, 5, 2, 6], [5, 6, 2, 0], [0, 2, 6, 5]] } },
        bass: [{ line: '..r.o.r...r.o.r.', l: 0.8 }, { line: '.rr..rr..rr..ro.', l: 0.7 }],
        chords: [{ mode: 'stab', steps: 'x.....x.....x...', len: 4 }, { mode: 'pad' }], chordSound: ['housePiano', 'strings'],
        arp: [{ mode: 'chord', rate: '8', oct: 2 }, { mode: 'up', rate: '16', oct: 2 }], arpSound: ['pluck', 'trancePluck'], mel: { style: 'qa', sound: ['lead', 'housePiano'] },
        mixOver: { bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.55 }, chords: { vol: 0.55, rev: 0.4, dly: 0.12, duck: 0.45 } } },
    },
  },
  /* Psytrance: 140-145, menor sobre una sola nota (pedal), bajo K-B-B-B en semicorcheas cortísimas,
     bombo seco, hats en semicorcheas, lead acid chirriante y efectos con delay. */
  psy: {
    name: 'Psytrance', bpm: [142, 145], swing: [0, 0], kit: ['tr909h'],
    harm: { mode: 'min', ext: -1, tpl: { min: [[0, 0, 0, 0], [0, 0, 0, 6], [0, 0, 5, 0]] } },
    drums: [
      { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'gxXxgxXxgxXxgxXx', open: '..X...X...X...X.', perc: '.......x.......x' },
      { kick: 'X...X...X...X...', clap: '............x...', hat: 'xgXgxgXgxgXgxgXg', open: '..X...X...X...X.', perc: '...x...x...x..xx' },
    ],
    clap: ['clap', 'snare'], perc: ['rim', 'tomH', 'clave'], kick: { pitch: 1, decay: 0.38 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.45 }, { line: '.Rrr.Rrr.Rrr.Rrr', l: 0.42 }],
    bassSound: ['psyBass'],
    chords: [{ mode: 'stab', steps: '..............x.', len: 1 }, { mode: 'pad' }],
    chordSound: ['dark', 'techStab'],
    arp: [{ mode: 'acid', rate: '16', oct: 2 }],
    arpSound: ['psyAcid'],
    mel: { style: 'psy', sound: ['psyLead', 'pluckHi'] },
    fx: { revSize: 0.7, revDamp: 0.4, revRet: 0.7, dlyFb: 0.55, dlyRet: 0.8, duck: 0.3 },
    mix: { arp: { vol: 0.5, rev: 0.15, dly: 0.35, duck: 0.35 }, chords: { vol: 0.32, rev: 0.4, dly: 0.3, duck: 0.4 }, melody: { vol: 0.55, rev: 0.3, dly: 0.35, duck: 0.3 }, bass: { vol: 0.8, rev: 0, dly: 0, duck: 0.25 } },
    styles: {
      /* full-on: 145, bajo agresivo, acid al frente, lead en semicorcheas */
      astrix: { name: 'Astrix', bpm: [144, 146] },
      /* progressive psy: 136-138, más groove y profundidad, plucks, menos ácido, más espacio */
      ace: { name: 'Ace Ventura', bpm: [136, 138], kit: ['tr909h', 'tr909'],
        drums: [{ kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.', open: '..x...x...x...x.', perc: 'gg.xgg.xgg.xgg.x' }, { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'ggxgggxgggxgggxg', open: '..x...x...x...x.', perc: '...x..x....x..x.' }],
        arp: [{ mode: 'chordpp', rate: '16', oct: 2 }, { mode: 'acid', rate: '16', oct: 2 }], arpSound: ['melodicPluck', 'psyAcid'],
        chords: [{ mode: 'pad' }], chordSound: ['airy', 'dark'], mel: { style: 'hook', sound: ['pluckHi', 'bell'] },
        fx: { revSize: 0.85, revDamp: 0.35, revRet: 0.9, dlyFb: 0.5, dlyRet: 0.75, duck: 0.35 } },
    },
  },
  /* Techno: menor, acorde fijo (vamp), bombo largo, hats con acentos, acid, stab con dub delay, sub. */
  techno: {
    name: 'Techno', bpm: [130, 134], swing: [0, 0.06], kit: ['tr909h'],
    harm: { mode: 'min', ext: 7, tpl: { min: [[0, 0, 0, 0], [0, 0, 5, 6], [0, 0, 3, 3], [0, 0, 0, 6]] } },
    drums: [
      { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'ggXgggXgggXgggXg', open: '..x...x...x...x.', perc: '...x..x....x..x.' },
      { kick: 'X...X...X...X..g', clap: '............x...', hat: 'gXgggXgggXgggXgg', open: '..x...x...x...x.', perc: '..x..x.x..x..x..' },
      { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'xgXgxgXgxgXgxgXg', open: '..X.......X.....', perc: '.x..x.x..x..x.x.' },
    ],
    clap: ['clap', 'rim2'], perc: ['rim', 'tomL', 'conga', 'ride'], kick: { pitch: -2, decay: 1 },
    bass: [{ line: '..r...r...r...r.', l: 1.4 }, { line: '.rr..rr..rr..rr.', l: 0.7 }, { line: '..rr..rr..rr..rr', l: 0.8 }],
    bassSound: ['technoSub'],
    chords: [{ mode: 'stab', steps: '...x......x.....', len: 1 }, { mode: 'stab', steps: '..x.....x..x....', len: 1 }, { mode: 'stab', steps: '.......x.......x', len: 1 }],
    chordSound: ['techStab'],
    arp: [{ mode: 'acid', rate: '16', oct: 2 }],
    arpSound: ['acid303'],
    mel: { style: 'hook', sound: ['pluckHi', 'chip'] },
    fx: { revSize: 0.75, revDamp: 0.45, revRet: 0.8, dlyFb: 0.58, dlyRet: 0.8, duck: 0.45 },
    mix: { arp: { vol: 0.5, rev: 0.12, dly: 0.25, duck: 0.5 }, chords: { vol: 0.5, rev: 0.3, dly: 0.55, duck: 0.5 }, melody: { vol: 0.5, rev: 0.25, dly: 0.35, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.6 } },
    styles: {
      /* minimal: 126-130, mucho espacio, rims y claves secos, acid, casi sin acordes, delay largo */
      hawtin: { name: 'Richie Hawtin', bpm: [126, 130], kit: ['tr808', 'tr909'],
        drums: [{ kick: 'X...X...X...X...', clap: '................', hat: '..x...x...x...x.', open: '................', perc: '...x..x..x....x.' }, { kick: 'X...X...X...X...', clap: '.......g........', hat: 'g.x.g.x.g.x.g.x.', open: '................', perc: '.x...x.x..x...x.' }],
        clap: ['rim', 'clave'], perc: ['clave', 'rim', 'tomM'], kick: { pitch: -1, decay: 0.7 },
        bass: [{ line: '..r.......r.....', l: 2 }, { line: '...r......r..r..', l: 1.2 }],
        chords: [{ mode: 'stab', steps: '...........x....', len: 0.8 }], arp: [{ mode: 'acid', rate: '16', oct: 2 }],
        fx: { revSize: 0.6, revDamp: 0.5, revRet: 0.6, dlyFb: 0.65, dlyRet: 0.85, duck: 0.3 },
        mixOver: { chords: { vol: 0.4, rev: 0.2, dly: 0.7, duck: 0.3 }, arp: { vol: 0.55, rev: 0.1, dly: 0.35, duck: 0.4 } } },
      /* Drumcode, peak time: 132-134, percusión que empuja, ride, rumble, stab hipnótico */
      beyer: { name: 'Adam Beyer', bpm: [132, 134],
        drums: [{ kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'ggXgggXgggXgggXg', open: '..x...x...x...x.', perc: 'g.x.g.x.g.x.g.x.' }, { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'xgXgxgXgxgXgxgXg', open: '..X...X...X...X.', perc: '..x.x..x..x.x..x' }],
        perc: ['ride', 'tomL'], bass: [{ line: '.rr..rr..rr..rr.', l: 0.7 }, { line: '..rr..rr..rr..rr', l: 0.8 }],
        chords: [{ mode: 'stab', steps: '..x.....x..x....', len: 1 }, { mode: 'stab', steps: '...x..x...x..x..', len: 1 }], arp: [{ mode: 'jump', rate: '16', oct: 2, gate: 'x.xx.xx.x.xx.x.x' }, { mode: 'acid', rate: '16', oct: 2 }], arpSound: ['techStab', 'acid303'] },
      /* groove de rave: 128-132, toms y congas, bajo con octavas, stab que salta, más swing */
      skils: { name: 'Bart Skils', bpm: [128, 132], swing: [0.06, 0.12],
        drums: [{ kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'ggxgggxgggxgggxg', open: '..x...x...x...x.', perc: '..x..x....x.x..x' }, { kick: 'X...X...X...X...', clap: '....x.......x.g.', hat: 'g.x.g.x.g.x.g.x.', open: '..x...x...x...x.', perc: 'x..x..x...x..x..' }],
        perc: ['conga', 'tomM', 'tomL'], bass: [{ line: '..ro..r...ro..r.', l: 0.7 }, { line: '..r..ro...r..ro.', l: 0.7 }],
        chords: [{ mode: 'stab', steps: '..x..x....x..x..', len: 1 }], mel: { style: 'hook', sound: ['pluckHi', 'organ'] } },
    },
  },
  /* Tech House: 124-128 con swing, bajo protagonista y saltarín, batería con mucho groove, stabs y órgano. */
  techhouse: {
    name: 'Tech House', bpm: [124, 127], swing: [0.12, 0.22], kit: ['tr909'],
    harm: { mode: 'min', ext: 7, tpl: { min: [[0, 0, 3, 3], [0, 0, 0, 0], [0, 6, 0, 6], [0, 3, 0, 6]] } },
    drums: [
      { kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'ggxgggxgggxgggxg', open: '..X...X...X...X.', perc: 'x..x..x...x..x..' },
      { kick: 'X...X...X...X...', clap: '....X.......X.g.', hat: 'g.x.g.x.g.x.g.x.', open: '..X...X...X...X.', perc: 'gxgxgxgxgxgxgxgx' },
    ],
    clap: ['clap'], perc: ['shaker', 'conga', 'tamb'], kick: { pitch: -1, decay: 0.85 },
    bass: [{ line: '..rr..ro..rr..rf', l: 0.6 }, { line: '.rr..ro..rr..ro.', l: 0.55 }, { line: '..r.or..r..r.or.', l: 0.6 }],
    bassSound: ['techHouseBass'],
    chords: [{ mode: 'stab', steps: '..x....x..x.....', len: 1 }, { mode: 'stab', steps: '...x......x..x..', len: 1 }],
    chordSound: ['techStab', 'organ'],
    arp: [{ mode: 'name', rate: '8', oct: 1, gate: 'x.x...x.x.x...x.' }],
    arpSound: ['organ', 'pluckHi'],
    mel: { style: 'house', sound: ['organ', 'pluckHi'] },
    fx: { revSize: 0.6, revDamp: 0.45, revRet: 0.7, dlyFb: 0.42, dlyRet: 0.6, duck: 0.3 },
    mix: { arp: { vol: 0.4, rev: 0.15, dly: 0.2, duck: 0.3 }, chords: { vol: 0.5, rev: 0.2, dly: 0.35, duck: 0.35 }, melody: { vol: 0.45, rev: 0.2, dly: 0.25, duck: 0.3 }, bass: { vol: 0.82, rev: 0, dly: 0, duck: 0.45 } },
    styles: {
      /* groove orgánico y cálido: mucho swing, congas y pandereta, órgano y keys, séptimas */
      anotr: { name: 'ANOTR', bpm: [124, 126], swing: [0.25, 0.32], harm: { ext: 7, tpl: { maj: [[1, 4, 0, 0], [0, 3, 1, 4], [0, 5, 1, 4]], min: [[0, 3, 0, 3], [0, 3, 6, 2], [0, 6, 5, 6]] } },
        drums: [{ kick: 'X...X...X...X...', clap: '....X.......X...', hat: 'g.xgg.xgg.xgg.xg', open: '..x...x...x...x.', perc: 'x.gx..x.g.x..xg.' }, { kick: 'X...X...X...X...', clap: '....X..g....X...', hat: 'ggxgggxgggxgggxg', open: '..x...x...x...x.', perc: 'gxgxgxgxgxgxgxgx' }],
        perc: ['conga', 'tamb'], bass: [{ line: '..ro..r...ro..f.', l: 0.7 }, { line: '...r..o...r..fo.', l: 0.7 }], bassSound: ['houseBass'],
        chords: [{ mode: 'stab', steps: '..x..x....x..x..', len: 1.5 }, { mode: 'stab', steps: '...x..x...x..x..', len: 1.5 }], chordSound: ['housePiano', 'organ'],
        mel: { style: 'house', sound: ['housePiano', 'organ'] } },
      /* minimal holandés: bajo rolling, hats shuffle, acorde dub con mucho delay, poco más */
      stussy: { name: 'Chris Stussy', bpm: [127, 129], swing: [0.18, 0.24],
        drums: [{ kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'xgxgxgxgxgxgxgxg', open: '..x...x...x...x.', perc: '...x..x....x..g.' }, { kick: 'X...X...X...X...', clap: '....x.......x...', hat: 'g.xgg.xgg.xgg.xg', open: '..x...x...x...x.', perc: '.g.x.g.x.g.x.g.x' }],
        perc: ['rim', 'shaker'], bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.55 }, { line: '..rr.rr...rr.rr.', l: 0.55 }],
        chords: [{ mode: 'stab', steps: '...x.......x....', len: 1.2 }], chordSound: ['techStab', 'deepRhodes'],
        mixOver: { chords: { vol: 0.45, rev: 0.3, dly: 0.6, duck: 0.4 } } },
      /* bajo enorme que rebota, bombo pesado, casi todo pasa por el bajo y un gancho corto */
      maup: { name: 'Mau P', bpm: [126, 128], swing: [0.06, 0.12],
        bass: [{ line: 'rRrrrRrrrRrrrRro', l: 0.5 }, { line: '.RrR.Rro.RrR.Rrf', l: 0.5 }], bassSound: ['mauBass'],
        chords: [{ mode: 'stab', steps: '..............x.', len: 1 }], mel: { style: 'hook', sound: ['pluckHi', 'chip'] },
        mixOver: { bass: { vol: 0.85, rev: 0, dly: 0, duck: 0.55 }, chords: { vol: 0.35, rev: 0.2, dly: 0.4, duck: 0.4 } } },
    },
  },
  /* Melodic Techno: menor y oscuro, pad largo, bajo rolling, arpegio de acorde, melodía larga, mucho espacio. */
  melodic: {
    name: 'Melodic Techno', bpm: [122, 126], swing: [0, 0], kit: ['tr909', 'tr909h'],
    harm: { mode: 'min', ext: 0, tpl: { min: [[0, 5, 3, 6], [0, 2, 6, 5], [0, 0, 5, 5], [0, 6, 5, 4], [0, 3, 0, 5]] } },
    drums: [
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '................', perc: '...x..x....x..g.' },
      { kick: 'X...x...X...x...', clap: '............x...', hat: 'g.x.g.x.g.x.g.x.', open: '..............g.', perc: 'g..x..g..x..g.x.' },
      { kick: 'X...x...X...x...', clap: '....g.......x...', hat: '..xg..xg..xg..xg', open: '................', perc: '..g...x...g...x.' },
    ],
    clap: ['clap', 'rim', 'snareSoft'], perc: ['clave', 'rim', 'shaker', 'tomM'], kick: { pitch: -1, decay: 0.9 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.7 }, { line: '..rr..rr..rr..rr', l: 0.8 }, { line: '.rr..rr..rr..rro', l: 0.7 }],
    bassSound: ['reese', 'bassSaw'],
    chords: [{ mode: 'pad' }, { mode: 'gate', steps: 'x.......x.......', len: 6 }],
    chordSound: ['dark', 'strings', 'choir'],
    arp: [{ mode: 'chord', rate: '16', oct: 2 }, { mode: 'chordpp', rate: '16', oct: 2 }],
    arpSound: ['melodicPluck', 'pluck'],
    mel: { style: 'long', sound: ['lead', 'bell', 'glass'] },
    fx: { revSize: 0.92, revDamp: 0.3, revRet: 1, dlyFb: 0.5, dlyRet: 0.75, duck: 0.55 },
    mix: { arp: { vol: 0.45, rev: 0.45, dly: 0.4, duck: 0.5 }, chords: { vol: 0.55, rev: 0.5, dly: 0.1, duck: 0.6 }, melody: { vol: 0.45, rev: 0.5, dly: 0.35, duck: 0.4 }, bass: { vol: 0.72, rev: 0, dly: 0, duck: 0.7 } },
    styles: {
      /* cinematográfico: arpegio grande al frente, lead filoso de ciencia ficción, i–VI–III–VII */
      anyma: { name: 'Anyma', bpm: [123, 125], harm: { mode: 'min', ext: -1, tpl: { min: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 5, 6, 4]] } },
        arp: [{ mode: 'chord', rate: '16', oct: 3 }, { mode: 'chordpp', rate: '16', oct: 2 }], arpSound: ['anymaArp'],
        chordSound: ['dark', 'strings'], mel: { style: 'anthem', sound: ['anymaLead'] },
        mixOver: { arp: { vol: 0.58, rev: 0.4, dly: 0.35, duck: 0.55 }, melody: { vol: 0.48, rev: 0.45, dly: 0.35, duck: 0.4 } } },
      /* oscuro y emotivo: más lento, menos notas, campanas y pad, mucho aire y reverb */
      taleofus: { name: 'Tale Of Us', bpm: [120, 123], kit: ['tr909', 'tr808'],
        drums: [{ kick: 'X...x...X...x...', clap: '............x...', hat: '..x...x...x...x.', open: '................', perc: '......g.......x.' }, { kick: 'X...x...X...x...', clap: '....g.......x...', hat: 'g.x.g.x.g.x.g.x.', open: '................', perc: '...g......g.....' }],
        bass: [{ line: '..rr..rr..rr..rr', l: 0.9 }, { line: '..r...r...r...r.', l: 1.6 }], bassSound: ['reese'],
        arp: [{ mode: 'up', rate: '8', oct: 2, gate: 'x...x...x.x.....' }, { mode: 'chord', rate: '8', oct: 2 }], arpSound: ['bell', 'melodicPluck'],
        chords: [{ mode: 'pad' }], chordSound: ['dark', 'choir'], mel: { style: 'sparse', sound: ['bell', 'glass', 'flute'] },
        fx: { revSize: 0.95, revDamp: 0.35, revRet: 1.05, dlyFb: 0.55, dlyRet: 0.8, duck: 0.5 } },
    },
  },
  /* Progressive: 120-126, hipnótico y profundo, bajo rolling, pads de aire, plucks que dibujan las letras. */
  prog: {
    name: 'Progressive', bpm: [121, 124], swing: [0, 0.04], kit: ['tr909', 'tr808'],
    harm: { mode: 'min', ext: 0 },
    drums: [
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '................', perc: 'gggxgggxgggxgggx' },
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: 'g.x.g.x.g.x.g.x.', open: '..............x.', perc: '...x..x....x..x.' },
      { kick: 'X...x...X...x...', clap: '....x.......x...', hat: '..x...x...x...x.', open: '......g.......g.', perc: 'g.g.g.g.g.g.g.g.' },
    ],
    clap: ['clap', 'snareSoft'], perc: ['shaker', 'rim', 'clave'], kick: { pitch: 0, decay: 0.8 },
    bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.6 }, { line: '..rr..rr..rr..rr', l: 0.7 }, { line: '..r..rr...r..ro.', l: 0.8 }],
    bassSound: ['bassSaw', 'pluckBass'],
    chords: [{ mode: 'pad' }, { mode: 'stab', steps: '..x.....x.....x.', len: 2 }],
    chordSound: ['airy', 'strings', 'glass'],
    arp: [{ mode: 'name', rate: '16', oct: 2 }, { mode: 'mirror', rate: '16', oct: 2 }, { mode: 'name', rate: 'tr', oct: 2 }],
    arpSound: ['progPluck', 'pluck'],
    mel: { style: 'qa', sound: ['lead', 'pluckHi', 'bell'] },
    fx: { revSize: 0.85, revDamp: 0.35, revRet: 0.9, dlyFb: 0.48, dlyRet: 0.72, duck: 0.4 },
    mix: { arp: { vol: 0.5, rev: 0.4, dly: 0.38, duck: 0.45 }, chords: { vol: 0.55, rev: 0.45, dly: 0.05, duck: 0.5 }, melody: { vol: 0.55, rev: 0.35, dly: 0.3, duck: 0.35 }, bass: { vol: 0.75, rev: 0, dly: 0, duck: 0.55 } },
    styles: {
      /* deep progressive: hipnótico, bajo rolling oscuro, pad de aire, pluck que gira, melodía mínima */
      cattaneo: { name: 'Hernán Cattaneo', bpm: [120, 122], kit: ['tr909'],
        bass: [{ line: '.rrr.rrr.rrr.rrr', l: 0.6 }, { line: '.rr..rr..rr..rro', l: 0.6 }], bassSound: ['reese', 'bassSaw'],
        chords: [{ mode: 'pad' }], chordSound: ['airy', 'dark'], arp: [{ mode: 'name', rate: '16', oct: 2 }, { mode: 'mirror', rate: '16', oct: 2 }], arpSound: ['progPluck', 'melodicPluck'],
        mel: { style: 'sparse', sound: ['bell', 'glass'] }, fx: { revSize: 0.9, revDamp: 0.4, revRet: 0.95, dlyFb: 0.55, dlyRet: 0.78, duck: 0.45 },
        mixOver: { melody: { vol: 0.45, rev: 0.5, dly: 0.4, duck: 0.35 } } },
      /* melódico y emotivo: arpegios que siguen el acorde, lead que canta, armonía más luminosa */
      guyj: { name: 'Guy J', bpm: [122, 124], harm: { ext: 0, tpl: { min: [[0, 5, 2, 6], [0, 2, 5, 6], [5, 2, 6, 0]], maj: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4]] } },
        chords: [{ mode: 'pad' }, { mode: 'stab', steps: '..x.....x.....x.', len: 2 }], chordSound: ['strings', 'glass'],
        arp: [{ mode: 'chordpp', rate: '16', oct: 2 }, { mode: 'chord', rate: 'tr', oct: 2 }], arpSound: ['pluck', 'progPluck'],
        mel: { style: 'qa', sound: ['lead', 'pluckHi'] } },
    },
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
  /* psy: riff en semicorcheas, repetitivo y agudo */
  psy: { lo: 62, hi: 79, form: 'hook',
    rh: [[[0, 1], [1, 1], [3, 1], [4, 1], [6, 1], [8, 1], [9, 1], [11, 1], [12, 1], [14, 1]], [[0, 1], [2, 1], [3, 1], [6, 1], [7, 1], [10, 1], [12, 1], [13, 1]], [[1, 1], [2, 1], [4, 1], [5, 1], [8, 1], [10, 1], [11, 1], [14, 1]]],
    cad: [[[0, 1], [1, 1], [3, 1], [4, 1], [6, 1], [8, 4], [12, 1], [14, 1]]] },
  long: { lo: 64, hi: 84, form: 'qa',
    rh: [[[0, 4], [4, 4], [8, 8]], [[0, 6], [6, 2], [8, 8]], [[0, 2], [2, 6], [8, 4], [12, 4]], [[0, 8], [8, 4], [12, 4]]],
    cad: [[[0, 4], [4, 12]], [[0, 8], [8, 8]]] },
};

/* pesos para elegir el género cuando se genera desde el nombre */
export const GENRE_WEIGHTS: Record<string, number> = { prog: 3, melodic: 3, trance: 2, techno: 2, techhouse: 2, psy: 2 };

export const parseDrum = (s: string) => [...s].map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : c === 'g' ? 3 : 0));
const OFF: Record<string, number> = { r: 0, R: 0, o: 12, f: 7, s: 10, b: -12 };
export const parseBass = (s: string) => ({ steps: [...s].map((c) => (c === '.' ? 0 : c === 'R' ? 2 : 1)), line: [...s].map((c) => OFF[c] ?? 0) });
export const parseGate = (s: string) => [...s].map((c) => c !== '.');
