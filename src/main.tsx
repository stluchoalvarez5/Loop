import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './style.css';
import { Engine } from './engine/engine';
import { Stage, type StageMode } from './stage';
import { saveVox, loadVox, deleteVox, voxKeys, cleanVox, startRecording, peaks, finishLoopVox } from './vox';
import { renderAudio, renderArrangement, defaultArrangement, wav, mp3, abletonZip, baseName, takeWav, takeMp3, type Take } from './engine/export';
import { migrate, listProjects, loadProject, saveProject, deleteProject, renameProject, duplicate, currentId, newId, titleOf, exportFile, importFile, type Meta } from './store';
import { registerSW } from 'virtual:pwa-register';
import { midi, connectMidi, saveMidi, useMidiPing, type MidiMsg } from './midi';
import {
  type Pro, type ProOsc, type ProEnv, type ProLfo, type WTable, mkPro, proFrom, PRO_PRESETS, WTABLES, MOD_SRC, MOD_DST, LFO_RATES, type Manual, PROGS, ROMAN, NOTE_ES, blankProject, applyGenreSound, manualHarmony, manualFrom, type EqBand, EQ_DEF, SCENES, switchScene, sceneUsed, nextScene, clearScene, varyTrack, type MacroKey, rollFromTrack, type Group, MACROS, AUTO_PARAMS, AUTO_SHAPES, autoShape, type AutoKey,
  type Project, type Track, SYNTHS, KITS, DRUM_SOUNDS, GENRES, newProject, projectFromName, applyGenre, harmonyFromName, applyHarmony,
  expand64, arpSeq, ARP_PATS, ARP_RHYTHMS, arpPlays, arpPreview, noteName, letterNote, clean, newTrack, generateMelody, nameScale, DRUM_GROUPS, type TrackType,
} from './model';

const engine = new Engine();
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
/* proyectos: se abre el último que usaste. Se guarda solo, un instante después de cada cambio (no en cada movimiento de perilla) */
const load = (): Project | null => { migrate(); return loadProject(currentId()) ?? loadProject(listProjects()[0]?.id ?? null); };
let saveT: any = 0, saveP: Project | null = null, onSaveFail: () => void = () => {};
const flushSave = () => { clearTimeout(saveT); saveT = 0; if (saveP && !saveProject(saveP)) onSaveFail(); saveP = null; };
const save = (p: Project) => { saveP = p; clearTimeout(saveT); saveT = setTimeout(flushSave, 400); };
if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); }); window.addEventListener('pagehide', flushSave); }
/* nombre para un loop nuevo: "Loop N", con el primer número libre */
const nextTitle = () => { const used = new Set(listProjects().map((m) => m.title)); let n = 1; while (used.has('Loop ' + n)) n++; return 'Loop ' + n; };
/* carga en el motor las voces grabadas de un proyecto (están en IndexedDB) */
/* borra del celu los audios de voz que ya no usa ningún loop guardado */
const sweepVox = async () => { const used = new Set<string>(); listProjects().forEach((m) => loadProject(m.id)?.tracks.forEach((t) => { if (t.type === 'vocal') used.add(t.id); })); for (const k of await voxKeys()) if (!used.has(k)) await deleteVox(k); };
const loadVoxes = async (p: Project) => {
  const vs = p.tracks.filter((t) => t.type === 'vocal' && t.vox?.has); if (!vs.length) return;
  await engine.init(); for (const t of vs) { const v = await loadVox(t.id).catch(() => undefined); if (v) engine.setVox(t.id, v.data, v.sr); }
};

/* ---------- instalación y modo sin conexión ---------- */
declare const __BUILD__: string;
const pwa = { prompt: null as any, update: null as null | (() => void), listeners: new Set<() => void>() };
const pwaPing = () => pwa.listeners.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.prompt = e; pwaPing(); });
  window.addEventListener('appinstalled', () => { pwa.prompt = null; pwaPing(); });
  // la versión nueva se instala sola en segundo plano (también desde versiones viejas de la app) pero no recarga:
  // cortaría lo que está sonando. Cuando toma el control se avisa arriba y "Actualizar" recarga.
  const hadCtrl = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtrl) { pwa.update = () => location.reload(); pwaPing(); } });
  const upd = registerSW({ immediate: true, onNeedRefresh: () => { pwa.update = () => upd(true); pwaPing(); }, onOfflineReady: () => pwaPing() });
}
const usePwa = () => { const [, f] = useState(0); useEffect(() => { const g = () => f((x) => x + 1); pwa.listeners.add(g); return () => { pwa.listeners.delete(g); }; }, []); return pwa; };

/* ---------- grabar movimientos ----------
   Con "Grabar movimientos" activado y el loop sonando, lo que movés en el Mixer o en las Macros se escribe en la automatización,
   en el paso que está sonando (rellena los pasos que se saltean si movés rápido). Al soltar, queda lo grabado. */
const REC = { on: false };
const recLast: Record<string, { s: number; t: number }> = {};
const recording = () => REC.on && engine.playing;
const stepNow = () => ((engine.beat.step % 64) + 64) % 64;
function writeRec(arr: number[], id: string, v: number) {
  const s = stepNow(), now = performance.now(), L = recLast[id];
  let i = L && now - L.t < 400 ? L.s : s; arr[i] = v;
  while (i !== s) { i = (i + 1) % 64; arr[i] = v; }
  recLast[id] = { s, t: now };
}
/* perillas de pista que se pueden automatizar: valor de la perilla ⇄ valor 0..1 de la automatización */
type AK = { k: AutoKey; get: (t: Track) => number; set: (t: Track, v: number) => void; norm: (v: number, t: Track) => number; den: (a: number, t: Track) => number };
const AKN: Record<string, AK> = {
  pan: { k: 'pan', get: (t) => t.pan, set: (t, v) => { t.pan = v; }, norm: (v) => (v + 1) / 2, den: (a) => a * 2 - 1 },
  rev: { k: 'rev', get: (t) => t.rev, set: (t, v) => { t.rev = v; }, norm: (v) => v, den: (a) => a },
  dly: { k: 'dly', get: (t) => t.dly, set: (t, v) => { t.dly = v; }, norm: (v) => v, den: (a) => a },
  drive: { k: 'drive', get: (t) => t.fx?.drive ?? 0, set: (t, v) => { t.fx = { ...t.fx, drive: v }; }, norm: (v) => v, den: (a) => a },
  hp: { k: 'hp', get: (t) => Math.max(20, t.fx?.hp || 20), set: (t, v) => { t.fx = { ...t.fx, hp: v <= 21 ? 0 : v }; }, norm: (v) => (v <= 21 ? 0 : Math.log(v / 20) / Math.log(100)), den: (a) => (a < 0.01 ? 20 : 20 * Math.pow(100, a)) },
  lp: { k: 'lp', get: (t) => t.fx?.lp || 20000, set: (t, v) => { t.fx = { ...t.fx, lp: v >= 19500 ? 0 : v }; }, norm: (v) => Math.max(0, Math.min(1, v >= 19500 ? 1 : Math.log(v / 200) / Math.log(100))), den: (a) => (a >= 0.995 ? 20000 : 200 * Math.pow(100, a)) },
  // el volumen grabado baja desde donde está el fader (la automatización multiplica al fader)
  vol: { k: 'vol', get: (t) => t.vol, set: (t, v) => { t.vol = v; }, norm: (v, t) => (t.vol > 0.001 ? Math.min(1, (v / t.vol) ** 2) : 1), den: (a, t) => t.vol * Math.sqrt(a) },
};
/* valor que muestra la perilla (si tiene automatización, el del paso actual) y qué hace al moverla */
function autoKnob(t: Track, key: keyof typeof AKN, upT: (id: string, fn: (t: Track) => void) => void) {
  const A = AKN[key], data = t.auto?.[A.k];
  return {
    value: data ? A.den(data[stepNow()] ?? 0, t) : A.get(t), mark: !!data,
    onChange: (v: number) => upT(t.id, (x) => applyAK(x, key, v)),
  };
}
function applyAK(x: Track, key: keyof typeof AKN, v: number) {
  const A = AKN[key];
  if (!recording()) { A.set(x, v); return; }
  const arr = x.auto?.[A.k] ? [...x.auto[A.k]!] : Array(64).fill(+A.norm(A.get(x), x).toFixed(3));
  writeRec(arr, x.id + ':' + A.k, +A.norm(v, x).toFixed(3)); x.auto = { ...x.auto, [A.k]: arr };
}
const M0 = { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 };
function applyMacro(d: Project, k: MacroKey, x: number) {
  const base = (d.macros ?? M0)[k];
  if (recording()) { const arr = d.macroAuto?.[k] ? [...d.macroAuto[k]!] : Array(64).fill(+base.toFixed(3)); writeRec(arr, 'macro:' + k, +x.toFixed(3)); d.macroAuto = { ...d.macroAuto, [k]: arr }; return; }
  d.macros = { ...(d.macros ?? M0), [k]: x };
}
/* portapapeles de patrones: queda guardado, así se puede pegar en otro loop */
type Clip = { type: TrackType; name: string; data: Partial<Track> };
const CLIP_KEYS = ['steps', 'arp', 'notes', 'roll', 'bassLine', 'bassLen', 'chordMode', 'chordLen', 'auto'] as const;
const getClip = (): Clip | null => { try { return JSON.parse(localStorage.getItem('loop.clip') ?? 'null'); } catch { return null; } };
const setClip = (t: Track) => { const data: any = {}; CLIP_KEYS.forEach((k) => { if (t[k] !== undefined) data[k] = clone(t[k]); }); try { localStorage.setItem('loop.clip', JSON.stringify({ type: t.type, name: t.name, data })); } catch { /* */ } };
/* pega en x lo copiado: mismo tipo = todo; batería ⇄ bajo o acordes = los golpes; notas (melodía o piano roll) = las notas */
function pasteClip(x: Track, c: Clip): string {
  const d = clone(c.data);
  if (c.type === x.type) { CLIP_KEYS.forEach((k) => { (x as any)[k] = (d as any)[k]; }); if (x.type === 'melody') x.autoMelody = false; return 'todo el patrón'; }
  const hasNotes = !!d.notes?.length && (c.type === 'melody' || d.roll);
  if (hasNotes && x.type !== 'drum' && x.type !== 'vocal') { x.notes = d.notes; if (x.type === 'melody') x.autoMelody = false; else { x.roll = true; x.rollEdited = true; } return 'las notas'; }
  if (d.steps && (x.type === 'drum' || x.type === 'bass' || x.type === 'chords')) { x.steps = d.steps.map((v) => (x.type === 'drum' ? v : v ? Math.min(v, 2) : 0)); if (x.type === 'chords' && (x.chordMode ?? 'pad') === 'pad') x.chordMode = 'stab'; if (x.type === 'bass') x.roll = false; return 'los golpes'; }
  return '';
}
let flashG: (m: string, ms?: number) => void = () => {};

/* ---------- controles ---------- */
function arc(a0: number, a1: number) { const r = 21, c = 27, p = (a: number) => [(c + r * Math.sin(a * Math.PI / 180)).toFixed(2), (c - r * Math.cos(a * Math.PI / 180)).toFixed(2)]; const s = p(a0), e = p(a1); return `M${s[0]} ${s[1]} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e[0]} ${e[1]}`; }
/* Gesto "mantener para mover" en pantallas táctiles: un toque corto o un deslizamiento hacen scroll normal;
   si mantenés el dedo quieto ~0,17 s el control se "agarra" (vibra y se ilumina) y recién ahí responde. */
