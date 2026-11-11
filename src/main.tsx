import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './style.css';
import { Engine } from './engine/engine';
import {
  type Project, type Track, SYNTHS, KITS, DRUM_SOUNDS, GENRES, newProject, projectFromName, applyGenre, harmonyFromName,
  arpPlays, arpPreview, noteName, toLetters, clean, NAMES, newTrack, nameScale, DRUM_GROUPS, type TrackType,
} from './model';

const engine = new Engine();
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const load = (): Project | null => { try { const s = localStorage.getItem('loop.project'); return s ? JSON.parse(s) : null; } catch { return null; } };
const save = (p: Project) => { try { localStorage.setItem('loop.project', JSON.stringify(p)); } catch { /* sin almacenamiento */ } };

/* ---------- controles ---------- */
function arc(a0: number, a1: number) { const r = 21, c = 27, p = (a: number) => [(c + r * Math.sin(a * Math.PI / 180)).toFixed(2), (c - r * Math.cos(a * Math.PI / 180)).toFixed(2)]; const s = p(a0), e = p(a1); return `M${s[0]} ${s[1]} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${e[0]} ${e[1]}`; }
type KP = { label: string; value: number; min: number; max: number; onChange: (v: number) => void; fmt?: (v: number) => string; log?: boolean; color?: string; def?: number; step?: number };
function Knob({ label, value, min, max, onChange, fmt = (v) => v.toFixed(2), log, color = 'var(--vio)', def, step }: KP) {
  const norm = (v: number) => log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const den = (n: number) => { let v = log ? min * Math.pow(max / min, n) : min + n * (max - min); if (step) v = Math.round(v / step) * step; return v; };
  const st = useRef({ y: 0, n: 0, drag: false, last: 0 });
  const n = Math.max(0, Math.min(1, norm(value))), a = -135 + n * 270;
  return (
    <div class="knob" role="slider" aria-label={label} aria-valuenow={value} tabIndex={0}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); const s = st.current; s.y = e.clientY; s.n = norm(value); s.drag = true; const now = Date.now(); if (now - s.last < 300 && def !== undefined) onChange(def); s.last = now; }}
      onPointerMove={(e) => { const s = st.current; if (s.drag) onChange(den(Math.max(0, Math.min(1, s.n + (s.y - e.clientY) / 160)))); }}
      onPointerUp={() => (st.current.drag = false)} onPointerCancel={() => (st.current.drag = false)}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') onChange(den(Math.min(1, n + 0.03))); if (e.key === 'ArrowDown') onChange(den(Math.max(0, n - 0.03))); }}>
      <svg viewBox="0 0 54 54"><path d={arc(-135, 135)} stroke="#262b3a" stroke-width="5" fill="none" stroke-linecap="round" />
        {n > 0.004 && <path d={arc(-135, a)} stroke={color} stroke-width="5" fill="none" stroke-linecap="round" />}
        <circle cx="27" cy="27" r="14" fill="#1b1f2b" /><line x1="27" y1="27" x2="27" y2="15" stroke="#f1f2f6" stroke-width="2.5" stroke-linecap="round" transform={`rotate(${a} 27 27)`} /></svg>
      <div class="kl">{label}</div><div class="kv">{fmt(value)}</div>
    </div>
  );
}
function Fader({ value, onChange, color, min = 0, max = 1, def, h = 150, label }: { value: number; onChange: (v: number) => void; color: string; min?: number; max?: number; def?: number; h?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null), st = useRef({ drag: false, last: 0 });
  const n = (value - min) / (max - min), top = 6 + (1 - n) * (h - 12);
  const set = (y: number) => { const r = ref.current!.getBoundingClientRect(); const k = 1 - Math.max(0, Math.min(1, (y - r.top - 6) / (r.height - 12))); onChange(+(min + k * (max - min)).toFixed(3)); };
  return (
    <div class="fader" ref={ref} style={{ height: h + 'px', '--c': color } as any} role="slider" aria-label={label} aria-valuenow={value} tabIndex={0}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); st.current.drag = true; const now = Date.now(); if (now - st.current.last < 300 && def !== undefined) onChange(def); else set(e.clientY); st.current.last = now; }}
      onPointerMove={(e) => st.current.drag && set(e.clientY)} onPointerUp={() => (st.current.drag = false)} onPointerCancel={() => (st.current.drag = false)}>
      <div class="track" /><div class="lvl" style={{ height: Math.max(0, h - 6 - top) + 'px', background: color }} /><div class="cap" style={{ top: top + 'px' }} />
    </div>
  );
}
const Icon = {
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5" /></svg>,
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>,
  mix: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v18M12 3v18M18 3v18" /><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor" /><rect x="9.5" y="6" width="5" height="3" rx="1" fill="currentColor" /><rect x="15.5" y="10" width="5" height="3" rx="1" fill="currentColor" /></svg>,
  master: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h3l3-7 4 14 3-9 2 2h3" /></svg>,
};
const pct = (v: number) => Math.round(v * 100) + '%';
const hz = (v: number) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '');

