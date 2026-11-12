import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './style.css';
import { Engine } from './engine/engine';
import { Stage, type StageMode } from './stage';
import { saveVox, loadVox, deleteVox, cleanVox, startRecording, peaks, finishLoopVox } from './vox';
import { renderAudio, wav, mp3, abletonZip, baseName, takeWav, takeMp3, type Take } from './engine/export';
import {
  rollFromTrack, MACROS, AUTO_PARAMS, AUTO_SHAPES, autoShape, type AutoKey,
  type Project, type Track, SYNTHS, KITS, DRUM_SOUNDS, GENRES, newProject, projectFromName, applyGenre, harmonyFromName, applyHarmony,
  arpPlays, arpPreview, noteName, letterNote, clean, newTrack, generateMelody, nameScale, DRUM_GROUPS, type TrackType,
} from './model';

const engine = new Engine();
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const load = (): Project | null => {
  try { const s = localStorage.getItem('loop.project'); if (!s) return null; const p: Project = JSON.parse(s); if (!GENRES[p.genre]) applyGenre(p, 'prog'); p.tracks.forEach((t) => { if (t.type !== 'drum' && t.type !== 'vocal' && !SYNTHS[t.sound]) t.sound = t.type === 'bass' ? 'bassSaw' : t.type === 'chords' ? 'strings' : 'pluck'; }); return p; } catch { return null; }
};
const save = (p: Project) => { try { localStorage.setItem('loop.project', JSON.stringify(p)); } catch { /* sin almacenamiento */ } };

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
type KP = { label: string; value: number; min: number; max: number; onChange: (v: number) => void; fmt?: (v: number) => string; log?: boolean; color?: string; def?: number; step?: number; instant?: boolean };
function Knob({ label, value, min, max, onChange, fmt = (v) => v.toFixed(2), log, color = 'var(--vio)', def, step, instant = false }: KP) {
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
      <svg viewBox="0 0 54 54"><path d={arc(-135, 135)} stroke="#2a2a2a" stroke-width="5" fill="none" stroke-linecap="round" />
        {n > 0.004 && <path d={arc(-135, a)} stroke={color} stroke-width="5" fill="none" stroke-linecap="round" />}
        <circle cx="27" cy="27" r="14" fill="#1d1d1d" /><line x1="27" y1="27" x2="27" y2="15" stroke="#ececec" stroke-width="2.5" stroke-linecap="round" transform={`rotate(${a} 27 27)`} /></svg>
      <div class="kl">{label}</div><div class="kv">{fmt(value)}</div>
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
const pct = (v: number) => Math.round(v * 100) + '%';
const hz = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '');

