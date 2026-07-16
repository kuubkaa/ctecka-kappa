import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { warmUpScanner } from './lib/scanner'
import './index.css'

registerSW({ immediate: true })

// Pull the ~1 MB scanner engine at boot rather than on the first scan, so the
// user isn't staring at a dead viewfinder the first time they press Skenovat.
warmUpScanner()

// Ask the browser not to evict our counts. Installed PWAs are already exempt from
// iOS's 7-day eviction, but this covers the in-browser case and Android.
void navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