const HOLD_MS = 170;
function useGrab(instant: boolean, h: { start: (e: PointerEvent) => void; move: (e: PointerEvent) => void; reset?: () => void }) {
  const g = useRef({ timer: 0 as any, grabbed: false, sx: 0, sy: 0, moved: false, last: 0, el: null as HTMLElement | null, pid: 0 });
  const grab = (e: PointerEvent) => { const s = g.current; s.grabbed = true; try { s.el?.setPointerCapture(s.pid); } catch { /* */ } s.el?.classList.add('grab'); try { navigator.vibrate?.(8); } catch { /* */ } h.start(e); };
  const end = () => { const s = g.current; clearTimeout(s.timer); s.timer = 0; if (s.grabbed) s.el?.classList.remove('grab'); s.grabbed = false; };
  return {
    onPointerDown: (e: PointerEvent) => {
      const s = g.current; s.el = e.currentTarget as HTMLElement; s.pid = e.pointerId; s.sx = e.clientX; s.sy = e.clientY; s.moved = false;
      if (instant || e.pointerType !== 'touch') { e.preventDefault(); grab(e); return; }
      clearTimeout(s.timer); s.timer = setTimeout(() => { s.timer = 0; if (!s.moved) grab(e); }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => { const s = g.current; if (s.grabbed) { h.move(e); return; } if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > 8) { s.moved = true; clearTimeout(s.timer); s.timer = 0; } },
    onPointerUp: () => { const s = g.current; const tap = !s.moved; end(); if (tap) { const now = Date.now(); if (now - s.last < 320) { h.reset?.(); s.last = 0; } else s.last = now; } },
    onPointerCancel: end,
    onTouchMove: (e: TouchEvent) => { if (g.current.grabbed) e.preventDefault(); },
    onContextMenu: (e: Event) => e.preventDefault(),
  };
}
type KP = { label: string; value: number; min: number; max: number; onChange: (v: number) => void; fmt?: (v: number) => string; log?: boolean; color?: string; def?: number; step?: number; instant?: boolean; mark?: boolean };
function Knob({ label, value, min, max, onChange, fmt = (v) => v.toFixed(2), log, color = 'var(--vio)', def, step, instant = false, mark }: KP) {
  const norm = (v: number) => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const den = (n: number) => { let v = log ? min * Math.pow(max / min, n) : min + n * (max - min); if (step) v = Math.round(v / step) * step; return v; };
  const st = useRef({ y: 0, n: 0 });
  const n = Math.max(0, Math.min(1, norm(value))), a = -135 + n * 270;
  const hd = useGrab(instant, {
    start: (e) => { st.current.y = e.clientY; st.current.n = norm(value); },
    move: (e) => onChange(den(Math.max(0, Math.min(1, st.current.n + (st.current.y - e.clientY) / 160)))),
    reset: () => def !== undefined && onChange(def),
  });
  return (
    <div class={'knob' + (instant ? ' instant' : '')} role="slider" aria-label={label} aria-valuenow={value} tabIndex={0} {...(hd as any)}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') onChange(den(Math.min(1, n + 0.03))); if (e.key === 'ArrowDown') onChange(den(Math.max(0, n - 0.03))); }}>
      <svg viewBox="0 0 54 54"><path class="k-tr" d={arc(-135, 135)} stroke="#2a2a2a" stroke-width="5" fill="none" stroke-linecap="round" />
        {n > 0.004 && <path d={arc(-135, a)} stroke={color} stroke-width="5" fill="none" stroke-linecap="round" />}
        <circle class="k-body" cx="27" cy="27" r="14" fill="#1d1d1d" /><line class="k-ptr" x1="27" y1="27" x2="27" y2="15" stroke="#ececec" stroke-width="2.5" stroke-linecap="round" transform={`rotate(${a} 27 27)`} /></svg>
      <div class="kl">{label}{mark && <i class="ka" title="Tiene automatización">A</i>}</div><div class="kv">{fmt(value)}</div>
    </div>
  );
}
function Fader({ value, onChange, color, min = 0, max = 1, def, h = 150, label, instant = false }: { value: number; onChange: (v: number) => void; color: string; min?: number; max?: number; def?: number; h?: number; label: string; instant?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = (value - min) / (max - min), top = 6 + (1 - n) * (h - 12);
  const set = (y: number) => { const r = ref.current!.getBoundingClientRect(); const k = 1 - Math.max(0, Math.min(1, (y - r.top - 6) / (r.height - 12))); onChange(+(min + k * (max - min)).toFixed(3)); };
  const hd = useGrab(instant, { start: (e) => set(e.clientY), move: (e) => set(e.clientY), reset: () => def !== undefined && onChange(def) });
  return (
    <div class={'fader' + (instant ? ' instant' : '')} ref={ref} style={{ height: h + 'px', '--c': color } as any} role="slider" aria-label={label} aria-valuenow={value} tabIndex={0} {...(hd as any)}
      onKeyDown={(e) => { const d = (max - min) / 40; if (e.key === 'ArrowUp') onChange(Math.min(max, value + d)); if (e.key === 'ArrowDown') onChange(Math.max(min, value - d)); }}>
      <div class="track" /><div class="lvl" style={{ height: Math.max(0, h - 6 - top) + 'px', background: color }} /><div class="cap" style={{ top: top + 'px' }} />
    </div>
  );
}
/* pantalla angosta (celu parado): la grilla muestra 8 pasos por vez, con casilleros que se pueden tocar */
function useNarrow() {
  const q = '(max-width: 599px)';
  const [n, setN] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setN(m.matches); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  return n;
}
function useLandscape() {
  const q = '(orientation: landscape) and (max-height: 560px)';
  const [l, setL] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), f = () => setL(m.matches); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  return l;
}
const Icon = {
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5" /></svg>,
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>,
  mix: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v18M12 3v18M18 3v18" /><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor" /><rect x="9.5" y="6" width="5" height="3" rx="1" fill="currentColor" /><rect x="15.5" y="10" width="5" height="3" rx="1" fill="currentColor" /></svg>,
  help: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7" /><path d="M12 17h.01" /></svg>,
  scene: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="5" /><path d="M2 16h20M5 20h14M12 16l-6 6M12 16l6 6" /></svg>,
  master: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h3l3-7 4 14 3-9 2 2h3" /></svg>,
};
/* íconos de línea (24×24): uno por acción e instrumento */
const sv = (d: any, fill = false) => <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>;
const Ic = {
  folder: sv(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  undo: sv(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  redo: sv(<><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>),
  chev: sv(<path d="m9 6 6 6-6 6" />),
  close: sv(<path d="M6 6l12 12M18 6 6 18" />),
  dice: sv(<><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></>),
  refresh: sv(<><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>),
  copy: sv(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>),
  paste: sv(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M9 12h6M9 16h4" /></>),
  trash: sv(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>),
  sort: sv(<><path d="M7 4v16M3 8l4-4 4 4" /><path d="M17 20V4M13 16l4 4 4-4" /></>),
  fill: sv(<><path d="M4 18h2M8 18v-3M12 18v-6M16 18v-9M20 18V5" /></>),
  chain: sv(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  spark: sv(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />),
  sliders: sv(<><path d="M6 4v16M12 4v16M18 4v16" /><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor" /><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor" /><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor" /></>),
  scenes: sv(<><rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /></>),
  curve: sv(<path d="M3 19c5 0 6-14 11-14 3 0 4 4 7 4" />),
  grid: sv(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  rec: sv(<circle cx="12" cy="12" r="6" fill="currentColor" />),
  export: sv(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>),
  eq: sv(<path d="M3 15c2 0 2-6 4-6s2 9 4 9 2-12 4-12 2 7 4 7 2-3 2-3" />),
  space: sv(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" opacity=".6" /><circle cx="12" cy="12" r="10" opacity=".3" /></>),
  midi: sv(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 6v7M11 6v7M15 6v7M19 6v7" /></>),
  phone: sv(<><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>),
  meter: sv(<path d="M4 18V9M9 18V5M14 18v-7M19 18v-4" />),
  // instrumentos
  kick: sv(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>),
  snare: sv(<><ellipse cx="12" cy="8" rx="8" ry="3" /><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8" /></>),
  hat: sv(<><ellipse cx="12" cy="9" rx="9" ry="2.5" /><path d="M12 6.5V4M12 11.5V20M9 20h6" /></>),
  perc: sv(<><path d="M8 4h8l-1 16H9z" /><path d="M8.5 9h7M9 14h6" /></>),
  bass: sv(<path d="M2 12c2.5-7 5-7 7.5 0s5 7 7.5 0 3-4 5-2" stroke-width="2.2" />),
  arp: sv(<path d="M3 19h4v-4h4v-4h4V7h4V3" />),
  chords: sv(<><rect x="4" y="5" width="16" height="3" rx="1" /><rect x="4" y="10.5" width="16" height="3" rx="1" /><rect x="4" y="16" width="16" height="3" rx="1" /></>),
  melody: sv(<><path d="M9 18V5l10-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>),
  mic: sv(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  wave: sv(<path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />),
  notes: sv(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h4M10 13h5M6 16h3" /></>),
  more: sv(<><circle cx="6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18" cy="12" r="1.3" fill="currentColor" /></>),
};
const diff4 = (a?: any[]) => !!a && a.length === 64 && a.some((v, i) => v !== a[i % 16]); // la pista tiene compases distintos
const trackIcon = (t: Track) => t.type === 'vocal' ? Ic.mic : t.type === 'bass' ? Ic.bass : t.type === 'arp' ? Ic.arp : t.type === 'chords' ? Ic.chords : t.type === 'melody' ? Ic.melody
  : t.sound === 'kick' ? Ic.kick : ['hat', 'open', 'ride', 'crash'].includes(t.sound) ? Ic.hat : ['clap', 'snare', 'snare808', 'snareSoft', 'rim', 'rim2'].includes(t.sound) ? Ic.snare : Ic.perc;

/* ---------- panel plegable (como los de Ableton): título con flecha, botones a la derecha y "?" para la ayuda ----------
   Recuerda si lo dejaste abierto (loop.open.<id>). Las explicaciones (.hint) solo se ven al tocar "?". */
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };
function Panel({ id, title, icon, def = true, lock, right, cls = '', children }: { id: string; title: string; icon?: any; def?: boolean; lock?: boolean; right?: any; cls?: string; children: any }) {
  const [open, setOpen] = useState(() => lock || (lsGet('loop.open.' + id) ?? (def ? '1' : '0')) === '1'), [help, setHelp] = useState(false);
  const flip = () => { if (lock) return; const v = !open; setOpen(v); lsSet('loop.open.' + id, v ? '1' : '0'); };
  return (
    <section class={'card panel ' + cls + (open ? ' open' : '') + (help ? ' help' : '')}>
      <div class="ph">
        <button class="ph-t" onClick={flip} aria-expanded={open} disabled={lock}>{!lock && <span class="chev">{Ic.chev}</span>}{icon && <span class="pi">{icon}</span>}<h3>{title}</h3></button>
        {open && right && <div class="ph-r">{right}</div>}
        {open && <button class={'qm' + (help ? ' on' : '')} onClick={() => setHelp(!help)} aria-label={'Ayuda de ' + title} aria-pressed={help}>?</button>}
      </div>
      {open && <div class="pb">{children}</div>}
    </section>
  );
}
/* hoja que sube desde abajo, con fondo oscuro (Mis loops) */
function Sheet({ title, icon, onClose, children }: { title: string; icon?: any; onClose: () => void; children: any }) {
  const [help, setHelp] = useState(false);
  return <div class="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class={'sheet' + (help ? ' help' : '')} role="dialog" aria-modal="true" aria-label={title}>
      <div class="ph"><span class="ph-t">{icon && <span class="pi">{icon}</span>}<h3>{title}</h3></span><button class={'qm' + (help ? ' on' : '')} onClick={() => setHelp(!help)} aria-label="Ayuda">?</button><button class="ib sm" onClick={onClose} aria-label="Cerrar">{Ic.close}</button></div>
      <div class="sheet-b">{children}</div>
    </div>
  </div>;
}
/* vista de detalle del instrumento (abajo, como en Ableton): pestañas Sonido, Notas, Movimiento y Más */
type DTab = 'snd' | 'notes' | 'eq' | 'move' | 'more';
function Detail({ p, t, upT, up, adv, playing, onClose, onDelete, init = 'snd' }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; up: (fn: (d: Project) => void) => void; adv: boolean; playing: boolean; onClose: () => void; onDelete: () => void; init?: DTab }) {
  const [tab, setTab] = useState<DTab>(init), [help, setHelp] = useState(false);
  const hasNotes = t.type === 'melody' || t.type === 'bass' || t.type === 'arp' || t.type === 'chords';
  const tabs: [DTab, string, any][] = [['snd', 'Sonido', Ic.wave], ...(hasNotes ? [['notes', 'Notas', Ic.notes] as [DTab, string, any]] : []), ['eq', 'EQ', Ic.eq], ...(adv && t.type !== 'vocal' ? [['move', 'Movimiento', Ic.curve] as [DTab, string, any]] : []), ['more', 'Más', Ic.more]];
  const cur = tabs.some((x) => x[0] === tab) ? tab : 'snd';
  const canVary = t.type !== 'vocal' && !(t.roll && t.type !== 'melody');
  return (
    <aside class={'detail' + (help ? ' help' : '')} style={{ '--c': t.color } as any} aria-label={'Editor de ' + t.name}>
      <div class="dh">
        <button class={'pw' + (t.mute ? '' : ' on')} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} {...tap(() => upT(t.id, (x) => { x.mute = !x.mute; }))} />
        <span class="ti">{trackIcon(t)}</span><b class="dn">{t.name}</b>
        {canVary && <button class="ib sm" aria-label="Variación" title="Variación" onClick={() => { let msg = ''; upT(t.id, (x) => { msg = varyTrack(p, x); }); setTimeout(() => msg && flashG(t.name + ': ' + msg), 0); }}>{Ic.dice}</button>}
        <button class={'qm' + (help ? ' on' : '')} onClick={() => setHelp(!help)} aria-label="Ayuda">?</button>
        <button class="ib sm" onClick={onClose} aria-label="Cerrar editor">{Ic.close}</button>
      </div>
      <div class="dtabs">{tabs.map(([k, l, ic]) => <button class={cur === k ? 'on' : ''} onClick={() => setTab(k)}>{ic}<span>{l}</span></button>)}</div>
      <div class="db">
        {cur === 'snd' && (t.type === 'vocal' ? <><VocalEditor p={p} t={t} upT={upT} power={null} onDelete={onDelete} bare /><PitchRow t={t} upT={upT} /></> : <TrackEditor p={p} t={t} upT={upT} up={up} part="snd" adv={adv} />)}
        {cur === 'notes' && <TrackEditor p={p} t={t} upT={upT} up={up} part="notes" adv={adv} />}
        {cur === 'eq' && <EqEditor t={t} upT={upT} />}
        {cur === 'move' && <AutoEditor key={t.id} t={t} upT={upT} playing={playing} bare />}
        {cur === 'more' && <>
          <TrackTools p={p} t={t} upT={upT} />
          {adv && <GroupPick p={p} t={t} upT={upT} />}
          <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div>
          <div class="hint">"Copiar patrón" lo guarda y "Pegar" lo pone en otra pista, incluso en otro loop. El dado de arriba (Variación) le da otro patrón a este instrumento.</div>
        </>}
      </div>
    </aside>
  );
}
/* escenas A..D en el transporte (siempre a mano); con modo Avanzado, también cadena y redoble */
function SceneBar({ p, go, queued, up, adv }: { p: Project; go: (k: string) => void; queued: string | null; up: (fn: (d: Project) => void) => void; adv: boolean }) {
  const cur = p.scene ?? 'A';
  return <div class="scenebar">
    <span class="sb-l">Escena</span>
    {SCENES.map((k) => <button class={'scn' + (k === cur ? ' on' : '') + (sceneUsed(p, k) ? ' used' : '') + (queued === k ? ' q' : '')} aria-label={'Escena ' + k} {...tap(() => go(k))}>{k}</button>)}
    <div class="sp" />
    {adv && <button class={'ib sm' + (p.chain ? ' on' : '')} onClick={() => up((d) => { d.chain = !d.chain; })} aria-label="Cadena: pasar solas las escenas" aria-pressed={!!p.chain} title="Cadena">{Ic.chain}</button>}
    <button class={'ib sm' + (p.fill ? ' on' : '')} onClick={() => up((d) => { d.fill = !d.fill; })} aria-label="Redoble al final" aria-pressed={!!p.fill} title="Redoble">{Ic.fill}</button>
  </div>;
}

const pct = (v: number) => Math.round(v * 100) + '%';
const hz = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '');

/* ---------- app ---------- */
function App() {
  const [p, setP] = useState<Project>(() => load() ?? { ...blankProject({ tonic: 9, mode: 'min', degrees: [0, 5, 2, 6], ext: 7 }, 'deep', 122, true), title: 'Loop 1' });
  const [recA, setRecA] = useState(false); // grabar movimientos
  // modo Simple (por defecto) o Avanzado: el avanzado muestra automatización, sinte pro, MIDI, grupos, EQ e insertos
  const [adv, setAdvS] = useState(() => { try { return localStorage.getItem('loop.adv') === '1'; } catch { return false; } });
  const setAdv = (v: boolean) => { setAdvS(v); try { localStorage.setItem('loop.adv', v ? '1' : '0'); } catch { /* */ } };
  const [tab, setTab] = useState<'scene' | 'pat' | 'mix' | 'master'>('scene');
  const [vis, setVis] = useState<StageMode>('wave');
  const [order, setOrder] = useState(false);
  const land = useLandscape(), narrow = useNarrow();
  const [half, setHalf] = useState(0), viewRef = useRef({ narrow: false, half: 0 }); viewRef.current = { narrow, half }; // mitad del compás a la vista (pasos 1–8 o 9–16)
  // guías: la intro aparece al abrir (salvo "No mostrar al abrir"); la de cada sección, la primera vez que entrás. El botón Guía las vuelve a abrir.
  const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return '1'; } }, set: (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* */ } } };
  const [guide, setGuide] = useState<TutKey | null>(() => (ls.get('loop.noTutorial') ? null : 'intro'));
  const closeGuide = (never: boolean) => {
    const g = guide; if (!g) return;
    if (g === 'intro') { ls.set('loop.noTutorial'); void never; setGuide(null); return; }
    ls.set('loop.seen.' + g); setGuide(null);
  };
  const goTab = (t: 'scene' | 'pat' | 'mix' | 'master') => { setTab(t); if (!guide && !ls.get('loop.seen.' + t)) { ls.set('loop.seen.' + t); flash('Tocá "Guía" (abajo a la derecha) para ver cómo se usa esta sección.', 3500); } };
  const [sel, setSel] = useState('arp');
  const [playing, setPlaying] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  // grabar la sesión: todo lo que suena, con lo que vayas tocando, hasta 10 minutos
  const [rec, setRec] = useState(false), [recSecs, setRecSecs] = useState(0), [take, setTake] = useState<Take | null>(null);
  const recTimer = useRef<any>(0);
  const toggleRec = async () => {
    if (!rec) {
      try {
        await engine.startSession(p); setRec(true); setPlaying(true); setRecSecs(0);
        recTimer.current = setInterval(() => { const sec = engine.sessionFrames / engine.sr; setRecSecs(sec); if (sec >= 600) stopRec(true); }, 500);
      } catch (e) { console.error(e); flash('No se pudo empezar a grabar en este navegador.', 4000); }
      return;
    }
    stopRec(false);
  };
  const stopRec = async (limit: boolean) => {
    clearInterval(recTimer.current); const t = await engine.stopSession(); setRec(false);
    if (t && t.frames > 0) { setTake(t); flash((limit ? 'Llegaste a los 10 minutos. ' : '') + 'Sesión grabada: la descargás en Master.', 4000); }
  };
  const phRef = useRef<HTMLStyleElement>(null), meterRef = useRef<HTMLElement>(null), barRef = useRef<HTMLElement>(null), lufsRef = useRef<HTMLElement>(null);
  const [stats, setStats] = useState({ lufs: -70, auto: 0, gr: 0 });
  const vuRefs = useRef<Record<string, HTMLElement | null>>({});

  // deshacer / rehacer: los cambios seguidos (una perilla que se arrastra) cuentan como uno solo
  const hist = useRef({ past: [] as Project[], future: [] as Project[], t: 0 });
  const remember = (cur: Project, force = false) => { const h = hist.current, now = performance.now(); if (force || now - h.t > 700 || !h.past.length) { h.past.push(cur); if (h.past.length > 80) h.past.shift(); } h.t = now; h.future = []; };
  const up = (fn: (d: Project) => void, atLoop = false) => setP((cur) => { remember(cur); const d = clone(cur); fn(d); d.edited = true; engine.update(d, atLoop); save(d); return d; });
  const restore = (np: Project) => { setP(np); engine.update(np); save(np); hist.current.t = 0; };
  const undo = () => { const h = hist.current, prev = h.past.pop(); if (!prev) return; h.future.push(pRef.current); restore(prev); flash('Deshecho'); };
  const redo = () => { const h = hist.current, nx = h.future.pop(); if (!nx) return; h.past.push(pRef.current); restore(nx); flash('Rehecho'); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === 'INPUT') return; const z = e.key.toLowerCase(); if (z === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (z === 'y' || (z === 'z' && e.shiftKey)) { e.preventDefault(); redo(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  // escenas: si está sonando, el cambio entra al terminar la vuelta
  const [queued, setQueued] = useState<string | null>(null), queuedRef = useRef<string | null>(null);
  const goScene = (k: string, auto = false) => {
    if (k === (pRef.current.scene ?? 'A') && !queuedRef.current) return;
    const live = engine.playing;
    setP((cur) => { if (!auto) remember(cur, true); const d = clone(cur); switchScene(d, k); if (!auto) d.edited = true; engine.update(d, live); save(d); return d; });
    if (live) { queuedRef.current = k; setQueued(k); }
  };
  useEffect(() => { onSaveFail = () => flash('No queda lugar en el celu para guardar: borrá algún loop en Mis loops.', 5000); engine.update(p); save(p); loadVoxes(p); setTimeout(() => sweepVox().catch(() => {}), 4000); }, []);
  // abrir otro proyecto: suena al instante (si estaba sonando, sigue) y se cargan sus voces
  const openProject = (np: Project) => { flushSave(); hist.current = { past: [], future: [], t: 0 }; queuedRef.current = null; setQueued(null); setP(np); engine.update(np); save(np); loadVoxes(np); if (!np.tracks.some((t) => t.id === sel)) setSel(np.tracks[0]?.id ?? ''); };
  const toggleRecA = () => { const on = !REC.on; REC.on = on; setRecA(on); if (on) { if (!engine.playing) toggle(); flash('Grabando movimientos: lo que muevas en el Mixer o en las Macros queda en la automatización.', 3500); } };
  useEffect(() => {
    let lastStat = 0;
    engine.onStep = (s) => {
      const i = s % 16 + 1; engine.beat.step = s; setPlaying(true); // por si arrancó desde la grabación de voz
      const k = pRef.current.tracks.find((t) => t.type === 'drum' && t.sound === 'kick' && !t.mute);
      if (k && k.steps[s % k.steps.length]) engine.beat.t = performance.now();
      const seen = !vbRef.current || Math.floor(s / 16) + 1 === vbRef.current;
      const vw = viewRef.current, i16 = s % 16, pad = vw.narrow ? (Math.floor(i16 / 8) === vw.half ? (i16 % 8) + 1 : 0) : i;
      if (phRef.current) phRef.current.textContent = (seen && pad ? `.pads>.pad:nth-child(${pad}){outline:2px solid #fff;outline-offset:-2px}` : '') + `.halfsel button:nth-child(${Math.floor(i16 / 8) + 1}){box-shadow:inset 0 -3px 0 var(--mint)}.leds span:nth-child(${i}){background:var(--mint);box-shadow:0 0 8px var(--mint)}.barsel button:nth-child(${Math.floor(s / 16) + 2}){box-shadow:inset 0 -3px 0 var(--mint)}`;
      if (barRef.current) barRef.current.textContent = String(Math.floor(s / 16) + 1);
      if (s === 0 && queuedRef.current) { queuedRef.current = null; setQueued(null); }
      // cadena: en el último compás se pone en cola la escena siguiente
      if (s === 48 && pRef.current.chain && !queuedRef.current) { const nx = nextScene(pRef.current); if (nx !== (pRef.current.scene ?? 'A')) goSceneRef.current(nx, true); }
    };
    engine.onMeter = (m) => {
      const db = 20 * Math.log10(Math.max(1e-5, m.peak));
      if (meterRef.current) meterRef.current.style.width = Math.max(0, Math.min(100, (db + 40) / 40 * 100)) + '%';
      if (lufsRef.current) lufsRef.current.textContent = m.lufs > -60 ? m.lufs.toFixed(1) : '–';
      m.tracks.forEach((v, k) => { const id = pRef.current.tracks[k]?.id; const el = id && vuRefs.current[id]; if (el) el.style.width = Math.min(100, v * 160) + '%'; });
      const now = performance.now(); if (now - lastStat > 400) { lastStat = now; setStats({ lufs: m.lufs, auto: m.auto, gr: m.gr }); }
    };
  }, []);
  const pRef = useRef(p); pRef.current = p;
  const goSceneRef = useRef(goScene); goSceneRef.current = goScene;
  /* MIDI: perillas a macros y volúmenes (una vez por cuadro), pads a escenas, mute, play, redoble y deshacer; las teclas tocan la pista elegida */
  const midiQ = useRef<Record<string, number>>({}), midiRaf = useRef(0);
  midi.onMsg = (m: MidiMsg, target: string | null) => {
    if (!target) { if (midi.keys && m.kind === 'on') { const t = pRef.current.tracks.find((x) => x.id === sel); if (t && t.type !== 'vocal') engine.preview(t.id, m.n); } return; }
    const [kind, arg] = target.split(':'), press = m.kind === 'on' || (m.kind === 'cc' && m.v > 0.5 && (midiQ.current['btn:' + target] ?? 0) <= 0.5);
    if (m.kind === 'cc') midiQ.current['btn:' + target] = m.v;
    if (kind === 'macro' || kind === 'vol') { if (m.kind === 'off') return; midiQ.current[target] = m.v; cancelAnimationFrame(midiRaf.current); midiRaf.current = requestAnimationFrame(() => { const q = midiQ.current; up((d) => { for (const key in q) { if (key.startsWith('btn:')) continue; const [kk, a] = key.split(':'), v = q[key]; if (kk === 'macro') applyMacro(d, a as MacroKey, v); else { const x = d.tracks.find((y) => y.id === a); if (x) applyAK(x, 'vol', v); } } Object.keys(q).forEach((key) => { if (!key.startsWith('btn:')) delete q[key]; }); }); }); return; }
    if (!press) return;
    if (kind === 'scene') goScene(arg);
    else if (kind === 'mute') up((d) => { const x = d.tracks.find((y) => y.id === arg); if (x) x.mute = !x.mute; });
    else if (kind === 'play') toggle();
    else if (kind === 'fill') up((d) => { d.fill = !d.fill; });
    else if (kind === 'undo') undo();
  };
  midi.onLearned = (mp) => flash('Asignado: ' + midiLabel(pRef.current, mp.target));

  const toggle = async () => {
    if (engine.playing) { engine.stop(); setPlaying(false); if (phRef.current) phRef.current.textContent = ''; return; }
    await engine.play(p); setPlaying(true); checkAudio();
  };
  // si a los 1,5 s el audio sigue trabado (pasa en algunos iPhone), avisamos qué revisar
  const checkAudio = () => setTimeout(() => { if (engine.playing && engine.state !== 'running') flash('No se escucha? Tocá play de nuevo, subí el volumen y revisá que el celu no esté en silencio.', 6000); }, 1500);
  // al volver a la app (o tras una llamada) el audio puede quedar suspendido: se reanuda solo o con el próximo toque
  useEffect(() => { const w = () => engine.wake(); document.addEventListener('visibilitychange', w); window.addEventListener('pointerdown', w, true); window.addEventListener('focus', w); return () => { document.removeEventListener('visibilitychange', w); window.removeEventListener('pointerdown', w, true); window.removeEventListener('focus', w); }; }, []);
  // el primer toque en cualquier parte destraba el audio (iPhone)
  useEffect(() => {
    if (!('AudioWorkletNode' in window)) { setNoAudio(true); return; }
    const f = () => { engine.unlock(); ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.removeEventListener(e, f, true)); };
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.addEventListener(e, f, true));
  }, []);

  // desde cero: loop vacío con la tonalidad y los acordes elegidos (no pisa un loop editado, igual que generar)
  const fromScratch = (m: Manual, genre: string, drums: boolean, title: string) => {
    const np = blankProject(m, genre, p.bpm, drums); np.title = title.trim().slice(0, 32) || nextTitle(); np.id = p.edited ? newId() : p.id; np.edited = true;
    if (p.edited) flash('"' + titleOf(p) + '" quedó guardado en Mis loops');
    remember(p, true); flushSave(); setP(np); engine.update(np); save(np);
    setTimeout(() => { goTab('pat'); flash(drums ? 'Loop nuevo con la batería del género: sumale bajo, acordes y melodía.' : 'Loop vacío: tocá los casilleros para armar tu ritmo.', 3500); }, 0);
  };
  const tr = p.tracks.find((t) => t.id === sel) ?? p.tracks[0];
  const [toast, setToast] = useState('');
  const toastT = useRef<any>(0);
  const flash = (m: string, ms = 1800) => { clearTimeout(toastT.current); setToast(m); toastT.current = setTimeout(() => setToast(''), ms); };
  flashG = flash;
  const [fxAll, setFxAll] = useState(false), [fxOpen, setFxOpen] = useState<Record<string, boolean>>({}); // mixer compacto: efectos plegados
  // editar un paso: en "Todos" cambia ese paso en los 4 compases; en un compás, solo ahí (la pista pasa a tener 4 compases distintos)
  const k64 = (i: number) => (vb - 1) * 16 + i;
  const val = <T,>(a: T[], i: number) => a[(vb ? k64(i) : i) % a.length];
  const cycStep = (x: Track, i: number) => {
    if (vb) { x.steps = expand64(x.steps); if (x.type === 'bass' && x.bassLine) x.bassLine = expand64(x.bassLine); x.steps[k64(i)] = (x.steps[k64(i)] + 1) % 3; return; }
    const nv = ((x.steps[i] ?? 0) + 1) % 3; if (x.steps.length === 64) for (let b = 0; b < 4; b++) x.steps[b * 16 + i] = nv; else x.steps[i] = nv;
  };
  const flipGate = (x: Track, i: number) => {
    const g = x.arp!.gate;
    if (vb) { x.arp!.gate = expand64(g); x.arp!.gate[k64(i)] = !x.arp!.gate[k64(i)]; return; }
    const nv = !g[i]; if (g.length === 64) for (let b = 0; b < 4; b++) g[b * 16 + i] = nv; else g[i] = nv;
  };
  /* copiar el compás que se ve a los otros tres, o vaciarlo (en todas las pistas con pasos) */
  const barOp = (op: 'copy' | 'clear') => up((d) => d.tracks.forEach((t) => {
    const b0 = (vb - 1) * 16, fix = (a: any[], z: any) => { const e = expand64(a); for (let k = 0; k < 16; k++) { if (op === 'clear') e[b0 + k] = z; else for (let b = 0; b < 4; b++) e[b * 16 + k] = e[b0 + k]; } return e; };
    if (t.type === 'drum' || t.type === 'bass' || (t.type === 'chords' && (t.chordMode ?? 'pad') !== 'pad')) { if (!t.roll) t.steps = fix(t.steps, 0); if (t.type === 'bass' && t.bassLine && op === 'copy') t.bassLine = fix(t.bassLine, 0); }
    if (t.type === 'arp' && t.arp && !t.roll) t.arp.gate = fix(t.arp.gate, false);
  }));
  const stepEdit = (t: Track, fn: (x: Track) => void) => { try { navigator.vibrate?.(8); } catch { /* sin vibración */ } const wasMuted = t.mute; upT(t.id, (x) => { fn(x); if (x.mute) x.mute = false; }); if (wasMuted) flash(t.name + ' encendida'); };
  const upT = (id: string, fn: (t: Track) => void) => up((d) => fn(d.tracks.find((t) => t.id === id)!));
  const arpNotes = useMemo(() => { const o: Record<string, (s: number) => number> = {}; p.tracks.forEach((t) => { if (t.type === 'arp') o[t.id] = arpPreview(p, t); }); return o; }, [p]);

  const [vb, setVbS] = useState(0), vbRef = useRef(0); vbRef.current = vb; // compás que se edita en la grilla: 0 = todos (el mismo en los 4)
  const setVb = (v: number) => setVbS(v);
  const [detail, setDetail] = useState(false), [loopsOpen, setLoopsOpen] = useState(false), [dTab, setDTab] = useState<DTab>('snd');
  const pick = (id: string, tb: DTab = 'snd') => { if (id === sel && detail && tb === dTab) setDetail(false); else { setSel(id); setDTab(tb); setDetail(true); } };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDetail(false); setLoopsOpen(false); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const delTrack = () => { if (!tr) return; const left = p.tracks.filter((x) => x.id !== tr.id); if (!left.length) return; up((d) => { d.tracks = d.tracks.filter((x) => x.id !== tr.id); }); setSel(left[0].id); setDetail(false); flash(tr.name + ' eliminada'); };
  const showDetail = detail && (tab === 'pat' || tab === 'mix') && !!tr;
  // al abrir el editor, la fila del instrumento elegido queda a la vista arriba de él
  useEffect(() => { if (showDetail && tab === 'pat') setTimeout(() => document.querySelector('.tname[data-tid="' + sel + '"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }, [showDetail, sel, tab]);

  return (
    <div class={'app' + (adv ? ' adv' : ' simple') + (showDetail ? ' has-detail' : '')}>
      <style ref={phRef} />
      <header class="top">
        <div class="logo" aria-label="Loop">LOOP<i class={playing ? 'on' : ''} /></div>
        <button class="tb proj" onClick={() => setLoopsOpen(true)} aria-label="Mis loops">{Ic.folder}<span>{titleOf(p)}</span></button>
        <div class="sp" />
        <button class="tb" disabled={!hist.current.past.length} onClick={undo} aria-label="Deshacer">{Ic.undo}</button>
        <button class="tb" disabled={!hist.current.future.length} onClick={redo} aria-label="Rehacer">{Ic.redo}</button>
        <button class={'tb mode' + (adv ? ' on' : '')} onClick={() => setAdv(!adv)} aria-pressed={adv} title="Muestra u oculta las funciones avanzadas">{adv ? 'Avanzado' : 'Simple'}</button>
      </header>

      <div class="transport">
        <div class="tr-row">
          <button class={'playbtn' + (playing ? ' on' : '')} onClick={toggle} aria-label={playing ? 'Parar' : 'Reproducir'}>{playing ? Icon.stop : Icon.play}</button>
          <button class={'recbtn' + (rec ? ' on' : '')} onClick={toggleRec} aria-label={rec ? 'Terminar de grabar la sesión' : 'Grabar sesión'}><i /></button>
          <div class="lcd">
            <div class="l1">{rec ? <span class="rec-t">● <b>{fmtT(recSecs)}</b></span> : <span>BAR <b ref={barRef as any}>1</b>/4</span>}<span class="chs"><b>{p.chords[0]?.name}</b> · {p.chords.slice(1).map((c) => c.name).join(' · ')}</span><span><b ref={lufsRef as any}>–</b> LUFS</span></div>
            <div class="leds">{Array.from({ length: 16 }, (_, i) => <span class={i % 4 === 0 ? 'q' : ''} />)}</div>
            <div class="meter"><i ref={meterRef as any} /></div>
          </div>
          <div class="tr-undo"><button class="undo" disabled={!hist.current.past.length} onClick={undo} aria-label="Deshacer (transporte)">{Ic.undo}</button><button class="undo" disabled={!hist.current.future.length} onClick={redo} aria-label="Rehacer (transporte)">{Ic.redo}</button></div>
          <Bpm bpm={p.bpm} set={(v) => up((d) => { d.bpm = Math.max(60, Math.min(200, Math.round(v))); })} />
        </div>
        <SceneBar p={p} go={goScene} queued={queued} up={up} adv={adv} />
      </div>

      {tab === 'scene' && <div class="page scene">
        <div class="a-stage">
          <Stage engine={engine} mode={vis} bpm={p.bpm} playing={playing} onTap={toggle} hud={{ name: titleOf(p), key: p.key ?? '', genre: GENRES[p.genre]?.name ?? '' }} />
          <div class="seg2 vis-seg">{([['wave', 'Onda'], ['spectrum', 'Espectro'], ['circle', 'Círculo']] as const).map(([k, l]) => <button class={vis === k ? 'on' : ''} onClick={() => setVis(k)}>{l}</button>)}</div>
        </div>
        <Panel id="name" title="Armar" icon={Ic.spark} cls="a-name">
          <Scratch p={p} up={up} create={fromScratch} />
        </Panel>
        <Panel id="macros" title="Macros" icon={Ic.sliders} cls="a-macros" right={<>{adv && <RecChip on={recA} toggle={toggleRecA} />}<button class="chip" onClick={() => up((d) => { d.macros = { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 }; })}>Centrar</button></>}>
          <div class="macros">
            {MACROS.map((m) => { const base = (p.macros ?? { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 })[m.k], ma = p.macroAuto?.[m.k], v = ma ? ma[stepNow()] ?? base : base; return <div class="macro">
              <Fader h={land ? 92 : 128} label={m.label} value={v} def={0.5} color={m.color} onChange={(x) => up((d) => applyMacro(d, m.k, x))} />
              <b style={{ color: m.color }}>{m.label}{ma && <i class="ka">A</i>}</b><span>{Math.round(v * 100)}</span>
            </div>; })}
          </div>
          <div class="hint">Energía: más brillo, saturación y hats. Oscuridad: cierra los filtros. Espacio: más reverb y delay. Groove: más swing y arrastre. Al medio queda como lo armó el género.</div>
          {adv && <MacroAuto p={p} up={up} playing={playing} />}
        </Panel>
        {adv && <Panel id="scenes" title="Escenas" icon={Ic.scenes} def={false} cls="a-scenes"><Scenes p={p} up={up} /></Panel>}
        {adv && <Panel id="quick" title="Automatización rápida" icon={Ic.curve} def={false} cls="a-auto">
          <div class="chips">{QUICK_AUTO.map(([n, fn]) => <button class="chip" onClick={() => { up((d) => fn(d)); flash(n === 'Borrar todo' ? 'Automatización borrada' : n + ' aplicada'); }}>{n}</button>)}</div>
          <div class="hint">Mueven varios instrumentos a lo largo de los 4 compases. Para dibujar la tuya, abrí un instrumento en Patrón y andá a Movimiento.</div>
        </Panel>}
        <Panel id="kits" title="Batería" icon={Ic.kick} def={false} cls="a-kits">
          <div class="chips">{Object.keys(KITS).map((k) => <button class={'chip' + (p.kit === k ? ' on' : '')} onClick={() => up((d) => { d.kit = k; })}>{KITS[k].label.replace('Kit ', '')}</button>)}</div>
          <div class="hint">Cambia el sonido del bombo, el clap, los hats y el redoblante sin tocar el patrón.</div>
        </Panel>
      </div>}

      {tab === 'pat' && <div class="page pat">
        <Panel id="grid" title="Patrón" icon={Ic.grid} lock cls="a-grid" right={<>
          {adv && <button class={'ib sm' + (order ? ' on' : '')} onClick={() => setOrder(!order)} aria-label="Ordenar pistas">{Ic.sort}</button>}
          <button class={'ib sm' + (p.fill ? ' on' : '')} onClick={() => up((d) => { d.fill = !d.fill; })} aria-label="Redoble al final" aria-pressed={!!p.fill}>{Ic.fill}</button>
          <button class="ib sm" onClick={() => up((d) => d.tracks.forEach((t) => { if (t.type === 'drum') t.steps = Array(16).fill(0); }))} aria-label="Vaciar batería">{Ic.trash}</button>
        </>}>
          {adv && <Groups p={p} up={up} />}
          <div class="barsel-w"><span class="sb-l">Compás</span><div class="seg barsel">{['Todos', '1', '2', '3', '4'].map((l, k) => <button class={vb === k ? 'on' : ''} onClick={() => setVb(k)} aria-label={k ? 'Editar el compás ' + k : 'Editar los 4 compases juntos'}>{l}</button>)}</div></div>
          {narrow && !order && <div class="barsel-w"><span class="sb-l">Pasos</span><div class="seg halfsel">{['1 – 8', '9 – 16'].map((l, k) => <button class={half === k ? 'on' : ''} onClick={() => setHalf(k)} aria-label={'Ver los pasos ' + l}>{l}</button>)}</div></div>}
          {vb > 0 && <div class="chips" style={{ margin: '-2px 0 8px' }}><button class="chip ic" onClick={() => { barOp('copy'); flash('Compás ' + vb + ' copiado a los 4'); }}>{Ic.copy}Copiar a los 4 compases</button><button class="chip ic" onClick={() => { barOp('clear'); flash('Compás ' + vb + ' vacío'); }}>{Ic.trash}Vaciar compás {vb}</button></div>}
          <div class="grid">
            {p.tracks.map((t, ti) => <>
              <button class={'pw' + (t.mute ? '' : ' on')} style={{ '--c': t.color } as any} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} {...tap(() => upT(t.id, (x) => { x.mute = !x.mute; }))} />
              <button class={'tname' + (sel === t.id && showDetail ? ' sel' : '') + (t.mute || gMuted(p, t) ? ' mute' : '')} style={{ '--c': t.color } as any} data-tid={t.id} onClick={() => pick(t.id)} aria-label={'Abrir ' + t.name}>
                <span class="ti">{trackIcon(t)}</span><span class="tn">{t.name}</span>{(diff4(t.steps) || diff4(t.arp?.gate) || diff4(t.bassLine)) && <span class="b4" title="Tiene compases distintos">4</span>}{t.auto && Object.keys(t.auto).length > 0 && <span class="au" title="Tiene automatización">A</span>}<i class="vu" ref={(el) => { vuRefs.current[t.id] = el; }} />
              </button>
              {order ? <div class="ord">
                <button class="btn" disabled={ti === 0} aria-label={'Subir ' + t.name} {...tap(() => up((d) => { const k = d.tracks.findIndex((x) => x.id === t.id); if (k > 0) [d.tracks[k - 1], d.tracks[k]] = [d.tracks[k], d.tracks[k - 1]]; }))}>▲ Subir</button>
                <button class="btn" disabled={ti === p.tracks.length - 1} aria-label={'Bajar ' + t.name} {...tap(() => up((d) => { const k = d.tracks.findIndex((x) => x.id === t.id); if (k >= 0 && k < d.tracks.length - 1) [d.tracks[k + 1], d.tracks[k]] = [d.tracks[k], d.tracks[k + 1]]; }))}>▼ Bajar</button>
                {t.group && <span class="gtag">{p.groups?.find((g) => g.id === t.group)?.name}</span>}
              </div> : t.type === 'vocal' ? <button class="pads vrow" style={{ '--c': t.color } as any} aria-label={'Editar ' + t.name} onClick={() => { setSel(t.id); setDetail(true); }}>
                {[0, 1, 2, 3].map((b) => <i style={{ left: b * 25 + '%' }} />)}
                {t.vox?.has ? <b style={{ left: ((t.vox.pos ?? 0) / 64) * 100 + '%' }}>{t.vox.rev ? 'voz al revés' : 'voz · 4 compases'}</b> : <b style={{ left: 0, opacity: 0.6 }}>tocá para grabar</b>}
              </button> : <div class={'pads' + (narrow ? ' p8' : '')}>
                {Array.from({ length: narrow ? 8 : 16 }, (_, j) => {
                  const i = (narrow ? half * 8 : 0) + j;
                  const open = () => { setSel(t.id); setDetail(true); };
                  const inBar = (n: { s: number }) => n.s % 16 === i && (!vb || Math.floor(n.s / 16) === vb - 1);
                  if (t.roll && t.type !== 'melody') {
                    const hit = (t.notes ?? []).filter(inBar);
                    return <button class={'pad' + (hit.length ? ' v1' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`} onClick={open}>{hit[0] && <span class="nn">{noteName(hit[0].n)}</span>}</button>;
                  }
                  if (t.type === 'arp') {
                    const si = vb ? k64(i) : i, on = val(t.arp!.gate, i), plays = arpPlays(t, si), nf = arpNotes[t.id];
                    return <button class={'pad' + (!on ? ' off' : plays ? ' v1' : ' skip')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                      {...tap(() => stepEdit(t, (x) => flipGate(x, i)))}>{on && plays && nf && <span class="nn">{noteName(nf(si))}</span>}</button>;
                  }
                  if (t.type === 'melody') {
                    const hit = (t.notes ?? []).filter(inBar);
                    return <button class={'pad' + (hit.length ? ' v1' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`} onClick={open}>{hit[0] && <span class="nn">{noteName(hit[0].n)}</span>}</button>;
                  }
                  if (t.type === 'chords' && (t.chordMode ?? 'pad') === 'pad') return <button class={'pad' + (i % 16 === 0 ? ' v2' : ' v1')} style={{ '--c': t.color, opacity: i ? 0.35 : 1 } as any} aria-label="Acorde sostenido" onClick={open} />;
                  const v = val(t.steps, i);
                  return <button class={'pad' + (v === 1 ? ' v1' : v === 2 ? ' v2' : v === 3 ? ' v1 gh' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                    {...tap(() => stepEdit(t, (x) => cycStep(x, i)))} />;
                })}
              </div>}
            </>)}
          </div>
          <AddTrack onAdd={(type, sound) => { let id = ''; up((d) => { if (d.tracks.length >= 16) return; const nt = newTrack(d, type, sound); id = nt.id; if (type === 'drum' && d.groups?.some((g) => g.id === 'drums')) nt.group = 'drums'; d.tracks.push(nt); }); setTimeout(() => { if (id) { setSel(id); setDetail(true); } }, 0); }} full={p.tracks.length >= 16} />
          <div class="hint">Tocá el nombre de un instrumento para abrir su editor abajo (sonido, notas y más). El botón de color de la izquierda lo enciende o apaga. En la grilla, un toque prende el golpe, otro lo acentúa y el tercero lo apaga; los casilleros tenues son golpes suaves. Arriba a la derecha: redoble al final de cada vuelta y vaciar la batería.</div>
        </Panel>
      </div>}
      {showDetail && tr && <Detail key={tr.id + dTab} init={dTab} p={p} t={tr} upT={upT} up={up} adv={adv} playing={playing} onClose={() => setDetail(false)} onDelete={delTrack} />}
      {toast && <div class="toast">{toast}</div>}
      {noAudio && <div class="toast">Este navegador no puede reproducir el audio de la app. En iPhone hace falta iOS 14.5 o más nuevo: actualizá el sistema o probá con otro navegador.</div>}

      {tab === 'mix' && <div class="page mix"><Panel id="mixer" title="Mixer" icon={Icon.mix} lock right={adv ? <><RecChip on={recA} toggle={toggleRecA} /><button class={'chip' + (fxAll ? ' on' : '')} onClick={() => { setFxAll(!fxAll); setFxOpen({}); }}>{fxAll ? 'Plegar' : 'Efectos'}</button></> : undefined}>
        {adv && <Groups p={p} up={up} />}
        <div class="mixer">
          {p.tracks.map((t) => { const K = (k: keyof typeof AKN) => autoKnob(t, k, upT), vol = K('vol'), open = adv && (fxOpen[t.id] ?? fxAll);
            const f = t.fx ?? {}, nfx = [t.rev > 0.01, t.dly > 0.01, (f.drive ?? 0) > 0.01, (f.chorus ?? 0) > 0.01, !!f.hp, !!f.lp, !!f.crush, !!f.phaser].filter(Boolean).length + (t.auto ? Object.keys(t.auto).length : 0);
            return (
            <div class={'strip' + (gMuted(p, t) ? ' gmute' : '') + (open ? ' open' : '')} style={{ '--c': t.color } as any}>
              <button class="nm" onClick={() => pick(t.id, 'eq')} aria-label={'Abrir ' + t.name}><span class="ti">{trackIcon(t)}</span>{t.name}{vol.mark && <i class="ka">A</i>}</button>
              {adv && <div class="gt">{t.group ? p.groups?.find((g) => g.id === t.group)?.name : ' '}</div>}
              <Fader h={land ? 96 : 150} label={'Volumen ' + t.name} value={vol.value} def={0.8} color={t.color} onChange={vol.onChange} />
              <div class="ms">
                <button class={'m' + (t.mute ? ' on' : '')} {...tap(() => upT(t.id, (x) => { x.mute = !x.mute; }))} aria-label={'Mutear ' + t.name}>M</button>
                <button class={'s' + (t.solo ? ' on' : '')} {...tap(() => upT(t.id, (x) => { x.solo = !x.solo; }))} aria-label={'Solo ' + t.name}>S</button>
              </div>
              <div class="mini"><Knob label="Pan" {...K('pan')} min={-1} max={1} def={0} color={t.color} fmt={(v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100))} /></div>
              <button class={'fxbtn eqb' + (t.eq?.some((b) => Math.abs(b.g) > 0.05) ? ' on' : '')} onClick={() => pick(t.id, 'eq')} aria-label={'Ecualizador de ' + t.name}>EQ</button>
              {adv && <button class="fxbtn" aria-expanded={open} onClick={() => setFxOpen({ ...fxOpen, [t.id]: !open })}>{open ? 'Cerrar' : 'Efectos'}{!open && nfx > 0 && <i>{nfx}</i>}</button>}
              {open && <>
              <div class="kn4">
              <div class="mini"><Knob label="Reverb" {...K('rev')} min={0} max={1} def={0} color="var(--mint)" fmt={pct} /></div>
              <div class="mini"><Knob label="Delay" {...K('dly')} min={0} max={1} def={0} color="var(--mint)" fmt={pct} /></div>
              {t.id === 'kick' ? <div class="mini" /> : <div class="mini"><Knob label="Sidechain" value={t.duck} min={0} max={1} def={0} color="var(--hot)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.duck = v; })} /></div>}
              <div class="mini"><Knob label="Saturación" {...K('drive')} min={0} max={1} def={0} color="var(--hot)" fmt={pct} /></div>
              </div>
              <div class="kn4">
              <div class="mini"><Knob label="Chorus" value={f.chorus ?? 0} min={0} max={1} def={0} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, chorus: v }; })} /></div>
              <div class="mini"><Knob label="Corta graves" {...K('hp')} min={20} max={2000} log def={20} color={t.color} fmt={(v) => (v <= 21 ? 'no' : hz(v))} /></div>
              <div class="mini"><Knob label="Corta agudos" {...K('lp')} min={200} max={20000} log def={20000} color={t.color} fmt={(v) => (v >= 19500 ? 'no' : hz(v))} /></div>
              <div class="mini"><Knob label="Bitcrusher" value={f.crush ?? 0} min={0} max={1} def={0} color="var(--red)" fmt={(v) => (v < 0.01 ? 'no' : pct(v))} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, crush: v < 0.01 ? 0 : v }; })} /></div>
              </div>
              <div class="kn4">
              <div class="mini"><Knob label="Phaser" value={f.phaser ?? 0} min={0} max={1} def={0} color={t.color} fmt={(v) => (v < 0.01 ? 'no' : pct(v))} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, phaser: v < 0.01 ? 0 : v }; })} /></div>
              </div></>}
            </div>
          ); })}
        </div>
        <div class="hint">Deslizá de costado para ver todas las pistas. Cada columna tiene volumen, mute (M), solo (S) y pan. Para mover un control, mantené el dedo quieto un instante hasta que se marque y después arrastrá; doble toque lo vuelve a su valor inicial.{adv ? ' "Efectos" abre reverb, delay, sidechain y el inserto (saturación, chorus, filtros, bitcrusher y phaser); el número dice cuántos tiene en uso. Con "Grabar movimientos" y el loop sonando, lo que muevas queda grabado en la automatización (las perillas con A ya tienen).' : ' En modo Avanzado (arriba) aparecen los efectos de cada pista.'}</div>
      </Panel></div>}

      {tab === 'master' && <div class="page master">
        <Session p={p} rec={rec} secs={recSecs} take={take} toggleRec={toggleRec} clear={() => setTake(null)} />
        <Export p={p} up={up} />
        {adv && <Master p={p} up={up} stats={stats} />}
        {adv && <MidiCard p={p} />}
        <AppCard adv={adv} setAdv={setAdv} />
      </div>}
      <UpdateBar />
      {loopsOpen && <Sheet title="Mis loops" icon={Ic.folder} onClose={() => setLoopsOpen(false)}><Projects p={p} open={(np) => { openProject(np); }} flash={flash} /></Sheet>}

      {guide && <Tutorial key={guide} kind={guide} onClose={closeGuide} />}
      <nav class="nav">
        <button class={tab === 'scene' ? 'on' : ''} onClick={() => goTab('scene')}>{Icon.scene}Escena</button>
        <button class={tab === 'pat' ? 'on' : ''} onClick={() => goTab('pat')}>{Icon.grid}Patrón</button>
        <button class={tab === 'mix' ? 'on' : ''} onClick={() => goTab('mix')}>{Icon.mix}Mixer</button>
        <button class={tab === 'master' ? 'on' : ''} onClick={() => goTab('master')}>{Icon.master}Master</button>
        <button class="nav-help" onClick={() => setGuide(tab)} aria-label="Guía de esta sección">{Icon.help}Guía</button>
      </nav>
    </div>
  );
}

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false);
  return <button class={'chip' + (sure ? ' on' : '')} style={{ '--c': '#ff5a36' } as any} onClick={() => { if (sure) onDelete(); else { setSure(true); setTimeout(() => setSure(false), 2500); } }}>{sure ? 'Tocá de nuevo para borrar' : 'Eliminar pista'}</button>;
}
function AddTrack({ onAdd, full }: { onAdd: (t: TrackType, s?: string) => void; full: boolean }) {
  const [open, setOpen] = useState(false), [drums, setDrums] = useState(false);
  if (full) return <div class="note">Llegaste al máximo de 16 pistas.</div>;
  if (!open) return <button class="btn vio" style={{ marginTop: '10px', width: '100%' }} onClick={() => setOpen(true)}>+ Agregar pista</button>;
  return <div style={{ marginTop: '10px' }}>
    <div class="chips">
      <button class={'chip' + (drums ? ' on' : '')} onClick={() => setDrums(!drums)}>Batería / percusión</button>
      {([['vocal', 'Voz (grabá tu voz)'], ['bass', 'Bajo'], ['arp', 'Arpegio'], ['chords', 'Acordes'], ['melody', 'Melodía (piano roll)']] as [TrackType, string][]).map(([k, l]) => <button class="chip" onClick={() => { onAdd(k); setOpen(false); }}>{l}</button>)}
      <button class="chip" onClick={() => { setOpen(false); setDrums(false); }}>Cancelar</button>
    </div>
    {drums && DRUM_GROUPS.map(([g, list]) => <><div class="sub">{g}</div><div class="chips">{list.map((k) => <button class="chip" onClick={() => { onAdd('drum', k); setOpen(false); setDrums(false); }}>{DRUM_SOUNDS[k]}</button>)}</div></>)}
  </div>;
}
/* ---------- arpegiador: sigue solo los acordes del loop ---------- */
const LEGACY_PAT: Record<string, string> = { chord: 'up', up: 'up', down: 'down', pp: 'updown', chordpp: 'updown', rand: 'rand', acid: 'acid' };
function Arpeggiator({ p, t, upT }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const a = t.arp!, cur = a.mode === 'acid' ? 'acid' : a.pat ?? LEGACY_PAT[a.mode] ?? '';
  const set = (fn: (x: NonNullable<Track['arp']>) => void) => upT(t.id, (x) => { const n = { ...x.arp!, gate: [...x.arp!.gate] }; if (!n.pat && n.mode !== 'acid') { n.pat = (LEGACY_PAT[n.mode] as any) || 'up'; n.mode = 'chord'; } fn(n); x.arp = n; x.roll = false; });
  const seq = useMemo(() => (a.pat && a.mode !== 'acid' ? arpSeq(p, t) : null), [p, t]);
  const gateStr = (a.gate.length === 16 ? a.gate : a.gate.slice(0, 16)).map((g) => (g ? 'x' : '.')).join('');
  return <>
    <div class="sub">Sigue los acordes del loop</div>
    <div class="arp-ch">{p.chords.map((c, b) => <div><b>{c.name}</b><small>compás {b + 1}</small>{seq && <span>{seq.slice(b * 16, b * 16 + 16).filter((_, i) => arpPlays(t, b * 16 + i)).slice(0, 8).map(noteName).join(' ')}{arpPlays(t, b * 16) ? '…' : ''}</span>}</div>)}</div>
    <div class="sub">Patrón</div>
    <div class="arp-pats">{ARP_PATS.map(([k, l]) => <button class={'chip' + (cur === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => set((n) => { if (k === 'acid') { n.mode = 'acid'; n.pat = undefined; } else { n.mode = 'chord'; n.pat = k; } })}>{l}</button>)}</div>
    {cur !== 'acid' && <>
      <div class="sub">Velocidad</div>
      <div class="seg">{([['4', '1/4'], ['8', '1/8'], ['16', '1/16'], ['tr', 'Galope']] as const).map(([k, l]) => <button class={a.rate === k ? 'on' : ''} onClick={() => set((n) => { n.rate = k; })}>{l}</button>)}</div>
      <div class="arp-2">
        <div><div class="sub">Octavas</div><div class="seg">{[1, 2, 3, 4].map((o) => <button class={a.oct === o ? 'on' : ''} onClick={() => set((n) => { n.oct = o; })}>{o}</button>)}</div></div>
        <div><div class="sub">Registro</div><div class="seg">{([[-1, 'Grave'], [0, 'Medio'], [1, 'Agudo']] as const).map(([v, l]) => <button class={(a.reg ?? 0) === v ? 'on' : ''} onClick={() => set((n) => { n.reg = v; })}>{l}</button>)}</div></div>
      </div>
      <div class="sub">Largo de las notas</div>
      <div class="seg">{([[0.35, 'Corto'], [0.8, 'Medio'], [1.1, 'Largo'], [1.8, 'Ligado']] as const).map(([v, l]) => <button class={Math.abs((a.len ?? 0.8) - v) < 0.05 ? 'on' : ''} onClick={() => set((n) => { n.len = v; })}>{l}</button>)}</div>
    </>}
    <div class="sub">Ritmo</div>
    <div class="chips">{ARP_RHYTHMS.map(([l, g]) => <button class={'chip' + (gateStr === g && a.gate.every((x, i) => x === (g[i % 16] === 'x')) ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => set((n) => { n.gate = [...g].map((c) => c === 'x'); })}>{l}</button>)}
      <button class="chip" onClick={() => set((n) => { n.gate = Array(16).fill(false); })}>Vacío</button></div>
    <div class="hint">El arpegiador toca, nota por nota, las notas del acorde de cada compás (los acordes que elegiste en Escena → Armar) y arranca de nuevo cuando cambia el acorde. Patrón: el orden (Sube, Baja, ida y vuelta, Pulgar alterna la nota más grave con las demás, Acorde entero las toca juntas). Velocidad: cada cuánto toca. Octavas: cuántas octavas recorre. Ritmo: qué pasos tocan; también los podés prender y apagar en la grilla de Patrón (y por compás).</div>
  </>;
}

/* volumen y pan del instrumento, arriba de su editor: son los mismos del Mixer (y respetan la automatización) */
/* tono del instrumento: afinación (sintes; batería y voz la tienen en su sección), fino y vibrato */
function PitchRow({ t, upT }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const synth = t.type !== 'drum' && t.type !== 'vocal', vib = t.vib ?? { d: 0, r: 5 };
  return <>
    <div class="sub">Tono</div>
    <div class="knobs">
      {synth && <Knob label="Afinación" value={t.pitch} min={-24} max={24} step={1} def={0} color={t.color} fmt={(v) => (v > 0 ? '+' : '') + v + ' st'} onChange={(v) => upT(t.id, (x) => { x.pitch = v; })} />}
      <Knob label="Fino" value={t.fine ?? 0} min={-100} max={100} def={0} color={t.color} fmt={(v) => (Math.abs(v) < 1 ? '0 ct' : (v > 0 ? '+' : '') + Math.round(v) + ' ct')} onChange={(v) => upT(t.id, (x) => { x.fine = Math.abs(v) < 1 ? 0 : Math.round(v); })} />
      <Knob label="Vibrato" value={vib.d} min={0} max={1} def={0} color={t.color} fmt={(v) => (v < 0.005 ? 'no' : v.toFixed(2) + ' st')} onChange={(v) => upT(t.id, (x) => { x.vib = { r: x.vib?.r ?? 5, d: v < 0.005 ? 0 : +v.toFixed(3) }; })} />
      <Knob label="Velocidad" value={vib.r} min={0.5} max={12} log def={5} color={t.color} fmt={(v) => v.toFixed(1) + ' Hz'} onChange={(v) => upT(t.id, (x) => { x.vib = { d: x.vib?.d ?? 0, r: +v.toFixed(2) }; })} />
    </div>
  </>;
}
function LevelRow({ t, upT }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const vol = autoKnob(t, 'vol', upT), pan = autoKnob(t, 'pan', upT);
  return <>
    <div class="sub">Nivel</div>
    <div class="knobs">
      <Knob label="Volumen" {...vol} min={0} max={1} def={0.8} color={t.color} fmt={(v) => (v < 0.005 ? 'mudo' : ((x) => (x > 0 ? '+' : '') + x.toFixed(1) + ' dB')(40 * Math.log10(v / 0.8)))} />
      <Knob label="Pan" {...pan} min={-1} max={1} def={0} color={t.color} fmt={(v) => (Math.abs(v) < 0.02 ? 'centro' : (v < 0 ? 'izq ' : 'der ') + Math.round(Math.abs(v) * 100))} />
    </div>
  </>;
}
function TrackEditor({ p, t, upT, up, part, adv }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; up: (fn: (d: Project) => void) => void; part: 'snd' | 'notes'; adv: boolean }) {
  if (t.type === 'drum') {
    return <>
      <LevelRow t={t} upT={upT} />
      <PitchRow t={t} upT={upT} />
      <div class="sub">Golpe</div>
      {DRUM_GROUPS.map(([g, list]) => <><div class="sub2">{g}</div><div class="chips">{list.map((o) => <button class={'chip' + (t.sound === o ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.sound = o; if (x.name === DRUM_SOUNDS[x.sound] || Object.values(DRUM_SOUNDS).includes(x.name)) x.name = DRUM_SOUNDS[o]; })}>{DRUM_SOUNDS[o]}</button>)}</div></>)}
      <div class="sub">Ajustes</div>
      <div class="knobs">
        <Knob label="Afinación" value={t.pitch} min={-12} max={12} step={1} def={0} color={t.color} fmt={(v) => (v > 0 ? '+' : '') + v + 'st'} onChange={(v) => upT(t.id, (x) => { x.pitch = v; })} />
        <Knob label="Largo" value={t.decay} min={0.05} max={1} def={1} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.decay = v; })} />
      </div>
      <div class="sub">Kit (bombo, clap, hats y snare)</div>
      <label class="sel-w"><select class="sel" value={p.kit} onChange={(e) => up((d) => { d.kit = (e.target as HTMLSelectElement).value; })}>{Object.keys(KITS).map((k) => <option value={k}>{KITS[k].label}</option>)}</select></label>
      <div class="hint">Elegí qué golpe suena en esta fila. Afinación lo sube o baja; Largo lo corta antes. El kit cambia el sonido de toda la batería.</div>
    </>;
  }
  if (part === 'notes') return <>
    {t.type === 'melody' && <PianoRoll p={p} t={t} upT={upT} />}
    {t.type !== 'melody' && (t.roll
      ? <><PianoRoll p={p} t={t} upT={upT} />
        <div class="chips" style={{ marginTop: '8px' }}><button class="chip" onClick={() => upT(t.id, (x) => { x.roll = false; })}>Volver a lo generado</button></div>
        <div class="hint">Esta pista suena con las notas del piano roll. "Volver a lo generado" usa otra vez el modo y el patrón de Sonido (tus notas quedan guardadas).</div></>
      : <><div class="empty-note">Esta pista sigue sola los acordes, con el patrón de la pestaña Sonido.</div>
        <button class="btn hot" onClick={() => upT(t.id, (x) => { if (!x.notes?.length || !x.rollEdited) x.notes = rollFromTrack(p, t); x.roll = true; })}>Editar notas en piano roll</button>
        <div class="hint">Pasa lo que toca esta pista al piano roll para que cambies, agregues o saques notas a mano.</div></>)}
  </>;
  const presets = Object.keys(SYNTHS).filter((k) => SYNTHS[k].for.includes(t.type));
  const s = t.synth ?? SYNTHS[t.sound]?.p;
  const setS = (k: string, v: number) => upT(t.id, (x) => { x.synth = { ...(x.synth ?? SYNTHS[x.sound].p), [k]: v }; });
  return <>
    <LevelRow t={t} upT={upT} />
    {t.type === 'arp' && <Arpeggiator p={p} t={t} upT={upT} />}
    <PitchRow t={t} upT={upT} />
    <div class="sub">Sonido{t.synth && <button class="lnk" onClick={() => upT(t.id, (x) => { x.synth = undefined; })}>Restablecer</button>}</div>
    <label class="sel-w"><select class="sel" value={s?.pro ? '' : t.sound} onChange={(e) => { const k = (e.target as HTMLSelectElement).value; if (k) upT(t.id, (x) => { x.sound = k; x.synth = undefined; }); }}>
      {s?.pro && <option value="">Sinte pro</option>}
      {presets.map((k) => <option value={k}>{SYNTHS[k].label}</option>)}
    </select></label>
    {t.type === 'chords' && <>
      <div class="sub">Modo</div>
      <div class="seg">{[['pad', 'Sostenido'], ['stab', 'Stabs'], ['gate', 'Gate']].map(([k, l]) => <button class={t.chordMode === k ? 'on' : ''} onClick={() => upT(t.id, (x) => { x.chordMode = k as any; if (k === 'gate' && x.steps.filter(Boolean).length < 4) x.steps = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0]; if (k === 'stab' && !x.steps.some(Boolean)) x.steps = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]; })}>{l}</button>)}</div>
    </>}
    {s?.pro ? <SynthPro t={t} upT={upT} /> : <>
      {s && <><div class="sub">Sonido fino</div>
        <div class="knobs">
          <Knob label="Filtro" value={s.cutoff} min={80} max={12000} log def={SYNTHS[t.sound].p.cutoff} color={t.color} fmt={hz} onChange={(v) => setS('cutoff', v)} />
          <Knob label="Reso" value={s.reso} min={0} max={0.95} def={SYNTHS[t.sound].p.reso} color={t.color} fmt={pct} onChange={(v) => setS('reso', v)} />
          <Knob label="Ataque" value={s.attack} min={0.001} max={2} log def={SYNTHS[t.sound].p.attack} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('attack', v)} />
          <Knob label="Release" value={s.release} min={0.02} max={3} log def={SYNTHS[t.sound].p.release} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('release', v)} />
          {adv && <Knob label="Envolv." value={s.envAmt} min={0} max={3} def={SYNTHS[t.sound].p.envAmt} color={t.color} fmt={(v) => v.toFixed(1)} onChange={(v) => setS('envAmt', v)} />}
          {adv && <Knob label="Decay" value={s.decay} min={0.02} max={3} log def={SYNTHS[t.sound].p.decay} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('decay', v)} />}
          {adv && s.wave !== 'fm' && <Knob label="Ancho" value={s.detune} min={0} max={40} step={1} def={SYNTHS[t.sound].p.detune} color={t.color} fmt={(v) => Math.round(v) + 'ct'} onChange={(v) => setS('detune', v)} />}
        </div></>}
      {adv && <><div class="sub">Sinte pro</div>
        <div class="chips">
          <button class="btn hot" onClick={() => upT(t.id, (x) => { const base = x.synth ?? SYNTHS[x.sound]?.p ?? SYNTHS.pluck.p; x.synth = { ...base, pro: proFrom(base) }; })}>Editar a fondo</button>
          {Object.entries(PRO_PRESETS).filter(([, v]) => v.for.includes(t.type)).slice(0, 3).map(([k, v]) => <button class="chip" style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.synth = { ...(x.synth ?? SYNTHS[x.sound]?.p ?? SYNTHS.pluck.p), pro: clone(PRO_PRESETS[k].p) }; })}>{v.label}</button>)}
        </div></>}
    </>}
    <div class="hint">Elegí el sonido de la lista y ajustalo con las perillas (filtro = brillo, ataque = qué tan de golpe entra, release = cuánto queda sonando).{adv ? ' "Editar a fondo" abre el sinte pro: dos osciladores con tablas de onda, filtro de varios tipos, envolventes, LFO y matriz de modulación, como Serum.' : ' En modo Avanzado tenés más perillas y el sinte pro.'}</div>
  </>;
}

