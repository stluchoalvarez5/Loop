/* Exportación: renderiza el loop con el mismo motor (worklet) dentro de un OfflineAudioContext
   y lo codifica a WAV, MP3 o un paquete para Ableton (stems WAV + MIDI). */
import workletUrl from './worklet.js?url';
import { compile, switchScene, sceneUsed, SCENES, type Project } from '../model';
import type { Engine } from './engine';

export type Progress = (msg: string) => void;
type Audio = { L: Float32Array; R: Float32Array; sr: number };

const loopSamples = (p: Project, sr: number) => sr * 60 / p.bpm / 4 * 64;

/* Renderiza `loops` vueltas después de `warm` vueltas de "calentamiento" (así las colas de reverb y delay
   ya están sonando y la vuelta exportada empalma perfecto consigo misma). stemId = renderizar solo esa pista. */
export async function renderAudio(engine: Engine, p: Project, loops: number, stemId?: string): Promise<Audio> {
  await engine.init();
  const sr = engine.ctx!.sampleRate, L1 = loopSamples(p, sr), warm = 1;
  const start = Math.round(warm * L1), len = Math.round((warm + loops) * L1);
  const ctx = new OfflineAudioContext(2, len, sr);
  await ctx.audioWorklet.addModule(workletUrl);
  const project: any = compile(p);
  if (stemId) {
    project.tracks.forEach((t: any) => { t.mute = t.id !== stemId; t.solo = false; });
    project.master = { ...project.master, auto: false, eq: [0, 0, 0, 0, 0, 0, 0, 0] };
  }
  const node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { export: true, project, samples: engine.sampleData, freezeAt: start } });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0).slice(start, len), R: buf.getChannelData(1).slice(start, len), sr };
}

/* Tema: una secuencia de escenas (una vuelta de 4 compases cada una) en una sola pasada, así las colas de reverb y delay
   pasan de una parte a la otra. La ganancia automática se calibra con la escena más llena y queda fija: la intro y el break
   suenan más bajos que el drop, como en un tema de verdad. */
export const defaultArrangement = (p: Project) => { const used = SCENES.filter((k) => sceneUsed(p, k)); return used.flatMap((k) => [k, k]); };
export async function renderArrangement(engine: Engine, p: Project, seq: string[]): Promise<Audio> {
  await engine.init();
  const sr = engine.ctx!.sampleRate, L1 = loopSamples(p, sr), start = Math.round(L1), len = Math.round((1 + seq.length) * L1);
  const comp: Record<string, any> = {}, live: Record<string, number> = {};
  for (const k of new Set(seq)) { const d: Project = JSON.parse(JSON.stringify(p)); switchScene(d, k); const c: any = compile(d); comp[k] = c; live[k] = c.tracks.filter((t: any) => !t.mute).length; }
  const warmK = Object.keys(comp).sort((a, b) => live[b] - live[a])[0];
  const ctx = new OfflineAudioContext(2, len, sr);
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, 'loop-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { export: true, project: comp[warmK], arr: seq.map((k) => comp[k]), samples: engine.sampleData, freezeAt: start } });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  // final: medio segundo de fundido para que no corte seco
  const L = buf.getChannelData(0).slice(start, len), R = buf.getChannelData(1).slice(start, len), f = Math.min(L.length, Math.round(sr * 0.5));
  for (let i = 0; i < f; i++) { const g = i / f; L[L.length - 1 - i] *= g; R[R.length - 1 - i] *= g; }
  return { L, R, sr };
}

export function wav({ L, R, sr }: Audio, bits: 16 | 24 = 24): Uint8Array {
  const n = L.length, bps = bits / 8, data = n * 2 * bps, out = new Uint8Array(44 + data), v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2 * bps, true); v.setUint16(32, 2 * bps, true); v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, data, true);
  let o = 44; const max = bits === 16 ? 32767 : 8388607;
  for (let i = 0; i < n; i++) for (const ch of [L, R]) {
    const x = Math.round(Math.max(-1, Math.min(1, ch[i])) * max);
    if (bits === 16) { v.setInt16(o, x, true); o += 2; } else { out[o] = x & 255; out[o + 1] = (x >> 8) & 255; out[o + 2] = (x >> 16) & 255; o += 3; }
  }
  return out;
}

