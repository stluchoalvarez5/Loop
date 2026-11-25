/* Generar un loop a partir de una descripción ("house estilo New Order, oscuro y bailable"). No es IA de verdad: es un intérprete que entiende género, artistas y estilos,
   clima (oscuro, alegre, épico…), tempo (BPM o rápido/lento), tonalidad ("en La menor") y qué instrumentos sumar o sacar, y arma el loop con las recetas de `genres.ts`.
   Gratis, sin conexión y repetible: la misma descripción da siempre el mismo loop (y "Otra versión" cambia la semilla). */
import { GENRES } from './genres';
import { projectFromName, applyHarmony, setSound, PROGS, type Project, type Manual } from './model';

export type Interp = { genre: string; style?: string; bpm?: number; tonic?: number; mode?: 'maj' | 'min'; ext?: number; macros: { energy: number; dark: number; space: number; groove: number }; bass?: string; arpAcid?: boolean; drop: string[]; notes: string[]; known: boolean };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9#.+ ]/g, ' ').replace(/\s+/g, ' ').trim();
/* palabras de género (lo que se pide) y artistas / estilos (cómo debe sonar). El primero que coincide gana: lo específico va antes que lo general.
   Si piden un género Y un artista de otro ("house estilo New Order"), la base es el género y los instrumentos (bajo, acordes, arpegio, melodía) toman el sonido del estilo. */
