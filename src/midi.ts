/* Controlador MIDI (Web MIDI: Chrome en Android o en la compu; en iPhone no existe).
   "Aprender": elegís qué querés manejar y movés una perilla o tocás un pad del controlador; queda asignado.
   Los mapas se guardan en este dispositivo (no en el proyecto), así sirven para todos los loops. */

export type MidiMap = { src: string; target: string }; // src: 'cc:<canal>:<n>' o 'note:<canal>:<n>'
export type MidiMsg = { kind: 'cc' | 'on' | 'off'; ch: number; n: number; v: number };
const KEY = 'loop.midi';

export const midi = {
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  access: null as any,
  inputs: [] as string[],
  maps: [] as MidiMap[],
  learn: null as string | null, // destino esperando un movimiento del controlador
  keys: true, // las teclas tocan la pista elegida
  onMsg: (_m: MidiMsg, _target: string | null) => {},
  onLearned: (_m: MidiMap) => {},
  listeners: new Set<() => void>(),
};
const ping = () => midi.listeners.forEach((f) => f());
try { const j = JSON.parse(localStorage.getItem(KEY) ?? '{}'); midi.maps = Array.isArray(j.maps) ? j.maps : []; midi.keys = j.keys ?? true; } catch { /* */ }
export const saveMidi = () => { try { localStorage.setItem(KEY, JSON.stringify({ maps: midi.maps, keys: midi.keys })); } catch { /* */ } ping(); };

function handle(e: any) {
  const [st, a, b] = e.data as Uint8Array, type = st & 0xf0, ch = st & 0x0f;
  let m: MidiMsg | null = null;
  if (type === 0xb0) m = { kind: 'cc', ch, n: a, v: b / 127 };
  else if (type === 0x90 && b > 0) m = { kind: 'on', ch, n: a, v: b / 127 };
  else if (type === 0x80 || (type === 0x90 && b === 0)) m = { kind: 'off', ch, n: a, v: 0 };
  if (!m) return;
  const src = (m.kind === 'cc' ? 'cc:' : 'note:') + ch + ':' + m.n;
  if (midi.learn && m.kind !== 'off') {
    const map = { src, target: midi.learn };
    midi.maps = [...midi.maps.filter((x) => x.src !== src && x.target !== midi.learn), map]; midi.learn = null; saveMidi(); midi.onLearned(map); return;
  }
  const hit = midi.maps.find((x) => x.src === src);
  midi.onMsg(m, hit ? hit.target : null);
}
function wire() {
  const a = midi.access; if (!a) return;
  midi.inputs = [];
  a.inputs.forEach((inp: any) => { inp.onmidimessage = handle; midi.inputs.push(inp.name || 'Controlador'); });
  ping();
}
export async function connectMidi() {
  if (!midi.supported) throw new Error('sin MIDI');
  if (!midi.access) { midi.access = await (navigator as any).requestMIDIAccess(); midi.access.onstatechange = wire; }
  wire();
}
export const useMidiPing = (f: () => void) => { midi.listeners.add(f); return () => { midi.listeners.delete(f); }; };
