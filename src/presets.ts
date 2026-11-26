/* Biblioteca de sonidos del sinte pro. Cada receta es un `Pro` armado con `mkPro`; el nivel (`gain`) está igualado midiendo el render del worklet
   (script de calibración en la sesión de diseño: bajos a la altura de `bassSaw`). Las categorías (`cat`) agrupan la lista desplegable. */
import type { Pro, ProOsc, ModSrc, ModDst, TrackType } from './model';
export const osc = (o: Partial<ProOsc> = {}): ProOsc => ({ on: true, table: 'basic', pos: 0.5, oct: 0, semi: 0, fine: 0, uni: 1, det: 0, width: 0.5, level: 1, ...o });
export const off = (o: Partial<ProOsc> = {}) => osc({ on: false, ...o });
export const mkPro = (o: Partial<Pro> = {}): Pro => ({
  a: osc(), b: off(), sub: 0, subOct: -1, noise: 0, fm: 0, fType: 'lp12', cut: 4000, res: 0.15, drive: 0, fEnv: 0, fKey: 0,
  env1: { a: 0.005, d: 0.4, s: 0.7, r: 0.25 }, env2: { a: 0.001, d: 0.3, s: 0, r: 0.2 },
  lfo1: { shape: 'sine', rate: 16, trig: false }, lfo2: { shape: 'tri', rate: 4, trig: true }, mods: [], mono: false, legato: false, glide: 0.06, gain: 0.3, ...o,
});
export const M = (src: ModSrc, dst: ModDst, amt: number) => ({ src, dst, amt });
export type LibEntry = { label: string; for: TrackType[]; cat: string; p: Pro };
const B: TrackType[] = ['bass'];
const lib = (cat: string, label: string, f: TrackType[], p: Pro): LibEntry => ({ cat, label, for: f, p });