const CHROM = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];
/* editor de voz: grabar o subir audio, recortar, afinar y efectos */
const VOX_FX: [string, string, Partial<Track>, Track['fx']][] = [
  ['Seca', 'Sin efectos', { rev: 0.05, dly: 0 }, { hp: 110 }],
  ['Eco', 'Delay largo', { rev: 0.2, dly: 0.6 }, { hp: 150 }],
  ['Catedral', 'Reverb enorme', { rev: 0.75, dly: 0.1 }, { hp: 200 }],
  ['Radio', 'Telefónica', { rev: 0.1, dly: 0.25 }, { hp: 700, lp: 3200, drive: 0.35 }],
  ['Robot', 'Chorus y delay', { rev: 0.2, dly: 0.35 }, { hp: 150, chorus: 0.8 }],
  ['Sucia', 'Distorsión', { rev: 0.15, dly: 0.2 }, { hp: 180, drive: 0.75 }],
  ['Consola', 'Bitcrusher', { rev: 0.15, dly: 0.25 }, { hp: 200, lp: 7000, crush: 0.6 }],
  ['Espacial', 'Phaser y eco', { rev: 0.4, dly: 0.45 }, { hp: 150, phaser: 0.75 }],
];
/* ---------- automatización ---------- */
const MEL_T = (d: Project) => d.tracks.filter((t) => t.type !== 'drum');
const setAuto = (t: Track, k: AutoKey, v: number[]) => { t.auto = { ...t.auto, [k]: v }; };
const QUICK_AUTO: [string, (d: Project) => void][] = [
  ['Subida', (d) => MEL_T(d).forEach((t) => { setAuto(t, 'lp', autoShape('up', t.type === 'bass' ? 0.5 : 0.32, 1)); if (t.type !== 'bass') setAuto(t, 'rev', autoShape('up', Math.min(t.rev, 0.15), 0.65)); })],
  ['Filtro que respira', (d) => MEL_T(d).forEach((t) => setAuto(t, 'lp', autoShape('wave', t.type === 'bass' ? 0.55 : 0.4, 1)))],
  ['Delay al final', (d) => MEL_T(d).filter((t) => t.type !== 'bass').forEach((t) => setAuto(t, 'dly', autoShape('last', t.dly, 0.85)))],
  ['Bombeo', (d) => MEL_T(d).filter((t) => t.type === 'chords' || t.type === 'arp').forEach((t) => setAuto(t, 'vol', autoShape('pump', 0.25, 1)))],
  ['Energía que crece', (d) => { d.macroAuto = { ...d.macroAuto, energy: autoShape('up', 0.25, 0.85) }; }],
  ['Espacio al final', (d) => { d.macroAuto = { ...d.macroAuto, space: autoShape('last', (d.macros?.space ?? 0.5), 0.95) }; }],
  ['Borrar todo', (d) => { d.tracks.forEach((t) => { t.auto = undefined; }); d.macroAuto = undefined; }],
];
/* línea de automatización: se dibuja con el dedo (64 pasos); la usan las pistas y las macros */
function AutoLane({ data, color, label, fmt, base, playing, onChange, hint = 'Dibujá con el dedo o elegí una forma' }: { data?: number[]; color: string; label: string; fmt: (v: number) => string; base: () => number; playing: boolean; onChange: (d: number[]) => void; hint?: string }) {
  const [touch, setTouch] = useState<string>('');
  const laneRef = useRef<HTMLDivElement>(null), headRef = useRef<HTMLElement>(null), draft = useRef<number[] | null>(null), last = useRef(-1), raf = useRef(0);
  const commit = () => { const d = draft.current; if (!d) return; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => onChange([...d])); };
  const at = (e: PointerEvent) => { const r = laneRef.current!.getBoundingClientRect(); return { i: Math.max(0, Math.min(63, Math.floor(((e.clientX - r.left) / r.width) * 64))), v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) }; };
  const paint = (e: PointerEvent) => {
    const { i, v } = at(e), d = draft.current!; const a = last.current < 0 ? i : last.current;
    for (let j = Math.min(a, i); j <= Math.max(a, i); j++) d[j] = +v.toFixed(3); // rellena el hueco si el dedo va rápido
    last.current = i; setTouch(fmt(v)); commit();
  };
  useEffect(() => {
    if (!playing) { if (headRef.current) headRef.current.style.opacity = '0'; return; }
    let id = 0; const loop = () => { if (headRef.current) { headRef.current.style.opacity = '1'; headRef.current.style.left = ((engine.beat.step % 64) / 64) * 100 + '%'; } id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id);
  }, [playing]);
  return (
    <div class={'lane' + (data ? '' : ' empty')} ref={laneRef}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); draft.current = data ? [...data] : Array(64).fill(+base().toFixed(3)); last.current = -1; paint(e as any); }}
      onPointerMove={(e) => { if (draft.current) paint(e as any); }}
      onPointerUp={() => { draft.current = null; last.current = -1; setTouch(''); }} onPointerCancel={() => { draft.current = null; setTouch(''); }}>
      {[0, 1, 2, 3].map((b) => <span class="bar" style={{ left: b * 25 + '%' }}>{b + 1}</span>)}
      {data ? <svg viewBox="0 0 64 100" preserveAspectRatio="none" aria-hidden="true">
        <path d={'M0 100 ' + data.map((v, i) => `L${i} ${100 - v * 100} L${i + 1} ${100 - v * 100}`).join(' ') + ' L64 100 Z'} fill={color} fill-opacity="0.18" />
        <path d={data.map((v, i) => `${i ? 'L' : 'M'}${i} ${100 - v * 100} L${i + 1} ${100 - v * 100}`).join(' ')} fill="none" stroke={color} stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg> : <div class="lane-hint">{hint}</div>}
      <i class="head" ref={headRef as any} />
      {touch && <b class="lane-val">{label}: {touch}</b>}
    </div>
  );
}
function AutoEditor({ t, upT, playing, bare }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void; playing: boolean; bare?: boolean }) {
  const [k, setK] = useState<AutoKey>('lp');
  const P = AUTO_PARAMS.find((x) => x.k === k)!, data = t.auto?.[k];
  // valor de partida si todavía no hay automatización: lo que la pista tiene hoy
  const base = () => { const f = t.fx ?? {}; const v = k === 'lp' ? (f.lp ? Math.log(f.lp / 200) / Math.log(100) : 1) : k === 'hp' ? (f.hp ? Math.log(f.hp / 20) / Math.log(100) : 0) : k === 'vol' ? 1 : k === 'rev' ? t.rev : k === 'dly' ? t.dly : k === 'drive' ? f.drive ?? 0 : k === 'pitch' ? 0.5 : (t.pan + 1) / 2; return Math.max(0, Math.min(1, v)); };
  const has = (key: AutoKey) => !!t.auto?.[key];
  return (
    <div class={bare ? 'auto-ed' : 'card a-autoed'} style={{ '--c': t.color } as any}>
      {!bare && <div class="ct"><h3>Automatización · {t.name}</h3></div>}
      <div class="chips">{AUTO_PARAMS.map((x) => <button class={'chip' + (k === x.k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setK(x.k)}>{x.label}{has(x.k) ? ' •' : ''}</button>)}</div>
      <AutoLane data={data} color={t.color} label={P.label} fmt={P.fmt} base={base} playing={playing} onChange={(d) => upT(t.id, (x) => setAuto(x, k, d))} />
      <div class="chips" style={{ marginTop: '10px' }}>
        {AUTO_SHAPES.map((sh) => <button class="chip" onClick={() => upT(t.id, (x) => setAuto(x, k, autoShape(sh.k, P.lo, P.hi)))}>{sh.label}</button>)}
        {data && <button class="chip" onClick={() => upT(t.id, (x) => { const a = { ...x.auto }; delete a[k]; x.auto = Object.keys(a).length ? a : undefined; })}>Borrar</button>}
      </div>
      <div class="hint">{P.label} a lo largo de los 4 compases. {k === 'pan' ? 'Arriba es derecha, abajo es izquierda.' : 'Arriba es más, abajo es menos.'} Mientras haya automatización, manda sobre la perilla de ese parámetro. También podés grabarla moviendo las perillas del Mixer con "Grabar movimientos".</div>
    </div>
  );
}
/* automatización de las macros: se dibuja igual que la de una pista */
function MacroAuto({ p, up, playing }: { p: Project; up: (fn: (d: Project) => void) => void; playing: boolean }) {
  const [open, setOpen] = useState(!!p.macroAuto), [k, setK] = useState<MacroKey>('energy');
  const m = MACROS.find((x) => x.k === k)!, data = p.macroAuto?.[k], base = (p.macros ?? { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 })[k];
  const setM = (d: Project, v: number[] | undefined) => { const a = { ...d.macroAuto }; if (v) a[k] = v; else delete a[k]; d.macroAuto = Object.keys(a).length ? a : undefined; };
  if (!open) return <div class="chips" style={{ marginTop: '10px' }}><button class="chip" onClick={() => setOpen(true)}>Automatizar macros</button></div>;
  return <>
    <div class="sub">Automatización de macros</div>
    <div class="chips">{MACROS.map((x) => <button class={'chip' + (k === x.k ? ' on' : '')} style={{ '--c': x.color } as any} onClick={() => setK(x.k)}>{x.label}{p.macroAuto?.[x.k] ? ' •' : ''}</button>)}</div>
    <AutoLane data={data} color={m.color} label={m.label} fmt={(v) => String(Math.round(v * 100))} base={() => base} playing={playing} onChange={(d) => up((x) => setM(x, d))} />
    <div class="chips" style={{ marginTop: '10px' }}>
      {AUTO_SHAPES.map((sh) => <button class="chip" onClick={() => up((x) => setM(x, autoShape(sh.k, 0.2, 0.85)))}>{sh.label}</button>)}
      {data && <button class="chip" onClick={() => up((x) => setM(x, undefined))}>Borrar</button>}
      {!p.macroAuto && <button class="chip" onClick={() => setOpen(false)}>Cerrar</button>}
    </div>
    <div class="hint">{m.label} a lo largo de los 4 compases: el medio es como lo armó el género. Mientras tenga automatización, manda sobre su fader (el fader muestra el valor del paso que suena).</div>
  </>;
}
function RecChip({ on, toggle }: { on: boolean; toggle: () => void }) {
  return <button class={'chip recchip' + (on ? ' on' : '')} style={{ '--c': 'var(--red)' } as any} onClick={toggle} aria-pressed={on}><span class="dotrec" />{on ? 'Grabando movimientos' : 'Grabar movimientos'}</button>;
}
function VocalEditor({ p, t, upT, power, onDelete, bare }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; power: any; onDelete: () => void; bare?: boolean }) {
  const [st, setSt] = useState<'idle' | 'loop' | 'free' | 'busy'>('idle'), [err, setErr] = useState(''), [wave, setWave] = useState<number[]>([]), [info, setInfo] = useState('');
  const stopRef = useRef<null | (() => Promise<AudioBuffer>)>(null), cancel = useRef<{ stop?: () => void }>({}), lvlRef = useRef<HTMLElement>(null), timer = useRef<any>(0);
  const loopSec = (64 * 60) / p.bpm / 4;
  const refresh = () => { const d = engine.sampleData['vox:' + t.id]; setWave(d ? peaks(d, 160) : []); };
  useEffect(refresh, [t.id, t.vox?.has]);
  const keep = async (v: { sr: number; data: Float32Array }) => {
    engine.setVox(t.id, v.data, v.sr); await saveVox(t.id, v).catch(() => {});
    upT(t.id, (x) => { x.vox = { ...(x.vox ?? { from: 0, rev: false, has: false }), has: true, from: 0, pos: 0 }; x.mute = false; }); refresh(); setSt('idle'); setInfo('');
  };
  const lvl = (lv: number) => { if (lvlRef.current) lvlRef.current.style.width = Math.min(100, lv * 140) + '%'; };
  // grabación en tiempo: exactamente 4 compases, alineada al loop
  const recLoop = async () => {
    engine.unlock(); setErr(''); setSt('loop'); setInfo('Preparando el micrófono…');
    try {
      const d = await engine.recordLoop(p, (m, lv) => { setInfo(m); lvl(lv); }, cancel.current);
      if (!d) { setSt('idle'); setInfo(''); return; }
      setSt('busy'); await keep(finishLoopVox(d, engine.sr));
    } catch { setSt('idle'); setInfo(''); setErr('No se pudo usar el micrófono. Revisá el permiso del navegador.'); }
  };
  // grabación libre: hasta 4 compases, se recortan los silencios
  const recFree = async () => {
    setErr('');
    try {
      engine.unlock(); await engine.init(); setSt('free'); const t0 = performance.now();
      stopRef.current = await startRecording(engine.ctx!, lvl);
      timer.current = setInterval(() => { const s = (performance.now() - t0) / 1000; setInfo('Grabando · ' + s.toFixed(1) + ' de ' + loopSec.toFixed(1) + ' s'); if (s >= loopSec) stopFree(); }, 100);
    } catch { setSt('idle'); setErr('No se pudo usar el micrófono. Revisá el permiso del navegador.'); }
  };
  const stopFree = async () => {
    clearInterval(timer.current); const f = stopRef.current; stopRef.current = null; if (!f) return; setSt('busy');
    try { await keep(cleanVox(await f(), loopSec)); } catch { setSt('idle'); setErr('No se pudo procesar la grabación.'); }
  };
  const upload = async (file?: File) => {
    if (!file) return; setErr(''); setSt('busy');
    try { await engine.init(); await keep(cleanVox(await engine.ctx!.decodeAudioData(await file.arrayBuffer()), loopSec)); } catch { setSt('idle'); setErr('No se pudo leer ese archivo de audio.'); }
  };
  const fx = t.fx ?? {}, from = t.vox?.from ?? 0, pos = t.vox?.pos ?? 0;
  const setFx = (k: keyof NonNullable<Track['fx']>, v: number) => upT(t.id, (x) => { x.fx = { ...x.fx, [k]: v }; });
  // largo del clip en pasos (para dibujarlo en la línea de 4 compases)
  const d = engine.sampleData['vox:' + t.id], clipSteps = d ? (d.length * (1 - from) / Math.pow(2, t.pitch / 12) / engine.sr) / (60 / p.bpm / 4) : 0;
  const w = Math.min(64 - pos, clipSteps * (t.decay >= 0.99 ? 1 : 0.15 + t.decay * 0.8));
  const seek = (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const s2 = Math.max(0, Math.min(62, Math.round(((e.clientX - r.left) / r.width) * 32) * 2)); upT(t.id, (x) => { x.vox = { ...x.vox!, pos: s2 }; }); };
  const busy = st !== 'idle';
  return (
    <div class={bare ? 'vox-ed' : 'card'} style={{ '--c': t.color } as any}>
      {!bare && <div class="ct"><h3>{t.name}</h3>{power}</div>}
      <div class="vox-rec">
        {st === 'loop' || st === 'free'
          ? <button class="btn rec on" onClick={() => (st === 'loop' ? cancel.current.stop?.() : stopFree())}><span class="sq" />{st === 'loop' ? 'Cancelar' : 'Parar'}</button>
          : <button class="btn rec" disabled={busy} onClick={recLoop}><span class="dotrec" />Grabar 4 compases</button>}
        <button class="btn" disabled={busy} onClick={recFree}>Grabar libre</button>
        <label class={'btn up' + (busy ? ' dis' : '')}>Subir audio<input type="file" accept="audio/*" disabled={busy} onChange={(e) => upload((e.target as HTMLInputElement).files?.[0])} /></label>
      </div>
      {info && <div class="vox-info">{info}</div>}
      {(st === 'loop' || st === 'free') && <div class="vox-lvl"><i ref={lvlRef as any} /></div>}
      {st === 'busy' && <div class="exp-status"><span class="spin" />Procesando…</div>}
      {err && <div class="err">{err}</div>}
      <div class="vox-tl" onClick={t.vox?.has ? seek : undefined} role="presentation">
        {[0, 1, 2, 3].map((b) => <span class="bar" style={{ left: b * 25 + '%' }}>{b + 1}</span>)}
        {wave.length > 0 && <div class="clip" style={{ left: (pos / 64) * 100 + '%', width: (w / 64) * 100 + '%' }}>
          <svg viewBox={`0 0 ${wave.length} 40`} preserveAspectRatio="none" aria-hidden="true">
            {wave.map((v, i) => i / wave.length >= from && <rect x={((i / wave.length - from) / (1 - from)) * wave.length} width={wave.length / (wave.length * (1 - from)) * 0.8} y={20 - v * 19} height={Math.max(0.6, v * 38)} fill={t.color} />)}
          </svg>
        </div>}
      </div>
      <div class="hint">{t.vox?.has ? 'La voz suena una vez cada 4 compases, desde donde está el clip. Tocá la línea para moverlo.' : `"Grabar 4 compases" graba en tiempo con el loop (${loopSec.toFixed(1)} s): si está parado, te da un compás de cuenta. Con auriculares sale mejor. "Grabar libre" y "Subir audio" recortan los silencios y lo ponen al principio.`}</div>
      {t.vox?.has && <>
        <div class="sub">Efecto rápido</div>
        <div class="chips">{VOX_FX.map(([n, dsc, mix, ins]) => <button class="chip" title={dsc} onClick={() => upT(t.id, (x) => { Object.assign(x, mix); x.fx = { ...ins }; })}>{n}</button>)}
          <button class={'chip' + (t.vox?.rev ? ' on' : '')} onClick={() => upT(t.id, (x) => { x.vox = { ...x.vox!, rev: !x.vox!.rev }; })}>Al revés</button></div>
        <div class="sub">Posición, recorte y tono</div>
        <div class="knobs">
          <Knob label="Arranca en" value={pos} min={0} max={62} step={2} def={0} color={t.color} fmt={(v) => 'c' + (Math.floor(v / 16) + 1) + '.' + (Math.floor((v % 16) / 4) + 1)} onChange={(v) => upT(t.id, (x) => { x.vox = { ...x.vox!, pos: v }; })} />
          <Knob label="Recorte inicio" value={from} min={0} max={0.9} def={0} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.vox = { ...x.vox!, from: v }; })} />
          <Knob label="Largo" value={t.decay} min={0.05} max={1} def={1} color={t.color} fmt={(v) => (v >= 0.99 ? 'todo' : pct(v))} onChange={(v) => upT(t.id, (x) => { x.decay = v; })} />
          <Knob label="Afinación" value={t.pitch} min={-12} max={12} step={1} def={0} color={t.color} fmt={(v) => (v > 0 ? '+' : '') + v + 'st'} onChange={(v) => upT(t.id, (x) => { x.pitch = v; })} />
          <Knob label="Volumen" value={t.vol} min={0} max={1} def={0.8} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.vol = v; })} />
        </div>
        <div class="sub">Efectos</div>
        <div class="knobs">
          <Knob label="Delay" value={t.dly} min={0} max={1} def={0.3} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.dly = v; })} />
          <Knob label="Reverb" value={t.rev} min={0} max={1} def={0.25} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.rev = v; })} />
          <Knob label="Saturación" value={fx.drive ?? 0} min={0} max={1} def={0} color={t.color} fmt={pct} onChange={(v) => setFx('drive', v)} />
          <Knob label="Chorus" value={fx.chorus ?? 0} min={0} max={1} def={0} color={t.color} fmt={pct} onChange={(v) => setFx('chorus', v)} />
          <Knob label="Bitcrusher" value={fx.crush ?? 0} min={0} max={1} def={0} color={t.color} fmt={(v) => (v < 0.01 ? 'no' : pct(v))} onChange={(v) => setFx('crush', v < 0.01 ? 0 : v)} />
          <Knob label="Phaser" value={fx.phaser ?? 0} min={0} max={1} def={0} color={t.color} fmt={(v) => (v < 0.01 ? 'no' : pct(v))} onChange={(v) => setFx('phaser', v < 0.01 ? 0 : v)} />
          <Knob label="Corta graves" value={Math.max(20, fx.hp || 20)} min={20} max={2000} log def={110} color={t.color} fmt={(v) => (v <= 21 ? 'no' : hz(v))} onChange={(v) => setFx('hp', v <= 21 ? 0 : v)} />
          <Knob label="Corta agudos" value={fx.lp || 20000} min={200} max={20000} log def={20000} color={t.color} fmt={(v) => (v >= 19500 ? 'no' : hz(v))} onChange={(v) => setFx('lp', v >= 19500 ? 0 : v)} />
        </div>
      </>}
      {!bare && <><GroupPick p={p} t={t} upT={upT} />
      <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div></>}
    </div>
  );
}
function PianoRoll({ p, t, upT }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  // octava inicial según la pista (el bajo vive abajo) y, si ya hay notas, la que las muestra
  const startOct = () => { const ns = t.notes ?? []; if (ns.length) { const mid = ns.map((x) => x.n).sort((a, b) => a - b)[ns.length >> 1]; return Math.max(-4, Math.min(2, Math.floor((mid - 60) / 12))); } return t.type === 'bass' ? -3 : t.type === 'chords' ? -1 : 0; };
  const [bar, setBar] = useState(0), [len, setLen] = useState(t.type === 'chords' ? 8 : t.type === 'bass' ? 1 : 2), [all, setAll] = useState(false), [oct, setOct] = useState(startOct);
  // "Usar todas las notas": el piano entero (cromático, 3 octavas a la vista, se mueve con Octava −/+)
  // sin esa opción: las notas de la tonalidad en 2 octavas, más cualquier nota que ya esté cargada en esa franja
  const lo = 60 + oct * 12, sc = p.scale?.length ? p.scale : [...new Set(nameScale(p, 1).map((m) => m % 12))];
  const inKey = Array.from({ length: 24 }, (_, i) => lo + i).filter((m) => sc.includes(((m % 12) + 12) % 12) || (t.notes ?? []).some((x) => x.n === m));
  const rows = (all ? Array.from({ length: 36 }, (_, i) => lo - 12 + i) : inKey).filter((m) => m >= 21 && m <= 108).reverse();
  const notes = t.notes ?? [];
  const at = (s: number, n: number) => notes.find((x) => x.n === n && s >= x.s && s < x.s + x.l);
  const [hear, setHearS] = useState(() => lsGet('loop.rollHear') === '1');
  const setHear = (v: boolean) => { setHearS(v); lsSet('loop.rollHear', v ? '1' : '0'); };
  const tap = (i: number, n: number) => {
    const s = bar * 16 + i, hit = at(s, n);
    upT(t.id, (x) => { x.autoMelody = false; x.rollEdited = true; const ns = x.notes ?? []; if (hit) x.notes = ns.filter((y) => !(y.s === hit.s && y.n === hit.n)); else { x.notes = [...ns, { s, n, l: Math.min(len, 64 - s) }]; } });
    if (!hit && hear) engine.preview(t.id, n); // por defecto no suena al ponerla: solo cuando le toca en el loop (en vivo no se escapa nada)
  };
  return <>
    <div class="sub">Piano roll · compás {bar + 1}</div>
    <div class="chips">
      {[0, 1, 2, 3].map((b) => <button class={'chip' + (bar === b ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setBar(b)}>Compás {b + 1}</button>)}
    </div>
    <div class="roll" style={{ '--c': t.color } as any}>
      {rows.map((n) => <>
        <div class={'rk' + ([1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12) ? ' blk' : '')}>{CHROM[((n % 12) + 12) % 12]}<small>{Math.floor(n / 12) - 1}</small></div>
        {Array.from({ length: 16 }, (_, i) => { const s = bar * 16 + i, h = at(s, n); return <button class={'rc' + (h ? (h.s === s ? ' st' : ' tl') : '') + (i % 4 === 0 ? ' q' : '')} aria-label={`${CHROM[((n % 12) + 12) % 12]} paso ${i + 1}`} onClick={() => tap(i, n)} />; })}
      </>)}
    </div>
    <div class="sub">Largo de las notas nuevas</div>
    <div class="chips">{[[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, 'Compás']].map(([v, l]) => <button class={'chip' + (len === v ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setLen(v as number)}>{l}</button>)}</div>
    <div class="chips" style={{ marginTop: '8px' }}>
      <button class={'chip' + (all ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setAll(!all)}>Usar todas las notas</button>
      <button class={'chip' + (hear ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setHear(!hear)} aria-pressed={hear}>Escuchar al poner notas</button>
      <button class="chip" onClick={() => setOct(Math.max(-4, oct - 1))}>Octava −</button>
      <button class="chip" onClick={() => setOct(Math.min(3, oct + 1))}>Octava +</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { x.autoMelody = false; const src = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) === bar); x.notes = [0, 1, 2, 3].flatMap((b) => src.map((y) => ({ ...y, s: b * 16 + (y.s % 16) }))); })}>Copiar a los 4 compases</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { x.autoMelody = false; x.notes = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) !== bar); })}>Borrar compás</button>
      {t.type === 'melody' && <button class="chip" style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.notes = generateMelody(p, String(Date.now())); x.autoMelody = true; })}>Nueva melodía</button>}
      {t.type !== 'melody' && <button class="chip" onClick={() => upT(t.id, (x) => { x.notes = rollFromTrack(p, { ...x, roll: false }); x.rollEdited = false; })}>Traer de nuevo lo generado</button>}
    </div>
    <div class="hint">Tocá un casillero para poner una nota y tocala de nuevo para sacarla. La nota suena recién cuando le toca en el loop, así en vivo no se escapa nada; si querés oírla al ponerla (por ejemplo con el loop parado), activá "Escuchar al poner notas". Podés poner varias notas en el mismo paso para armar acordes. Sin "Usar todas las notas" ves las notas de la tonalidad del loop; con esa opción, el piano entero (con Octava − y + llegás a cualquier altura).</div>
  </>;
}

