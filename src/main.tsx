import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { isDecorationFailure } from './lib/lazy-decoration'
import { SCHEMA_VERSION } from './lib/ledger/constants'

/*
 * A deploy replaces the hashed chunks under an open tab, so a lazy import can 404 ("Failed to
 * fetch dynamically imported module"). Reload once to pick up the new index.html; the
 * sessionStorage flag stops a chunk that is still missing after the reload from looping, and it
 * is cleared once the reloaded page has stayed up, so a later deploy gets its own one reload.
 * Without the reload, the ErrorBoundary around each Suspense shows a Reload button instead.
 *
 * Purely decorative chunks (lazyDecoration, e.g. the Home particle field) are exempt: Vite fires
 * this event before the failed import() rejects, so the handler waits one task for such a loader
 * to claim its own failure, and a claimed failure is dropped instead of reloading the page.
 */
const RELOAD_FLAG = 'ks:preload-reloaded'
const HEALTHY_AFTER_MS = 30_000

window.addEventListener('vite:preloadError', (event) => {
  const failure = event.payload
  window.setTimeout(() => {
    if (isDecorationFailure(failure)) return
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
    } catch {
      return // no storage means no loop guard, so leave recovery to the ErrorBoundary
    }
    window.location.reload()
  }, 0)
})

window.setTimeout(() => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    // storage unavailable: nothing was set
  }
}, HEALTHY_AFTER_MS)

/*
 * Service worker (docs/specs/wave-1.md §6.10): Today and Boot work offline after one visit. It registers once the
 * first paint is out of the way, only in production builds and secure contexts. `?nosw=1` is the app-side off
 * switch: unregister every worker and delete the caches this app made, and do not register. (public/sw.js is the
 * other one: deploy it with KILL_SWITCH on.) After each registration and controller change the page posts its
 * schemaVersion, so the worker never serves a cached shell older than the newest schema a page has announced.
 */
function setUpServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  if (new URLSearchParams(window.location.search).get('nosw') === '1') {
    void sw
      .getRegistrations()
      .then((registrations) => {
        // the live worker is told first, so it stops caching while the page it controls is still loading chunks
        for (const r of registrations) r.active?.postMessage({ t: 'kill' })
        return Promise.all(registrations.map((r) => r.unregister()))
      })
      .then(() => caches.keys())
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ks-')).map((key) => caches.delete(key))))
      .catch(() => {}) // best effort: a browser that refuses leaves the kill-switch deploy as the way out
    return
  }
  if (!import.meta.env.PROD || !window.isSecureContext) return

  const hello = (worker: ServiceWorker | null | undefined) => worker?.postMessage({ t: 'hello', schemaVersion: SCHEMA_VERSION })
  sw.addEventListener('controllerchange', () => hello(sw.controller))
  const register = () => {
    const base = import.meta.env.BASE_URL
    sw.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then(() => sw.ready)
      .then((registration) => hello(registration.active))
      .catch(() => {}) // no worker means online-only, which is how the app worked before it
  }
  const afterPaint = () => window.setTimeout(register, 1500)
  if (document.readyState === 'complete') afterPaint()
  else window.addEventListener('load', afterPaint, { once: true })
}

setUpServiceWorker()

createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>,
)