/* Tablas: basic pos 0 seno · .25 triángulo · .5 sierra · .75 cuadrada · 1 pulso. Mod cut: amt × 5 octavas. LFO rate en pasos de 1/16 (4 = 1/4, 16 = 1 compás). */
export const PRO_LIB: Record<string, LibEntry> = {
  /* ---- Bajo · Sub ---- */
  subPuro: lib('Bajo · Sub', 'Sub puro', B, mkPro({ a: osc({ pos: 0 }), cut: 900, res: 0.05, env1: { a: 0.004, d: 0.5, s: 0.85, r: 0.08 }, mono: true, legato: true, glide: 0.05, gain: 0.383 })),
  sub808Largo: lib('Bajo · Sub', '808 largo', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0.25, oct: 1, level: 0.12 }), cut: 1600, res: 0.05, drive: 0.15, env2: { a: 0.001, d: 0.07, s: 0, r: 0.1 }, mods: [M('env2', 'pitch', 0.3)], env1: { a: 0.002, d: 1.6, s: 0.55, r: 0.3 }, mono: true, legato: true, glide: 0.09, gain: 0.503 })),
  sub808Sucio: lib('Bajo · Sub', '808 saturado', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0.25, oct: 1, level: 0.25 }), cut: 2600, res: 0.1, drive: 0.75, env2: { a: 0.001, d: 0.06, s: 0, r: 0.1 }, mods: [M('env2', 'pitch', 0.25)], env1: { a: 0.002, d: 1.0, s: 0.5, r: 0.2 }, mono: true, legato: true, glide: 0.07, gain: 0.917 })),
  subMedios: lib('Bajo · Sub', 'Sub con medios', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0.5, level: 0.3 }), fType: 'lp24', cut: 700, res: 0.15, fEnv: 0.15, env2: { a: 0.001, d: 0.2, s: 0.2, r: 0.1 }, env1: { a: 0.003, d: 0.35, s: 0.75, r: 0.08 }, mono: true, glide: 0.04, gain: 0.421 })),
  dubBass: lib('Bajo · Sub', 'Dub profundo', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0.25, level: 0.4 }), sub: 0.5, cut: 340, res: 0.1, drive: 0.2, env1: { a: 0.01, d: 0.7, s: 0.75, r: 0.3 }, mono: true, legato: true, glide: 0.1, gain: 0.556 })),
  /* ---- Bajo · House y deep ---- */
  deepRedondo: lib('Bajo · House y deep', 'Deep redondo', B, mkPro({ a: osc({ pos: 0.25 }), sub: 0.5, cut: 420, res: 0.1, env1: { a: 0.004, d: 0.35, s: 0.6, r: 0.1 }, mono: true, glide: 0.04, gain: 0.516 })),
  houseRebote: lib('Bajo · House y deep', 'House rebote', B, mkPro({ a: osc({ pos: 0.9 }), b: osc({ pos: 0.5, level: 0.4 }), fType: 'lp24', cut: 260, res: 0.3, fEnv: 0.55, env2: { a: 0.001, d: 0.12, s: 0, r: 0.08 }, env1: { a: 0.002, d: 0.22, s: 0.35, r: 0.06 }, mono: true, glide: 0.03, gain: 0.7 })),
  houseCuadrada: lib('Bajo · House y deep', 'House cuadrada', B, mkPro({ a: osc({ pos: 0.75 }), fType: 'lp24', cut: 340, res: 0.2, fEnv: 0.5, env2: { a: 0.001, d: 0.1, s: 0, r: 0.08 }, env1: { a: 0.002, d: 0.18, s: 0.3, r: 0.05 }, mono: true, glide: 0.03, gain: 0.75 })),
  analogCalido: lib('Bajo · House y deep', 'Analógico cálido', B, mkPro({ a: osc({ pos: 0.5, uni: 2, det: 8, width: 0.3 }), b: osc({ pos: 0.75, oct: -1, level: 0.5 }), fType: 'lp24', cut: 380, res: 0.25, drive: 0.2, fEnv: 0.35, fKey: 0.3, env2: { a: 0.001, d: 0.25, s: 0.15, r: 0.1 }, env1: { a: 0.004, d: 0.3, s: 0.65, r: 0.1 }, mono: true, glide: 0.05, gain: 0.802 })),
  pulsoMoog: lib('Bajo · House y deep', 'Pulso moog', B, mkPro({ a: osc({ pos: 0.85 }), fType: 'lp24', cut: 450, res: 0.3, fEnv: 0.3, lfo1: { shape: 'sine', rate: 32, trig: false }, mods: [M('lfo1', 'posA', 0.2)], env2: { a: 0.001, d: 0.2, s: 0.1, r: 0.1 }, env1: { a: 0.003, d: 0.3, s: 0.6, r: 0.08 }, mono: true, glide: 0.04, gain: 0.634 })),
  /* ---- Bajo · Trance y techno ---- */
  tranceRodante: lib('Bajo · Trance y techno', 'Trance rodante', B, mkPro({ a: osc({ pos: 0.5, uni: 3, det: 10, width: 0.4 }), sub: 0.4, fType: 'lp24', cut: 520, res: 0.2, drive: 0.15, fEnv: 0.35, env2: { a: 0.001, d: 0.09, s: 0, r: 0.06 }, env1: { a: 0.002, d: 0.16, s: 0.45, r: 0.04 }, mono: true, glide: 0.02, gain: 1.086 })),
  technoTriangulo: lib('Bajo · Trance y techno', 'Techno triángulo', B, mkPro({ a: osc({ pos: 0.25 }), sub: 0.5, cut: 260, res: 0.15, env1: { a: 0.003, d: 0.28, s: 0.6, r: 0.06 }, mono: true, glide: 0.03, gain: 0.536 })),
  technoSucio: lib('Bajo · Trance y techno', 'Techno sucio', B, mkPro({ a: osc({ pos: 0.5 }), b: osc({ pos: 0.5, fine: 8, level: 0.6 }), fType: 'lp24', cut: 300, res: 0.45, drive: 0.6, fEnv: 0.45, env2: { a: 0.001, d: 0.14, s: 0, r: 0.08 }, env1: { a: 0.002, d: 0.2, s: 0.5, r: 0.06 }, mono: true, glide: 0.03, gain: 1.321 })),
  hardDistorsion: lib('Bajo · Trance y techno', 'Hard distorsionado', B, mkPro({ a: osc({ pos: 0.5 }), sub: 0.5, fType: 'lp24', cut: 240, res: 0.3, drive: 0.95, fEnv: 0.3, env2: { a: 0.001, d: 0.1, s: 0, r: 0.06 }, env1: { a: 0.002, d: 0.18, s: 0.55, r: 0.05 }, mono: true, glide: 0.02, gain: 1.439 })),
  /* ---- Bajo · Reese y wobble ---- */
  reeseOscuro: lib('Bajo · Reese y wobble', 'Reese oscuro', B, mkPro({ a: osc({ pos: 0.5, uni: 2, det: 28, width: 0.5 }), b: osc({ pos: 0.5, fine: 18, uni: 2, det: 20, width: 0.5 }), sub: 0.5, fType: 'lp24', cut: 380, res: 0.35, drive: 0.5, lfo1: { shape: 'sine', rate: 16, trig: false }, mods: [M('lfo1', 'cut', 0.22)], env1: { a: 0.01, d: 0.5, s: 0.8, r: 0.2 }, mono: true, legato: true, glide: 0.08, gain: 0.783 })),
  reeseAncho: lib('Bajo · Reese y wobble', 'Reese ancho', B, mkPro({ a: osc({ pos: 0.5, uni: 5, det: 35, width: 1 }), sub: 0.45, fType: 'lp24', cut: 700, res: 0.25, drive: 0.35, lfo1: { shape: 'sine', rate: 8, trig: false }, mods: [M('lfo1', 'cut', 0.15), M('lfo1', 'posA', 0.1)], env1: { a: 0.01, d: 0.5, s: 0.8, r: 0.2 }, mono: true, legato: true, glide: 0.08, gain: 0.696 })),
  wobbleLento: lib('Bajo · Reese y wobble', 'Wobble lento', B, mkPro({ a: osc({ pos: 0.5 }), sub: 0.5, fType: 'lp24', cut: 180, res: 0.55, drive: 0.4, lfo1: { shape: 'tri', rate: 8, trig: true }, mods: [M('lfo1', 'cut', 0.5)], env1: { a: 0.004, d: 0.5, s: 0.85, r: 0.1 }, mono: true, legato: true, glide: 0.05, gain: 0.758 })),
  wobbleRapido: lib('Bajo · Reese y wobble', 'Wobble rápido', B, mkPro({ a: osc({ pos: 0.5, uni: 2, det: 14 }), sub: 0.5, fType: 'lp24', cut: 200, res: 0.6, drive: 0.45, lfo1: { shape: 'tri', rate: 2, trig: true }, mods: [M('lfo1', 'cut', 0.45)], env1: { a: 0.004, d: 0.5, s: 0.85, r: 0.1 }, mono: true, legato: true, glide: 0.05, gain: 0.74 })),
  growl: lib('Bajo · Reese y wobble', 'Growl', B, mkPro({ a: osc({ pos: 0.5, uni: 2, det: 18 }), b: osc({ table: 'vocal', pos: 0.6, level: 0.7 }), noise: 0.03, fType: 'lp24', cut: 400, res: 0.5, drive: 0.6, lfo1: { shape: 'saw', rate: 4, trig: true }, lfo2: { shape: 'tri', rate: 16, trig: false }, mods: [M('lfo1', 'cut', 0.3), M('lfo2', 'posB', 0.5)], env1: { a: 0.004, d: 0.5, s: 0.85, r: 0.1 }, mono: true, legato: true, glide: 0.05, gain: 0.871 })),
  /* ---- Bajo · Acid y FM ---- */
  acidCuadrada: lib('Bajo · Acid y FM', 'Acid cuadrada', B, mkPro({ a: osc({ pos: 0.75, oct: -1 }), fType: 'lp24', cut: 200, res: 0.85, drive: 0.3, fEnv: 0.65, mods: [M('vel', 'cut', 0.3)], env2: { a: 0.001, d: 0.18, s: 0, r: 0.1 }, env1: { a: 0.002, d: 0.3, s: 0.6, r: 0.04 }, mono: true, glide: 0.06, gain: 0.653 })),
  acidChillon: lib('Bajo · Acid y FM', 'Acid chillón', B, mkPro({ a: osc({ pos: 0.5, oct: -1 }), fType: 'lp24', cut: 300, res: 0.92, drive: 0.5, fEnv: 0.8, mods: [M('vel', 'cut', 0.35)], env2: { a: 0.001, d: 0.2, s: 0, r: 0.1 }, env1: { a: 0.002, d: 0.3, s: 0.6, r: 0.04 }, mono: true, glide: 0.06, gain: 1.009 })),
  fmGrunon: lib('Bajo · Acid y FM', 'FM gruñón', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0 }), fm: 0.25, sub: 0.3, cut: 1500, res: 0.1, lfo1: { shape: 'sine', rate: 16, trig: false }, mods: [M('env2', 'fm', 0.3), M('lfo1', 'fm', 0.1)], env2: { a: 0.001, d: 0.25, s: 0.2, r: 0.1 }, env1: { a: 0.003, d: 0.3, s: 0.5, r: 0.08 }, mono: true, glide: 0.04, gain: 0.556 })),
  fmSeco: lib('Bajo · Acid y FM', 'FM seco', B, mkPro({ a: osc({ pos: 0 }), b: osc({ pos: 0, oct: 1 }), fm: 0.3, cut: 3000, res: 0.1, mods: [M('env2', 'fm', 0.4)], env2: { a: 0.001, d: 0.08, s: 0, r: 0.06 }, env1: { a: 0.002, d: 0.2, s: 0.2, r: 0.06 }, mono: true, glide: 0.03, gain: 1.103 })),
  /* ---- Bajo · Texturas ---- */
  bajoVocal: lib('Bajo · Texturas', 'Bajo vocal', B, mkPro({ a: osc({ table: 'vocal', pos: 0.3 }), sub: 0.4, fType: 'lp24', cut: 900, res: 0.2, lfo1: { shape: 'tri', rate: 16, trig: false }, mods: [M('lfo1', 'posA', 0.35), M('lfo1', 'cut', 0.1)], env1: { a: 0.006, d: 0.4, s: 0.7, r: 0.1 }, mono: true, legato: true, glide: 0.06, gain: 0.611 })),
  bajoMetalico: lib('Bajo · Texturas', 'Bajo metálico', B, mkPro({ a: osc({ table: 'metal', pos: 0.3 }), b: osc({ pos: 0, oct: -1, level: 0.8 }), cut: 700, res: 0.2, mods: [M('env2', 'posA', 0.4)], env2: { a: 0.001, d: 0.25, s: 0, r: 0.1 }, env1: { a: 0.003, d: 0.3, s: 0.5, r: 0.08 }, mono: true, glide: 0.04, gain: 0.622 })),
};