/* ---------- guías: intro al abrir y una por sección ---------- */
type TutKey = 'intro' | 'scene' | 'pat' | 'mix' | 'master';
type TutStep = { title: string; body: string; art: any };
const Y = '#e9c46a', G = '#7cc48f', R = '#e5655b';
const artWave = <svg class="art-svg" viewBox="0 0 200 80" aria-hidden="true"><path d="M8 40 C 28 8, 40 8, 52 40 S 76 72, 96 40 S 124 10, 140 40 S 170 70, 192 40" fill="none" stroke="#ececec" stroke-width="2" />{Array.from({ length: 16 }, (_, k) => <rect x={8 + k * 11.5} y="70" width="9" height="3" rx="1" fill={k === 5 ? Y : '#2a2a2a'} />)}</svg>;
const artName = <div class="art-name"><div class="an-in">Luciano</div><div class="an-row">{[['L', 'SI'], ['U', 'SOL#m'], ['C', 'RE'], ['I', 'SOL#']].map(([a, b]) => <span><b>{a}</b>{b}</span>)}</div><div class="an-key">SOL# menor · G#m · E · B · F#</div></div>;
const artChips = (l: string[], on = 0) => <div class="art-chips">{l.map((x, k) => <span class={k === on ? 'on' : ''}>{x}</span>)}</div>;
const artBars = (cols: string[], vals: number[], labels?: string[]) => <div class="art-mix">{vals.map((v, k) => <div class="am-col"><div class="am-f"><i style={{ bottom: v * 70 + 'px', background: cols[k % cols.length] }} /></div>{labels && <small>{labels[k]}</small>}</div>)}</div>;
const artGrid = <div class="art-grid">{[R, '#e98a5f', Y, G].map((c, r) => <div class="ag-row"><i class="ag-pw" style={{ background: c }} />{Array.from({ length: 8 }, (_, k) => <i class={'ag-pad' + ([[0, 4], [2, 6], [1, 3, 5, 7], [1, 3, 6]][r].includes(k) ? ' on' : '')} style={{ '--c': c } as any} />)}</div>)}</div>;
const artKnobs = (labels: string[]) => <div class="art-knobs">{labels.map((l, k) => { const a0 = 0.75 * Math.PI, a1 = a0 + [0.35, 0.8, 0.55, 0.7][k % 4] * 1.5 * Math.PI, pt = (a: number) => `${(20 + 15 * Math.cos(a)).toFixed(1)} ${(20 + 15 * Math.sin(a)).toFixed(1)}`; return <div><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="none" stroke="#2a2a2a" stroke-width="4" /><path d={`M ${pt(a0)} A 15 15 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}`} fill="none" stroke={[R, Y, G][k % 3]} stroke-width="4" stroke-linecap="round" /></svg><small>{l}</small></div>; })}</div>;
const TUTS: Record<TutKey, TutStep[]> = {
  intro: [
    { title: 'Bienvenido a Loop', body: 'Acá armás loops de música electrónica de 4 compases: batería, bajo, arpegio, acordes, melodía y hasta tu voz. La app tiene cuatro secciones, abajo: Escena, Patrón, Mixer y Master.', art: artChips(['Escena', 'Patrón', 'Mixer', 'Master']) },
    { title: 'Armá tu loop', body: 'En Escena, el panel Armar: elegís la tonalidad (la nota y si es menor, más oscura, o mayor, más alegre) y un acorde para cada uno de los 4 compases, con progresiones típicas listas. Para empezar uno nuevo elegís de qué género salen los sonidos y si arranca con batería o vacío. Después lo armás en Patrón tocando los casilleros.', art: artName },
    { title: 'Cómo se mueven los controles', body: 'Para mover una perilla o un fader, mantené el dedo quieto un instante hasta que se marque y después arrastrá; si deslizás de una, solo se mueve la pantalla. Doble toque vuelve al valor inicial. Cada sección viene en paneles que se abren y cierran tocando el título, y el "?" de cada panel muestra su explicación. Arriba: la carpeta abre Mis loops, las flechas deshacen y rehacen, y "Simple / Avanzado" muestra u oculta las funciones más técnicas.', art: artBars([R, Y, G], [0.7, 0.4, 0.55, 0.3, 0.8]) },
  ],
  scene: [
    { title: 'El escenario', body: 'Tocalo para que suene o para pararlo. Arriba ves el nombre y el tempo; abajo, el género, la tonalidad y los 16 pasos del compás. Con Onda, Espectro y Círculo cambiás el visual.', art: artWave },
    { title: 'Escenas', body: 'Las letras A, B, C y D debajo del play son cuatro versiones del loop para armar un tema: tocá B y arranca como copia de la actual; cambiale golpes o notas, o apagá instrumentos para un break. Si está sonando, cambia justo al terminar la vuelta. El botón de las barritas mete un redoble al final de cada vuelta, y en modo Avanzado la cadena las pasa solas.', art: artChips(['A', 'B', 'C', 'D'], 1) },
    { title: 'Tonalidad, acordes y loop nuevo', body: 'Lo que cambiás en Armar (tonalidad, acordes y color: tríadas, séptimas o novenas) suena al instante en el loop abierto, y el bajo, el arpegio y los acordes lo siguen solos. "Crear loop nuevo" arma otro con los sonidos, el kit y la mezcla del género que elijas; si el anterior estaba editado, queda guardado en Mis loops.', art: artChips(['Otra versión', 'Trance', 'Techno', 'House'], 2) },
    { title: 'Mis loops', body: 'Todo se guarda solo en el celu. La carpeta de arriba (con el nombre del loop) abre Mis loops: abrís cualquier loop anterior, lo duplicás, lo renombrás o lo borrás. Si creás un loop nuevo sin haber tocado el abierto, lo reemplaza; si lo editaste, queda guardado y el nuevo va aparte. "Guardar en un archivo" te lo llevás a otro celu, con tu voz incluida.', art: <div class="art-chips"><span class="on">Luciano · deep</span><span>Noche · techno</span><span>Fiesta · house</span></div> },
    { title: 'Macros', body: 'Cuatro controles que mueven muchas cosas a la vez. Energía: más brillo, saturación y hats. Oscuridad: filtros más cerrados. Espacio: más reverb y delay. Groove: más swing. Al medio queda como lo armó el género; "Centrar" lo vuelve ahí. Con "Automatizar macros" dibujás cómo cambian en los 4 compases, y con "Grabar movimientos" las grabás moviendo los faders mientras suena.', art: artBars([R, '#9a9a9a', G, Y], [0.75, 0.4, 0.6, 0.35], ['Energía', 'Oscur.', 'Espacio', 'Groove']) },
    { title: 'Automatización rápida', body: 'Con un toque hacés que el loop se mueva a lo largo de los 4 compases. Subida: los filtros y la reverb van creciendo, como antes de un drop. Filtro que respira: abre y cierra en cada compás. Delay al final: eco en el último tiempo. Bombeo: los acordes y el arpegio laten con el pulso. Energía que crece y Espacio al final mueven las macros.', art: <svg class="art-svg" viewBox="0 0 200 80" aria-hidden="true"><path d="M8 70 C 60 68, 120 50, 192 10 L192 74 L8 74 Z" fill={Y} fill-opacity="0.18" /><path d="M8 70 C 60 68, 120 50, 192 10" fill="none" stroke={Y} stroke-width="2" /></svg> },
    { title: 'Batería', body: 'Elegí el kit: el 909 y el 808 clásicos, uno por género, Synthwave 80s, Electro o Lo-Fi. Cambia el sonido del bombo, el clap, los hats y el redoblante sin tocar el patrón.', art: artChips(['909', '808', 'Techno', 'Lo-Fi'], 1) },
  ],
  pat: [
    { title: 'La grilla', body: 'Cada fila es un instrumento y cada casillero, un paso del compás. Un toque prende el golpe, otro lo acentúa y el tercero lo apaga. Los casilleros tenues son golpes suaves. El interruptor de la izquierda enciende o apaga la pista. Podés tocar varios a la vez con varios dedos. Arriba de la grilla elegís el compás: en "Todos" lo que tocás se repite en los 4 compases; en 1, 2, 3 o 4 cambiás solo ese compás (por ejemplo, un golpe distinto al final). "Copiar a los 4 compases" y "Vaciar compás" aplican al compás elegido, y las pistas con compases distintos muestran un 4 al lado del nombre. Con el celu parado ves 8 pasos por vez, bien grandes: con "Pasos 1 – 8 / 9 – 16" pasás a la otra mitad del compás (la que está sonando se marca en verde). Acostado ves los 16 juntos.', art: artGrid },
    { title: 'Grupos y orden', body: 'En modo Avanzado, arriba de la grilla están los grupos: con M muteás todo el grupo junto (por ejemplo, toda la Batería) y con S lo dejás sonando solo. "+ Grupo" crea uno nuevo y tocando el nombre de un grupo abrís su panel para renombrarlo, sumar o sacar instrumentos o borrarlo. El botón de las flechas ordena los instrumentos.', art: artChips(['Batería  M  S', 'Sintes  M  S', '+ Grupo'], 0) },
    { title: 'Editar una pista', body: 'Tocá el nombre de un instrumento y se abre su editor abajo, con pestañas: Sonido (elegís el sonido de la lista y lo ajustás), Notas (piano roll), Movimiento (automatización, en modo Avanzado) y Más (copiar, pegar, grupo y borrar). Tocá la X o el nombre de nuevo para cerrarlo. Arriba de Sonido tenés el volumen y el pan del instrumento (los mismos del Mixer) y el tono: afinación, fino y vibrato. En Movimiento también podés automatizar el Tono para que suba o baje a lo largo de los 4 compases.', art: artKnobs(['Filtro', 'Reso', 'Decay', 'Detune']) },
    { title: 'Variación, copiar y pegar', body: 'El dado arriba del editor de cada instrumento le da otro patrón (de los que usa el género, o cambiando algunos golpes y notas). En la pestaña Más, "Copiar patrón" lo guarda y "Pegar" lo pone en otra pista, incluso en otro loop. Arriba de la grilla, las barritas agregan un redoble y el tacho vacía la batería.', art: artChips(['Variación', 'Copiar patrón', 'Pegar'], 0) },
    { title: 'Sinte pro', body: 'En modo Avanzado, en la pestaña Sonido del bajo, el arpegio, los acordes o la melodía, "Editar a fondo" abre un sinte completo, estilo Serum: dos osciladores con tablas de onda (Forma recorre la tabla), unísono con detune y ancho estéreo, sub y ruido, filtro de varios tipos, dos envolventes, dos LFO al ritmo del loop y una matriz para conectar todo. Hay sonidos pro listos y podés guardar los tuyos en Mis sonidos.', art: artKnobs(['Forma', 'Detune', 'Corte', 'LFO']) },
    { title: 'Ecualizador de cada instrumento', body: 'En el editor de cada instrumento, la pestaña EQ tiene un ecualizador de 4 bandas: arrastrás los puntos de la curva con el dedo (a los costados la frecuencia, arriba o abajo cuánto sube o baja) o usás las perillas y los ajustes rápidos (Menos barro, Más brillo, Radio…). En el Mixer lo abrís con el botón EQ de cada columna.', art: artKnobs(['Graves', 'Medio', 'Agudos', 'Ancho']) },
    { title: 'Arpegiador', body: 'La pista de arpegio sigue sola los acordes del loop: arriba ves los 4 acordes y las notas que va a tocar en cada compás. Elegís el patrón (Sube, Baja, Sube y baja, Pulgar, Al azar, Acorde entero o Acid 303), la velocidad (1/4, 1/8, 1/16 o Galope), cuántas octavas recorre, el registro, el largo de las notas y un ritmo listo (Sincopado, Contratiempo, Galope…). Si cambiás los acordes en Escena → Armar, el arpegio cambia con ellos.', art: artChips(['Sube', 'Pulgar', '1/8', 'Sincopado'], 0) },
    { title: 'Piano roll', body: 'La melodía son 4 compases que dibujás en el piano roll, y el bajo, el arpegio y los acordes también se pueden pasar al piano roll con "Editar notas en piano roll". Tocás un casillero para poner una nota y de nuevo para sacarla. "Usar todas las notas" muestra el piano entero, no solo las de la tonalidad.', art: <div class="art-roll">{Array.from({ length: 5 }, (_, r) => <div>{Array.from({ length: 12 }, (_, k) => <i class={[[1, 2], [4], [0, 7, 8], [10], [5]][r].includes(k) ? 'on' : ''} />)}</div>)}</div> },
    { title: 'Automatización', body: 'En modo Avanzado, la pestaña Movimiento de cada instrumento es su automatización: elegís qué mover (Filtro, Volumen, Reverb, Delay, Saturación, Pan o Corta graves) y dibujás con el dedo cómo cambia en los 4 compases, o tocás una forma (Sube, Baja, Onda, Bombeo…). Las pistas con automatización muestran una "A".', art: <svg class="art-svg" viewBox="0 0 200 80" aria-hidden="true">{[0, 1, 2, 3].map((b) => <line x1={8 + b * 46} y1="4" x2={8 + b * 46} y2="76" stroke="#2a2a2a" />)}<path d="M8 60 L50 60 L54 20 L100 20 L104 50 L146 50 L150 10 L192 10" fill="none" stroke={G} stroke-width="2" /></svg> },
    { title: 'Tu voz y más pistas', body: 'Con "+ Agregar pista" sumás batería, bajo, arpegio, acordes, melodía o Voz. En Voz, "Grabar 4 compases" graba en tiempo con el loop (con un compás de cuenta si está parado). Después le ponés efectos: eco, catedral, radio, robot y más. Usá auriculares para grabar.', art: <div class="art-vox"><span class="dot" />Grabar 4 compases<svg viewBox="0 0 160 30" aria-hidden="true">{Array.from({ length: 40 }, (_, k) => { const h = 4 + Math.abs(Math.sin(k * 1.7)) * 22; return <rect x={k * 4} y={15 - h / 2} width="2.5" height={h} fill={R} />; })}</svg></div> },
  ],
  mix: [
    { title: 'Faders y botones', body: 'Cada columna es una pista: el fader es su volumen, M la silencia, S la deja sonando sola y abajo está el pan. Podés apretar varios M o S al mismo tiempo. Deslizá de costado para ver todas. En modo Avanzado, "Efectos" abre el resto de sus perillas (el número dice cuántos tiene en uso) y arriba aparecen los grupos.', art: artBars([R, Y, G, '#e98a5f', '#8fc7a0'], [0.75, 0.5, 0.62, 0.35, 0.8]) },
    { title: 'Pan, efectos y sidechain', body: '(Modo Avanzado) Pan la manda a la izquierda o a la derecha. Reverb y Delay le suman ambiente y eco. Sidechain es cuánto se "agacha" la pista cuando pega el bombo: es lo que hace que el loop bombee.', art: artKnobs(['Pan', 'Reverb', 'Delay', 'Sidechain']) },
    { title: 'El inserto de cada pista', body: '(Modo Avanzado) Abajo de cada columna: Saturación (calienta o ensucia), Chorus (la abre y la engorda), Corta graves y Corta agudos (filtros), Bitcrusher (sonido digital roto, de consola vieja) y Phaser (un barrido que gira cada 2 compases). Cada género trae los suyos armados; los podés ajustar a gusto.', art: artKnobs(['Saturación', 'Chorus', 'Bitcrusher', 'Phaser']) },
    { title: 'Grabar movimientos', body: '(Modo Avanzado) Tocá "Grabar movimientos" y, mientras suena, mové el volumen, el pan, la reverb, el delay, la saturación o los filtros: cada movimiento queda grabado en la automatización de esa pista, en el paso exacto. Al soltar, queda lo grabado y se repite en cada vuelta. Las perillas con una A ya tienen automatización. Para corregir, grabás encima o la editás en Patrón.', art: <div class="art-vox"><span class="dot" />Grabar movimientos<svg viewBox="0 0 160 30" aria-hidden="true"><path d="M0 24 C 30 24, 40 6, 70 8 S 120 26, 160 12" fill="none" stroke={Y} stroke-width="2" /></svg></div> },
  ],
  master: [
    { title: 'Grabar sesión', body: 'El botón rojo (al lado del play, o acá en Master) graba en vivo todo lo que suena mientras tocás: perillas, pistas que prendés y apagás, cambios de género. Hasta 10 minutos. Cuando terminás, la descargás en WAV o MP3.', art: <div class="art-vox"><span class="dot" />● REC 2:41<svg viewBox="0 0 160 30" aria-hidden="true">{Array.from({ length: 40 }, (_, k) => { const h = 6 + Math.abs(Math.sin(k * 0.9) * Math.cos(k * 0.3)) * 20; return <rect x={k * 4} y={15 - h / 2} width="2.5" height={h} fill={R} />; })}</svg></div> },
    { title: 'Exportar', body: 'Con "Tema con escenas" armás el orden de las partes (por ejemplo A A B B C C C C D D C C) y sale un tema entero, de una pasada. Elegí cuántos compases y descargá en WAV (máxima calidad), MP3 (liviano) o el paquete para Ableton, con cada pista por separado, la mezcla y los MIDI. Después lo compartís desde el botón Compartir.', art: artChips(['WAV', 'MP3', 'Ableton'], 0) },
    { title: 'Salida y volumen', body: '(Modo Avanzado) El volumen se mantiene parejo solo: la ganancia automática lleva el loop al nivel elegido (en LUFS) y el limitador evita que sature. Los medidores te muestran cuánto está trabajando cada uno.', art: <div class="art-meter"><div><i style={{ width: '72%' }} /></div><small>-14 LUFS · limitador -1 dB</small></div> },
    { title: 'Controlador MIDI', body: '(Modo Avanzado) Con Chrome (Android o compu) podés enchufar un controlador MIDI: "Conectar controlador", tocás lo que querés manejar (una macro, un volumen, una escena, play…) y movés la perilla o el pad. Las teclas sin asignar tocan la pista elegida. En iPhone no hay MIDI en el navegador.', art: artKnobs(['Energía', 'Espacio', 'Bajo', 'Kick']) },
    { title: 'La app en tu celu', body: 'El panel App muestra la versión, si Loop está instalada y si ya funciona sin conexión, y ahí también elegís modo Simple o Avanzado. "Instalar Loop" la pone en tu pantalla de inicio (en iPhone: Compartir → Agregar a inicio). "Proteger mis loops" le pide al navegador que no borre lo guardado. Cuando hay una versión nueva aparece un aviso arriba.', art: artChips(['Instalada', 'Sin conexión', 'Protegida'], 1) },
    { title: 'Ecualizador y efectos', body: '(Modo Avanzado) El EQ de 8 bandas sube o baja graves, medios y agudos de todo el loop. En Efectos ajustás el tamaño de la reverb y cuánto se repite el delay, para todas las pistas a la vez.', art: artBars([G, G, Y, Y, Y, R, R, R], [0.6, 0.55, 0.45, 0.4, 0.5, 0.55, 0.62, 0.5]) },
  ],
};
const TUT_NAME: Record<TutKey, string> = { intro: 'Intro', scene: 'Escena', pat: 'Patrón', mix: 'Mixer', master: 'Master' };
function Tutorial({ kind, onClose }: { kind: TutKey; onClose: (never: boolean) => void }) {
  const steps = TUTS[kind], [i, setI] = useState(0), [never, setNever] = useState(false), st = steps[i], last = i === steps.length - 1;
  return (
    <div class="tut" role="dialog" aria-modal="true" aria-label={'Guía: ' + TUT_NAME[kind]}>
      <div class="tut-card">
        <div class="tut-top"><span>{TUT_NAME[kind]} · {i + 1} de {steps.length}</span><button class="tut-skip" onClick={() => onClose(never)}>{kind === 'intro' ? 'Omitir intro' : 'Omitir'}</button></div>
        <div class="tut-art">{st.art}</div>
        <h2>{st.title}</h2>
        <p>{st.body}</p>
        <div class="tut-dots">{steps.map((_, k) => <button class={k === i ? 'on' : ''} aria-label={'Ir al paso ' + (k + 1)} onClick={() => setI(k)} />)}</div>
        <div class="tut-foot">
          <span />
          <div class="tut-btns">
            {i > 0 && <button class="btn" onClick={() => setI(i - 1)}>Atrás</button>}
            <button class="btn hot" onClick={() => (last ? onClose(never) : setI(i + 1))}>{last ? (kind === 'intro' ? 'Empezar' : 'Entendido') : 'Siguiente'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- grupos de instrumentos ---------- */
const gMuted = (p: Project, t: Track) => !!(t.group && p.groups?.find((g) => g.id === t.group)?.mute);
function Groups({ p, up }: { p: Project; up: (fn: (d: Project) => void) => void }) {
  const gs = p.groups ?? [], [edit, setEdit] = useState<string | null>(null), [sure, setSure] = useState(false);
  const setG = (id: string, fn: (g: Group) => void) => up((d) => { const g = d.groups?.find((x) => x.id === id); if (g) fn(g); });
  const add = () => { const id = 'g' + Date.now().toString(36); up((d) => { d.groups = [...(d.groups ?? []), { id, name: 'Grupo ' + ((d.groups?.length ?? 0) + 1) }]; }); setEdit(id); setSure(false); };
  const eg = gs.find((g) => g.id === edit);
  return (
    <div class="groups-w">
      <div class="groups">
        {gs.map((g) => { const n = p.tracks.filter((t) => t.group === g.id).length; return <div class={'grp' + (edit === g.id ? ' ed' : '')}>
          <button class="gname" onClick={() => { setEdit(edit === g.id ? null : g.id); setSure(false); }} aria-label={'Editar grupo ' + g.name} aria-expanded={edit === g.id}>{g.name}<small>{n}</small></button>
          <button class={'m' + (g.mute ? ' on' : '')} aria-label={'Mutear grupo ' + g.name} {...tap(() => setG(g.id, (x) => { x.mute = !x.mute; }))}>M</button>
          <button class={'s' + (g.solo ? ' on' : '')} aria-label={'Solo grupo ' + g.name} {...tap(() => setG(g.id, (x) => { x.solo = !x.solo; }))}>S</button>
        </div>; })}
        <button class="chip" onClick={add}>+ Grupo</button>
      </div>
      {/* panel del grupo: nombre, qué instrumentos tiene (tocás para sumar o sacar) y borrar */}
      {eg && <div class="gpanel">
        <div class="gp-row">
          <input value={eg.name} maxLength={18} aria-label="Nombre del grupo" onInput={(e) => { const v = (e.target as HTMLInputElement).value; setG(eg.id, (x) => { x.name = v || 'Grupo'; }); }} />
          <button class="btn hot" onClick={() => setEdit(null)}>Listo</button>
        </div>
        <div class="sub">Instrumentos del grupo (tocá para sumar o sacar)</div>
        <div class="chips">{p.tracks.map((t) => { const inG = t.group === eg.id, other = t.group && !inG ? gs.find((g) => g.id === t.group)?.name : ''; return (
          <button class={'chip' + (inG ? ' on' : '')} style={{ '--c': t.color } as any} aria-pressed={inG} {...tap(() => up((d) => { const x = d.tracks.find((y) => y.id === t.id); if (x) x.group = inG ? undefined : eg.id; }))}>
            {inG ? '✓ ' : ''}{t.name}{other ? <small class="gother"> · {other}</small> : null}
          </button>); })}</div>
        <div class="chips" style={{ marginTop: '10px' }}>
          <button class="chip" onClick={() => up((d) => d.tracks.forEach((t) => { if (t.type === 'drum') t.group = eg.id; }))}>Toda la batería</button>
          <button class="chip" onClick={() => up((d) => d.tracks.forEach((t) => { if (t.type !== 'drum' && t.type !== 'vocal') t.group = eg.id; }))}>Todos los sintes</button>
          <button class={'chip' + (sure ? ' on' : '')} style={{ '--c': 'var(--red)' } as any} onClick={() => { if (!sure) { setSure(true); setTimeout(() => setSure(false), 2500); return; } up((d) => { d.groups = d.groups?.filter((x) => x.id !== eg.id); d.tracks.forEach((t) => { if (t.group === eg.id) t.group = undefined; }); }); setEdit(null); setSure(false); }}>{sure ? 'Tocá de nuevo para borrar' : 'Borrar grupo'}</button>
        </div>
        <div class="hint">Cada instrumento está en un solo grupo: si lo sumás acá, sale del otro. Borrar el grupo no borra los instrumentos.</div>
      </div>}
    </div>
  );
}
function GroupPick({ p, t, upT }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  if (!p.groups?.length) return null;
  return <><div class="sub">Grupo</div>
    <div class="chips">
      <button class={'chip' + (!t.group ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.group = undefined; })}>Ninguno</button>
      {p.groups.map((g) => <button class={'chip' + (t.group === g.id ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.group = g.id; })}>{g.name}</button>)}
    </div></>;
}

/* ---------- toques simultáneos ----------
   El navegador manda "click" de a un dedo por vez. Con pointerup cada dedo cuenta solo, así podés mutear varias cosas juntas.
   Si el dedo se movió (scroll), no cuenta. El click queda para mouse y teclado. */
function tap(fn: () => void) {
  return {
    onPointerDown: (e: PointerEvent) => { (e.currentTarget as any)._tp = { x: e.clientX, y: e.clientY, id: e.pointerId }; },
    onPointerUp: (e: PointerEvent) => { const el = e.currentTarget as any, st = el._tp; el._tp = null; if (st && st.id === e.pointerId && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 12) { el._tpDone = performance.now(); fn(); } },
    onPointerCancel: (e: PointerEvent) => { (e.currentTarget as any)._tp = null; },
    onClick: (e: MouseEvent) => { const d = (e.currentTarget as any)._tpDone; if (d && performance.now() - d < 700) return; fn(); },
  };
}

/* ---------- grabar sesión ---------- */
const fmtT = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function Session({ p, rec, secs, take, toggleRec, clear }: { p: Project; rec: boolean; secs: number; take: Take | null; toggleRec: () => void; clear: () => void }) {
  const [busy, setBusy] = useState(''), [out, setOut] = useState<Out | null>(null);
  useEffect(() => { if (out) { URL.revokeObjectURL(out.url); setOut(null); } }, [take]);
  const make = async (kind: 'wav' | 'mp3') => {
    if (!take || busy) return; if (out) { URL.revokeObjectURL(out.url); setOut(null); }
    setBusy(kind === 'wav' ? 'Armando el WAV…' : 'Codificando MP3… 0%');
    const blob = kind === 'wav' ? takeWav(take) : await takeMp3(take, (x) => setBusy('Codificando MP3… ' + Math.round(x * 100) + '%'));
    const d = new Date(), stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    const name = baseName(p) + '_sesion_' + stamp + '.' + kind, file = new File([blob], name, { type: blob.type });
    setOut({ url: URL.createObjectURL(file), file, name, size: blob.size }); setBusy('');
  };
  const canShare = typeof navigator !== 'undefined' && (navigator as any).canShare && out && (navigator as any).canShare({ files: [out.file] });
  const len = take ? take.frames / take.sr : 0;
  return (
    <Panel id="session" title="Grabar sesión" icon={Ic.rec}>

      <button class={'btn rec sess' + (rec ? ' on' : '')} onClick={toggleRec}>{rec ? <><span class="sq" />Terminar · {fmtT(secs)}</> : <><span class="dotrec" />Grabar sesión</>}</button>
      {rec && <div class="hint">Grabando todo lo que suena. Podés cambiar de sección, mover perillas, apagar pistas o cambiar de género: queda todo en la grabación. El botón rojo de arriba también la termina.</div>}
      {take && !rec && <>
        <div class="exp-out" style={{ marginTop: '10px' }}><div><b>Sesión de {fmtT(len)}</b><span>{(take.frames * 4 / 1048576).toFixed(0)} MB en WAV</span></div>
          <div class="exp-btns">
            <button class="btn hot" disabled={!!busy} onClick={() => make('wav')}>WAV</button>
            <button class="btn hot" disabled={!!busy} onClick={() => make('mp3')}>MP3</button>
            <button class="btn" disabled={!!busy} onClick={() => { if (out) URL.revokeObjectURL(out.url); setOut(null); clear(); }}>Descartar</button>
          </div>
        </div>
        {busy && <div class="exp-status"><i class="spin" />{busy}</div>}
        {out && <div class="exp-out"><div><b>{out.name}</b><span>{(out.size / 1048576).toFixed(1)} MB</span></div>
          <div class="exp-btns">
            <a class="btn hot" href={out.url} download={out.name}>Descargar</a>
            {canShare && <button class="btn" onClick={() => (navigator as any).share({ files: [out.file], title: out.name }).catch(() => {})}>Compartir / Guardar en el celu</button>}
          </div></div>}
      </>}
      {!rec && !take && <div class="hint">Graba en vivo todo lo que sale por los parlantes, con cada cambio que hagas mientras suena, hasta 10 minutos. Al terminar la descargás en WAV o MP3. Si el loop está parado, arranca solo.</div>}
    </Panel>
  );
}

/* ---------- EQ de cada instrumento: 4 bandas con la curva a la vista (se arrastran los puntos) ---------- */
const EQ_SR = 48000, EQ_RANGE = [[20, 1000], [40, 8000], [200, 16000], [1500, 20000]], EQ_COL = ['#e5655b', '#ffc24d', '#8ad27a', '#5fb0f0'];
const EQ_NAMES = ['Graves', 'Medio 1', 'Medio 2', 'Agudos'];
/* mismos coeficientes que el Biquad del motor, para dibujar exactamente lo que suena */
function bqCoef(type: string, f: number, q: number, g: number) {
  const A = Math.pow(10, g / 40), w = 2 * Math.PI * Math.min(f, EQ_SR * 0.45) / EQ_SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  else if (type === 'ls') { const sq = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq); a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq; }
  else { const sq = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq); a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function bqDb(c: number[], f: number) {
  const w = 2 * Math.PI * f / EQ_SR, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2), dr = 1 + c[3] * c1 + c[4] * c2, di = -(c[3] * s1 + c[4] * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
const eqType = (k: number) => (k === 0 ? 'ls' : k === 3 ? 'hs' : 'peak');
const EQ_PRESETS: [string, (b: EqBand[]) => void][] = [
  ['Plano', (b) => b.forEach((x) => { x.g = 0; })],
  ['Menos barro', (b) => { b[1] = { f: 320, g: -4, q: 1.2 }; }],
  ['Más cuerpo', (b) => { b[0] = { f: 120, g: 3, q: 0.7 }; }],
  ['Menos graves', (b) => { b[0] = { f: 150, g: -8, q: 0.7 }; }],
  ['Presencia', (b) => { b[2] = { f: 3200, g: 3, q: 0.9 }; }],
  ['Más brillo', (b) => { b[3] = { f: 8000, g: 4, q: 0.7 }; }],
  ['Más oscuro', (b) => { b[3] = { f: 5000, g: -6, q: 0.7 }; }],
  ['Radio', (b) => { b[0] = { f: 400, g: -12, q: 0.7 }; b[2] = { f: 1600, g: 5, q: 1.2 }; b[3] = { f: 3500, g: -12, q: 0.7 }; }],
];
function EqEditor({ t, upT }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const bands = t.eq ?? EQ_DEF, [sel, setSel] = useState(1), ref = useRef<SVGSVGElement>(null), drag = useRef(-1), raf = useRef(0), pend = useRef<EqBand | null>(null);
  const W = 320, H = 150, GMAX = 18;
  const fx = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W, gy = (g: number) => H / 2 - (g / GMAX) * (H / 2 - 8);
  const curve = useMemo(() => { const cs = bands.map((b, k) => (Math.abs(b.g) > 0.05 ? bqCoef(eqType(k), b.f, k === 0 || k === 3 ? 0.707 : b.q, b.g) : null)); let d = ''; for (let i = 0; i <= 120; i++) { const f = 20 * Math.pow(1000, i / 120); let db = 0; cs.forEach((c) => { if (c) db += bqDb(c, f); }); d += (i ? 'L' : 'M') + ((i / 120) * W).toFixed(1) + ' ' + gy(Math.max(-GMAX, Math.min(GMAX, db))).toFixed(1); } return d; }, [bands]);
  const setBand = (k: number, b: Partial<EqBand>) => upT(t.id, (x) => { const e = (x.eq ?? EQ_DEF).map((y) => ({ ...y })); e[k] = { ...e[k], ...b }; x.eq = e; });
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H; return { f: 20 * Math.pow(1000, Math.max(0, Math.min(1, x / W))), g: Math.max(-GMAX, Math.min(GMAX, ((H / 2 - y) / (H / 2 - 8)) * GMAX)), x, y }; };
  const move = (e: PointerEvent) => {
    const k = drag.current; if (k < 0) return; const { f, g } = at(e), [lo, hi] = EQ_RANGE[k];
    pend.current = { ...bands[k], f: Math.round(Math.max(lo, Math.min(hi, f))), g: Math.abs(g) < 0.4 ? 0 : +g.toFixed(1) };
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => { if (pend.current) setBand(k, pend.current); });
  };
  const b = bands[sel], fmtF = (f: number) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : Math.round(f) + '') + ' Hz';
  return <>
    <svg ref={ref} class="eqg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Curva del ecualizador"
      onPointerDown={(e) => { const r = at(e as any); let best = 0, bd = 1e9; bands.forEach((x, k) => { const d = Math.hypot(fx(x.f) - r.x, gy(x.g) - r.y); if (d < bd) { bd = d; best = k; } }); drag.current = best; setSel(best); (e.currentTarget as any).setPointerCapture(e.pointerId); move(e as any); }}
      onPointerMove={(e) => move(e as any)} onPointerUp={() => { drag.current = -1; }} onPointerCancel={() => { drag.current = -1; }}>
      {[100, 1000, 10000].map((f) => <line x1={fx(f)} x2={fx(f)} y1="0" y2={H} class="eq-grid" />)}
      {[-12, -6, 6, 12].map((g) => <line x1="0" x2={W} y1={gy(g)} y2={gy(g)} class="eq-grid" />)}
      <line x1="0" x2={W} y1={gy(0)} y2={gy(0)} class="eq-zero" />
      {[['100', 100], ['1k', 1000], ['10k', 10000]].map(([l, f]) => <text x={fx(f as number) + 3} y={H - 4} class="eq-lab">{l}</text>)}
      <path d={curve + ` L${W} ${H} L0 ${H} Z`} fill={t.color} fill-opacity="0.14" />
      <path d={curve} fill="none" stroke={t.color} stroke-width="2" vector-effect="non-scaling-stroke" />
      {bands.map((x, k) => <circle cx={fx(x.f)} cy={gy(x.g)} r={sel === k ? 9 : 7} fill={EQ_COL[k]} fill-opacity={Math.abs(x.g) > 0.05 ? 1 : 0.45} stroke={sel === k ? '#fff' : '#111'} stroke-width="2" vector-effect="non-scaling-stroke" />)}
    </svg>
    <div class="seg" style={{ marginTop: '8px' }}>{EQ_NAMES.map((n, k) => <button class={sel === k ? 'on' : ''} style={sel === k ? { background: EQ_COL[k] } : undefined} onClick={() => setSel(k)}>{n}</button>)}</div>
    <div class="knobs" style={{ marginTop: '6px' }}>
      <Knob label="Frecuencia" value={b.f} min={EQ_RANGE[sel][0]} max={EQ_RANGE[sel][1]} log def={EQ_DEF[sel].f} color={EQ_COL[sel]} fmt={fmtF} onChange={(v) => setBand(sel, { f: Math.round(v) })} />
      <Knob label="Ganancia" value={b.g} min={-18} max={18} def={0} color={EQ_COL[sel]} fmt={(v) => (Math.abs(v) < 0.05 ? '0 dB' : (v > 0 ? '+' : '') + v.toFixed(1) + ' dB')} onChange={(v) => setBand(sel, { g: Math.abs(v) < 0.4 ? 0 : +v.toFixed(1) })} />
      {(sel === 1 || sel === 2) && <Knob label="Ancho" value={b.q} min={0.3} max={6} log def={1} color={EQ_COL[sel]} fmt={(v) => (v < 0.8 ? 'ancho' : v > 3 ? 'finito' : 'Q ' + v.toFixed(1))} onChange={(v) => setBand(sel, { q: +v.toFixed(2) })} />}
    </div>
    <div class="sub">Ajustes rápidos</div>
    <div class="chips">{EQ_PRESETS.map(([n, fn]) => <button class="chip" onClick={() => upT(t.id, (x) => { const e = (x.eq ?? EQ_DEF).map((y) => ({ ...y })); fn(e); x.eq = e.some((y) => Math.abs(y.g) > 0.05) ? e : undefined; })}>{n}</button>)}</div>
    <div class="hint">Arrastrá un punto con el dedo: a los costados cambia la frecuencia y para arriba o abajo sube o baja ese rango. Graves y Agudos suben o bajan todo lo que está por debajo o por encima; los dos medios son campanas, y Ancho dice si tocan una franja angosta o amplia. Doble toque en una perilla la vuelve a cero. Truco: bajar suele sonar mejor que subir (sacale barro a los sintes cerca de 300 Hz y graves a todo lo que no sea bombo y bajo).</div>
  </>;
}

