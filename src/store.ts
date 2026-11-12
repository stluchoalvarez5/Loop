/* Varios proyectos guardados en el celu.
   localStorage: `loop.projects` = índice chico (nombre, género, fecha) y `loop.proj.<id>` = cada proyecto entero.
   Las voces grabadas siguen en IndexedDB (loop-vox, clave = id de pista): acá solo se copian o se borran con su proyecto. */
import { GENRES, SYNTHS, applyGenre, type Project } from './model';
import { saveVox, loadVox, deleteVox } from './vox';

export type Meta = { id: string; title: string; genre: string; key?: string; updated: number };
const IDX = 'loop.projects', CUR = 'loop.current', KEY = (id: string) => 'loop.proj.' + id;
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* */ } };

export const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const titleOf = (p: Project) => p.title || p.name || 'Loop';

/* arregla proyectos viejos: géneros, grupos y sonidos que ya no existen */
export function normalize(p: Project): Project {
  if (!GENRES[p.genre]) applyGenre(p, 'prog');
  if (!p.groups) { p.groups = [{ id: 'drums', name: 'Batería' }]; p.tracks.forEach((t) => { if (t.type === 'drum') t.group = 'drums'; }); }
  p.tracks.forEach((t) => { if (t.type !== 'drum' && t.type !== 'vocal' && !SYNTHS[t.sound]) t.sound = t.type === 'bass' ? 'bassSaw' : t.type === 'chords' ? 'strings' : 'pluck'; });
  return p;
}

export function listProjects(): Meta[] {
  try { const l = JSON.parse(get(IDX) ?? '[]'); return Array.isArray(l) ? l.sort((a: Meta, b: Meta) => b.updated - a.updated) : []; } catch { return []; }
}
const writeIndex = (l: Meta[]) => set(IDX, JSON.stringify(l));
const meta = (p: Project): Meta => ({ id: p.id!, title: titleOf(p), genre: p.genre, key: p.key, updated: Date.now() });

/* primera vez con varios proyectos: el que estaba guardado (`loop.project`) pasa a ser el primero de la lista */
export function migrate() {
  if (get(IDX) !== null) return;
  const old = get('loop.project'); const l: Meta[] = [];
  if (old) { try { const p: Project = JSON.parse(old); p.id = newId(); p.edited = true; if (set(KEY(p.id), JSON.stringify(p))) { l.push(meta(p)); set(CUR, p.id); } } catch { /* */ } }
  writeIndex(l); del('loop.project');
}

export function loadProject(id: string | null): Project | null {
  if (!id) return null;
  try { const s = get(KEY(id)); if (!s) return null; const p: Project = JSON.parse(s); p.id = id; return normalize(p); } catch { return null; }
}
export const currentId = () => get(CUR);
export const setCurrent = (id: string) => set(CUR, id);

/* guarda el proyecto en su lugar (y lo sube en la lista). Devuelve false si no hay más lugar */
export function saveProject(p: Project): boolean {
  if (!p.id) p.id = newId();
  if (!set(KEY(p.id), JSON.stringify(p))) return false;
  const l = listProjects().filter((m) => m.id !== p.id); l.unshift(meta(p)); writeIndex(l); setCurrent(p.id);
  return true;
}
export async function deleteProject(id: string) {
  const p = loadProject(id);
  del(KEY(id)); writeIndex(listProjects().filter((m) => m.id !== id));
  if (p) for (const t of p.tracks) if (t.type === 'vocal') await deleteVox(t.id).catch(() => {});
}
export function renameProject(id: string, title: string) {
  const p = loadProject(id); if (!p) return; p.title = title; saveProject(p);
}

/* copia con id nuevo; las voces se copian con ids de pista nuevos para que cada proyecto tenga las suyas */
export async function duplicate(p: Project, title?: string): Promise<Project> {
  const d: Project = JSON.parse(JSON.stringify(p)); d.id = newId(); d.title = title ?? titleOf(p) + ' (copia)'; d.edited = true;
  for (const t of d.tracks) if (t.type === 'vocal') {
    const nid = 'vocal-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), v = await loadVox(t.id).catch(() => undefined);
    if (v) await saveVox(nid, v).catch(() => {});
    t.id = nid;
  }
  return d;
}

/* ---------- archivo de respaldo (.loop): el proyecto y sus voces (16 bits) ---------- */
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
export async function exportFile(p: Project): Promise<Blob> {
  const vox: Record<string, { sr: number; pcm: string }> = {};
  for (const t of p.tracks) if (t.type === 'vocal') {
    const v = await loadVox(t.id).catch(() => undefined); if (!v) continue;
    const i16 = new Int16Array(v.data.length); for (let i = 0; i < i16.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(v.data[i] * 32767)));
    vox[t.id] = { sr: v.sr, pcm: b64(new Uint8Array(i16.buffer)) };
  }
  return new Blob([JSON.stringify({ app: 'loop', v: 1, project: p, vox })], { type: 'application/json' });
}
export async function importFile(file: File): Promise<Project> {
  const j = JSON.parse(await file.text());
  if (j?.app !== 'loop' || !j.project?.tracks) throw new Error('no es un archivo de Loop');
  const p: Project = normalize(j.project); p.id = newId(); p.edited = true;
  for (const t of p.tracks) if (t.type === 'vocal') {
    const v = j.vox?.[t.id], nid = 'vocal-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    if (v) { const u = unb64(v.pcm), i16 = new Int16Array(u.buffer, 0, u.length >> 1), f = new Float32Array(i16.length); for (let i = 0; i < f.length; i++) f[i] = i16[i] / 32767; await saveVox(nid, { sr: v.sr, data: f }).catch(() => {}); }
    else if (t.vox) t.vox.has = false;
    t.id = nid;
  }
  return p;
}