/* ---------- app ---------- */
function App() {
  const [p, setP] = useState<Project>(() => load() ?? projectFromName('Loop'));
  const [tab, setTab] = useState<'scene' | 'pat' | 'mix' | 'master'>('scene');
  const [vis, setVis] = useState<StageMode>('wave');
  const land = useLandscape();
  // guías: la intro aparece al abrir (salvo "No mostrar al abrir"); la de cada sección, la primera vez que entrás. El botón Guía las vuelve a abrir.
  const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return '1'; } }, set: (k: string) => { try { localStorage.setItem(k, '1'); } catch { /* */ } } };
  const [guide, setGuide] = useState<TutKey | null>(() => (ls.get('loop.noTutorial') ? (ls.get('loop.seen.scene') ? null : 'scene') : 'intro'));
  const closeGuide = (never: boolean) => {
    const g = guide; if (!g) return;
    if (g === 'intro') { if (never) ls.set('loop.noTutorial'); setGuide(ls.get('loop.seen.' + tab) ? null : tab); return; }
    ls.set('loop.seen.' + g); setGuide(null);
  };
  const goTab = (t: 'scene' | 'pat' | 'mix' | 'master') => { setTab(t); if (!guide && !ls.get('loop.seen.' + t)) setGuide(t); };
  const [sel, setSel] = useState('arp');
  const [playing, setPlaying] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  // grabar la sesión: todo lo que suena, con lo que vayas tocando, hasta 20 minutos
  const [rec, setRec] = useState(false), [recSecs, setRecSecs] = useState(0), [take, setTake] = useState<Take | null>(null);
  const recTimer = useRef<any>(0);
  const toggleRec = async () => {
    if (!rec) {
      try {
        await engine.startSession(p); setRec(true); setPlaying(true); setRecSecs(0);
        recTimer.current = setInterval(() => { const sec = engine.sessionFrames / engine.sr; setRecSecs(sec); if (sec >= 1200) stopRec(true); }, 500);
      } catch (e) { console.error(e); flash('No se pudo empezar a grabar en este navegador.', 4000); }
      return;
    }
    stopRec(false);
  };
  const stopRec = async (limit: boolean) => {
    clearInterval(recTimer.current); const t = await engine.stopSession(); setRec(false);
    if (t && t.frames > 0) { setTake(t); flash((limit ? 'Llegaste a los 20 minutos. ' : '') + 'Sesión grabada: la descargás en Master.', 4000); }
  };
  const [nameIn, setNameIn] = useState(p.name === 'Loop' ? '' : p.name);
  const [variant, setVariant] = useState(0);
  const phRef = useRef<HTMLStyleElement>(null), meterRef = useRef<HTMLElement>(null), barRef = useRef<HTMLElement>(null), lufsRef = useRef<HTMLElement>(null);
  const [stats, setStats] = useState({ lufs: -70, auto: 0, gr: 0 });
  const vuRefs = useRef<Record<string, HTMLElement | null>>({});

  const up = (fn: (d: Project) => void) => setP((cur) => { const d = clone(cur); fn(d); engine.update(d); save(d); return d; });
  useEffect(() => { engine.update(p); save(p); }, []);
  // voces grabadas guardadas en este celu: se cargan al abrir
  useEffect(() => {
    const vs = p.tracks.filter((t) => t.type === 'vocal' && t.vox?.has); if (!vs.length) return;
    (async () => { await engine.init(); for (const t of vs) { const v = await loadVox(t.id).catch(() => undefined); if (v) engine.setVox(t.id, v.data, v.sr); } })();
  }, []);
  useEffect(() => {
    let lastStat = 0;
    engine.onStep = (s) => {
      const i = s % 16 + 1; engine.beat.step = s; setPlaying(true); // por si arrancó desde la grabación de voz
      const k = pRef.current.tracks.find((t) => t.type === 'drum' && t.sound === 'kick' && !t.mute);
      if (k && k.steps[s % 16]) engine.beat.t = performance.now();
      if (phRef.current) phRef.current.textContent = `.pads>.pad:nth-child(${i}){outline:2px solid #fff;outline-offset:-2px}.leds span:nth-child(${i}){background:var(--mint);box-shadow:0 0 8px var(--mint)}`;
      if (barRef.current) barRef.current.textContent = String(Math.floor(s / 16) + 1);
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

  const toggle = async () => {
    if (engine.playing) { engine.stop(); setPlaying(false); if (phRef.current) phRef.current.textContent = ''; return; }
    await engine.play(p); setPlaying(true); checkAudio();
  };
  // si a los 1,5 s el audio sigue trabado (pasa en algunos iPhone), avisamos qué revisar
  const checkAudio = () => setTimeout(() => { if (engine.playing && engine.state !== 'running') flash('No se escucha? Tocá play de nuevo, subí el volumen y revisá que el celu no esté en silencio.', 6000); }, 1500);
  // el primer toque en cualquier parte destraba el audio (iPhone)
  useEffect(() => {
    if (!('AudioWorkletNode' in window)) { setNoAudio(true); return; }
    const f = () => { engine.unlock(); ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.removeEventListener(e, f, true)); };
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.addEventListener(e, f, true));
  }, []);
  const fromName = async (v = 0) => {
    const np = projectFromName(nameIn || 'Loop', v, v ? p.genre : 'deep'); setVariant(v); setP(np); engine.update(np); save(np);
    if (!engine.playing) { await engine.play(np); setPlaying(true); checkAudio(); }
  };
  const tr = p.tracks.find((t) => t.id === sel) ?? p.tracks[0];
  const [toast, setToast] = useState('');
  const flash = (m: string, ms = 1800) => { setToast(m); setTimeout(() => setToast(''), ms); };
  const stepEdit = (t: Track, fn: (x: Track) => void) => { try { navigator.vibrate?.(8); } catch { /* sin vibración */ } const wasMuted = t.mute; upT(t.id, (x) => { fn(x); if (x.mute) x.mute = false; }); if (wasMuted) flash(t.name + ' encendida'); };
  const upT = (id: string, fn: (t: Track) => void) => up((d) => fn(d.tracks.find((t) => t.id === id)!));
  const letters = useMemo(() => { const c = clean(p.name || 'Loop'); return [...c].map((ch) => [ch, letterNote(ch)]); }, [p.name]);
  const arpNotes = useMemo(() => { const o: Record<string, (s: number) => number> = {}; p.tracks.forEach((t) => { if (t.type === 'arp') o[t.id] = arpPreview(p, t); }); return o; }, [p]);

  return (
    <div class="app">
      <style ref={phRef} />
      <div class="top">
        <div class="logo" aria-label="Loop">L<i class={playing ? 'on' : ''} /><i class={'b' + (playing ? ' on' : '')} />P</div>
        <div class="sp" />
        <span class="pill">{GENRES[p.genre]?.name}</span>
        <span class="pill">{KITS[p.kit]?.label}</span>
      </div>

      <div class="transport">
        <div class="tr-row">
          <button class={'playbtn' + (playing ? ' on' : '')} onClick={toggle} aria-label={playing ? 'Parar' : 'Reproducir'}>{playing ? Icon.stop : Icon.play}</button>
          <button class={'recbtn' + (rec ? ' on' : '')} onClick={toggleRec} aria-label={rec ? 'Terminar de grabar la sesión' : 'Grabar sesión'}><i /></button>
          <div class="lcd">
            <div class="l1">{rec ? <span class="rec-t">● <b>{fmtT(recSecs)}</b></span> : <span>BAR <b ref={barRef as any}>1</b>/4</span>}<span><b>{p.chords[0]?.name}</b> · {p.chords.slice(1).map((c) => c.name).join(' · ')}</span><span><b ref={lufsRef as any}>–</b> LUFS</span></div>
            <div class="leds">{Array.from({ length: 16 }, (_, i) => <span class={i % 4 === 0 ? 'q' : ''} />)}</div>
            <div class="meter"><i ref={meterRef as any} /></div>
          </div>
          <div class="bpm">
            <button onClick={() => up((d) => { d.bpm = Math.min(150, d.bpm + 1); })} aria-label="Subir tempo">+</button>
            <b>{p.bpm}</b>
            <button onClick={() => up((d) => { d.bpm = Math.max(90, d.bpm - 1); })} aria-label="Bajar tempo">−</button>
          </div>
        </div>
      </div>

      {tab === 'scene' && <div class="page scene">
        <div class="a-stage">
          <Stage engine={engine} mode={vis} bpm={p.bpm} playing={playing} onTap={toggle} hud={{ name: p.name || 'Loop', key: p.key ?? '', genre: GENRES[p.genre]?.name ?? '' }} />
          <div class="seg2 vis-seg">{([['wave', 'Onda'], ['spectrum', 'Espectro'], ['circle', 'Círculo']] as const).map(([k, l]) => <button class={vis === k ? 'on' : ''} onClick={() => setVis(k)}>{l}</button>)}</div>
        </div>
        <div class="card a-name">
          <div class="ct"><h3>Generar desde un nombre</h3></div>
          <form class="name-in" onSubmit={(e) => { e.preventDefault(); fromName(0); (document.activeElement as HTMLElement)?.blur(); }}>
            <input value={nameIn} onInput={(e) => setNameIn((e.target as HTMLInputElement).value)} placeholder="Escribí un nombre" maxLength={24} autocomplete="off" />
            <button class="btn hot" type="submit">Generar</button>
          </form>
          <div class="recipe">
            {(p.letterNotes ?? letters.map(([ch, note]) => ({ ch, note, moved: false }))).map((x) => <span class={'ln' + (x.moved ? ' mv' : '')} title={x.moved ? 'Corrida para entrar en la tonalidad' : ''}><b>{x.ch}</b> {x.note}</span>)}
          </div>
          <div class="keyline">
            <span>Tonalidad: <b>{p.key ?? '–'}</b>{p.progression ? <> · {p.progression}</> : null}</span>
            <div class="seg2">
              {([['tonal', 'Armónico'], ['puro', 'Puro']] as const).map(([k, l]) => <button class={(p.harmony ?? 'tonal') === k ? 'on' : ''} onClick={() => up((d) => { d.harmony = k; applyHarmony(d); })}>{l}</button>)}
            </div>
          </div>
          <div class="hint" style={{ marginTop: '6px' }}>{(p.harmony ?? 'tonal') === 'tonal' ? 'Armónico: se busca la tonalidad que mejor le queda al nombre y las notas que chocan (en otro color) se corren medio tono.' : 'Puro: se usan exactamente las notas de las letras, aunque suenen tensas.'}</div>
          <div class="chips" style={{ marginTop: '10px' }}>
            <button class="chip" onClick={() => fromName(variant + 1)}>Otra versión</button>
            {Object.keys(GENRES).map((g) => <button class={'chip' + (p.genre === g ? ' on' : '')} onClick={() => up((d) => applyGenre(d, g))}>{GENRES[g].name}</button>)}
          </div>
        </div>

        <div class="card a-macros">
          <div class="ct"><h3>Macros</h3><button class="chip" onClick={() => up((d) => { d.macros = { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 }; })}>Centrar</button></div>
          <div class="macros">
            {MACROS.map((m) => { const v = (p.macros ?? { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 })[m.k]; return <div class="macro">
              <Fader h={land ? 92 : 128} label={m.label} value={v} def={0.5} color={m.color} onChange={(x) => up((d) => { d.macros = { ...(d.macros ?? { energy: 0.5, dark: 0.5, space: 0.5, groove: 0.5 }), [m.k]: x }; })} />
              <b style={{ color: m.color }}>{m.label}</b><span>{Math.round(v * 100)}</span>
            </div>; })}
          </div>
          <div class="hint">Energía: más brillo, saturación y hats. Oscuridad: cierra los filtros. Espacio: más reverb y delay. Groove: más swing y arrastre. Al medio queda como lo armó el género.</div>
        </div>
        <div class="card a-auto">
          <div class="ct"><h3>Automatización rápida</h3></div>
          <div class="chips">{QUICK_AUTO.map(([n, fn]) => <button class="chip" onClick={() => { up((d) => fn(d)); flash(n === 'Borrar todo' ? 'Automatización borrada' : n + ' aplicada'); }}>{n}</button>)}</div>
          <div class="hint">Mueven varios instrumentos a lo largo de los 4 compases. Para dibujar la tuya, andá a Patrón, tocá una pista y bajá hasta Automatización.</div>
        </div>
        <div class="card a-kits">
          <div class="ct"><h3>Batería</h3></div>
          <div class="chips">{Object.keys(KITS).map((k) => <button class={'chip' + (p.kit === k ? ' on' : '')} onClick={() => up((d) => { d.kit = k; })}>{KITS[k].label.replace('Kit ', '')}</button>)}</div>
        </div>
      </div>}

      {tab === 'pat' && <div class="page pat">
        <div class="card a-grid">
          <div class="ct"><h3>Patrón</h3><button class="chip" onClick={() => up((d) => d.tracks.forEach((t) => { if (t.type === 'drum') t.steps = Array(16).fill(0); }))}>Vaciar batería</button></div>
          <div class="grid">
            {p.tracks.map((t) => <>
              <button class={'pw' + (t.mute ? '' : ' on')} style={{ '--c': t.color } as any} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} />
              <button class={'tname' + (sel === t.id ? ' sel' : '') + (t.mute ? ' mute' : '')} style={{ '--c': t.color } as any} onClick={() => setSel(t.id)}>
                <span class="dot" />{t.name}{t.auto && Object.keys(t.auto).length > 0 && <span class="au" title="Tiene automatización">A</span>}<i class="vu" ref={(el) => { vuRefs.current[t.id] = el; }} />
              </button>
              {t.type === 'vocal' ? <button class="pads vrow" style={{ '--c': t.color } as any} aria-label={'Editar ' + t.name} onClick={() => setSel(t.id)}>
                {[0, 1, 2, 3].map((b) => <i style={{ left: b * 25 + '%' }} />)}
                {t.vox?.has ? <b style={{ left: ((t.vox.pos ?? 0) / 64) * 100 + '%' }}>{t.vox.rev ? 'voz al revés' : 'voz · 4 compases'}</b> : <b style={{ left: 0, opacity: 0.6 }}>tocá para grabar</b>}
              </button> : <div class="pads">
                {Array.from({ length: 16 }, (_, i) => {
                  if (t.roll && t.type !== 'melody') {
                    const hit = (t.notes ?? []).filter((n) => n.s % 16 === i);
                    return <button class={'pad' + (hit.length ? ' v1' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`} onClick={() => setSel(t.id)}>{hit[0] && <span class="nn">{noteName(hit[0].n)}</span>}</button>;
                  }
                  if (t.type === 'arp') {
                    const on = t.arp!.gate[i], plays = arpPlays(t, i), nf = arpNotes[t.id];
                    return <button class={'pad' + (!on ? ' off' : plays ? ' v1' : ' skip')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                      onClick={() => stepEdit(t, (x) => { x.arp!.gate[i] = !x.arp!.gate[i]; })}>{on && plays && nf && <span class="nn">{noteName(nf(i))}</span>}</button>;
                  }
                  if (t.type === 'melody') {
                    const hit = (t.notes ?? []).filter((n) => n.s % 16 === i);
                    return <button class={'pad' + (hit.length ? ' v1' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`} onClick={() => setSel(t.id)}>{hit[0] && <span class="nn">{noteName(hit[0].n)}</span>}</button>;
                  }
                  if (t.type === 'chords' && (t.chordMode ?? 'pad') === 'pad') return <button class={'pad' + (i % 16 === 0 ? ' v2' : ' v1')} style={{ '--c': t.color, opacity: i ? 0.35 : 1 } as any} aria-label="Acorde sostenido" onClick={() => setSel(t.id)} />;
                  const v = t.steps[i];
                  return <button class={'pad' + (v === 1 ? ' v1' : v === 2 ? ' v2' : v === 3 ? ' v1 gh' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                    onClick={() => stepEdit(t, (x) => { x.steps[i] = (x.steps[i] + 1) % 3; })} />;
                })}
              </div>}
            </>)}
          </div>
          <AddTrack onAdd={(type, sound) => { let id = ''; up((d) => { if (d.tracks.length >= 16) return; const nt = newTrack(d, type, sound); id = nt.id; d.tracks.push(nt); }); setTimeout(() => id && setSel(id), 0); }} full={p.tracks.length >= 16} />
          <div class="hint">El botón de la izquierda enciende o apaga cada instrumento. En la grilla, un toque prende el golpe, otro lo acentúa y el tercero lo apaga. Los casilleros tenues son golpes suaves que pone el género.</div>
        </div>

        {tr && <div class="a-ed"><TrackEditor p={p} t={tr} upT={upT} up={up} onDelete={() => { const left = p.tracks.filter((x) => x.id !== tr.id); if (!left.length) return; up((d) => { d.tracks = d.tracks.filter((x) => x.id !== tr.id); }); if (tr.type === 'vocal') deleteVox(tr.id).catch(() => {}); setSel(left[0].id); flash(tr.name + ' eliminada'); }} /><AutoEditor key={tr.id} t={tr} upT={upT} playing={playing} /></div>}
      </div>}
      {toast && <div class="toast">{toast}</div>}
      {noAudio && <div class="toast">Este navegador no puede reproducir el audio de la app. En iPhone hace falta iOS 14.5 o más nuevo: actualizá el sistema o probá con otro navegador.</div>}

      {tab === 'mix' && <div class="card">
        <div class="ct"><h3>Mixer</h3></div>
        <div class="mixer">
          {p.tracks.map((t) => (
            <div class="strip" style={{ '--c': t.color } as any}>
              <div class="nm">{t.name}</div>
              <Fader h={land ? 96 : 150} label={'Volumen ' + t.name} value={t.vol} def={0.8} color={t.color} onChange={(v) => upT(t.id, (x) => { x.vol = v; })} />
              <div class="ms">
                <button class={'m' + (t.mute ? ' on' : '')} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} aria-label={'Mutear ' + t.name}>M</button>
                <button class={'s' + (t.solo ? ' on' : '')} onClick={() => upT(t.id, (x) => { x.solo = !x.solo; })} aria-label={'Solo ' + t.name}>S</button>
              </div>
              <div class="kn4">
              <div class="mini"><Knob label="Pan" value={t.pan} min={-1} max={1} def={0} color={t.color} fmt={(v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100))} onChange={(v) => upT(t.id, (x) => { x.pan = v; })} /></div>
              <div class="mini"><Knob label="Reverb" value={t.rev} min={0} max={1} def={0} color="var(--mint)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.rev = v; })} /></div>
              <div class="mini"><Knob label="Delay" value={t.dly} min={0} max={1} def={0} color="var(--mint)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.dly = v; })} /></div>
              {t.id === 'kick' && <div class="mini" />}
              {t.id !== 'kick' && <div class="mini"><Knob label="Sidechain" value={t.duck} min={0} max={1} def={0} color="var(--hot)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.duck = v; })} /></div>}
              </div>
              <div class="kn4">
              <div class="mini"><Knob label="Saturación" value={t.fx?.drive ?? 0} min={0} max={1} def={0} color="var(--hot)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, drive: v }; })} /></div>
              <div class="mini"><Knob label="Chorus" value={t.fx?.chorus ?? 0} min={0} max={1} def={0} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, chorus: v }; })} /></div>
              <div class="mini"><Knob label="Corta graves" value={Math.max(20, t.fx?.hp || 20)} min={20} max={2000} log def={20} color={t.color} fmt={(v) => (v <= 21 ? 'no' : hz(v))} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, hp: v <= 21 ? 0 : v }; })} /></div>
              <div class="mini"><Knob label="Corta agudos" value={t.fx?.lp || 20000} min={200} max={20000} log def={20000} color={t.color} fmt={(v) => (v >= 19500 ? 'no' : hz(v))} onChange={(v) => upT(t.id, (x) => { x.fx = { ...x.fx, lp: v >= 19500 ? 0 : v }; })} /></div>
              </div>
            </div>
          ))}
        </div>
        <div class="hint">Deslizá para recorrer el mixer. Para mover un control, mantené el dedo quieto un instante sobre él hasta que se ilumine y después arrastrá. Doble toque lo vuelve a su valor inicial. Sidechain: cuánto se "agacha" la pista cuando pega el kick. Abajo, el inserto de cada pista: saturación, chorus y filtros que cortan graves o agudos (cada género los trae armados).</div>
      </div>}

      {tab === 'master' && <div class="page master"><Session p={p} rec={rec} secs={recSecs} take={take} toggleRec={toggleRec} clear={() => setTake(null)} /><Master p={p} up={up} stats={stats} /></div>}

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
  if (full) return <div class="hint">Llegaste al máximo de 16 pistas.</div>;
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
function TrackEditor({ p, t, upT, up, onDelete }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; up: (fn: (d: Project) => void) => void; onDelete: () => void }) {
  const power = <button class={'pw' + (t.mute ? '' : ' on')} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} />;
  if (t.type === 'vocal') return <VocalEditor p={p} t={t} upT={upT} power={power} onDelete={onDelete} />;
  if (t.type === 'drum') {
    return (
      <div class="card" style={{ '--c': t.color } as any}>
        <div class="ct"><h3>{t.name}</h3>{power}</div>
        <div class="sub">Kit (para kick, clap, hats y snare)</div>
        <div class="chips">{Object.keys(KITS).map((k) => <button class={'chip' + (p.kit === k ? ' on' : '')} onClick={() => up((d) => { d.kit = k; })}>{KITS[k].label}</button>)}</div>
        {DRUM_GROUPS.map(([g, list]) => <><div class="sub">{g}</div><div class="chips">{list.map((o) => <button class={'chip' + (t.sound === o ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.sound = o; if (x.name === DRUM_SOUNDS[x.sound] || Object.values(DRUM_SOUNDS).includes(x.name)) x.name = DRUM_SOUNDS[o]; })}>{DRUM_SOUNDS[o]}</button>)}</div></>)}
        <div class="sub">Ajustes</div>
        <div class="knobs">
          <Knob label="Afinación" value={t.pitch} min={-12} max={12} step={1} def={0} color={t.color} fmt={(v) => (v > 0 ? '+' : '') + v + 'st'} onChange={(v) => upT(t.id, (x) => { x.pitch = v; })} />
          <Knob label="Largo" value={t.decay} min={0.05} max={1} def={1} color={t.color} fmt={pct} onChange={(v) => upT(t.id, (x) => { x.decay = v; })} />
        </div>
        <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div>
      </div>
    );
  }
  const presets = Object.keys(SYNTHS).filter((k) => SYNTHS[k].for.includes(t.type));
  const s = t.synth ?? SYNTHS[t.sound]?.p;
  const setS = (k: string, v: number) => upT(t.id, (x) => { x.synth = { ...(x.synth ?? SYNTHS[x.sound].p), [k]: v }; });
  return (
    <div class="card" style={{ '--c': t.color } as any}>
      <div class="ct"><h3>{t.name}</h3>{t.synth && <button class="chip" onClick={() => upT(t.id, (x) => { x.synth = undefined; })}>Restablecer</button>}{power}</div>
      <div class="sub">Sonido</div>
      <div class="chips">{presets.map((k) => <button class={'chip' + (t.sound === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.sound = k; x.synth = undefined; })}>{SYNTHS[k].label}</button>)}</div>
      {t.type === 'arp' && <>
        <div class="sub">Orden de las notas</div>
        <div class="chips">{[['name', 'Nombre'], ['up', 'Sube'], ['down', 'Baja'], ['pp', 'Ping-pong'], ['mirror', 'Espejo'], ['jump', 'Saltos'], ['rand', 'Al azar'], ['chord', 'Acorde'], ['chordpp', 'Acorde ida y vuelta'], ['acid', 'Acid 303']].map(([k, l]) => <button class={'chip' + (t.arp!.mode === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.mode = k; })}>{l}</button>)}</div>
        <div class="sub">Ritmo y octavas</div>
        <div class="chips">{[['16', '1/16'], ['8', '1/8'], ['tr', 'Galope']].map(([k, l]) => <button class={'chip' + (t.arp!.rate === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.rate = k as any; })}>{l}</button>)}
          {[1, 2, 3].map((o) => <button class={'chip' + (t.arp!.oct === o ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.oct = o; })}>{o} oct</button>)}</div>
      </>}
      {t.type === 'chords' && <>
        <div class="sub">Modo</div>
        <div class="chips">{[['pad', 'Sostenido'], ['stab', 'Stabs'], ['gate', 'Gate']].map(([k, l]) => <button class={'chip' + (t.chordMode === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.chordMode = k as any; if (k === 'gate' && x.steps.filter(Boolean).length < 4) x.steps = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0]; if (k === 'stab' && !x.steps.some(Boolean)) x.steps = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]; })}>{l}</button>)}</div>
      </>}
      {s && <><div class="sub">Sonido fino</div>
        <div class="knobs">
          <Knob label="Filtro" value={s.cutoff} min={80} max={12000} log def={SYNTHS[t.sound].p.cutoff} color={t.color} fmt={hz} onChange={(v) => setS('cutoff', v)} />
          <Knob label="Reso" value={s.reso} min={0} max={0.95} def={SYNTHS[t.sound].p.reso} color={t.color} fmt={pct} onChange={(v) => setS('reso', v)} />
          <Knob label="Envolv." value={s.envAmt} min={0} max={3} def={SYNTHS[t.sound].p.envAmt} color={t.color} fmt={(v) => v.toFixed(1)} onChange={(v) => setS('envAmt', v)} />
          <Knob label="Ataque" value={s.attack} min={0.001} max={2} log def={SYNTHS[t.sound].p.attack} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('attack', v)} />
          <Knob label="Decay" value={s.decay} min={0.02} max={3} log def={SYNTHS[t.sound].p.decay} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('decay', v)} />
          <Knob label="Release" value={s.release} min={0.02} max={3} log def={SYNTHS[t.sound].p.release} color={t.color} fmt={(v) => (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(1) + 's')} onChange={(v) => setS('release', v)} />
          {s.wave !== 'fm' && <Knob label="Ancho" value={s.detune} min={0} max={40} step={1} def={SYNTHS[t.sound].p.detune} color={t.color} fmt={(v) => Math.round(v) + 'ct'} onChange={(v) => setS('detune', v)} />}
        </div></>}
      {t.type === 'melody' && <PianoRoll p={p} t={t} upT={upT} />}
      {(t.type === 'bass' || t.type === 'arp' || t.type === 'chords') && (t.roll
        ? <><PianoRoll p={p} t={t} upT={upT} />
          <div class="chips" style={{ marginTop: '8px' }}><button class="chip" onClick={() => upT(t.id, (x) => { x.roll = false; })}>Volver a lo generado</button></div>
          <div class="hint">Esta pista suena con las notas del piano roll. "Volver a lo generado" usa otra vez el modo y el patrón de arriba (tus notas quedan guardadas).</div></>
        : <><div class="sub">Piano roll</div>
          <div class="chips"><button class="chip" style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { if (!x.notes?.length || !x.rollEdited) x.notes = rollFromTrack(p, t); x.roll = true; })}>Editar notas en piano roll</button></div>
          <div class="hint">Pasa lo que toca esta pista al piano roll para que cambies, agregues o saques notas a mano.</div></>)}
      <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div>
    </div>
  );
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
];
/* ---------- automatización ---------- */
const MEL_T = (d: Project) => d.tracks.filter((t) => t.type !== 'drum');
const setAuto = (t: Track, k: AutoKey, v: number[]) => { t.auto = { ...t.auto, [k]: v }; };
const QUICK_AUTO: [string, (d: Project) => void][] = [
  ['Subida', (d) => MEL_T(d).forEach((t) => { setAuto(t, 'lp', autoShape('up', t.type === 'bass' ? 0.5 : 0.32, 1)); if (t.type !== 'bass') setAuto(t, 'rev', autoShape('up', Math.min(t.rev, 0.15), 0.65)); })],
  ['Filtro que respira', (d) => MEL_T(d).forEach((t) => setAuto(t, 'lp', autoShape('wave', t.type === 'bass' ? 0.55 : 0.4, 1)))],
  ['Delay al final', (d) => MEL_T(d).filter((t) => t.type !== 'bass').forEach((t) => setAuto(t, 'dly', autoShape('last', t.dly, 0.85)))],
  ['Bombeo', (d) => MEL_T(d).filter((t) => t.type === 'chords' || t.type === 'arp').forEach((t) => setAuto(t, 'vol', autoShape('pump', 0.25, 1)))],
  ['Borrar todo', (d) => d.tracks.forEach((t) => { t.auto = undefined; })],
];
function AutoEditor({ t, upT, playing }: { t: Track; upT: (id: string, fn: (t: Track) => void) => void; playing: boolean }) {
  const [k, setK] = useState<AutoKey>('lp'), [touch, setTouch] = useState<string>('');
  const P = AUTO_PARAMS.find((x) => x.k === k)!, data = t.auto?.[k];
  const laneRef = useRef<HTMLDivElement>(null), headRef = useRef<HTMLElement>(null), draft = useRef<number[] | null>(null), last = useRef(-1), raf = useRef(0);
  // valor de partida si todavía no hay automatización: lo que la pista tiene hoy
  const base = () => { const f = t.fx ?? {}; const v = k === 'lp' ? (f.lp ? Math.log(f.lp / 200) / Math.log(100) : 1) : k === 'hp' ? (f.hp ? Math.log(f.hp / 20) / Math.log(100) : 0) : k === 'vol' ? 1 : k === 'rev' ? t.rev : k === 'dly' ? t.dly : k === 'drive' ? f.drive ?? 0 : (t.pan + 1) / 2; return Math.max(0, Math.min(1, v)); };
  const commit = () => { const d = draft.current; if (!d) return; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => upT(t.id, (x) => setAuto(x, k, [...d]))); };
  const at = (e: PointerEvent) => { const r = laneRef.current!.getBoundingClientRect(); return { i: Math.max(0, Math.min(63, Math.floor(((e.clientX - r.left) / r.width) * 64))), v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)) }; };
  const paint = (e: PointerEvent) => {
    const { i, v } = at(e), d = draft.current!; const a = last.current < 0 ? i : last.current;
    for (let j = Math.min(a, i); j <= Math.max(a, i); j++) d[j] = +v.toFixed(3); // rellena el hueco si el dedo va rápido
    last.current = i; setTouch(P.fmt(v)); commit();
  };
  useEffect(() => {
    if (!playing) { if (headRef.current) headRef.current.style.opacity = '0'; return; }
    let id = 0; const loop = () => { if (headRef.current) { headRef.current.style.opacity = '1'; headRef.current.style.left = ((engine.beat.step % 64) / 64) * 100 + '%'; } id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id);
  }, [playing]);
  const has = (key: AutoKey) => !!t.auto?.[key];
  return (
    <div class="card a-autoed" style={{ '--c': t.color } as any}>
      <div class="ct"><h3>Automatización · {t.name}</h3></div>
      <div class="chips">{AUTO_PARAMS.map((x) => <button class={'chip' + (k === x.k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setK(x.k)}>{x.label}{has(x.k) ? ' •' : ''}</button>)}</div>
      <div class={'lane' + (data ? '' : ' empty')} ref={laneRef}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); draft.current = data ? [...data] : Array(64).fill(+base().toFixed(3)); last.current = -1; paint(e as any); }}
        onPointerMove={(e) => { if (draft.current) paint(e as any); }}
        onPointerUp={() => { draft.current = null; last.current = -1; setTouch(''); }} onPointerCancel={() => { draft.current = null; setTouch(''); }}>
        {[0, 1, 2, 3].map((b) => <span class="bar" style={{ left: b * 25 + '%' }}>{b + 1}</span>)}
        {data ? <svg viewBox="0 0 64 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={'M0 100 ' + data.map((v, i) => `L${i} ${100 - v * 100} L${i + 1} ${100 - v * 100}`).join(' ') + ' L64 100 Z'} fill={t.color} fill-opacity="0.18" />
          <path d={data.map((v, i) => `${i ? 'L' : 'M'}${i} ${100 - v * 100} L${i + 1} ${100 - v * 100}`).join(' ')} fill="none" stroke={t.color} stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg> : <div class="lane-hint">Dibujá con el dedo o elegí una forma</div>}
        <i class="head" ref={headRef as any} />
        {touch && <b class="lane-val">{P.label}: {touch}</b>}
      </div>
      <div class="chips" style={{ marginTop: '10px' }}>
        {AUTO_SHAPES.map((sh) => <button class="chip" onClick={() => upT(t.id, (x) => setAuto(x, k, autoShape(sh.k, P.lo, P.hi)))}>{sh.label}</button>)}
        {data && <button class="chip" onClick={() => upT(t.id, (x) => { const a = { ...x.auto }; delete a[k]; x.auto = Object.keys(a).length ? a : undefined; })}>Borrar</button>}
      </div>
      <div class="hint">{P.label} a lo largo de los 4 compases. {k === 'pan' ? 'Arriba es derecha, abajo es izquierda.' : 'Arriba es más, abajo es menos.'} Mientras haya automatización, manda sobre la perilla de ese parámetro.</div>
    </div>
  );
}
function VocalEditor({ p, t, upT, power, onDelete }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; power: any; onDelete: () => void }) {
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
    <div class="card" style={{ '--c': t.color } as any}>
      <div class="ct"><h3>{t.name}</h3>{power}</div>
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
      {err && <div class="hint" style={{ color: 'var(--red)' }}>{err}</div>}
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
          <Knob label="Corta graves" value={Math.max(20, fx.hp || 20)} min={20} max={2000} log def={110} color={t.color} fmt={(v) => (v <= 21 ? 'no' : hz(v))} onChange={(v) => setFx('hp', v <= 21 ? 0 : v)} />
          <Knob label="Corta agudos" value={fx.lp || 20000} min={200} max={20000} log def={20000} color={t.color} fmt={(v) => (v >= 19500 ? 'no' : hz(v))} onChange={(v) => setFx('lp', v >= 19500 ? 0 : v)} />
        </div>
      </>}
      <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div>
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
  const tap = (i: number, n: number) => {
    const s = bar * 16 + i, hit = at(s, n);
    upT(t.id, (x) => { x.autoMelody = false; x.rollEdited = true; const ns = x.notes ?? []; if (hit) x.notes = ns.filter((y) => !(y.s === hit.s && y.n === hit.n)); else { x.notes = [...ns, { s, n, l: Math.min(len, 64 - s) }]; } });
    if (!hit) engine.preview(t.id, n);
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
      <button class="chip" onClick={() => setOct(Math.max(-4, oct - 1))}>Octava −</button>
      <button class="chip" onClick={() => setOct(Math.min(3, oct + 1))}>Octava +</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { x.autoMelody = false; const src = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) === bar); x.notes = [0, 1, 2, 3].flatMap((b) => src.map((y) => ({ ...y, s: b * 16 + (y.s % 16) }))); })}>Copiar a los 4 compases</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { x.autoMelody = false; x.notes = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) !== bar); })}>Borrar compás</button>
      {t.type === 'melody' && <button class="chip" style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.notes = generateMelody(p, String(Date.now())); x.autoMelody = true; })}>Nueva melodía</button>}
      {t.type !== 'melody' && <button class="chip" onClick={() => upT(t.id, (x) => { x.notes = rollFromTrack(p, { ...x, roll: false }); x.rollEdited = false; })}>Traer de nuevo lo generado</button>}
    </div>
    <div class="hint">Tocá un casillero para poner una nota (suena al agregarla) y tocala de nuevo para sacarla. Podés poner varias notas en el mismo paso para armar acordes. Sin "Usar todas las notas" ves las notas de la tonalidad de tu nombre; con esa opción, el piano entero (con Octava − y + llegás a cualquier altura).</div>
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
    { title: 'Todo arranca con un nombre', body: 'Cada letra es una tonalidad: de la A a la L son mayores y de la M a la X, menores. Escribí un nombre en Escena, tocá Generar y la app arma un loop en la tonalidad que mejor le queda. El mismo nombre da siempre el mismo loop.', art: artName },
    { title: 'Cómo se mueven los controles', body: 'Para mover una perilla o un fader, mantené el dedo quieto un instante hasta que se marque y después arrastrá; si deslizás de una, solo se mueve la pantalla. Doble toque vuelve al valor inicial. Cada sección tiene su propia guía: aparece la primera vez que entrás y la volvés a ver con el botón Guía.', art: artBars([R, Y, G], [0.7, 0.4, 0.55, 0.3, 0.8]) },
  ],
  scene: [
    { title: 'El escenario', body: 'Tocalo para que suene o para pararlo. Arriba ves el nombre y el tempo; abajo, el género, la tonalidad y los 16 pasos del compás. Con Onda, Espectro y Círculo cambiás el visual.', art: artWave },
    { title: 'Nombre, versión y género', body: 'Generar arma el loop del nombre. Cada nombre nuevo arranca en Deep House. "Otra versión" prueba otra progresión en el mismo género. Los botones de género (Trance, Techno, House…) cambian batería, bajo, sonidos y armonía manteniendo tus notas. Armónico busca la tonalidad que mejor encaja; Puro usa las notas exactas de las letras.', art: artChips(['Otra versión', 'Trance', 'Techno', 'House'], 2) },
    { title: 'Macros', body: 'Cuatro controles que mueven muchas cosas a la vez. Energía: más brillo, saturación y hats. Oscuridad: filtros más cerrados. Espacio: más reverb y delay. Groove: más swing. Al medio queda como lo armó el género; "Centrar" lo vuelve ahí.', art: artBars([R, '#9a9a9a', G, Y], [0.75, 0.4, 0.6, 0.35], ['Energía', 'Oscur.', 'Espacio', 'Groove']) },
    { title: 'Automatización rápida', body: 'Con un toque hacés que el loop se mueva a lo largo de los 4 compases. Subida: los filtros y la reverb van creciendo, como antes de un drop. Filtro que respira: abre y cierra en cada compás. Delay al final: eco en el último tiempo. Bombeo: los acordes y el arpegio laten con el pulso.', art: <svg class="art-svg" viewBox="0 0 200 80" aria-hidden="true"><path d="M8 70 C 60 68, 120 50, 192 10 L192 74 L8 74 Z" fill={Y} fill-opacity="0.18" /><path d="M8 70 C 60 68, 120 50, 192 10" fill="none" stroke={Y} stroke-width="2" /></svg> },
    { title: 'Batería', body: 'Elegí el kit: el 909 y el 808 clásicos, uno por género, Synthwave 80s, Electro o Lo-Fi. Cambia el sonido del bombo, el clap, los hats y el redoblante sin tocar el patrón.', art: artChips(['909', '808', 'Techno', 'Lo-Fi'], 1) },
  ],
  pat: [
    { title: 'La grilla', body: 'Cada fila es un instrumento y cada casillero, un paso del compás. Un toque prende el golpe, otro lo acentúa y el tercero lo apaga. Los casilleros tenues son golpes suaves. El interruptor de la izquierda enciende o apaga la pista.', art: artGrid },
    { title: 'Editar una pista', body: 'Tocá el nombre de una pista para abrir su editor abajo: elegís el sonido, el orden de las notas del arpegio, la forma de tocar los acordes y el sonido fino con perillas. Las pistas de batería eligen kit y golpe.', art: artKnobs(['Filtro', 'Reso', 'Decay', 'Detune']) },
    { title: 'Piano roll', body: 'La melodía son 4 compases que salen de tu nombre, y el bajo, el arpegio y los acordes también se pueden pasar al piano roll con "Editar notas en piano roll". Tocás un casillero para poner una nota y de nuevo para sacarla. "Usar todas las notas" muestra el piano entero, no solo las de la tonalidad.', art: <div class="art-roll">{Array.from({ length: 5 }, (_, r) => <div>{Array.from({ length: 12 }, (_, k) => <i class={[[1, 2], [4], [0, 7, 8], [10], [5]][r].includes(k) ? 'on' : ''} />)}</div>)}</div> },
    { title: 'Automatización', body: 'Abajo del editor de cada pista está su automatización: elegís qué mover (Filtro, Volumen, Reverb, Delay, Saturación, Pan o Corta graves) y dibujás con el dedo cómo cambia en los 4 compases, o tocás una forma (Sube, Baja, Onda, Bombeo…). Las pistas con automatización muestran una "A".', art: <svg class="art-svg" viewBox="0 0 200 80" aria-hidden="true">{[0, 1, 2, 3].map((b) => <line x1={8 + b * 46} y1="4" x2={8 + b * 46} y2="76" stroke="#2a2a2a" />)}<path d="M8 60 L50 60 L54 20 L100 20 L104 50 L146 50 L150 10 L192 10" fill="none" stroke={G} stroke-width="2" /></svg> },
    { title: 'Tu voz y más pistas', body: 'Con "+ Agregar pista" sumás batería, bajo, arpegio, acordes, melodía o Voz. En Voz, "Grabar 4 compases" graba en tiempo con el loop (con un compás de cuenta si está parado). Después le ponés efectos: eco, catedral, radio, robot y más. Usá auriculares para grabar.', art: <div class="art-vox"><span class="dot" />Grabar 4 compases<svg viewBox="0 0 160 30" aria-hidden="true">{Array.from({ length: 40 }, (_, k) => { const h = 4 + Math.abs(Math.sin(k * 1.7)) * 22; return <rect x={k * 4} y={15 - h / 2} width="2.5" height={h} fill={R} />; })}</svg></div> },
  ],
  mix: [
    { title: 'Faders y botones', body: 'Cada columna es una pista: el fader es su volumen, M la silencia y S la deja sonando sola. Deslizá de costado para ver todas.', art: artBars([R, Y, G, '#e98a5f', '#8fc7a0'], [0.75, 0.5, 0.62, 0.35, 0.8]) },
    { title: 'Pan, efectos y sidechain', body: 'Pan la manda a la izquierda o a la derecha. Reverb y Delay le suman ambiente y eco. Sidechain es cuánto se "agacha" la pista cuando pega el bombo: es lo que hace que el loop bombee.', art: artKnobs(['Pan', 'Reverb', 'Delay', 'Sidechain']) },
    { title: 'El inserto de cada pista', body: 'Abajo de cada columna: Saturación (calienta o ensucia), Chorus (la abre y la engorda), Corta graves y Corta agudos (filtros). Cada género los trae armados; los podés ajustar a gusto.', art: artKnobs(['Saturación', 'Chorus', 'Graves', 'Agudos']) },
  ],
  master: [
    { title: 'Grabar sesión', body: 'El botón rojo (al lado del play, o acá en Master) graba en vivo todo lo que suena mientras tocás: perillas, pistas que prendés y apagás, cambios de género. Hasta 20 minutos. Cuando terminás, la descargás en WAV o MP3.', art: <div class="art-vox"><span class="dot" />● REC 2:41<svg viewBox="0 0 160 30" aria-hidden="true">{Array.from({ length: 40 }, (_, k) => { const h = 6 + Math.abs(Math.sin(k * 0.9) * Math.cos(k * 0.3)) * 20; return <rect x={k * 4} y={15 - h / 2} width="2.5" height={h} fill={R} />; })}</svg></div> },
    { title: 'Exportar', body: 'Elegí cuántos compases y descargá en WAV (máxima calidad), MP3 (liviano) o el paquete para Ableton, con cada pista por separado, la mezcla y los MIDI. Después lo compartís desde el botón Compartir.', art: artChips(['WAV', 'MP3', 'Ableton'], 0) },
    { title: 'Salida y volumen', body: 'El volumen se mantiene parejo solo: la ganancia automática lleva el loop al nivel elegido (en LUFS) y el limitador evita que sature. Los medidores te muestran cuánto está trabajando cada uno.', art: <div class="art-meter"><div><i style={{ width: '72%' }} /></div><small>-14 LUFS · limitador -1 dB</small></div> },
    { title: 'Ecualizador y efectos', body: 'El EQ de 8 bandas sube o baja graves, medios y agudos de todo el loop. En Efectos ajustás el tamaño de la reverb y cuánto se repite el delay, para todas las pistas a la vez.', art: artBars([G, G, Y, Y, Y, R, R, R], [0.6, 0.55, 0.45, 0.4, 0.5, 0.55, 0.62, 0.5]) },
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
          {kind === 'intro' ? <label><input type="checkbox" checked={never} onChange={(e) => setNever((e.target as HTMLInputElement).checked)} /> No mostrar al abrir</label> : <span />}
          <div class="tut-btns">
            {i > 0 && <button class="btn" onClick={() => setI(i - 1)}>Atrás</button>}
            <button class="btn hot" onClick={() => (last ? onClose(never) : setI(i + 1))}>{last ? (kind === 'intro' ? 'Empezar' : 'Entendido') : 'Siguiente'}</button>
          </div>
        </div>
      </div>
    </div>
  );
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
    <div class="card">
      <div class="ct"><h3>Grabar sesión</h3></div>
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
      {!rec && !take && <div class="hint">Graba en vivo todo lo que sale por los parlantes, con cada cambio que hagas mientras suena, hasta 20 minutos. Al terminar la descargás en WAV o MP3. Si el loop está parado, arranca solo.</div>}
    </div>
  );
}