/* ---------- desde cero: tonalidad, acordes, género base y "Crear" ----------
   Si el loop abierto ya es "desde cero", los cambios de tonalidad y acordes se aplican en vivo; "Crear" siempre arma uno nuevo. */
function Scratch({ p, up, create }: { p: Project; up: (fn: (d: Project) => void) => void; create: (m: Manual, genre: string, drums: boolean, title: string) => void }) {
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState<Manual>({ tonic: 9, mode: 'min', degrees: [0, 5, 2, 6], ext: 7 });
  const [genre, setGenre] = useState(p.genre), [drums, setDrums] = useState(false);
  void draft; void setDraft;
  const m = manualFrom(p);
  const set = (fn: (x: Manual) => void) => up((d) => { d.manual = { ...manualFrom(d), degrees: [...manualFrom(d).degrees] }; fn(d.manual); applyHarmony(d); });
  const roman = ROMAN[m.mode], progs = PROGS[m.mode], cur = progs.find(([, d]) => d.join() === m.degrees.join());
  const names = manualHarmony({ ...m, degrees: [0, 1, 2, 3, 4, 5, 6] }).chords.map((c) => c.name); // nombre de cada grado en esta tonalidad
  return <>
    <div class="gen-row" style={{ marginTop: 0 }}>
      <label class="sel-w"><span>Tónica</span><select class="sel" value={m.tonic} onChange={(e) => set((x) => { x.tonic = +(e.target as HTMLSelectElement).value; })}>{NOTE_ES.map((n, i) => <option value={i}>{n}</option>)}</select></label>
      <div class="sel-w"><span>Modo</span><div class="seg"><button class={m.mode === 'min' ? 'on' : ''} onClick={() => set((x) => { if (x.mode !== 'min') { x.mode = 'min'; x.degrees = [...PROGS.min[0][1]]; } })}>Menor</button><button class={m.mode === 'maj' ? 'on' : ''} onClick={() => set((x) => { if (x.mode !== 'maj') { x.mode = 'maj'; x.degrees = [...PROGS.maj[0][1]]; } })}>Mayor</button></div></div>
    </div>
    <label class="sel-w" style={{ marginTop: '10px' }}><span>Progresión</span><select class="sel" value={cur ? cur[0] : ''} onChange={(e) => { const pr = progs.find(([n]) => n === (e.target as HTMLSelectElement).value); if (pr) set((x) => { x.degrees = [...pr[1]]; }); }}>
      {!cur && <option value="">A mano</option>}
      {progs.map(([n, d]) => <option value={n}>{n} ({d.map((k) => names[k]).join(' ')})</option>)}
    </select></label>
    <div class="sub">Acorde de cada compás</div>
    <div class="bars4">{m.degrees.map((d, i) => <label class="sel-w"><span>{i + 1}</span><select class="sel" value={d} onChange={(e) => set((x) => { x.degrees[i] = +(e.target as HTMLSelectElement).value; })}>{roman.map((r, k) => <option value={k}>{r} · {names[k]}</option>)}</select></label>)}</div>
    <div class="keyline"><span>Suena: <b>{p.chords.map((c) => c.name).join(' · ')}</b></span></div>
    <div class="sub">Color de los acordes</div>
    <div class="seg">{([[0, 'Tríadas'], [7, 'Séptimas'], [9, 'Novenas']] as [number, string][]).map(([v, l]) => <button class={m.ext === v ? 'on' : ''} onClick={() => set((x) => { x.ext = v; })}>{l}</button>)}</div>
    <div class="sub">Sonidos de este loop</div>
    <label class="sel-w"><select class="sel" aria-label="Género del loop" value={p.genre} onChange={(e) => { const g = (e.target as HTMLSelectElement).value; up((d) => applyGenreSound(d, g)); flashG('Sonidos de ' + GENRES[g].name + ': tus patrones y notas quedan igual'); }}>{Object.keys(GENRES).map((g) => <option value={g}>{GENRES[g].name}</option>)}</select></label>
    <div class="sub">Loop nuevo</div>
    <input class="txt" value={title} maxLength={32} placeholder="Nombre (opcional)" aria-label="Nombre del loop nuevo" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
    <div class="gen-row" style={{ marginTop: '8px' }}>
      <label class="sel-w"><span>Sonidos de</span><select class="sel" value={genre} onChange={(e) => setGenre((e.target as HTMLSelectElement).value)}>{Object.keys(GENRES).map((g) => <option value={g}>{GENRES[g].name}</option>)}</select></label>
      <button class={'ib' + (drums ? ' on' : '')} onClick={() => setDrums(!drums)} aria-pressed={drums}>{Ic.kick}<small>{drums ? 'Con batería' : 'Sin batería'}</small></button>
    </div>
    <button class="btn hot" style={{ width: '100%', marginTop: '12px' }} onClick={() => { create(m, genre, drums, title); setTitle(''); }}>Crear loop nuevo</button>
    <div class="hint">La tonalidad (la nota, y si es menor, más oscura, o mayor, más alegre) y el acorde de cada compás se aplican al loop abierto al instante. El bajo, el arpegio y los acordes siguen solos esos acordes. "Sonidos de este loop" cambia el kit, los sintes y la mezcla por los de otro género sin tocar tus patrones. Para empezar otro: ponele un nombre (si no, se llama Loop y un número), elegí de qué género salen los sonidos (sintes, kit y mezcla), si arranca con la batería del género o vacío, y tocá "Crear loop nuevo"; se arma en Patrón tocando los casilleros, y la melodía va en el piano roll.</div>
  </>;
}