const GEN: [RegExp, string, string][] = [
  [/hard ?techno|techno duro|hardtechno|rave duro|industrial/, 'hard', 'Hard Techno'],
  [/melodic ?techno|techno melodico/, 'melodic', 'Melodic Techno'],
  [/techno|tecno|minimal/, 'techno', 'Techno'],
  [/trance|psy ?trance|psytrance|goa/, 'trance', 'Trance'],
  [/progresiv|progressive|\bprog\b/, 'prog', 'Progressive'],
  [/deep house|\bdeep\b|soulful|jazzy|lounge/, 'deep', 'Deep House'],
  [/new ?wave|synth ?pop|synthpop|italo|synthwave|ochentas|ochenta|\b80s\b|\b80'?s\b|anos 80/, 'newwave', 'New Wave'],
  [/disco|funk|nu ?disco|boogie/, 'disco', 'Disco'],
  [/chill|lo-?fi|downtempo|trip ?hop|relajad|estudiar|ambient|ambiental|\bcafe\b|sunset|atardecer/, 'downtempo', 'Downtempo'],
  [/electro|robot|breakdance|\bbreak/, 'electro', 'Electro'],
  [/house|club|boliche/, 'house', 'House'],
];
const ART: [RegExp, string, string][] = [
  [/sara landry|i hate models|\bperc\b|hard ?style/, 'hard', 'Hard Techno'],
  [/afterlife|artbat|tale of us|solomun|innellea|massano|stephan bodzin|anyma|camelphat/, 'melodic', 'Melodic Techno'],
  [/carl cox|charlotte de witte|amelie lens|adam beyer|jeff mills|richie hawtin|enrico sangiuliano|berghain|detroit|nina kraviz|boris brejcha/, 'techno', 'Techno'],
  [/armin|paul van dyk|tiesto|ferry corsten|above (and|&) beyond|infected mushroom|astrix|oakenfold/, 'trance', 'Trance'],
  [/deadmau5|eric prydz|sasha|digweed|hernan cattaneo|lane 8|\bbt\b|nick warren/, 'prog', 'Progressive'],
  [/larry heard|kerri chandler|moodymann|disclosure|chicago|boiler room|frankie knuckles/, 'deep', 'Deep House'],
  [/new ?order|depeche|pet shop|human league|erasure|ultravox|duran duran|a-?ha|eurythmics|gary numan|yazoo|tears for fears|\bomd\b|joy division|blue monday|cure/, 'newwave', 'New Order / New Wave'],
  [/daft punk|\bchic\b|earth wind|bee gees|moroder|sister sledge|cassius|bob sinclar|\bsoul\b|jamiroquai|purple disco/, 'disco', 'Disco / funk'],
  [/massive attack|portishead|bonobo|tycho|nujabes|khruangbin|air french/, 'downtempo', 'Downtempo'],
  [/kraftwerk|electro ?funk|egyptian lover|afrika bambaataa|planet rock|mr oizo|justice|vitalic/, 'electro', 'Electro / Kraftwerk'],
  [/fatboy|armand van helden|calvin harris|david guetta|swedish house|avicii|martin garrix|mind against/, 'house', 'House'],
];
const MOODS: [RegExp, string, (I: Interp) => void][] = [
  [/oscur|dark|siniestr|tenebr|sombri|misterios|noir|gotic|nocturn|noche|\bmal(o|a)\b/, 'oscuro', (I) => { I.mode ??= 'min'; I.macros.dark += 0.25; }],
  [/alegr|feliz|luminos|solar|festiv|brillante|positiv|verano|playa|sunny|happy|euforic|divertid/, 'alegre', (I) => { I.mode ??= 'maj'; I.macros.dark -= 0.2; I.macros.energy += 0.1; }],
  [/trist|melancol|nostalg|emotiv|sentimental|lluvia|llorar|dolor/, 'melancólico', (I) => { I.mode ??= 'min'; I.macros.space += 0.15; I.macros.energy -= 0.1; I.ext ??= 7; }],
  [/epic|himno|grandios|cinematogr|emocionante|euforia|apote/, 'épico', (I) => { I.macros.energy += 0.2; I.macros.space += 0.2; }],
  [/hipnot|repetitiv|trance-?like|obsesiv/, 'hipnótico', (I) => { I.macros.energy -= 0.05; I.macros.dark += 0.1; }],
  [/suave|relaj|tranquil|calm|dulce|etere|sereno|pacific/, 'suave', (I) => { I.macros.energy -= 0.25; I.macros.space += 0.2; }],
  [/agresiv|\bduro\b|pesad|potente|brutal|intens|furios|crudo|sucio|salvaje/, 'agresivo', (I) => { I.macros.energy += 0.3; I.macros.dark += 0.1; }],
  [/bailable|fiesta|pista|bailar|dance|energic|explosiv/, 'bailable', (I) => { I.macros.groove += 0.15; I.macros.energy += 0.1; }],
  [/groove|swing|sensual|sexy|funky|latino|tropical/, 'con groove', (I) => { I.macros.groove += 0.3; }],
  [/espacial|amplio|atmosf|cosmic|inmens|flotante|sonador/, 'espacioso', (I) => { I.macros.space += 0.3; }],
  [/\bseco\b|directo|sin reverb|dry/, 'seco', (I) => { I.macros.space -= 0.3; }],
];
const BASS_WORDS: [RegExp, string, string][] = [
  [/acid|303/, 'pro:acidChillon', 'acid'], [/reese/, 'pro:reeseOscuro', 'reese'], [/wobble|dubstep/, 'pro:wobbleLento', 'wobble'],
  [/bajo (sub|profundo|grave)|sub bass|808/, 'pro:sub808Largo', 'sub profundo'], [/moog|analogic/, 'pro:analogCalido', 'analógico'], [/bajo fm|fm bass/, 'pro:fmGrunon', 'FM'],
];
const NOTES: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function interpret(text: string): Interp {
  const t = norm(text), I: Interp = { genre: 'house', macros: { energy: 0, dark: 0, space: 0, groove: 0 }, drop: [], notes: [], known: false };
  const gen = GEN.find(([re]) => re.test(t)), art = ART.find(([re]) => re.test(t));
  if (gen && art && gen[1] !== art[1]) { I.genre = gen[1]; I.style = art[1]; I.known = true; I.notes.push(gen[2] + ' con sonido ' + art[2]); }
  else if (gen || art) { const x = (gen ?? art)!; I.genre = x[1]; I.known = true; I.notes.push(x[2]); }
  const moodsHit: string[] = [];
  for (const [re, label, fn] of MOODS) if (re.test(t)) { fn(I); I.notes.push(label); moodsHit.push(label); }
  if (!I.known) { // sin género: lo elige el clima (y avisa)
    const mg: Record<string, string> = { 'melancólico': 'melodic', 'suave': 'downtempo', 'épico': 'trance', 'agresivo': 'hard', 'alegre': 'house', 'bailable': 'house', 'oscuro': 'techno', 'hipnótico': 'prog', 'con groove': 'disco', 'espacioso': 'melodic' };
    const pick1 = moodsHit.find((m) => mg[m]); I.genre = pick1 ? mg[pick1] : 'house'; I.notes.unshift(pick1 ? 'género elegido por el clima (' + GENRES[I.genre].name + ')' : 'no reconocí un género: probé con House');
  }
  const bpm = t.match(/(\d{2,3}) ?bpm|bpm ?(\d{2,3})/); if (bpm) { const v = +(bpm[1] ?? bpm[2]); if (v >= 60 && v <= 200) { I.bpm = v; } }
  else if (/muy rapid|rapidisim|acelerad/.test(t)) I.macros.energy += 0.1, I.notes.push('tempo muy rápido');
  const key = t.match(/\ben (do|re|mi|fa|sol|la|si)( ?(#|sostenido|b|bemol))?( ?(menor|mayor|m|min|maj))?\b/) ?? t.match(/\b([a-g])( ?(#|b))? ?(minor|major|menor|mayor)\b/);
  if (key) { let pc = NOTES[key[1]]; const acc = key[3]; if (acc === '#' || acc === 'sostenido') pc = (pc + 1) % 12; else if (acc === 'b' || acc === 'bemol') pc = (pc + 11) % 12; I.tonic = pc; const m = key[5] ?? key[4]; if (m) I.mode = /^(m|min|minor|menor)$/.test(m.trim()) ? 'min' : 'maj'; }
  for (const [re, snd, label] of BASS_WORDS) if (re.test(t)) { I.bass = snd; I.notes.push('bajo ' + label); if (label === 'acid') I.arpAcid = true; break; }
  if (/sin (bateria|ritmo|percusion)/.test(t)) I.drop.push('kick', 'clap', 'hat', 'open', 'perc');
  if (/sin bajo/.test(t)) I.drop.push('bass'); if (/sin melodia/.test(t)) I.drop.push('melody'); if (/sin arpegio/.test(t)) I.drop.push('arp'); if (/sin (acordes|pad)/.test(t)) I.drop.push('chords');
  const dn: Record<string, string> = { kick: 'batería', clap: '', hat: '', open: '', perc: '', bass: 'bajo', melody: 'melodía', arp: 'arpegio', chords: 'acordes' };
  if (/solo (bateria|ritmo|percusion)/.test(t)) I.drop.push('bass', 'arp', 'chords', 'melody');
  if (/sin voz|instrumental/.test(t)) { /* sin voz: no hay pista de voz por defecto */ }
  const sn = [...new Set(I.drop.map((d) => dn[d]).filter(Boolean))]; if (sn.length) I.notes.push('sin ' + sn.join(', '));
  return I;
}

const pickOf = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];
const seedRng = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000003) / 1000003; }; };
const KEY_POOL = [9, 2, 4, 7, 0, 5, 11, 6, 1];
const KEY_NAMES = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];