/* sesión grabada: WAV de 16 bits armado por pedazos (sin juntar todo en un solo arreglo gigante) y MP3 por pedazos */
export type Take = { sr: number; chunks: { l: Int16Array; r: Int16Array }[]; frames: number };
export function takeWav(t: Take): Blob {
  const data = t.frames * 4, h = new DataView(new ArrayBuffer(44)), str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); h.setUint32(4, 36 + data, true); str(8, 'WAVE'); str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 2, true);
  h.setUint32(24, t.sr, true); h.setUint32(28, t.sr * 4, true); h.setUint16(32, 4, true); h.setUint16(34, 16, true); str(36, 'data'); h.setUint32(40, data, true);
  const parts: BlobPart[] = [h.buffer];
  for (const c of t.chunks) { const o = new Int16Array(c.l.length * 2); for (let i = 0; i < c.l.length; i++) { o[i * 2] = c.l[i]; o[i * 2 + 1] = c.r[i]; } parts.push(o.buffer); }
  return new Blob(parts, { type: 'audio/wav' });
}
export async function takeMp3(t: Take, onPct: (p: number) => void, kbps = 256): Promise<Blob> {
  const lame: any = await import('@breezystack/lamejs');
  const enc = new lame.Mp3Encoder(2, t.sr, kbps), parts: BlobPart[] = [];
  for (let k = 0; k < t.chunks.length; k++) {
    const d = enc.encodeBuffer(t.chunks[k].l, t.chunks[k].r); if (d.length) parts.push(new Uint8Array(d));
    if (k % 40 === 0) { onPct(k / t.chunks.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  const e = enc.flush(); if (e.length) parts.push(new Uint8Array(e));
  return new Blob(parts, { type: 'audio/mpeg' });
}
export async function mp3({ L, R, sr }: Audio, kbps = 256): Promise<Uint8Array> {
  const lame: any = await import('@breezystack/lamejs');
  const enc = new lame.Mp3Encoder(2, sr, kbps), toI16 = (a: Float32Array) => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(a[i] * 32767))); return o; };
  const l = toI16(L), r = toI16(R), parts: Uint8Array[] = [], B = 1152 * 20;
  for (let i = 0; i < l.length; i += B) { const d = enc.encodeBuffer(l.subarray(i, i + B), r.subarray(i, i + B)); if (d.length) parts.push(new Uint8Array(d)); if (i % (B * 20) === 0) await new Promise((res) => setTimeout(res, 0)); }
  const e = enc.flush(); if (e.length) parts.push(new Uint8Array(e));
  const out = new Uint8Array(parts.reduce((a, x) => a + x.length, 0)); let o = 0; parts.forEach((x) => { out.set(x, o); o += x.length; });
  return out;
}