/* ---------- tempo: mantener + o − lo hace correr; tocar el número marca el tempo con toques (tap) ---------- */
function Bpm({ bpm, set }: { bpm: number; set: (v: number) => void }) {
  const cur = useRef(bpm); cur.current = bpm;
  const rep = useRef<any>(0), taps = useRef<number[]>([]), [tapOn, setTapOn] = useState(false);
  const stop = () => { clearTimeout(rep.current); rep.current = 0; };
  const hold = (d: number) => ({
    onPointerDown: (e: PointerEvent) => { e.preventDefault(); set(cur.current + d); let n = 0; const go = () => { n++; set(cur.current + d * (n > 12 ? 5 : 1)); rep.current = setTimeout(go, n > 12 ? 140 : 90); }; rep.current = setTimeout(go, 420); },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onContextMenu: (e: Event) => e.preventDefault(),
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') set(cur.current + d); },
  });
  const tapIt = () => {
    const now = performance.now(), t = taps.current.filter((x) => now - x < 2500); t.push(now); taps.current = t.slice(-6);
    setTapOn(true); setTimeout(() => setTapOn(false), 120);
    if (t.length >= 3) { const iv = (t[t.length - 1] - t[0]) / (t.length - 1); set(60000 / iv); }
  };
  return (
    <div class="bpm">
      <button {...hold(1)} aria-label="Subir tempo">+</button>
      <button class={'tap' + (tapOn ? ' on' : '')} onPointerDown={tapIt} aria-label={'Tempo ' + bpm + '. Tocá al ritmo para marcarlo'}><b>{bpm}</b><small>TAP</small></button>
      <button {...hold(-1)} aria-label="Bajar tempo">−</button>
    </div>
  );
}

