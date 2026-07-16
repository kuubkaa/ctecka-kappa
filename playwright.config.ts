import { defineConfig, devices } from '@playwright/test'
import { FAKE_CAMERA_Y4M } from './e2e/fake-camera'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  // Paints a real barcode into the fake camera feed before Chromium starts.
  globalSetup: './e2e/global-setup.ts',
  use: {
    // Trailing slash matters: the app deploys under a GitHub Pages subfolder, and
    // tests navigate with relative URLs so they resolve inside it, exactly as in prod.
    baseURL: 'http://localhost:4173/ctecka-kappa/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'android-chrome',
      use: {
        // The app is only ever used on a phone; testing at desktop width would
        // exercise a layout no user sees.
        ...devices['Pixel 7'],
        // Playwright's default headless build is chromium-headless-shell, which has
        // no media capture at all — getUserMedia there fails with "Not supported"
        // and no camera ever appears. The full browser is required to test scanning.
        channel: 'chromium',
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            // Path must be decoded, not URL-encoded: this repo lives under a folder
            // with Czech characters, and Chromium silently registers no camera at
            // all when the file is missing rather than reporting a bad path.
            `--use-file-for-fake-video-capture=${FAKE_CAMERA_Y4M}`,
          ],
        },
      },
    },
  ],
  webServer: {
    // Test the production build, not the dev server: the wasm asset handling,
    // the lazily-loaded PDF chunk, and the service worker only exist after a build.
    command: 'E2E=1 npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173/ctecka-kappa/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
