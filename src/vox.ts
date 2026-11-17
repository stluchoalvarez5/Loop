/* Voces grabadas: captura del micrófono, limpieza (recorte de silencios, normalizado) y guardado en IndexedDB.
   El audio no entra en localStorage (es muy grande): se guarda aparte por id de pista. */

const DB = 'loop-vox', STORE = 'vox';
const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => { const db = await open(); return new Promise<T>((res, rej) => { const q = fn(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };

export type Vox = { sr: number; data: Float32Array; pk?: number }; // pk: pico original (solo al subir un sample, para avisar si es muy bajito)
export const saveVox = (id: string, v: Vox) => tx('readwrite', (s) => s.put({ sr: v.sr, data: v.data }, id));
export const loadVox = (id: string) => tx<Vox | undefined>('readonly', (s) => s.get(id));
export const deleteVox = (id: string) => tx('readwrite', (s) => s.delete(id));
export const voxKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k.map(String));

/* pasa el audio a mono, recorta los silencios del principio y del final, normaliza y suaviza los bordes */
export function cleanVox(buf: AudioBuffer, maxSec = 8): Vox {
  const sr = buf.sampleRate, n = buf.length, mono = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
  const th = Math.max(0.01, pk * 0.06), win = Math.round(sr * 0.01);
  let a = 0, b = n;
  for (let i = 0; i < n; i += win) { let m = 0; for (let j = i; j < Math.min(n, i + win); j++) m = Math.max(m, Math.abs(mono[j])); if (m > th) { a = Math.max(0, i - win * 2); break; } }
  for (let i = n - win; i > a; i -= win) { let m = 0; for (let j = i; j < Math.min(n, i + win); j++) m = Math.max(m, Math.abs(mono[j])); if (m > th) { b = Math.min(n, i + win * 6); break; } }
  b = Math.min(b, a + Math.round(maxSec * sr));
  const out = mono.slice(a, Math.max(a + 1, b)), g = pk > 0 ? 0.9 / pk : 1, f = Math.min(out.length >> 2, Math.round(sr * 0.006));
  for (let i = 0; i < out.length; i++) out[i] *= g;
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return { sr, data: out };
}

/* grabación con MediaRecorder: devuelve una función para cortar, que entrega el audio decodificado */
export async function startRecording(ctx: BaseAudioContext, onLevel: (v: number) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  const rec = new MediaRecorder(stream), chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // medidor de nivel del micrófono (solo para mostrar en pantalla)
  const lc = new AudioContext(), src = lc.createMediaStreamSource(stream), an = lc.createAnalyser(); an.fftSize = 512; src.connect(an);
  const td = new Float32Array(512); let raf = 0;
  const tick = () => { an.getFloatTimeDomainData(td); let m = 0; for (const x of td) m = Math.max(m, Math.abs(x)); onLevel(m); raf = requestAnimationFrame(tick); };
  tick(); rec.start();
  return () => new Promise<AudioBuffer>((res, rej) => {
    rec.onstop = async () => {
      cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); lc.close();
      try { res(await ctx.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer())); } catch (e) { rej(e); }
    };
    rec.stop();
  });
}

/* grabación en tiempo: se respeta el largo exacto (4 compases) y solo se normaliza y se suaviza el final */
export function finishLoopVox(d: Float32Array, sr: number): Vox {
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const g = pk > 0.001 ? 0.9 / pk : 1, f = Math.round(sr * 0.01);
  for (let i = 0; i < d.length; i++) d[i] *= g;
  for (let i = 0; i < f; i++) { d[i] *= i / f; d[d.length - 1 - i] *= i / f; }
  return { sr, data: d };
}

/* contorno de la onda para dibujarla (picos por columna) */
export function peaks(d: Float32Array, cols = 120) { const o: number[] = [], k = Math.max(1, Math.floor(d.length / cols)); for (let c = 0; c < cols; c++) { let m = 0; for (let i = c * k; i < Math.min(d.length, (c + 1) * k); i++) m = Math.max(m, Math.abs(d[i])); o.push(m); } return o; }

/* sample propio: a mono, sin el silencio del principio (aunque dure minutos: una capela que arranca en el minuto 2 empieza ahí), normalizado y con los bordes suavizados.
   Se guardan hasta 120 s desde donde empieza el sonido, para no llenar la memoria; con las líneas de recorte se elige la parte que suena. */
export function cleanSample(buf: AudioBuffer, maxSec = 120): Vox {
  const sr = buf.sampleRate, total = buf.length, nc = buf.numberOfChannels, chs = Array.from({ length: nc }, (_, c) => buf.getChannelData(c));
  const at = (i: number) => { let v = 0; for (let c = 0; c < nc; c++) v += chs[c][i]; return v / nc; };
  // se busca el pico y el primer sonido sobre TODO el archivo (antes solo se miraban los primeros segundos)
  let pk = 0; for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(at(i)));
  if (nc > 1) for (let c = 0; c < nc; c++) { const d = chs[c]; for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(d[i]) * 0.5); }
  if (!(pk > 1e-5)) throw new Error('silencio');
  const th = pk * 0.01; let a = 0;
  while (a < total - 1) { let m = 0; for (let c = 0; c < nc; c++) m = Math.max(m, Math.abs(chs[c][a])); if (m >= th) break; a++; }
  a = Math.max(0, a - Math.round(sr * 0.002));
  const n = Math.min(total - a, Math.round(maxSec * sr)), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = at(a + i);
  // un estéreo con los canales en contrafase se anula al sumarlos a mono: en ese caso se usa el canal con más energía
  if (nc > 1) {
    const en = (d: ArrayLike<number>, o = 0) => { let e = 0; for (let i = 0; i < n; i++) e += d[o + i] * d[o + i]; return e; };
    let best = 0, bestE = -1; for (let c = 0; c < nc; c++) { const e = en(chs[c], a); if (e > bestE) { bestE = e; best = c; } }
    if (en(mono) < bestE * 0.35) mono.set(chs[best].subarray(a, a + n));
  }
  let mp = 0; for (let i = 0; i < n; i++) mp = Math.max(mp, Math.abs(mono[i]));
  if (!(mp > 1e-5)) throw new Error('silencio');
  // la ganancia está limitada (×32): un audio que es casi silencio no se infla hasta que el ruido de fondo suene a todo volumen
  const g = Math.min(0.9 / mp, 32), f = Math.min(n >> 2, Math.round(sr * 0.004));
  for (let i = 0; i < n; i++) mono[i] *= g;
  for (let i = 0; i < f; i++) { mono[i] *= i / f; mono[n - 1 - i] *= i / f; }
  return { sr, data: mono, pk: mp };
}
