import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

/*
 * A deploy replaces the hashed chunks under an open tab, so a lazy import can 404 ("Failed to
 * fetch dynamically imported module"). Reload once to pick up the new index.html; the
 * sessionStorage flag stops a chunk that is still missing after the reload from looping, and it
 * is cleared once the reloaded page has stayed up, so a later deploy gets its own one reload.
 * Without the reload, the ErrorBoundary around each Suspense shows a Reload button instead.
 */
const RELOAD_FLAG = 'ks:preload-reloaded'
const HEALTHY_AFTER_MS = 30_000

window.addEventListener('vite:preloadError', () => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  } catch {
    return // no storage means no loop guard, so leave recovery to the ErrorBoundary
  }
  window.location.reload()
})

window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    // storage unavailable: nothing was set
  }
}, HEALTHY_AFTER_MS)

createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>,
)
