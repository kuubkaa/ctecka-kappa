import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { migrateFromLegacy, startSync } from './db'
import { warmUpScanner } from './lib/scanner'
import './index.css'

registerSW({ immediate: true })

// Pull the ~1 MB scanner engine at boot rather than on the first scan, so the
// user isn't staring at a dead viewfinder the first time they press Skenovat.
warmUpScanner()

// Ask the browser not to evict our counts. Installed PWAs are already exempt from
// iOS's 7-day eviction, but this covers the in-browser case and Android.
void navigator.storage?.persist?.().catch(() => {})

const root = createRoot(document.getElementById('root')!)

/**
 * Move any pre-sync data across before the first render.
 *
 * Rendering first would flash an empty stocktake list at someone who has months of
 * counts — they'd reasonably conclude the update ate their data. A failed migration
 * must not block the app either: the old database is left intact, so the worst case
 * is an empty app with the data still recoverable rather than a white screen.
 */
migrateFromLegacy()
  .catch((err) => {
    console.error('Migrace ze starší verze selhala; stará data zůstala nedotčená.', err)
  })
  .finally(() => {
    // After the migration, so the timer never races rows still being copied across.
    startSync()
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
