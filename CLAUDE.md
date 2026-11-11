# Loop

App web instalable (PWA) para crear loops de música electrónica: batería, bajo, sinte (arpegio) y acordes, con mixer, efectos y master. Uno de los modos genera el loop a partir de un nombre: cada letra es una nota (A H O V = LA, B I P W = SI, C J Q X = DO, D K R Y = RE, E L S Z = MI, F M T = FA, G N U = SOL), y el arpegio, los acordes y el bajo usan solo esas notas.

El dueño del proyecto es Luc. Habla en español rioplatense: respondé en ese idioma y con respuestas directas. Es un proyecto gratis y personal.

## Comandos

```bash
npm install
npm run dev        # servidor de desarrollo (abrilo desde el celu con la IP que muestra)
npm run build      # genera dist/ con el service worker de la PWA
npx vite preview --port 4173 & python3 tests/smoke.py   # prueba de humo con Playwright
```

## Arquitectura

- `src/engine/worklet.js`: **el motor de audio**, un `AudioWorkletProcessor` que corre en el hilo de audio. Es JavaScript plano, sin imports, porque Vite lo sirve tal cual con `?url`. Contiene:
  - el secuenciador, con precisión de muestra (64 pasos = 4 compases, swing en los pasos impares);
  - voces de sampler (con interpolación lineal) y de sintetizador (osciladores polyBLEP, unísono, FM, filtro SVF TPT con envolvente, ADSR);
  - el mixer por pista (volumen, paneo de potencia constante, mute, solo, envíos a reverb y delay, sidechain disparado por el kick);
  - los FX compartidos: Freeverb y delay ping-pong sincronizado al tempo;
  - el master: EQ de 8 bandas, compresor "glue", ganancia automática por sonoridad (ponderación K, objetivo en LUFS, ajuste lento acotado entre -18 y +6 dB) y limitador con lookahead más recorte en el techo.
- `src/engine/engine.ts`: lado del hilo principal. Crea el `AudioContext`, carga el worklet, decodifica los samples (más las percusiones sintetizadas una sola vez con `OfflineAudioContext`) y se los manda al worklet. También manda el proyecto compilado.
- `src/model.ts`: tipos, teoría (nombre → notas y acordes), presets de sintes y kits, géneros, `projectFromName()` (semilla por nombre: el mismo nombre da siempre el mismo loop) y `compile()` (proyecto → eventos por paso para el worklet).
- `src/main.tsx` + `src/style.css`: la interfaz en Preact, con tres pestañas: Patrón, Mixer y Master. En Patrón: interruptor de encendido por pista (si cargás un paso en una pista apagada se enciende sola), editor de pista, piano roll y "+ Agregar pista".
- Las ediciones de las perillas de un sinte se guardan en `track.synth` (copia del preset) y `compile()` usa `track.synth ?? SYNTHS[track.sound].p`. El kick que dispara el sidechain es la primera pista de batería con sonido `kick` que esté encendida.
- `public/samples/`: set TR-909 de Rob Roy Recordings. **La licencia exige no modificar, no borrar y no renombrar los archivos, y no usarlos con fines de lucro.** Si la app alguna vez se monetiza, hay que reemplazarlos por sonidos con licencia comercial.

## Reglas para que suene bien y fluido

1. Nada de programar notas con `setTimeout`, `setInterval` ni nodos de Web Audio por nota: todo sonido nuevo se implementa como voz dentro del worklet.
2. En el `process()` del worklet no se crean objetos por muestra ni se reserva memoria por bloque (salvo los buffers reutilizables de `this.buf`).
3. El hilo principal solo manda mensajes chicos (`project`, `play`, `stop`, `sample`). Cualquier cambio en la interfaz llama a `engine.update(p)`, que recompila y manda el proyecto entero, y el motor lo aplica al instante.
4. El volumen percibido tiene que mantenerse parejo: no saques ni saltees la ganancia automática ni el limitador del master. El techo es `master.ceiling` (-1 dBFS).
5. Para la UI que cambia en cada paso (playhead, LEDs, medidores), usá manipulación directa del DOM o el `<style>` del playhead, no estado de Preact.

## Hoja de ruta

- [x] Etapa 1: motor en AudioWorklet, transporte, patrón, mixer, master con EQ, ganancia automática y limitador, modo nombre.
- [x] Etapa 2: agregar y quitar pistas (hasta 16), librería ampliada (toms, rims, snares; sintes Lead, Brass, Flauta, Pluck brillante; bajos FM y Pluck; pads Aire y Oscuro), piano roll para melodías (pista tipo `melody`, notas `{s, n, l}` en 64 pasos), botón de encendido por pista en Patrón.
- [ ] Etapa 3: FX por pista (filtro, distorsión, chorus, bitcrusher, phaser) y automatización simple.
- [ ] Etapa 4: guardar varios proyectos, exportar a WAV, pulir la instalación y el modo offline.
