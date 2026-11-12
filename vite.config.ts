import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt', // una versión nueva se avisa y se instala con un toque (no recarga sola en medio de un loop)
      includeAssets: ['icons/*.png', 'samples/*.WAV', 'samples/*.TXT'],
      manifest: {
        name: 'Loop', short_name: 'Loop', description: 'Estudio de loops: batería, sintes, mixer y master.',
        id: './', scope: './', lang: 'es', dir: 'ltr', start_url: './', display: 'standalone', orientation: 'any', background_color: '#0a0a0a', theme_color: '#0a0a0a', categories: ['music', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { skipWaiting: true, clientsClaim: true, globPatterns: ['**/*.{js,css,html,png,svg,WAV,TXT,woff2,webmanifest}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, cleanupOutdatedCaches: true, navigateFallback: 'index.html' },
    }),
  ],
});
