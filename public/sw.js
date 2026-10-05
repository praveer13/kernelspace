/* kernelspace service worker (docs/specs/wave-1.md §6.10; docs/specs/ledger-v3.md §9.7).
   Today and Boot work offline after one visit. Four rules:
     1. Kill switch: set KILL_SWITCH to true and deploy, and install/activate unregister this worker and delete
        every cache. A copy that scripts/build-sw-manifest.ts never patched (BUILD is still null) does the same,
        so a build that skipped the script cannot leave a half-configured worker behind.
        App code (src/main.tsx) also unregisters on ?nosw=1 (it sends a `kill` message first, so the live worker
        stops caching), and a navigation carrying it bypasses this worker.
     2. index.html is network-first with a 3 s timeout, then the precached shell. Hashed assets are cache-first.
     3. Schema handshake: pages post { t: 'hello', schemaVersion }. The highest value seen is kept, and a cached
        shell built for a lower schema is never served once a newer one has been seen.
     4. It never caches kernelspace:* storage or IndexedDB. It touches no storage API except its own caches, and
        it handles only same-origin GETs inside its scope: the precache list below plus hashed assets.
   scripts/build-sw-manifest.ts replaces the BUILD placeholder in dist/sw.js after `vite build`. */

const KILL_SWITCH = false
const BUILD = /*__SW_BUILD__*/ null

const SHELL_TIMEOUT_MS = 3000
const PREFIX = 'ks-'
const META_CACHE = 'ks-meta'

const SCOPE = self.registration.scope
const kill = KILL_SWITCH || BUILD === null

const allCaches = () => caches.keys()

async function retire() {
  const keys = await allCaches()
  await Promise.all(keys.map((key) => caches.delete(key)))
  await self.registration.unregister()
}

if (kill) {
  self.addEventListener('install', (event) => {
    event.waitUntil(retire().then(() => self.skipWaiting()))
  })
  self.addEventListener('activate', (event) => {
    event.waitUntil(retire())
  })
} else {
  const PRECACHE = `${PREFIX}pre-${BUILD.id}`
  const RUNTIME = `${PREFIX}run-${BUILD.id}`
  const SHELL_URL = SCOPE + BUILD.shell
  const META_URL = `${SCOPE}__ks-sw-meta`
  const precached = new Set(BUILD.precache.map((path) => SCOPE + path))

  /** Highest schemaVersion any page has announced. Persisted, because the worker is stopped between events. */
  let seen = null
  async function readSeen() {
    if (seen !== null) return seen
    try {
      const hit = await (await caches.open(META_CACHE)).match(META_URL)
      const value = hit ? (await hit.json()).schemaVersion : 0
      seen = Number.isFinite(value) ? value : 0
    } catch {
      seen = 0
    }
    return seen
  }
  async function recordSeen(schemaVersion) {
    if (schemaVersion <= (await readSeen())) return
    seen = schemaVersion
    try {
      const body = JSON.stringify({ schemaVersion })
      await (await caches.open(META_CACHE)).put(META_URL, new Response(body, { headers: { 'content-type': 'application/json' } }))
    } catch {
      // the in-memory value still guards this run of the worker
    }
  }

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(PRECACHE)
        .then((cache) => cache.addAll(BUILD.precache.map((path) => new Request(SCOPE + path, { cache: 'reload' }))))
        .then(() => self.skipWaiting()),
    )
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      allCaches()
        .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && ![PRECACHE, RUNTIME, META_CACHE].includes(key)).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()),
    )
  })

  /** Set by a `kill` message (?nosw=1): the page is leaving the worker behind, so it must stop touching caches at once. */
  let killed = false

  self.addEventListener('message', (event) => {
    const data = event.data
    if (data && data.t === 'kill') {
      killed = true
      event.waitUntil(retire())
      return
    }
    if (!data || data.t !== 'hello' || typeof data.schemaVersion !== 'number' || !Number.isFinite(data.schemaVersion)) return
    event.waitUntil(
      recordSeen(data.schemaVersion).then(() => {
        // A page running a newer schema than this build means a newer worker is probably waiting on the network.
        if (data.schemaVersion > BUILD.schema) return self.registration.update()
      }),
    )
  })

  /** The precached shell, or null when it was built for a lower schema than the newest one a page has announced. */
  async function cachedShell() {
    if (BUILD.schema < (await readSeen())) return null
    const cache = await caches.open(PRECACHE)
    return (await cache.match(SHELL_URL)) ?? null
  }

  const offlineShell = () =>
    new Response('<!doctype html><meta charset="utf-8"><title>kernelspace offline</title><p>You are offline and this saved copy is out of date. Reconnect and reload.', {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

  /** Network first. After SHELL_TIMEOUT_MS or a failure, `fallback()`; with nothing to fall back to, keep waiting for the network. */
  async function networkFirst(request, fallback) {
    const network = fetch(request)
    network.catch(() => {}) // a late rejection after the timeout has already won must not go unhandled
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), SHELL_TIMEOUT_MS)
    })
    try {
      const response = await Promise.race([network, timeout])
      if (response) return response
    } catch {
      // offline or refused: fall through to the cache
    } finally {
      clearTimeout(timer)
    }
    const stored = await fallback()
    if (stored) return stored
    return network.catch(() => offlineShell())
  }

  async function assetFirst(event) {
    const hit = await caches.match(event.request)
    if (hit) return hit
    const response = await fetch(event.request)
    if (response.ok) event.waitUntil(caches.open(RUNTIME).then((cache) => cache.put(event.request, response.clone())))
    return response
  }

  self.addEventListener('fetch', (event) => {
    const request = event.request
    if (killed || request.method !== 'GET' || request.headers.has('range')) return
    const url = new URL(request.url)
    if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return

    if (request.mode === 'navigate') {
      if (url.searchParams.get('nosw') === '1') return // the recovery link goes straight to the network
      event.respondWith(networkFirst(request, cachedShell))
      return
    }
    const bare = url.origin + url.pathname
    if (bare.startsWith(`${SCOPE}assets/`)) {
      event.respondWith(assetFirst(event))
    } else if (bare !== SHELL_URL && precached.has(bare)) {
      // claims.json and the like: data the deploy may have changed, so the network wins and the cache is the offline copy.
      // The shell is excluded: it is only ever replaced by an install, so it always matches the precached chunks.
      const key = new Request(bare)
      event.respondWith(
        networkFirst(request, () => caches.match(key)).then((response) => {
          if (response.ok && response.status === 200) event.waitUntil(caches.open(PRECACHE).then((cache) => cache.put(key, response.clone())))
          return response
        }),
      )
    }
  })
}