/* ---------- escenas A..D ---------- */
function Scenes({ p, up }: { p: Project; up: (fn: (d: Project) => void) => void }) {
  const cur = p.scene ?? 'A', others = SCENES.filter((k) => k !== cur && sceneUsed(p, k));
  return <>
    <div class="chips">
      <button class={'chip ic' + (p.chain ? ' on' : '')} onClick={() => up((d) => { d.chain = !d.chain; })}>{Ic.chain}Cadena</button>
      <button class={'chip ic' + (p.fill ? ' on' : '')} onClick={() => up((d) => { d.fill = !d.fill; })}>{Ic.fill}Redoble</button>
      {others.map((k) => <button class="chip ic" onClick={() => { up((d) => clearScene(d, k)); flashG('Escena ' + k + ' borrada'); }}>{Ic.trash}Borrar {k}</button>)}
    </div>
    <div class="hint">Las letras A, B, C y D de arriba (en el transporte) son cuatro versiones del loop para armar un tema: tocá B y arranca como copia de la actual; cambiale golpes o notas o apagá instrumentos. Si está sonando, cambia al terminar la vuelta. Cadena las va pasando solas y Redoble mete un redoble de batería al final de cada vuelta.</div>
  </>;
}

/* ---------- herramientas de pista: variación, copiar y pegar ---------- */
function TrackTools({ p, t, upT }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const [clip, setC] = useState(getClip);
  void p;
  return <>
    <div class="chips" style={{ marginBottom: '4px' }}>
      <button class="chip ic" onClick={() => { setClip(t); setC(getClip()); flashG('Copiaste el patrón de ' + t.name); }}>{Ic.copy}Copiar patrón</button>
      {clip && <button class="chip ic" onClick={() => { let what = ''; upT(t.id, (x) => { what = pasteClip(x, clip); }); setTimeout(() => flashG(what ? 'Pegaste ' + what + ' de ' + clip.name : 'Eso no se puede pegar en ' + t.name), 0); }}>{Ic.paste}Pegar de {clip.name}</button>}
    </div>
  </>;
}

/* ---------- controlador MIDI ---------- */
const midiLabel = (p: Project, target: string) => {
  const [k, a] = target.split(':'), tn = (id: string) => p.tracks.find((t) => t.id === id)?.name ?? id;
  if (k === 'macro') return MACROS.find((m) => m.k === a)?.label ?? a;
  if (k === 'vol') return 'Volumen ' + tn(a);
  if (k === 'mute') return 'Mute ' + tn(a);
  if (k === 'scene') return 'Escena ' + a;
  return ({ play: 'Play / Stop', fill: 'Redoble', undo: 'Deshacer' } as Record<string, string>)[k] ?? target;
};
function MidiCard({ p }: { p: Project }) {
  const [, f] = useState(0), [on, setOn] = useState(!!midi.access), [err, setErr] = useState('');
  useEffect(() => useMidiPing(() => f((x) => x + 1)), []);
  const learn = (t: string | null) => { midi.learn = t; f((x) => x + 1); };
  if (!midi.supported) return <Panel id="midi" title="Controlador MIDI" icon={Ic.midi} def={false}><div class="note">Este navegador no tiene MIDI (en iPhone y en Safari no existe). Funciona en Chrome, en Android o en la compu, con un controlador enchufado por USB.</div></Panel>;
  const groups: [string, string[]][] = [
    ['Macros', MACROS.map((m) => 'macro:' + m.k)], ['Transporte', ['play', 'fill', 'undo']], ['Escenas', SCENES.map((k) => 'scene:' + k)],
    ['Volumen', p.tracks.map((t) => 'vol:' + t.id)], ['Mute', p.tracks.map((t) => 'mute:' + t.id)],
  ];
  return (
    <Panel id="midi" title="Controlador MIDI" icon={Ic.midi} def={false}>

      {!on ? <button class="btn hot" onClick={async () => { try { await connectMidi(); setOn(true); setErr(''); } catch { setErr('No se pudo usar MIDI: revisá el permiso del navegador.'); } }}>Conectar controlador</button>
        : <div class="appst"><div><i class={midi.inputs.length ? 'ok' : ''} />{midi.inputs.length ? midi.inputs.join(', ') : 'No hay controladores: enchufalo y esperá un momento'}</div></div>}
      {err && <div class="err">{err}</div>}
      {on && <>
        {midi.learn ? <div class="learn"><span class="dotrec" />Mové una perilla o tocá un pad para <b>{midiLabel(p, midi.learn)}</b><button class="chip" onClick={() => learn(null)}>Cancelar</button></div> : <>
          <div class="sub">Asignar (tocá y después mové el control)</div>
          {groups.map(([g, ts]) => <><div class="midig">{g}</div><div class="chips">{ts.map((t) => { const m = midi.maps.find((x) => x.target === t); return <button class={'chip' + (m ? ' on' : '')} onClick={() => learn(t)}>{midiLabel(p, t).replace(/^(Volumen|Mute) /, '')}{m ? ' ·' : ''}</button>; })}</div></>)}
        </>}
        {midi.maps.length > 0 && <><div class="sub">Asignados</div>
          <div class="maps">{midi.maps.map((m) => <div><span>{midiLabel(p, m.target)}</span><small>{m.src.replace(/^cc:(\d+):/, (_, c) => 'CC ' + (c > 0 ? '(canal ' + (+c + 1) + ') ' : '')).replace(/^note:(\d+):/, (_, c) => 'Nota ' + (c > 0 ? '(canal ' + (+c + 1) + ') ' : ''))}</small><button class="chip" onClick={() => { midi.maps = midi.maps.filter((x) => x !== m); saveMidi(); }}>Quitar</button></div>)}</div></>}
        <div class="chips" style={{ marginTop: '10px' }}><button class={'chip' + (midi.keys ? ' on' : '')} onClick={() => { midi.keys = !midi.keys; saveMidi(); }}>Las teclas tocan la pista elegida</button></div>
      </>}
      <div class="hint">Las perillas sirven para macros y volúmenes; los pads o botones, para escenas, mute, play, redoble y deshacer. Con "Grabar movimientos" activo, lo que muevas en el controlador también se graba. Las teclas no asignadas tocan la pista que tenés elegida en Patrón. Las asignaciones quedan guardadas en este dispositivo.</div>
    </Panel>
  );
}

/* ---------- sinte pro (estilo Serum) ---------- */
const SH = (i: number, t: number) => i === 0 ? Math.sin(2 * Math.PI * t) : i === 1 ? 4 * Math.abs(((t + 0.75) % 1) - 0.5) - 1 : i === 2 ? 2 * ((t + 0.5) % 1) - 1 : (t < (i === 3 ? 0.5 : 0.12) ? 1 : -1) - (2 * (i === 3 ? 0.5 : 0.12) - 1);
const VOWS = [[3.5, 6], [2, 9], [1.5, 11], [2.5, 4.5], [1.5, 4], [3.5, 6]];
function wtW(kind: WTable, fr: number, k: number) {
  const g = (x: number, m: number, w: number) => Math.exp(-((x - m) ** 2) / (2 * w * w));
  if (kind === 'harm') { const n = 1 + fr * 31; return Math.max(0, Math.min(1, n - k + 1)) / k; }
  if (kind === 'vocal') { const x = fr * 5, i = Math.min(4, Math.floor(x)), f = x - i, f1 = VOWS[i][0] + (VOWS[i + 1][0] - VOWS[i][0]) * f, f2 = VOWS[i][1] + (VOWS[i + 1][1] - VOWS[i][1]) * f; return (g(k, f1, 1.1) + 0.7 * g(k, f2, 1.6) + 0.04) / Math.sqrt(k); }
  if (kind === 'metal') return ((k % 2 ? 1 : 0.35) / Math.pow(k, 0.7)) * (0.15 + 0.85 * Math.abs(Math.cos(Math.PI * k * (0.08 + fr * 0.42))));
  return k === 1 ? 1 : 0;
}
/* dibujo de un ciclo de la onda (igual que en el motor) */
function wavePath(o: ProOsc, w = 200, h = 64) {
  const N = 96, ys: number[] = [];
  for (let j = 0; j < N; j++) {
    const t = j / N; let v = 0;
    if (o.table === 'basic') { const x = o.pos * 4, i = Math.min(3, Math.floor(x)), f = x - i; v = SH(i, t) + (f > 0.001 ? (SH(i + 1, t) - SH(i, t)) * f : 0); }
    else { const fr = o.pos; for (let k = 1; k <= 32; k++) { const a = wtW(o.table, fr, k); if (a) v += a * Math.sin(2 * Math.PI * k * t); } }
    ys.push(v);
  }
  const m = Math.max(1e-6, ...ys.map(Math.abs));
  return ys.map((v, j) => (j ? 'L' : 'M') + ((j / (N - 1)) * w).toFixed(1) + ' ' + (h / 2 - (v / m) * (h / 2 - 4)).toFixed(1)).join(' ');
}
function filterPath(P: Pro, w = 300, h = 80) {
  const k = 2 - 2 * Math.min(0.98, P.res); let d = '';
  for (let j = 0; j <= 80; j++) {
    const f = 20 * Math.pow(1000, j / 80), x = f / P.cut, den = Math.sqrt((1 - x * x) ** 2 + (k * x) ** 2);
    let m = P.fType === 'hp' ? (x * x) / den : P.fType === 'bp' ? (k * x) / den : P.fType === 'notch' ? Math.abs(1 - x * x) / den : 1 / den;
    if (P.fType === 'lp24') m *= 1 / Math.sqrt((1 - x * x) ** 2 + (1.414 * x) ** 2);
    const db = Math.max(-36, Math.min(18, 20 * Math.log10(m + 1e-9)));
    d += (j ? 'L' : 'M') + ((j / 80) * w).toFixed(1) + ' ' + (h * 0.35 - (db / 36) * h * 0.6).toFixed(1);
  }
  return d;
}
function envPath(e: ProEnv, w = 140, h = 44) {
  const tot = e.a + e.d + 0.5 + e.r, X = (t: number) => ((t / tot) * w).toFixed(1), Y = (v: number) => (h - 2 - v * (h - 6)).toFixed(1);
  return `M0 ${Y(0)} L${X(e.a)} ${Y(1)} L${X(e.a + e.d)} ${Y(e.s)} L${X(e.a + e.d + 0.5)} ${Y(e.s)} L${X(tot)} ${Y(0)}`;
}
const sec = (v: number) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's');
const MY_KEY = 'loop.mysynths';
const mySynths = (): { name: string; pro: Pro }[] => { try { return JSON.parse(localStorage.getItem(MY_KEY) ?? '[]'); } catch { return []; } };
type ProTab = 'a' | 'b' | 'sub' | 'filt' | 'env' | 'lfo' | 'mod' | 'voice';
function SynthPro({ t, upT }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const P = t.synth!.pro!, c = t.color, D = mkPro();
  const [tab, setTab] = useState<ProTab>('a'), [mine, setMine] = useState(mySynths), [naming, setNaming] = useState(false), [nm, setNm] = useState('');
  const setP = (fn: (p: Pro) => void) => upT(t.id, (x) => { const p = clone(x.synth!.pro!); fn(p); x.synth = { ...x.synth!, pro: p }; });
  const K = (label: string, v: number, min: number, max: number, on: (p: Pro, v: number) => void, o: { fmt?: (v: number) => string; log?: boolean; step?: number; def?: number } = {}) =>
    <Knob label={label} value={v} min={min} max={max} color={c} fmt={o.fmt ?? pct} log={o.log} step={o.step} def={o.def} onChange={(x) => setP((p) => on(p, x))} />;
  const oscTab = (k: 'a' | 'b') => { const o = P[k]; return <>
    <div class="pro-row">
      <svg class="pro-wave" viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="32" x2="200" y2="32" stroke="#2a2a2a" /><path d={wavePath(o)} fill="none" stroke={o.on ? c : '#5a5a5a'} stroke-width="2" vector-effect="non-scaling-stroke" /></svg>
      <button class={'chip' + (o.on ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p[k].on = !p[k].on; })}>{o.on ? 'Encendido' : 'Apagado'}</button>
    </div>
    <div class="chips">{WTABLES.map(([w, l]) => <button class={'chip' + (o.table === w ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p[k].table = w; })}>{l}</button>)}</div>
    {o.table === 'basic' && <div class="chips" style={{ marginTop: '6px' }}>{([[0, 'Seno'], [0.25, 'Triángulo'], [0.5, 'Sierra'], [0.75, 'Cuadrada'], [1, 'Pulso']] as [number, string][]).map(([v, l]) => <button class={'chip mini-chip' + (Math.abs(o.pos - v) < 0.01 ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p[k].pos = v; })}>{l}</button>)}</div>}
    <div class="knobs">
      {K('Forma', o.pos, 0, 1, (p, v) => { p[k].pos = +v.toFixed(3); }, { def: 0.5 })}
      {K('Octava', o.oct, -3, 3, (p, v) => { p[k].oct = v; }, { step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v })}
      {K('Semitono', o.semi, -12, 12, (p, v) => { p[k].semi = v; }, { step: 1, def: 0, fmt: (v) => (v > 0 ? '+' : '') + v })}
      {K('Fino', o.fine, -50, 50, (p, v) => { p[k].fine = Math.round(v); }, { def: 0, fmt: (v) => Math.round(v) + 'ct' })}
      {K('Unísono', o.uni, 1, 7, (p, v) => { p[k].uni = v; }, { step: 1, def: 1, fmt: (v) => v + (v === 1 ? ' voz' : ' voces') })}
      {K('Detune', o.det, 0, 100, (p, v) => { p[k].det = Math.round(v); }, { def: 0, fmt: (v) => Math.round(v) + 'ct' })}
      {K('Ancho', o.width, 0, 1, (p, v) => { p[k].width = v; }, { def: 0.5 })}
      {K('Nivel', o.level, 0, 1, (p, v) => { p[k].level = v; }, { def: 1 })}
      {k === 'b' && K('FM a A', P.fm, 0, 1, (p, v) => { p.fm = v < 0.01 ? 0 : v; }, { def: 0, fmt: (v) => (v < 0.01 ? 'no' : pct(v)) })}
    </div>
    <div class="hint">{k === 'a' ? 'Forma recorre la tabla de onda: en Básica va de seno a triángulo, sierra, cuadrada y pulso; las otras tablas cambian de color a medida que la movés. Unísono apila voces desafinadas (Detune) y Ancho las abre en estéreo.' : 'El oscilador B suena junto al A o, con "FM a A", lo modula (B deja de sonar y le da al A un brillo metálico o de campana).'}</div>
  </>; };
  const lfoBox = (i: 1 | 2) => { const L: ProLfo = i === 1 ? P.lfo1 : P.lfo2, set = (fn: (l: ProLfo) => void) => setP((p) => fn(i === 1 ? p.lfo1 : p.lfo2)); return <>
    <div class="sub">LFO {i}</div>
    <div class="chips">{([['sine', 'Seno'], ['tri', 'Triángulo'], ['saw', 'Sierra'], ['sqr', 'Cuadrada'], ['rand', 'Al azar']] as const).map(([k, l]) => <button class={'chip' + (L.shape === k ? ' on' : '')} style={{ '--c': c } as any} onClick={() => set((x) => { x.shape = k; })}>{l}</button>)}</div>
    <div class="chips" style={{ marginTop: '6px' }}>{LFO_RATES.map(([r, l]) => <button class={'chip mini-chip' + (L.rate === r ? ' on' : '')} style={{ '--c': c } as any} onClick={() => set((x) => { x.rate = r; })}>{l}</button>)}
      <button class={'chip mini-chip' + (L.trig ? ' on' : '')} style={{ '--c': c } as any} onClick={() => set((x) => { x.trig = !x.trig; })}>Arranca con cada nota</button></div>
  </>; };
  return <div class="pro" style={{ '--c': c } as any}>
    <div class="sub">Sinte pro</div>
    <div class="chips">{Object.entries(PRO_PRESETS).filter(([, v]) => v.for.includes(t.type)).map(([k, v]) => <button class="chip" style={{ '--c': c } as any} onClick={() => upT(t.id, (x) => { x.synth = { ...x.synth!, pro: clone(PRO_PRESETS[k].p) }; })}>{v.label}</button>)}</div>
    {(mine.length > 0 || naming) && <div class="chips" style={{ marginTop: '6px' }}>
      {mine.map((m, i) => <span class="mychip"><button class="chip" onClick={() => upT(t.id, (x) => { x.synth = { ...x.synth!, pro: clone(m.pro) }; })}>★ {m.name}</button><button class="chip x" aria-label={'Borrar ' + m.name} onClick={() => { const l = mine.filter((_, j) => j !== i); try { localStorage.setItem(MY_KEY, JSON.stringify(l)); } catch { /* */ } setMine(l); }}>×</button></span>)}
    </div>}
    {naming ? <form class="gp-row" style={{ marginTop: '8px' }} onSubmit={(e) => { e.preventDefault(); const n = nm.trim().slice(0, 24) || 'Mi sonido'; const l = [...mine.filter((m) => m.name !== n), { name: n, pro: clone(P) }]; try { localStorage.setItem(MY_KEY, JSON.stringify(l)); flashG('Guardado en Mis sonidos: ' + n); } catch { flashG('No queda lugar para guardarlo.'); } setMine(l); setNaming(false); setNm(''); }}>
      <input value={nm} placeholder="Nombre del sonido" maxLength={24} onInput={(e) => setNm((e.target as HTMLInputElement).value)} /><button class="btn hot" type="submit">Guardar</button><button class="btn" type="button" onClick={() => setNaming(false)}>Cancelar</button>
    </form> : <div class="chips" style={{ marginTop: '6px' }}><button class="chip" onClick={() => setNaming(true)}>Guardar en Mis sonidos</button><button class="chip" onClick={() => upT(t.id, (x) => { const { pro, ...rest } = x.synth!; void pro; x.synth = rest; })}>Volver al sinte simple</button></div>}
    <div class="pro-tabs">{([['a', 'Osc A'], ['b', 'Osc B'], ['sub', 'Sub y ruido'], ['filt', 'Filtro'], ['env', 'Envolventes'], ['lfo', 'LFO'], ['mod', 'Matriz'], ['voice', 'Voz']] as [ProTab, string][]).map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'mod' && P.mods.length ? ' ' + P.mods.length : ''}</button>)}</div>
    {tab === 'a' && oscTab('a')}
    {tab === 'b' && oscTab('b')}
    {tab === 'sub' && <><div class="knobs">
      {K('Sub', P.sub, 0, 1, (p, v) => { p.sub = v < 0.01 ? 0 : v; }, { def: 0 })}
      {K('Ruido', P.noise, 0, 0.5, (p, v) => { p.noise = v < 0.005 ? 0 : v; }, { def: 0 })}
    </div>
      <div class="chips">{([[-1, 'Sub 1 octava abajo'], [-2, 'Sub 2 octavas abajo']] as [-1 | -2, string][]).map(([v, l]) => <button class={'chip' + (P.subOct === v ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p.subOct = v; })}>{l}</button>)}</div>
      <div class="hint">Sub: un seno grave que le da cuerpo (ideal en bajos). Ruido: aire o ataque, para plucks y subidas.</div></>}
    {tab === 'filt' && <>
      <svg class="pro-filt" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="28" x2="300" y2="28" stroke="#2a2a2a" /><path d={filterPath(P) + ' L300 80 L0 80 Z'} fill={c} fill-opacity="0.15" /><path d={filterPath(P)} fill="none" stroke={c} stroke-width="2" vector-effect="non-scaling-stroke" /></svg>
      <div class="chips">{([['lp12', 'Pasa bajos 12'], ['lp24', 'Pasa bajos 24'], ['hp', 'Pasa altos'], ['bp', 'Pasa banda'], ['notch', 'Notch']] as [Pro['fType'], string][]).map(([k, l]) => <button class={'chip' + (P.fType === k ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p.fType = k; })}>{l}</button>)}</div>
      <div class="knobs">
        {K('Corte', P.cut, 30, 18000, (p, v) => { p.cut = Math.round(v); }, { log: true, def: D.cut, fmt: hz })}
        {K('Reso', P.res, 0, 0.95, (p, v) => { p.res = v; }, { def: D.res })}
        {K('Drive', P.drive, 0, 1, (p, v) => { p.drive = v < 0.01 ? 0 : v; }, { def: 0 })}
        {K('Env 2', P.fEnv, -1, 1, (p, v) => { p.fEnv = Math.abs(v) < 0.01 ? 0 : v; }, { def: 0, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v * 100) })}
        {K('Teclado', P.fKey, 0, 1, (p, v) => { p.fKey = v; }, { def: 0 })}
      </div>
      <div class="hint">Env 2 abre (o cierra, si es negativo) el filtro con la envolvente 2: es lo que hace sonar "pluck" a un sinte. Teclado: las notas agudas abren más el filtro.</div></>}
    {tab === 'env' && ([['env1', 'Envolvente 1 · volumen'], ['env2', 'Envolvente 2 · modulación']] as ['env1' | 'env2', string][]).map(([k, l]) => { const e = P[k]; return <>
      <div class="sub">{l}</div>
      <div class="pro-env"><svg viewBox="0 0 140 44" preserveAspectRatio="none" aria-hidden="true"><path d={envPath(e)} fill="none" stroke={c} stroke-width="2" vector-effect="non-scaling-stroke" /></svg>
        <div class="knobs">
          {K('Ataque', e.a, 0.001, 4, (p, v) => { p[k].a = v; }, { log: true, fmt: sec, def: D[k].a })}
          {K('Decay', e.d, 0.02, 4, (p, v) => { p[k].d = v; }, { log: true, fmt: sec, def: D[k].d })}
          {K('Sustain', e.s, 0, 1, (p, v) => { p[k].s = v; }, { def: D[k].s })}
          {K('Release', e.r, 0.01, 6, (p, v) => { p[k].r = v; }, { log: true, fmt: sec, def: D[k].r })}
        </div></div>
    </>; })}
    {tab === 'env' && <div class="hint">La envolvente 2 no suena sola: movela al filtro (Env 2 en Filtro) o a cualquier destino en la Matriz.</div>}
    {tab === 'lfo' && <>{lfoBox(1)}{lfoBox(2)}<div class="hint">Los LFO van al ritmo del loop (4 c = una vuelta cada 4 compases, 1/16 = cada semicorchea). Para que muevan algo, asignalos en la Matriz.</div></>}
    {tab === 'mod' && <>
      <div class="mods">{P.mods.map((m, i) => <div class="modrow">
        <select value={m.src} aria-label="Fuente" onChange={(e) => setP((p) => { p.mods[i].src = (e.target as HTMLSelectElement).value as any; })}>{MOD_SRC.map(([k, l]) => <option value={k}>{l}</option>)}</select>
        <span>→</span>
        <select value={m.dst} aria-label="Destino" onChange={(e) => setP((p) => { p.mods[i].dst = (e.target as HTMLSelectElement).value as any; })}>{MOD_DST.map(([k, l]) => <option value={k}>{l}</option>)}</select>
        <div class="mini">{K('Cantidad', m.amt, -1, 1, (p, v) => { p.mods[i].amt = Math.abs(v) < 0.005 ? 0 : +v.toFixed(3); }, { def: 0, fmt: (v) => (v > 0 ? '+' : '') + Math.round(v * 100) })}</div>
        <button class="chip x" aria-label="Quitar ruta" onClick={() => setP((p) => { p.mods.splice(i, 1); })}>×</button>
      </div>)}</div>
      {P.mods.length < 6 && <button class="chip" style={{ marginTop: '8px' }} onClick={() => setP((p) => { p.mods.push({ src: 'lfo1', dst: 'cut', amt: 0.3 }); })}>+ Ruta de modulación</button>}
      <div class="hint">Cada ruta conecta una fuente con un destino: LFO 1 → Filtro hace un wobble, LFO → Tono es un vibrato (con poquito alcanza), Env 2 → Forma A cambia el color del ataque y Velocidad → Filtro hace que los acentos suenen más brillantes.</div></>}
    {tab === 'voice' && <>
      <div class="chips">
        <button class={'chip' + (P.mono ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p.mono = !p.mono; })}>Mono</button>
        <button class={'chip' + (P.legato ? ' on' : '')} style={{ '--c': c } as any} onClick={() => setP((p) => { p.legato = !p.legato; })}>Legato (desliza entre notas)</button>
      </div>
      <div class="knobs">
        {K('Glide', P.glide, 0.005, 1, (p, v) => { p.glide = v; }, { log: true, fmt: sec, def: 0.06 })}
        {K('Volumen', P.gain, 0, 2, (p, v) => { p.gain = v; }, { def: 0.3 })}
      </div>
      <div class="hint">Mono: una nota por vez. Con Legato, si las notas se pisan, la nueva se desliza desde la anterior (Glide es cuánto tarda). Los bajos siempre son mono.</div></>}
  </div>;
}