/* ---------- MIDI (formato 1, 480 ticks por negra: una semicorchea = 120 ticks) ---------- */
const GM: Record<string, number> = { kick: 36, clap: 39, snare: 38, snare808: 38, snareSoft: 40, rim: 37, rim2: 37, hat: 42, open: 46, ride: 51, crash: 49, cowbell: 56, clave: 75, conga: 63, shaker: 70, tamb: 54, maraca: 70, tomL: 45, tomM: 47, tomH: 50 };
const vlq = (n: number) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
function track(name: string, evs: { t: number; d: number[] }[]) {
  const nm = [...new TextEncoder().encode(name)], bytes: number[] = [0, 0xff, 0x03, ...vlq(nm.length), ...nm];
  evs.sort((a, b) => a.t - b.t || (a.d[0] & 0xf0) - (b.d[0] & 0xf0)); let last = 0;
  evs.forEach((e) => { bytes.push(...vlq(e.t - last), ...e.d); last = e.t; });
  bytes.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes];
}
export function midi(p: Project, only?: string): Uint8Array {
  const c = compile(p), T = 120, us = Math.round(60000000 / p.bpm), trks: number[][] = [];
  trks.push(track('Loop · ' + p.bpm + ' BPM', [{ t: 0, d: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { t: 0, d: [0xff, 0x58, 0x04, 4, 2, 24, 8] }]));
  const drumEv: { t: number; d: number[] }[] = [];
  let ch = 0;
  p.tracks.forEach((t, k) => {
    if (only && t.id !== only) return;
    if (t.mute || t.type === 'vocal') return; // la voz va como audio en los stems, no como MIDI
    const ct = c.tracks[k], evs: { t: number; d: number[] }[] = [];
    ct.ev.forEach((list: any[], s: number) => list.forEach((e) => {
      const tick = s * T;
      if (t.type === 'drum') { const n = GM[t.sound] ?? 37, v = Math.round((e.v ?? 0.8) * 110); drumEv.push({ t: tick, d: [0x99, n, v] }, { t: tick + 60, d: [0x89, n, 0] }); }
      else { const n = Math.max(0, Math.min(127, Math.round(e.n + (t.pitch || 0)))), v = Math.round((e.v ?? 0.8) * 110), off = tick + Math.max(30, Math.round(e.l * T)); evs.push({ t: tick, d: [0x90 | ch, n, v] }, { t: off, d: [0x80 | ch, n, 0] }); }
    }));
    if (t.type !== 'drum' && evs.length) { trks.push(track(t.name, evs)); ch = (ch + 1) % 9; }
  });
  if (drumEv.length) trks.push(track('Batería', drumEv));
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, trks.length, 480 >> 8, 480 & 255];
  return new Uint8Array([...head, ...trks.flat()]);
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const baseName = (p: Project) => (slug(p.title || p.name || '') || 'loop') + '_' + p.bpm + 'bpm' + (p.key && !p.key.startsWith('sin') ? '_' + p.key.replace(/\s+/g, '-').replace('#', 's') : '');

export async function abletonZip(engine: Engine, p: Project, loops: number, prog: Progress): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}, base = baseName(p);
  const gOff = new Set((p.groups ?? []).filter((g) => g.mute).map((g) => g.id));
  const live = p.tracks.filter((t) => !t.mute && !(t.group && gOff.has(t.group)));
  for (let i = 0; i < live.length; i++) {
    const t = live[i]; prog(`Renderizando ${t.name} (${i + 1} de ${live.length})…`);
    const a = await renderAudio(engine, p, loops, t.id);
    files[`Stems/${String(i + 1).padStart(2, '0')} ${t.name}.wav`] = [wav(a, 24), { level: 0 }];
  }
  prog('Renderizando la mezcla completa…');
  files[`${base} (mezcla).wav`] = [wav(await renderAudio(engine, p, loops), 24), { level: 0 }];
  prog('Armando los MIDI…');
  files['MIDI/Todo (todas las pistas).mid'] = midi(p);
  p.tracks.forEach((t) => { if (!t.mute && t.type !== 'drum' && t.type !== 'vocal') files[`MIDI/${t.name}.mid`] = midi(p, t.id); });
  const drumsOnly = { ...p, tracks: p.tracks.map((t) => (t.type === 'drum' ? t : { ...t, mute: true })) };
  files['MIDI/Batería.mid'] = midi(drumsOnly);
  files['LEEME.txt'] = new TextEncoder().encode([
    `Loop: ${p.title || p.name || 'sin nombre'}`, `Tempo: ${p.bpm} BPM · 4/4 · ${loops * 4} compases`, `Tonalidad: ${p.key ?? '-'}`, `Acordes: ${p.chords.map((c) => c.name).join(' – ')}`, '',
    'Cómo usarlo en Ableton Live:',
    `1. Poné el tempo del set en ${p.bpm} BPM.`,
    '2. Arrastrá los WAV de la carpeta Stems a pistas de audio, todos en el compás 1. Están en el mismo largo y suenan juntos como la mezcla.',
    '3. Los MIDI van en pistas MIDI con el instrumento que quieras. "Batería.mid" usa el mapa General MIDI (bombo = C1/36, clap = D#1/39, hat cerrado = F#1/42, hat abierto = A#1/46), que coincide con los Drum Rack de Ableton.',
    '4. Los stems salen sin el volumen automático ni el EQ del master: el master lo hacés en Ableton.',
    '', 'Batería: samples TR-909 de Rob Roy Recordings (1995), uso libre sin fines de lucro.',
  ].join('\n'));
  prog('Comprimiendo…');
  return zipSync(files as any);
}

/* Entregar el archivo: en el celu abre "Compartir" (Guardar en Archivos, WhatsApp, Drive…); si no, lo descarga. */
export async function deliver(data: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime }), file = new File([blob], filename, { type: mime });
  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await nav.share({ files: [file], title: filename }); return 'shared'; } catch (e: any) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
