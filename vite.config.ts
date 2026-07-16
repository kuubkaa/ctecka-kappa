import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const emptyModule = fileURLToPath(new URL('./src/lib/empty-module.ts', import.meta.url))

/**
 * GitHub Pages serves this from a subfolder, not the domain root. Applying the same
 * base in dev and test — rather than only in the Pages build — means the E2E suite
 * exercises the paths that actually ship. Font fetches and the wasm URL are both
 * base-sensitive, and getting them wrong is invisible until deploy.
 */
const BASE = '/ctecka-kappa/'

// The scanner harness is compiled into the build only for E2E runs, so the test can
// exercise the real production wasm pipeline without that page shipping to users.
const input = process.env.E2E
  ? {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      harness: fileURLToPath(new URL('./e2e/harness.html', import.meta.url)),
    }
  : undefined

export default defineConfig({
  base: BASE,
  build: { rollupOptions: { input } },
  resolve: {
    alias: {
      // jsPDF pulls these in for doc.html() and SVG, which this app never calls.
      // Left alone they cost ~380 kB of precache on the user's phone. See empty-module.ts.
      html2canvas: emptyModule,
      dompurify: emptyModule,
      canvg: emptyModule,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fonts/*.ttf'],
      workbox: {
        // The scanner engine is a ~1 MB .wasm file. Workbox's default globPatterns
        // include wasm, but spelling the list out means a future edit can't silently
        // drop it — which would break scanning offline while everything else still works.
        globPatterns: ['**/*.{js,css,html,wasm,ttf,svg,png,ico}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Čtečka Kappa — inventura',
        short_name: 'Inventura',
        description: 'Skenování čárových kódů a předávací protokol',
        lang: 'cs',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        // Must match the subfolder, or the home-screen icon opens a 404.
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
})