export function projectFromPrompt(text: string, variant = 0): { p: Project; info: Interp; summary: string } {
  const I = interpret(text), G = GENRES[I.genre], clean = text.trim().slice(0, 80) || 'Loop', r = seedRng(norm(clean) + '#' + variant);
  const p = projectFromName(clean, variant, I.genre);
  // tonalidad, modo, progresión y color: lo pedido, o el criterio del género
  const mode: 'maj' | 'min' = I.mode ?? (G.harm.mode ?? (r() < 0.62 ? 'min' : 'maj')), tonic = I.tonic ?? pickOf(r, KEY_POOL);
  const tpl = G.harm.tpl?.[mode] ?? PROGS[mode].map(([, d]) => d), degrees = [...pickOf(r, tpl)];
  const ext = I.ext ?? (G.harm.ext < 0 ? 0 : G.harm.ext);
  // estilo de otro género: bajo, acordes, arpegio y melodía toman la forma y el sonido de ese estilo; la batería, el tempo y el kit siguen siendo del género pedido
  if (I.style && GENRES[I.style]) {
    const q = projectFromName(clean, variant, I.style);
    for (const id of ['bass', 'chords', 'arp', 'melody']) { const a = p.tracks.find((t) => t.id === id), b = q.tracks.find((t) => t.id === id); if (a && b) Object.assign(a, { steps: b.steps, bassLine: b.bassLine, bassLen: b.bassLen, sound: b.sound, synth: b.synth, arp: b.arp, chordMode: b.chordMode, chordLen: b.chordLen, fx: b.fx, vol: b.vol, duck: b.duck, rev: 0, dly: 0 }); }
    if (!G.harm.mode && GENRES[I.style].harm.mode) I.mode ??= GENRES[I.style].harm.mode; // el estilo trae su modo habitual (New Order: menor)
  }
  const mode2: 'maj' | 'min' = I.mode ?? mode, tpl2 = G.harm.tpl?.[mode2] ?? GENRES[I.style ?? I.genre].harm.tpl?.[mode2] ?? PROGS[mode2].map(([, d]) => d);
  const m: Manual = { tonic, mode: mode2, degrees: I.style || mode2 !== mode ? [...pickOf(r, tpl2)] : degrees, ext }; p.manual = m; applyHarmony(p, 'v' + variant);
  // tempo y groove
  p.bpm = I.bpm ?? Math.round(Math.max(60, Math.min(200, p.bpm + (I.macros.energy > 0.25 ? 3 : I.macros.energy < -0.2 ? -4 : 0))));
  // macros (0.5 = como lo dejó el género)
  const c = (v: number) => Math.max(0.05, Math.min(0.95, 0.5 + v)); p.macros = { energy: c(I.macros.energy), dark: c(I.macros.dark), space: c(I.macros.space), groove: c(I.macros.groove) };
  // bajo pedido y arpegio acid
  const bass = p.tracks.find((t) => t.id === 'bass'); if (bass && I.bass) setSound(bass, I.bass);
  if (I.arpAcid) { const arp = p.tracks.find((t) => t.id === 'arp'); if (arp?.arp) { arp.arp = { ...arp.arp, mode: 'acid', pat: undefined, rate: '16' }; setSound(arp, 'acid303'); } }
  // pistas que se piden sin
  for (const id of I.drop) { const t = p.tracks.find((x) => x.id === id); if (t) t.mute = true; }
  p.title = clean.length > 30 ? clean.slice(0, 29) + '…' : clean; p.edited = false; p.seed = r();
  const summary = `${G.name} · ${p.bpm} BPM · ${KEY_NAMES[tonic]} ${m.mode === 'maj' ? 'mayor' : 'menor'} · ${p.progression ?? ''}` + (I.notes.length ? ' · ' + I.notes.join(', ') : '');
  return { p, info: I, summary };
}