/* ---------- mis loops: varios proyectos guardados en el celu ---------- */
const when = (t: number) => { const d = new Date(t), now = new Date(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return d.toDateString() === now.toDateString() ? 'hoy ' + hm : d.getDate() + '/' + (d.getMonth() + 1) + ' ' + hm; };
function Projects({ p, open, flash }: { p: Project; open: (np: Project) => void; flash: (m: string, ms?: number) => void }) {
  const [list, setList] = useState<Meta[]>(listProjects), [all, setAll] = useState(false), [sure, setSure] = useState(''), [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => setList(listProjects());
  useEffect(() => { const id = setTimeout(refresh, 600); return () => clearTimeout(id); }, [p]); // después de que se guarde solo
  const cur: Meta = { id: p.id ?? '', title: titleOf(p), genre: p.genre, key: p.key, updated: Date.now() };
  const items = [cur, ...list.filter((m) => m.id !== p.id)], shown = all ? items : items.slice(0, 5);
  const go = (id: string) => { flushSave(); const np = loadProject(id); if (np) { open(np); flash('Abriste "' + titleOf(np) + '"'); } else { flash('No se pudo abrir ese loop.'); refresh(); } };
  const remove = async (id: string) => {
    setSure(''); flushSave(); await deleteProject(id); const rest = listProjects(); setList(rest);
    if (id === p.id) { const nx = loadProject(rest[0]?.id ?? null); open(nx ?? { ...blankProject({ tonic: 9, mode: 'min', degrees: [0, 5, 2, 6], ext: 7 }, 'deep', 122, true), title: 'Loop 1' }); }
    flash('Loop borrado');
  };
  const copy = async () => { flushSave(); const d = await duplicate(p); open(d); flushSave(); refresh(); flash('Copia guardada: ahora estás en "' + titleOf(d) + '"'); };
  const [ren, setRen] = useState<string | null>(null);
  const rename = (n: string) => { setRen(null); if (!n.trim()) return; flushSave(); if (p.id) renameProject(p.id, n.trim().slice(0, 32)); const np = loadProject(p.id ?? null); if (np) open(np); refresh(); };
  const toFile = async () => {
    setBusy(true);
    try {
      flushSave(); const b = await exportFile(p), name = baseName({ ...p, name: titleOf(p) }) + '.loop.json', file = new File([b], name, { type: 'application/json' });
      if ((navigator as any).canShare?.({ files: [file] })) await (navigator as any).share({ files: [file], title: name }).catch(() => {});
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    } catch { flash('No se pudo armar el archivo.'); }
    setBusy(false);
  };
  const fromFile = async (f?: File) => {
    if (!f) return; setBusy(true);
    try { flushSave(); const np = await importFile(f); if (!saveProject(np)) throw new Error('lleno'); open(np); refresh(); flash('Abriste "' + titleOf(np) + '" desde el archivo'); }
    catch { flash('Ese archivo no es un loop de esta app (o no queda lugar).', 3500); }
    setBusy(false); if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div class="projs-w">
      {ren !== null ? <form class="gp-row" style={{ marginBottom: '8px' }} onSubmit={(e) => { e.preventDefault(); rename(ren); }}><input value={ren} maxLength={32} aria-label="Nombre del loop" onInput={(e) => setRen((e.target as HTMLInputElement).value)} /><button class="btn hot" type="submit">Guardar</button><button class="btn" type="button" onClick={() => setRen(null)}>Cancelar</button></form>
        : <div class="chips" style={{ marginBottom: '8px' }}><button class="chip" onClick={() => setRen(titleOf(p))}>Renombrar</button><button class="chip ic" onClick={copy}>{Ic.copy}Duplicar</button></div>}
      <div class="projs">
        {shown.map((m) => <div class={'proj' + (m.id === p.id ? ' cur' : '')}>
          <button class="pj-open" onClick={() => m.id !== p.id && go(m.id)} aria-label={m.id === p.id ? m.title + ' (abierto)' : 'Abrir ' + m.title}>
            <b>{m.title}</b><span>{GENRES[m.genre]?.name ?? m.genre}{m.key ? ' · ' + m.key : ''} · {m.id === p.id ? 'abierto' : when(m.updated)}</span>
          </button>
          {(m.id !== p.id || items.length > 1) && <button class={'chip pj-del' + (sure === m.id ? ' on' : '')} style={{ '--c': 'var(--red)' } as any} onClick={() => (sure === m.id ? remove(m.id) : (setSure(m.id), setTimeout(() => setSure((x) => (x === m.id ? '' : x)), 2500)))}>{sure === m.id ? '¿Borrar?' : 'Borrar'}</button>}
        </div>)}
      </div>
      {items.length > 5 && <button class="chip" style={{ marginTop: '8px' }} onClick={() => setAll(!all)}>{all ? 'Ver menos' : 'Ver todos (' + items.length + ')'}</button>}
      <div class="chips" style={{ marginTop: '10px' }}>
        <button class="chip" disabled={busy} onClick={toFile}>Guardar en un archivo</button>
        <label class={'chip up' + (busy ? ' dis' : '')}>Abrir archivo<input ref={fileRef} type="file" accept=".json,.loop,application/json" disabled={busy} onChange={(e) => fromFile((e.target as HTMLInputElement).files?.[0])} /></label>
      </div>
      <div class="hint">Todo se guarda solo en este celu. Si creás un loop nuevo sin haber tocado el abierto, lo reemplaza; si lo editaste, queda guardado acá y el nuevo va aparte. "Guardar en un archivo" lo lleva a otro celu o a la compu, con tu voz incluida.</div>
    </div>
  );
}

/* ---------- la app: instalar, sin conexión y espacio ---------- */
function AppCard({ adv, setAdv }: { adv: boolean; setAdv: (v: boolean) => void }) {
  const w = usePwa(), [persist, setPersist] = useState<boolean | null>(null), [use, setUse] = useState('');
  const standalone = typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const offline = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersist).catch(() => {});
    navigator.storage?.estimate?.().then((e) => { if (e.usage != null) setUse((e.usage / 1048576).toFixed(1) + ' MB'); }).catch(() => {});
    if (standalone) navigator.storage?.persist?.().then(setPersist).catch(() => {}); // instalada: que el navegador no borre los loops
  }, []);
  return (
    <Panel id="app" title="App" icon={Ic.phone} def={false}>

      <div class="seg" style={{ marginBottom: '10px' }}><button class={!adv ? 'on' : ''} onClick={() => setAdv(false)}>Modo simple</button><button class={adv ? 'on' : ''} onClick={() => setAdv(true)}>Modo avanzado</button></div>
      <div class="appst">
        <div><i class={standalone ? 'ok' : ''} />{standalone ? 'Instalada en este dispositivo' : 'Abierta en el navegador'}</div>
        <div><i class={offline ? 'ok' : ''} />{offline ? 'Funciona sin conexión' : 'Preparando el modo sin conexión…'}</div>
        <div><i class="ok" />Versión del {new Date(__BUILD__).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
        <div><i class={persist ? 'ok' : ''} />{persist ? 'Tus loops están protegidos' : 'El navegador podría borrar tus loops si se queda sin espacio'}{use ? ' · ' + use + ' usados' : ''}</div>
      </div>
      <div class="chips" style={{ marginTop: '10px' }}>
        {!standalone && w.prompt && <button class="btn hot" onClick={async () => { w.prompt.prompt(); await w.prompt.userChoice.catch(() => {}); w.prompt = null; pwaPing(); }}>Instalar Loop</button>}
        {!persist && navigator.storage?.persist && <button class="chip" onClick={() => navigator.storage.persist().then((x) => { setPersist(x); if (!x) alert('El navegador no lo permitió todavía. Instalando la app suele alcanzar.'); }).catch(() => {})}>Proteger mis loops</button>}
        {w.update && <button class="btn vio" onClick={() => w.update!()}>Actualizar a la versión nueva</button>}
      </div>
      {!standalone && <div class="hint">{ios ? 'En iPhone: abrila en Safari, tocá Compartir (el cuadrado con la flecha) y después "Agregar a inicio". Queda como una app, a pantalla completa y sin conexión.' : w.prompt ? 'Instalala para abrirla como una app, a pantalla completa y sin conexión.' : 'Para instalarla, abrí el menú del navegador y elegí "Instalar app" o "Agregar a la pantalla de inicio".'}</div>}
    </Panel>
  );
}
/* aviso de versión nueva: no recarga sola para no cortar lo que está sonando */
function UpdateBar() {
  const w = usePwa(), [hide, setHide] = useState(false);
  if (!w.update || hide) return null;
  return <div class="updbar"><span>Hay una versión nueva de Loop</span><button class="btn hot" onClick={() => w.update!()}>Actualizar</button><button class="chip" onClick={() => setHide(true)}>Después</button></div>;
}

/* ---------- exportar ---------- */
type Out = { url: string; file: File; name: string; size: number };
function Export({ p, up }: { p: Project; up: (fn: (d: Project) => void) => void }) {
  const [song, setSong] = useState(false), seq = p.arrangement?.length ? p.arrangement : defaultArrangement(p), used = SCENES.filter((k) => sceneUsed(p, k));
  const setSeq = (v: string[]) => up((d) => { d.arrangement = v; });
  const [loops, setLoops] = useState(1), [busy, setBusy] = useState(''), [out, setOut] = useState<Out | null>(null), [err, setErr] = useState('');
  const make = async (kind: 'wav' | 'mp3' | 'zip') => {
    if (busy) return; setErr(''); if (out) { URL.revokeObjectURL(out.url); setOut(null); }
    try {
      let data: Uint8Array, ext: string, mime: string;
      if (kind === 'zip') { data = await abletonZip(engine, p, loops, setBusy); ext = 'zip'; mime = 'application/zip'; }
      else {
        setBusy(song ? 'Renderizando el tema…' : 'Renderizando el loop…'); const a = song ? await renderArrangement(engine, p, seq) : await renderAudio(engine, p, loops);
        if (kind === 'wav') { data = wav(a, 24); ext = 'wav'; mime = 'audio/wav'; } else { setBusy('Codificando MP3…'); data = await mp3(a); ext = 'mp3'; mime = 'audio/mpeg'; }
      }
      const name = baseName(p) + (kind === 'zip' ? '_ableton' : song ? '_tema' : '') + '.' + ext, file = new File([data as BlobPart], name, { type: mime });
      setOut({ url: URL.createObjectURL(file), file, name, size: data.length });
    } catch (e: any) { console.error(e); setErr('No se pudo exportar en este navegador. Probá desde Chrome o Safari actualizados.'); }
    setBusy('');
  };
  const canShare = typeof navigator !== 'undefined' && (navigator as any).canShare && out && (navigator as any).canShare({ files: [out.file] });
  return (
    <Panel id="export" title="Exportar" icon={Ic.export}>

      <div class="seg" style={{ marginBottom: '10px' }}><button class={!song ? 'on' : ''} onClick={() => setSong(false)}>Loop</button><button class={song ? 'on' : ''} onClick={() => setSong(true)}>Tema con escenas</button></div>
      {!song ? <>
        <div class="sub" style={{ marginTop: 0 }}>Largo</div>
        <div class="chips">{[[1, '4 compases'], [2, '8 compases'], [4, '16 compases']].map(([v, l]) => <button class={'chip' + (loops === v ? ' on' : '')} onClick={() => setLoops(v as number)}>{l}</button>)}</div>
      </> : <>
        <div class="sub" style={{ marginTop: 0 }}>Orden · {seq.length} vueltas · {fmtT((seq.length * 64 * 60) / p.bpm / 4)}</div>
        <div class="arr">{seq.map((k, i) => <button class="scn used" aria-label={'Quitar ' + k + ' (posición ' + (i + 1) + ')'} onClick={() => setSeq(seq.filter((_, j) => j !== i))}>{k}</button>)}</div>
        <div class="chips" style={{ marginTop: '8px' }}>{used.map((k) => <button class="chip" onClick={() => setSeq([...seq, k])}>+ {k}</button>)}
          <button class="chip" onClick={() => setSeq(defaultArrangement(p))}>Restablecer</button></div>
      </>}
      <div class="exp-btns">
        <button class="btn hot" disabled={!!busy || (song && !seq.length)} onClick={() => make('wav')}>WAV</button>
        <button class="btn hot" disabled={!!busy || (song && !seq.length)} onClick={() => make('mp3')}>MP3</button>
        {!song && <button class="btn vio" disabled={!!busy} onClick={() => make('zip')}>Para Ableton (.zip)</button>}
      </div>
      {busy && <div class="exp-status"><i class="spin" />{busy}</div>}
      {err && <div class="exp-status" style={{ color: '#ff7b7b' }}>{err}</div>}
      {out && <div class="exp-out">
        <div><b>{out.name}</b><span>{(out.size / 1048576).toFixed(1)} MB</span></div>
        <div class="exp-btns">
          <a class="btn hot" href={out.url} download={out.name}>Descargar</a>
          {canShare && <button class="btn" onClick={() => (navigator as any).share({ files: [out.file], title: out.name }).catch(() => {})}>Compartir / Guardar en el celu</button>}
        </div>
      </div>}
      <div class="hint">Tema con escenas: cada letra es una vuelta de 4 compases de esa escena, en el orden que armes (tocá una letra para sacarla). Sale todo de una pasada, con las colas de reverb de una parte a la otra, y el volumen se ajusta con la parte más llena, así la intro y el break quedan más bajos que el drop. El WAV y el MP3 de un loop empalman perfecto si los ponés en loop. El paquete para Ableton trae un WAV por pista (stems), la mezcla, los MIDI de cada pista y de la batería, y un LEEME con el tempo y la tonalidad: arrastrás todo al compás 1 y queda alineado.</div>
    </Panel>
  );
}

const EQF = ['63', '160', '400', '1k', '2.5k', '6.3k', '10k', '16k'];
const EQPRE: Record<string, number[]> = { Plano: [0, 0, 0, 0, 0, 0, 0, 0], 'Más graves': [5, 3, 0, -1, 0, 0, 0, 0], Brillo: [0, 0, -1, 0, 1, 3, 4, 3], Club: [4, 2, -2, -2, 0, 2, 3, 2], 'Cálido': [2, 3, 1, 0, -1, -2, -3, -3], 'Lo-fi': [-12, -4, 2, 3, 2, -4, -10, -12], 'Sin barro': [0, -1, -4, -1, 1, 1, 0, 0] };
function Master({ p, up, stats }: { p: Project; up: (fn: (d: Project) => void) => void; stats: { lufs: number; auto: number; gr: number } }) {
  const curve = useMemo(() => {
    const F = [63, 160, 400, 1000, 2500, 6300, 10000, 16000]; let d = '';
    for (let i = 0; i <= 96; i++) { const f = 30 * Math.pow(18000 / 30, i / 96); let g = 0;
      F.forEach((fc, k) => { const x = Math.log2(f / fc); const gk = p.master.eq[k]; g += k === 0 ? gk / (1 + Math.exp(x * 3)) : k === 7 ? gk / (1 + Math.exp(-x * 3)) : gk * Math.exp(-x * x * 1.6); });
      d += (i ? 'L' : 'M') + (i / 96 * 320).toFixed(1) + ' ' + (48 - g / 12 * 40).toFixed(1); }
    return d;
  }, [p.master.eq]);
  return <>
    <Panel id="out" title="Salida" icon={Ic.meter} def={false}>

      <div class="stats">
        <div class="stat"><b>{stats.lufs > -60 ? stats.lufs.toFixed(1) : '–'}</b><span>LUFS</span></div>
        <div class="stat"><b>{stats.auto >= 0 ? '+' : ''}{stats.auto.toFixed(1)}</b><span>Auto-ganancia dB</span></div>
        <div class="stat"><b>{stats.gr.toFixed(1)}</b><span>Limitador dB</span></div>
      </div>
      <div class="chips" style={{ marginTop: '10px' }}>
        <button class={'chip' + (p.master.auto ? ' on' : '')} onClick={() => up((d) => { d.master.auto = !d.master.auto; })}>Volumen automático</button>
        {[-16, -14, -11].map((t) => <button class={'chip' + (p.master.target === t ? ' on' : '')} onClick={() => up((d) => { d.master.target = t; })}>{t} LUFS{t === -14 ? ' (streaming)' : t === -11 ? ' (club)' : ' (suave)'}</button>)}
      </div>
      <div class="hint">El volumen automático mide la sonoridad como el oído y la mantiene pareja, suenen todas las pistas o una sola. El limitador nunca deja pasar de {p.master.ceiling} dB.</div>
    </Panel>
    <Panel id="eq" title="EQ · 8 bandas" icon={Ic.eq} def={false}>

      <div class="eqv"><svg viewBox="0 0 320 96" preserveAspectRatio="none"><line x1="0" y1="48" x2="320" y2="48" stroke="#2c3350" /><path d={curve + ' L320 96 L0 96 Z'} fill="rgba(47,216,180,.12)" /><path d={curve} stroke="#2fd8b4" stroke-width="2" fill="none" vector-effect="non-scaling-stroke" /></svg></div>
      <div class="faders8">{p.master.eq.map((g, k) => <div><Fader h={120} label={'EQ ' + EQF[k]} value={g} min={-12} max={12} def={0} color="#2fd8b4" onChange={(v) => up((d) => { d.master.eq[k] = Math.round(v * 2) / 2; })} /><div class="lab">{g > 0 ? '+' : ''}{g}</div><div class="lab">{EQF[k]}</div></div>)}</div>
      <div class="chips" style={{ marginTop: '10px' }}>{Object.keys(EQPRE).map((k) => <button class="chip" onClick={() => up((d) => { d.master.eq = [...EQPRE[k]]; })}>{k}</button>)}</div>
    </Panel>
    <Panel id="fx" title="Reverb y delay" icon={Ic.space} def={false}>

      <div class="knobs">
        <Knob label="Tamaño" value={p.fx.revSize} min={0.3} max={0.98} def={0.8} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revSize = v; })} />
        <Knob label="Brillo rev." value={1 - p.fx.revDamp} min={0} max={1} def={0.65} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revDamp = 1 - v; })} />
        <Knob label="Retorno rev." value={p.fx.revRet} min={0} max={1.5} def={0.9} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revRet = v; })} />
        <Knob label="Repeticiones" value={p.fx.dlyFb} min={0} max={0.8} def={0.42} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.dlyFb = v; })} />
        <Knob label="Retorno delay" value={p.fx.dlyRet} min={0} max={1.5} def={0.7} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.dlyRet = v; })} />
        <Knob label="Swing" value={p.swing} min={0} max={0.6} def={0} color="var(--sun)" fmt={pct} onChange={(v) => up((d) => { d.swing = v; })} />
      </div>
    </Panel>
  </>;
}

render(<App />, document.getElementById('app')!);
