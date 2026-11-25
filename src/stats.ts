/* Estadísticas anónimas (GoatCounter, panel privado de Luc). Sin cookies, sin ids ni datos personales: cada aviso es un pedido de imagen con la ruta
   ("/" = abrieron la app, "/instalada" = la abrieron desde el ícono, evento "instalar" = la instalaron) y el tamaño de pantalla.
   Solo cuenta en la app publicada (github.io) y se apaga con el interruptor de la tarjeta App (`loop.noStats`) o con "No rastrear" del navegador. */
const HOST = 'loop-luc.goatcounter.com';
const live = () => typeof location !== 'undefined' && location.hostname.endsWith('github.io');
export const statsOff = () => { try { return localStorage.getItem('loop.noStats') === '1' || (navigator as any).doNotTrack === '1'; } catch { return false; } };
export const setStats = (on: boolean) => { try { if (on) localStorage.removeItem('loop.noStats'); else localStorage.setItem('loop.noStats', '1'); } catch { /* sin almacenamiento */ } };
export const isInstalled = () => typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
function hit(path: string, title: string, event = false) {
  if (!live() || statsOff()) return;
  try {
    const q = new URLSearchParams({ p: path, t: title, s: `${screen.width},${screen.height},${devicePixelRatio || 1}`, rnd: Math.random().toString(36).slice(2, 8) });
    if (event) q.set('e', 'true');
    new Image().src = `https://${HOST}/count?${q}`;
  } catch { /* sin conexión o bloqueado: no pasa nada */ }
}
let opened = false;
export function trackOpen() { if (opened) return; opened = true; hit('/', 'Loop'); if (isInstalled()) hit('/instalada', 'App instalada'); }
export function trackInstall() { hit('instalar', 'Instalaron la app', true); }