/* ---------- exportar ---------- */
type Out = { url: string; file: File; name: string; size: number };
function Export({ p }: { p: Project }) {
  const [loops, setLoops] = useState(1), [busy, setBusy] = useState(''), [out, setOut] = useState<Out | null>(null), [err, setErr] = useState('');
  const make = async (kind: 'wav' | 'mp3' | 'zip') => {
    if (busy) return; setErr(''); if (out) { URL.revokeObjectURL(out.url); setOut(null); }
    try {
      let data: Uint8Array, ext: string, mime: string;
      if (kind === 'zip') { data = await abletonZip(engine, p, loops, setBusy); ext = 'zip'; mime = 'application/zip'; }
      else {
        setBusy('Renderizando el loop…'); const a = await renderAudio(engine, p, loops);
        if (kind === 'wav') { data = wav(a, 24); ext = 'wav'; mime = 'audio/wav'; } else { setBusy('Codificando MP3…'); data = await mp3(a); ext = 'mp3'; mime = 'audio/mpeg'; }
      }
      const name = baseName(p) + (kind === 'zip' ? '_ableton' : '') + '.' + ext, file = new File([data as BlobPart], name, { type: mime });
      setOut({ url: URL.createObjectURL(file), file, name, size: data.length });
    } catch (e: any) { console.error(e); setErr('No se pudo exportar en este navegador. Probá desde Chrome o Safari actualizados.'); }
    setBusy('');
  };
  const canShare = typeof navigator !== 'undefined' && (navigator as any).canShare && out && (navigator as any).canShare({ files: [out.file] });
  return (
    <div class="card">
      <div class="ct"><h3>Exportar</h3></div>
      <div class="sub" style={{ marginTop: 0 }}>Largo</div>
      <div class="chips">{[[1, '4 compases'], [2, '8 compases'], [4, '16 compases']].map(([v, l]) => <button class={'chip' + (loops === v ? ' on' : '')} onClick={() => setLoops(v as number)}>{l}</button>)}</div>
      <div class="exp-btns">
        <button class="btn hot" disabled={!!busy} onClick={() => make('wav')}>WAV</button>
        <button class="btn hot" disabled={!!busy} onClick={() => make('mp3')}>MP3</button>
        <button class="btn vio" disabled={!!busy} onClick={() => make('zip')}>Para Ableton (.zip)</button>
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
      <div class="hint">El WAV y el MP3 empalman perfecto si los ponés en loop. El paquete para Ableton trae un WAV por pista (stems), la mezcla, los MIDI de cada pista y de la batería, y un LEEME con el tempo y la tonalidad: arrastrás todo al compás 1 y queda alineado.</div>
    </div>
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
    <Export p={p} />
    <div class="card">
      <div class="ct"><h3>Salida</h3></div>
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
    </div>
    <div class="card">
      <div class="ct"><h3>EQ · 8 bandas</h3></div>
      <div class="eqv"><svg viewBox="0 0 320 96" preserveAspectRatio="none"><line x1="0" y1="48" x2="320" y2="48" stroke="#2c3350" /><path d={curve + ' L320 96 L0 96 Z'} fill="rgba(47,216,180,.12)" /><path d={curve} stroke="#2fd8b4" stroke-width="2" fill="none" vector-effect="non-scaling-stroke" /></svg></div>
      <div class="faders8">{p.master.eq.map((g, k) => <div><Fader h={120} label={'EQ ' + EQF[k]} value={g} min={-12} max={12} def={0} color="#2fd8b4" onChange={(v) => up((d) => { d.master.eq[k] = Math.round(v * 2) / 2; })} /><div class="lab">{g > 0 ? '+' : ''}{g}</div><div class="lab">{EQF[k]}</div></div>)}</div>
      <div class="chips" style={{ marginTop: '10px' }}>{Object.keys(EQPRE).map((k) => <button class="chip" onClick={() => up((d) => { d.master.eq = [...EQPRE[k]]; })}>{k}</button>)}</div>
    </div>
    <div class="card">
      <div class="ct"><h3>Reverb y delay</h3></div>
      <div class="knobs">
        <Knob label="Tamaño" value={p.fx.revSize} min={0.3} max={0.98} def={0.8} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revSize = v; })} />
        <Knob label="Brillo rev." value={1 - p.fx.revDamp} min={0} max={1} def={0.65} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revDamp = 1 - v; })} />
        <Knob label="Retorno rev." value={p.fx.revRet} min={0} max={1.5} def={0.9} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.revRet = v; })} />
        <Knob label="Repeticiones" value={p.fx.dlyFb} min={0} max={0.8} def={0.42} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.dlyFb = v; })} />
        <Knob label="Retorno delay" value={p.fx.dlyRet} min={0} max={1.5} def={0.7} color="var(--mint)" fmt={pct} onChange={(v) => up((d) => { d.fx.dlyRet = v; })} />
        <Knob label="Swing" value={p.swing} min={0} max={0.6} def={0} color="var(--sun)" fmt={pct} onChange={(v) => up((d) => { d.swing = v; })} />
      </div>
    </div>
  </>;
}

render(<App />, document.getElementById('app')!);
