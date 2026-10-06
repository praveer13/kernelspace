/**
 * sw-smoke — a real-browser check of public/sw.js (docs/specs/wave-1.md §6.10, B23). tests/sw/manifest.test.ts runs the
 * worker against a fake scope; it cannot see the browser's job queue or Vary matching, so this drives headless Chromium.
 *
 *   bun run build && PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core bun scripts/sw-smoke.ts
 *
 * Optional: CHROME_BIN (a chromium or chrome-headless-shell binary, or a wrapper that sets LD_LIBRARY_PATH on NixOS).
 * playwright-core is deliberately not a dependency of the repo; install it in a scratch directory and point
 * PLAYWRIGHT_CORE at it. Not part of `bun run test` or the verify gates, because it needs a browser.
 *
 * It serves a temporary copy of dist/ (the repo's dist/ is untouched) with `Vary: Origin` on every response, like
 * `vite preview`, and checks, in order:
 *   1. offline /today and /boot render after one online visit;
 *   2. a slow network falls back to the cached shell after about 3 s;
 *   3. ?nosw=1 unregisters the worker, deletes ks-* caches and leaves the page uncontrolled;
 *   4. a deployed KILL_SWITCH worker replaces a live one on registration.update() and retires it, caches included.
 * Not covered, and owner/partner manual checks: Android Chrome and iOS Safari offline behaviour, and deploying the
 * kill switch to a real preview.
 */
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSw, patchSw, type ManifestChunk } from './build-sw-manifest'

interface Page {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>
  reload(opts?: { waitUntil?: string }): Promise<unknown>
  evaluate<T>(fn: string | ((arg: never) => T | Promise<T>)): Promise<T>
  on(event: string, fn: (arg: { url(): string; failure(): { errorText: string } | null }) => void): void
}
interface Context {
  newPage(): Promise<Page>
  setOffline(offline: boolean): Promise<void>
}
interface Browser {
  newContext(): Promise<Context>
  close(): Promise<void>
}

const playwright = (await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')) as {
  chromium: { launch(opts: { executablePath?: string; headless: boolean }): Promise<Browser> }
}

const root = new URL('../', import.meta.url)
const tmp = await mkdtemp(join(tmpdir(), 'ks-sw-smoke-'))
await cp(new URL('dist/', root), tmp, { recursive: true })
const manifest = JSON.parse(await readFile(join(tmp, '.vite/manifest.json'), 'utf8')) as Record<string, ManifestChunk>
const swSource = await readFile(new URL('public/sw.js', root), 'utf8')
const live = patchSw(swSource, buildSw(manifest, await readFile(join(tmp, 'index.html'), 'utf8')))
const killed = live.replace('const KILL_SWITCH = false', 'const KILL_SWITCH = true')
if (killed === live) throw new Error('sw.js has no KILL_SWITCH = false line to flip')

