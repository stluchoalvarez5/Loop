import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'samples/*.WAV', 'samples/*.TXT'],
      manifest: {
        name: 'Loop', short_name: 'Loop', description: 'Estudio de loops: batería, sintes, mixer y master.',
        lang: 'es', start_url: './', display: 'standalone', orientation: 'any', background_color: '#08090d', theme_color: '#08090d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,WAV,TXT}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
});