/* ---------- app ---------- */
function App() {
  const [p, setP] = useState<Project>(() => load() ?? projectFromName('Loop'));
  const [tab, setTab] = useState<'pat' | 'mix' | 'master'>('pat');
  const [sel, setSel] = useState('arp');
  const [playing, setPlaying] = useState(false);
  const [nameIn, setNameIn] = useState(p.name === 'Loop' ? '' : p.name);
  const [variant, setVariant] = useState(0);
  const phRef = useRef<HTMLStyleElement>(null), meterRef = useRef<HTMLElement>(null), barRef = useRef<HTMLElement>(null), lufsRef = useRef<HTMLElement>(null);
  const [stats, setStats] = useState({ lufs: -70, auto: 0, gr: 0 });
  const vuRefs = useRef<Record<string, HTMLElement | null>>({});

  const up = (fn: (d: Project) => void) => setP((cur) => { const d = clone(cur); fn(d); engine.update(d); save(d); return d; });
  useEffect(() => { engine.update(p); save(p); }, []);
  useEffect(() => {
    let lastStat = 0;
    engine.onStep = (s) => {
      const i = s % 16 + 1;
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
    await engine.play(p); setPlaying(true);
  };
  const fromName = async (v = 0) => {
    const np = projectFromName(nameIn || 'Loop', v); setVariant(v); setP(np); engine.update(np); save(np);
    if (!engine.playing) { await engine.play(np); setPlaying(true); }
  };
  const tr = p.tracks.find((t) => t.id === sel) ?? p.tracks[0];
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1800); };
  const stepEdit = (t: Track, fn: (x: Track) => void) => { const wasMuted = t.mute; upT(t.id, (x) => { fn(x); if (x.mute) x.mute = false; }); if (wasMuted) flash(t.name + ' encendida'); };
  const upT = (id: string, fn: (t: Track) => void) => up((d) => fn(d.tracks.find((t) => t.id === id)!));
  const letters = useMemo(() => { const c = clean(p.name || 'Loop'); const ls = toLetters(c); return [...c].map((ch, i) => [ch, NAMES['ABCDEFG'.indexOf(ls[i])]]); }, [p.name]);
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
          <div class="lcd">
            <div class="l1"><span>BAR <b ref={barRef as any}>1</b>/4</span><span><b>{p.chords[0]?.name}</b> · {p.chords.slice(1).map((c) => c.name).join(' · ')}</span><span><b ref={lufsRef as any}>–</b> LUFS</span></div>
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

      {tab === 'pat' && <>
        <div class="card">
          <div class="ct"><h3>Generar desde un nombre</h3></div>
          <form class="name-in" onSubmit={(e) => { e.preventDefault(); fromName(0); (document.activeElement as HTMLElement)?.blur(); }}>
            <input value={nameIn} onInput={(e) => setNameIn((e.target as HTMLInputElement).value)} placeholder="Escribí un nombre" maxLength={24} autocomplete="off" />
            <button class="btn hot" type="submit">Generar</button>
          </form>
          <div class="recipe">
            {letters.map(([ch, nt]) => <span style={{ marginRight: '8px' }}><b>{ch}</b> {nt}</span>)}
          </div>
          <div class="chips" style={{ marginTop: '10px' }}>
            <button class="chip" onClick={() => fromName(variant + 1)}>Otra versión</button>
            {Object.keys(GENRES).map((g) => <button class={'chip' + (p.genre === g ? ' on' : '')} onClick={() => up((d) => applyGenre(d, g))}>{GENRES[g].name}</button>)}
          </div>
        </div>

        <div class="card">
          <div class="ct"><h3>Patrón</h3><button class="chip" onClick={() => up((d) => d.tracks.forEach((t) => { if (t.type === 'drum') t.steps = Array(16).fill(0); }))}>Vaciar batería</button></div>
          <div class="grid">
            {p.tracks.map((t) => <>
              <button class={'pw' + (t.mute ? '' : ' on')} style={{ '--c': t.color } as any} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} />
              <button class={'tname' + (sel === t.id ? ' sel' : '') + (t.mute ? ' mute' : '')} style={{ '--c': t.color } as any} onClick={() => setSel(t.id)}>
                <span class="dot" />{t.name}<i class="vu" ref={(el) => { vuRefs.current[t.id] = el; }} />
              </button>
              <div class="pads">
                {Array.from({ length: 16 }, (_, i) => {
                  if (t.type === 'arp') {
                    const on = t.arp!.gate[i], plays = arpPlays(t, i), nf = arpNotes[t.id];
                    return <button class={'pad' + (!on ? ' off' : plays ? ' v1' : ' skip')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                      onClick={() => stepEdit(t, (x) => { x.arp!.gate[i] = !x.arp!.gate[i]; })}>{on && plays && nf && <span class="nn">{noteName(nf(i))}</span>}</button>;
                  }
                  if (t.type === 'melody') {
                    const hit = (t.notes ?? []).filter((n) => n.s % 16 === i);
                    return <button class={'pad' + (hit.length ? ' v1' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`} onClick={() => setSel(t.id)}>{hit[0] && <span class="nn">{noteName(hit[0].n)}</span>}</button>;
                  }
                  if (t.type === 'chords' && t.chordMode !== 'stab') return <button class={'pad' + (i % 16 === 0 ? ' v2' : ' v1')} style={{ '--c': t.color, opacity: i ? 0.35 : 1 } as any} aria-label="Acorde sostenido" onClick={() => setSel(t.id)} />;
                  const v = t.steps[i];
                  return <button class={'pad' + (v === 1 ? ' v1' : v === 2 ? ' v2' : '')} style={{ '--c': t.color } as any} aria-label={`${t.name} paso ${i + 1}`}
                    onClick={() => stepEdit(t, (x) => { x.steps[i] = (x.steps[i] + 1) % 3; })} />;
                })}
              </div>
            </>)}
          </div>
          <AddTrack onAdd={(type, sound) => { let id = ''; up((d) => { if (d.tracks.length >= 16) return; const nt = newTrack(d, type, sound); id = nt.id; d.tracks.push(nt); }); setTimeout(() => id && setSel(id), 0); }} full={p.tracks.length >= 16} />
          <div class="hint">El botón de la izquierda enciende o apaga cada instrumento. En la grilla, un toque prende el golpe, otro lo acentúa y el tercero lo apaga.</div>
        </div>

        {tr && <TrackEditor p={p} t={tr} upT={upT} up={up} onDelete={() => { const left = p.tracks.filter((x) => x.id !== tr.id); if (!left.length) return; up((d) => { d.tracks = d.tracks.filter((x) => x.id !== tr.id); }); setSel(left[0].id); flash(tr.name + ' eliminada'); }} />}
        {toast && <div class="toast">{toast}</div>}
      </>}

      {tab === 'mix' && <div class="card">
        <div class="ct"><h3>Mixer</h3></div>
        <div class="mixer">
          {p.tracks.map((t) => (
            <div class="strip" style={{ '--c': t.color } as any}>
              <div class="nm">{t.name}</div>
              <Fader label={'Volumen ' + t.name} value={t.vol} def={0.8} color={t.color} onChange={(v) => upT(t.id, (x) => { x.vol = v; })} />
              <div class="ms">
                <button class={'m' + (t.mute ? ' on' : '')} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} aria-label={'Mutear ' + t.name}>M</button>
                <button class={'s' + (t.solo ? ' on' : '')} onClick={() => upT(t.id, (x) => { x.solo = !x.solo; })} aria-label={'Solo ' + t.name}>S</button>
              </div>
              <div class="mini"><Knob label="Pan" value={t.pan} min={-1} max={1} def={0} color={t.color} fmt={(v) => (Math.abs(v) < 0.02 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100))} onChange={(v) => upT(t.id, (x) => { x.pan = v; })} /></div>
              <div class="mini"><Knob label="Reverb" value={t.rev} min={0} max={1} def={0} color="var(--mint)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.rev = v; })} /></div>
              <div class="mini"><Knob label="Delay" value={t.dly} min={0} max={1} def={0} color="var(--mint)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.dly = v; })} /></div>
              {t.id !== 'kick' && <div class="mini"><Knob label="Sidechain" value={t.duck} min={0} max={1} def={0} color="var(--hot)" fmt={pct} onChange={(v) => upT(t.id, (x) => { x.duck = v; })} /></div>}
            </div>
          ))}
        </div>
        <div class="hint">Sidechain: cuánto se "agacha" cada pista cuando pega el kick. Doble toque en un control lo vuelve a su valor inicial.</div>
      </div>}

      {tab === 'master' && <Master p={p} up={up} stats={stats} />}

      <nav class="nav">
        <button class={tab === 'pat' ? 'on' : ''} onClick={() => setTab('pat')}>{Icon.grid}Patrón</button>
        <button class={tab === 'mix' ? 'on' : ''} onClick={() => setTab('mix')}>{Icon.mix}Mixer</button>
        <button class={tab === 'master' ? 'on' : ''} onClick={() => setTab('master')}>{Icon.master}Master</button>
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
      {([['bass', 'Bajo'], ['arp', 'Arpegio'], ['chords', 'Acordes'], ['melody', 'Melodía (piano roll)']] as [TrackType, string][]).map(([k, l]) => <button class="chip" onClick={() => { onAdd(k); setOpen(false); }}>{l}</button>)}
      <button class="chip" onClick={() => { setOpen(false); setDrums(false); }}>Cancelar</button>
    </div>
    {drums && DRUM_GROUPS.map(([g, list]) => <><div class="sub">{g}</div><div class="chips">{list.map((k) => <button class="chip" onClick={() => { onAdd('drum', k); setOpen(false); setDrums(false); }}>{DRUM_SOUNDS[k]}</button>)}</div></>)}
  </div>;
}
function TrackEditor({ p, t, upT, up, onDelete }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void; up: (fn: (d: Project) => void) => void; onDelete: () => void }) {
  const power = <button class={'pw' + (t.mute ? '' : ' on')} aria-label={(t.mute ? 'Encender ' : 'Apagar ') + t.name} onClick={() => upT(t.id, (x) => { x.mute = !x.mute; })} />;
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
        <div class="chips">{[['name', 'Nombre'], ['up', 'Sube'], ['down', 'Baja'], ['pp', 'Ping-pong'], ['mirror', 'Espejo'], ['jump', 'Saltos'], ['rand', 'Al azar']].map(([k, l]) => <button class={'chip' + (t.arp!.mode === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.mode = k; })}>{l}</button>)}</div>
        <div class="sub">Ritmo y octavas</div>
        <div class="chips">{[['16', '1/16'], ['8', '1/8'], ['tr', 'Galope']].map(([k, l]) => <button class={'chip' + (t.arp!.rate === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.rate = k as any; })}>{l}</button>)}
          {[1, 2, 3].map((o) => <button class={'chip' + (t.arp!.oct === o ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.arp!.oct = o; })}>{o} oct</button>)}</div>
      </>}
      {t.type === 'chords' && <>
        <div class="sub">Modo</div>
        <div class="chips">{[['pad', 'Sostenido'], ['stab', 'Stabs']].map(([k, l]) => <button class={'chip' + (t.chordMode === k ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => upT(t.id, (x) => { x.chordMode = k as any; if (k === 'stab' && !x.steps.some(Boolean)) x.steps = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]; })}>{l}</button>)}</div>
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
      <div class="chips" style={{ marginTop: '12px' }}><DeleteBtn onDelete={onDelete} /></div>
    </div>
  );
}

const CHROM = ['DO', 'DO#', 'RE', 'RE#', 'MI', 'FA', 'FA#', 'SOL', 'SOL#', 'LA', 'LA#', 'SI'];
function PianoRoll({ p, t, upT }: { p: Project; t: Track; upT: (id: string, fn: (t: Track) => void) => void }) {
  const [bar, setBar] = useState(0), [len, setLen] = useState(2), [onlyName, setOnlyName] = useState(true), [oct, setOct] = useState(0);
  const rows = (onlyName ? nameScale(p, 2) : Array.from({ length: 24 }, (_, i) => 60 + i)).map((m) => m + oct * 12).reverse();
  const notes = t.notes ?? [];
  const at = (s: number, n: number) => notes.find((x) => x.n === n && s >= x.s && s < x.s + x.l);
  const tap = (i: number, n: number) => {
    const s = bar * 16 + i, hit = at(s, n);
    upT(t.id, (x) => { const ns = x.notes ?? []; if (hit) x.notes = ns.filter((y) => !(y.s === hit.s && y.n === hit.n)); else { x.notes = [...ns, { s, n, l: Math.min(len, 64 - s) }]; } });
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
      <button class={'chip' + (onlyName ? ' on' : '')} style={{ '--c': t.color } as any} onClick={() => setOnlyName(!onlyName)}>Solo notas del nombre</button>
      <button class="chip" onClick={() => setOct(Math.max(-2, oct - 1))}>Octava −</button>
      <button class="chip" onClick={() => setOct(Math.min(1, oct + 1))}>Octava +</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { const src = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) === bar); x.notes = [0, 1, 2, 3].flatMap((b) => src.map((y) => ({ ...y, s: b * 16 + (y.s % 16) }))); })}>Copiar a los 4 compases</button>
      <button class="chip" onClick={() => upT(t.id, (x) => { x.notes = (x.notes ?? []).filter((y) => Math.floor(y.s / 16) !== bar); })}>Borrar compás</button>
    </div>
    <div class="hint">Tocá un casillero para poner una nota (suena al agregarla) y tocala de nuevo para sacarla. "Solo notas del nombre" muestra únicamente las notas de tus letras.</div>
  </>;
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