const state = { sw: live, htmlDelayMs: 0 }
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    const headers = { vary: 'Origin', 'cache-control': 'no-cache' }
    if (pathname === '/sw.js') return new Response(state.sw, { headers: { ...headers, 'content-type': 'text/javascript' } })
    const file = Bun.file(join(tmp, pathname === '/' ? 'index.html' : pathname))
    if (pathname !== '/' && !pathname.startsWith('/.') && (await file.exists())) return new Response(file, { headers })
    if (pathname.startsWith('/assets/')) return new Response('missing', { status: 404 })
    // an SPA route: index.html, optionally after a stall
    if (state.htmlDelayMs) await Bun.sleep(state.htmlDelayMs)
    return new Response(Bun.file(join(tmp, 'index.html')), { headers: { ...headers, 'content-type': 'text/html' } })
  },
})
const origin = `http://localhost:${server.port}`

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true })
try {
  const watch = (page: Page, bag: string[]) => page.on('requestfailed', (r) => bag.push(`${r.url()} ${r.failure()?.errorText}`))
  const rendered = (page: Page) => page.evaluate<number>(() => (document.getElementById('root')?.innerText ?? '').trim().length as never)
  const registrations = (page: Page) => page.evaluate<number>('navigator.serviceWorker.getRegistrations().then((r) => r.length)')
  const cacheNames = (page: Page) => page.evaluate<string[]>('caches.keys()')
  const controlled = (page: Page) => page.evaluate<boolean>('navigator.serviceWorker.controller !== null')
  /** Polls until the async `body` (the text of an async function body, returning a boolean) is true; the worker's own work runs on its own clock (registration starts 1.5 s after load). Polled from here because waitForFunction does not await a string expression. */
  const until = async (page: Page, body: string, ms = 15000) => {
    for (const deadline = Date.now() + ms; Date.now() < deadline; await Bun.sleep(200)) {
      if (await page.evaluate<boolean>(`(async () => { ${body} })()`).catch(() => false)) return true
    }
    return false
  }

  // 1 and 2: a visit with the worker, then offline and slow.
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${origin}/today`, { waitUntil: 'load' })
    check('registered, active and precached after one visit', await until(page, "return (await navigator.serviceWorker.getRegistration())?.active != null && (await caches.keys()).some((n) => n.startsWith('ks-pre-'))"))
    await page.goto(`${origin}/boot`, { waitUntil: 'load' }) // the second load is controlled
    check('controlled on the next load', await until(page, 'return navigator.serviceWorker.controller !== null', 5000))

    await ctx.setOffline(true)
    for (const path of ['/today', '/boot']) {
      const failed: string[] = []
      watch(page, failed)
      const navigated = await page.goto(`${origin}${path}`, { waitUntil: 'load' }).then(() => true, () => false)
      check(`offline ${path} navigation is answered`, navigated)
      if (!navigated) continue
      await page.evaluate('document.fonts.ready.then(() => true)')
      await Bun.sleep(1000)
      const chars = await rendered(page)
      check(`offline ${path} renders`, chars > 40, `${chars} characters`)
      check(`offline ${path} has no failed same-origin request`, failed.filter((f) => f.startsWith(origin)).length === 0, failed.join('; '))
    }
    await ctx.setOffline(false)

    state.htmlDelayMs = 6000
    const t0 = Date.now()
    await page.goto(`${origin}/today`, { waitUntil: 'load' })
    const took = Date.now() - t0
    state.htmlDelayMs = 0
    check('a stalled network falls back to the cached shell near 3 s', took >= 2500 && took < 5500 && (await rendered(page)) > 40, `${took} ms`)
    await ctx.setOffline(false)
  }

  // 3: ?nosw=1.
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${origin}/today`, { waitUntil: 'load' })
    await until(page, "return (await caches.keys()).some((n) => n.startsWith('ks-pre-'))")
    await page.goto(`${origin}/today?nosw=1`, { waitUntil: 'load' })
    check('?nosw=1 unregisters and clears ks-* caches', await until(page, "return (await navigator.serviceWorker.getRegistrations()).length === 0 && (await caches.keys()).every((n) => !n.startsWith('ks-'))", 8000), `${await registrations(page)} registrations, ${(await cacheNames(page)).join(',')}`)
    await page.goto(`${origin}/today?nosw=1`, { waitUntil: 'load' })
    check('a following ?nosw=1 load is uncontrolled', !(await controlled(page)))
  }

  // 4: a deployed kill switch over a live worker.
  {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${origin}/today`, { waitUntil: 'load' })
    // settled: precached, activated, controlling and the hello recorded. An update before that can slip past the stuck-install case.
    await until(page, "return navigator.serviceWorker.controller !== null && (await caches.keys()).includes('ks-meta')")
    await Bun.sleep(1000)
    state.sw = killed
    // not awaited: with a stuck install the update never settles, and the polling below is the verdict
    void page.evaluate('navigator.serviceWorker.getRegistration().then((r) => r.update())').catch(() => {})
    // getRegistration(), not getRegistrations(): an unregister that is queued behind a stuck install already hides the
    // registration from the plural call, while the old worker stays active and controlling.
    const gone = 'return (await navigator.serviceWorker.getRegistration()) === undefined && (await caches.keys()).length === 0'
    check('a deployed kill switch replaces the live worker and retires it', await until(page, gone, 6000), `registration ${await page.evaluate<string>("navigator.serviceWorker.getRegistration().then((r) => r ? [r.active?.state, r.waiting?.state, r.installing?.state].join() : 'none')")}`)
    // a plain load registers the kill worker again (the page does not know), which must retire itself and leave the page alone
    await page.goto(`${origin}/today`, { waitUntil: 'load' })
    await Bun.sleep(4500)
    check('a later plain load stays uncontrolled with no ks-* cache', !(await controlled(page)) && (await cacheNames(page)).length === 0 && (await until(page, 'return (await navigator.serviceWorker.getRegistration()) === undefined', 4000)))
    state.sw = live
  }
} finally {
  await browser.close()
  await server.stop(true)
  await rm(tmp, { recursive: true, force: true })
}
console.log(failures === 0 ? 'sw-smoke: all checks passed' : `sw-smoke: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
