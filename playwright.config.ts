import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    // Trailing slash matters: the app deploys under a GitHub Pages subfolder, and
    // tests navigate with relative URLs so they resolve inside it, exactly as in prod.
    baseURL: 'http://localhost:4173/ctecka-kappa/',
    trace: 'on-first-retry',
    // The app is only ever used on a phone; testing at desktop width would exercise
    // a layout no user sees.
    ...devices['Pixel 7'],
  },
  projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Test the production build, not the dev server: the wasm asset handling,
    // the lazily-loaded PDF chunk, and the service worker only exist after a build.
    command: 'E2E=1 npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173/ctecka-kappa/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
