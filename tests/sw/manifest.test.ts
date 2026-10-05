import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PLACEHOLDER, buildSw, collectPrecache, patchSw, type ManifestChunk, type SwBuild } from '../../scripts/build-sw-manifest'
import { SCHEMA_VERSION } from '../../src/lib/ledger/constants'

/**
 * B23 (docs/specs/wave-1.md §6.10): the precache manifest builder and the four rules of public/sw.js. The browser
 * behaviour (offline Today, the 3 s timeout, ?nosw=1, a deployed kill switch) is checked in headless Chromium
 * against a real build; this file pins the logic that needs no browser.
 */
const SW_SOURCE = readFileSync(resolve(import.meta.dir, '../../public/sw.js'), 'utf8')

function chunk(file: string, extra: Partial<ManifestChunk> = {}): ManifestChunk {
  return { file: `assets/${file}`, ...extra }
}

/** A manifest shaped like the real one: Today and Boot lazy, the engine and palette loaded by the entry, one page the SW must skip. */
function fixture(extra: Record<string, ManifestChunk> = {}): Record<string, ManifestChunk> {
  return {
    'index.html': chunk('index-AAA.js', { css: ['assets/index-AAA.css'], dynamicImports: ['src/pages/Today.tsx', 'src/pages/Home.tsx'] }),
    'src/pages/Today.tsx': chunk('Today-BBB.js', { isDynamicEntry: true, imports: ['index.html', '_shared-CCC.js'] }),
    '_shared-CCC.js': chunk('shared-CCC.js', { imports: ['index.html'] }),
    'src/pages/Boot.tsx': chunk('Boot-DDD.js', { isDynamicEntry: true, imports: ['index.html'], dynamicImports: ['src/pages/boot/later.ts'] }),
    'src/pages/boot/later.ts': chunk('later-EEE.js', { isDynamicEntry: true, imports: ['index.html'] }),
    'src/lib/ledger/engine.ts': chunk('engine-FFF.js', { isDynamicEntry: true, imports: ['index.html'] }),
    'src/components/ledger/LedgerNotices.tsx': chunk('LedgerNotices-GGG.js', { isDynamicEntry: true, imports: ['index.html'] }),
    'src/components/CommandPalette.tsx': chunk('CommandPalette-HHH.js', { isDynamicEntry: true, imports: ['index.html', '_fuse-III.js'] }),
    '_fuse-III.js': chunk('fuse-III.js'),
    'src/pages/Home.tsx': chunk('Home-JJJ.js', { isDynamicEntry: true, imports: ['index.html'] }),
    ...extra,
  }
}

describe('collectPrecache', () => {
  test('holds the entry, the /today and /boot closures, the shell lazies, claims and the shell', () => {
    const list = collectPrecache(fixture())
    expect(list).toEqual(
      [
        'assets/Boot-DDD.js',
        'assets/CommandPalette-HHH.js',
        'assets/LedgerNotices-GGG.js',
        'assets/Today-BBB.js',
        'assets/engine-FFF.js',
        'assets/fuse-III.js',
        'assets/index-AAA.css',
        'assets/index-AAA.js',
        'assets/later-EEE.js',
        'assets/shared-CCC.js',
        'claims.json',
        'index.html',
      ].sort(),
    )
  })

  test('skips pages that are not Today or Boot', () => {
    expect(collectPrecache(fixture())).not.toContain('assets/Home-JJJ.js')
  })

  test('adds the generator family chunks and the search index chunk when they exist', () => {
    const list = collectPrecache(
      fixture({
        'src/lib/items/families/frag.ts': chunk('frag-K1.js', { isDynamicEntry: true }),
        'src/lib/items/families/kv.ts': chunk('kv-K2.js', { isDynamicEntry: true }),
        'src/lib/items/families/roofline.ts': chunk('roofline-K3.js', { isDynamicEntry: true }),
        'src/data/search-index.json': chunk('search-index-L1.js', { isDynamicEntry: true }),
      }),
    )
    for (const f of ['frag-K1', 'kv-K2', 'roofline-K3', 'search-index-L1']) expect(list).toContain(`assets/${f}.js`)
  })

  test('is sorted and lists each file once', () => {
    const list = collectPrecache(fixture())
    expect([...list]).toEqual([...new Set(list)].sort())
  })

  test('fails loudly when a route or a shell chunk is missing', () => {
    const noToday = fixture()
    delete noToday['src/pages/Today.tsx']
    expect(() => collectPrecache(noToday)).toThrow(/Today/)
    const noEngine = fixture()
    delete noEngine['src/lib/ledger/engine.ts']
    expect(() => collectPrecache(noEngine)).toThrow(/engine/)
    expect(() => collectPrecache({})).toThrow(/index\.html/)
  })

  test('finds a route chunk that Vite filed under a hashed key', () => {
    const m = fixture()
    m['_Boot-ZZZ.js'] = { ...m['src/pages/Boot.tsx'], name: 'Boot' }
    delete m['src/pages/Boot.tsx']
    expect(collectPrecache(m)).toContain('assets/Boot-DDD.js')
  })
})

describe('buildSw and patchSw', () => {
  test('the build carries the bundle schema, the shell and a content-derived id', () => {
    const a = buildSw(fixture(), '<html>a</html>')
    expect(a.schema).toBe(SCHEMA_VERSION)
    expect(a.shell).toBe('index.html')
    expect(a.precache).toContain(a.shell)
    expect(a.id).toMatch(/^[0-9a-f]{12}$/)
    expect(buildSw(fixture(), '<html>a</html>').id).toBe(a.id)
    expect(buildSw(fixture(), '<html>b</html>').id).not.toBe(a.id)
    expect(buildSw(fixture({ 'src/lib/items/families/x.ts': chunk('x-1.js') }), '<html>a</html>').id).not.toBe(a.id)
  })

  test('patchSw fills the placeholder once, and refuses a source without it', () => {
    expect(SW_SOURCE.split(PLACEHOLDER).length - 1).toBe(1)
    const build = buildSw(fixture(), '<html></html>')
    const patched = patchSw(SW_SOURCE, build)
    expect(patched).not.toContain(PLACEHOLDER)
    expect(patched).toContain(JSON.stringify(build, null, 2))
    expect(() => patchSw(patched, build)).toThrow(/placeholder/)
  })
})

// A just-enough worker environment: a Map-backed CacheStorage, scripted fetch and a manual clock.
const SCOPE = 'https://ks.test/'

function worldFor(source: string, store = new Map<string, Map<string, Response>>()) {
  const listeners = new Map<string, (event: unknown) => void>()
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url)
  const cache = (name: string) => ({
    async put(r: Request | string, res: Response) {
      store.get(name)!.set(key(r), res)
    },
    async match(r: Request | string) {
      return store.get(name)!.get(key(r))?.clone()
    },
    async addAll(rs: Request[]) {
      for (const r of rs) {
        const res = await world.fetch(r)
        if (!res.ok) throw new Error(`addAll ${r.url} ${res.status}`)
        store.get(name)!.set(r.url, res)
      }
    },
    async keys() {
      return [...store.get(name)!.keys()].map((url) => new Request(url))
    },
  })
  const world = {
    listeners,
    store,
    unregistered: 0,
    updated: 0,
    skipped: 0,
    claimed: 0,
    online: true,
    timers: [] as (() => void)[],
    fetched: [] as string[],
    fetch: async (r: Request | string): Promise<Response> => {
      const url = key(r)
      world.fetched.push(url)
      if (!world.online) throw new TypeError('offline')
      return new Response(`net:${url}`, { status: 200 })
    },
  }
  const caches = {
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map())
      return cache(name)
    },
    async keys() {
      return [...store.keys()]
    },
    async delete(name: string) {
      return store.delete(name)
    },
    async match(r: Request) {
      for (const name of store.keys()) {
        const hit = await cache(name).match(r)
        if (hit) return hit
      }
      return undefined
    },
  }
  const self = {
    registration: {
      scope: SCOPE,
      unregister: async () => void world.unregistered++,
      update: async () => void world.updated++,
    },
    location: { origin: 'https://ks.test' },
    clients: { claim: async () => void world.claimed++ },
    skipWaiting: async () => void world.skipped++,
    addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
  }
  const setTimeoutFake = (fn: () => void) => world.timers.push(fn)
  new Function('self', 'caches', 'fetch', 'setTimeout', 'clearTimeout', source)(self, caches, (r: Request | string) => world.fetch(r), setTimeoutFake, () => {})

  const waits: Promise<unknown>[] = []
  const settle = async () => {
    await Promise.all(waits.splice(0))
  }
  const fire = async (type: string, extra: object = {}) => {
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => void waits.push(p), ...extra })
    await settle()
  }
  /** Dispatches a fetch event and returns the response, or null when the worker did not call respondWith. */
  const request = (url: string, init: { mode?: string; method?: string; range?: boolean } = {}) => {
    let responded: Promise<Response> | null = null
    const req = new Request(url, { method: init.method ?? 'GET', headers: init.range ? { range: 'bytes=0-1' } : {} })
    Object.defineProperty(req, 'mode', { value: init.mode ?? 'cors' })
    listeners.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)), waitUntil: (p: Promise<unknown>) => void waits.push(p) })
    return { handled: responded !== null, response: responded as Promise<Response> | null }
  }
  return { world, fire, request, settle }
}

function sourceFor(build: SwBuild | null, kill = false): string {
  const src = build ? patchSw(SW_SOURCE, build) : SW_SOURCE
  return kill ? src.replace('const KILL_SWITCH = false', 'const KILL_SWITCH = true') : src
}

const BUILD: SwBuild = { id: 'abc', schema: 4, shell: 'index.html', precache: ['assets/Today-1.js', 'assets/index-1.js', 'claims.json', 'index.html'] }

describe('rule 1: the kill switch', () => {
  for (const [name, src] of [
    ['KILL_SWITCH = true', sourceFor(BUILD, true)],
    ['an unpatched build', sourceFor(null)],
  ] as const) {
    test(`${name}: install and activate unregister and delete every cache, and nothing is served`, async () => {
      const { world, fire } = worldFor(src)
      world.store.set('ks-old', new Map())
      world.store.set('someone-elses', new Map())
      await fire('install')
      expect(world.unregistered).toBe(1)
      expect([...world.store.keys()]).toEqual([])
      world.store.set('ks-again', new Map())
      await fire('activate')
      expect(world.unregistered).toBe(2)
      expect([...world.store.keys()]).toEqual([])
      expect(world.listeners.has('fetch')).toBe(false)
    })
  }
})

describe('rule 2: caching', () => {
  test('install precaches every listed file fresh, then activate prunes other builds', async () => {
    const { world, fire } = worldFor(sourceFor(BUILD))
    world.store.set('ks-pre-old', new Map())
    world.store.set('ks-meta', new Map())
    await fire('install')
    expect([...(world.store.get('ks-pre-abc')?.keys() ?? [])].sort()).toEqual(BUILD.precache.map((p) => SCOPE + p).sort())
    expect(world.skipped).toBe(1)
    await fire('activate')
    expect([...world.store.keys()].sort()).toEqual(['ks-meta', 'ks-pre-abc'])
    expect(world.claimed).toBe(1)
  })

  test('a failed precache fails the install, leaving the old worker in charge', async () => {
    const { world } = worldFor(sourceFor(BUILD))
    world.online = false
    let waited: Promise<unknown> = Promise.resolve()
    world.listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => void (waited = p) })
    await expect(waited).rejects.toThrow()
    expect(world.skipped).toBe(0)
  })

  test('navigation: the network answers when it is fast', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    const { handled, response } = t.request(`${SCOPE}today`, { mode: 'navigate' })
    expect(handled).toBe(true)
    expect(await (await response!).text()).toBe(`net:${SCOPE}today`)
  })

  test('navigation: after the 3 s timeout the precached shell answers', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    const hang = worldFor(sourceFor(BUILD), t.world.store)
    hang.world.fetch = () => new Promise(() => {}) // a network that never answers
    const { handled, response } = hang.request(`${SCOPE}today`, { mode: 'navigate' })
    expect(handled).toBe(true)
    expect(hang.world.timers.length).toBe(1) // only the timer can win this race
    hang.world.timers[0]()
    expect(await (await response!).text()).toBe(`net:${SCOPE}index.html`)
  })

  test('navigation: offline falls back to the shell at once', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    t.world.online = false
    const { response } = t.request(`${SCOPE}boot`, { mode: 'navigate' })
    expect(await (await response!).text()).toBe(`net:${SCOPE}index.html`)
  })

  test('hashed assets are cache-first and later hits never reach the network', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    t.world.fetched.length = 0
    expect(await (await t.request(`${SCOPE}assets/Today-1.js`).response!).text()).toBe(`net:${SCOPE}assets/Today-1.js`)
    expect(t.world.fetched).toEqual([])
    // an asset that is not precached is fetched once, stored, and served from the cache after that
    await (await t.request(`${SCOPE}assets/Other-9.js`).response!).text()
    await t.settle()
    expect(t.world.fetched).toEqual([`${SCOPE}assets/Other-9.js`])
    t.world.online = false
    expect(await (await t.request(`${SCOPE}assets/Other-9.js`).response!).text()).toBe(`net:${SCOPE}assets/Other-9.js`)
  })

  test('claims.json is network-first with the cache as its offline copy', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    t.world.online = false
    expect(await (await t.request(`${SCOPE}claims.json`).response!).text()).toBe(`net:${SCOPE}claims.json`)
  })

  test('the shell is only ever replaced by an install', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    // a plain fetch of index.html is not refreshed into the cache, so the shell always matches the precached chunks
    expect(t.request(`${SCOPE}index.html`).handled).toBe(false)
  })
})

describe('rule 3: the schema handshake', () => {
  const hello = (schemaVersion: unknown) => ({ data: { t: 'hello', schemaVersion } })

  test('a newer schema from any page makes the cached shell unservable', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    await t.fire('message', hello(5))
    expect(t.world.updated).toBe(1) // it also looks for a newer worker
    t.world.online = false
    const res = await t.request(`${SCOPE}today`, { mode: 'navigate' }).response!
    expect(res.status).toBe(503)
  })

  test('the highest value survives the worker being stopped', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    await t.fire('message', hello(7))
    const reborn = worldFor(sourceFor(BUILD), t.world.store)
    reborn.world.online = false
    expect((await reborn.request(`${SCOPE}today`, { mode: 'navigate' }).response!).status).toBe(503)
  })

  test('the same or a lower schema keeps serving the shell; junk messages are ignored', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    for (const v of [4, 3, 0, 'x', Infinity, null]) await t.fire('message', hello(v))
    await t.fire('message', { data: null })
    await t.fire('message', { data: { t: 'other' } })
    expect(t.world.updated).toBe(0)
    t.world.online = false
    const res = await t.request(`${SCOPE}today`, { mode: 'navigate' }).response!
    expect(res.status).toBe(200)
  })
})

describe('rule 4: never caches ledger storage', () => {
  test('requests outside the precache list and the hashed assets are left to the network', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    for (const url of [`${SCOPE}leaderboard.json`, `${SCOPE}labs/01.zip`, `${SCOPE}kernelspace:v2`, `${SCOPE}lessons-md/t0.l1.md`, 'https://other.test/assets/x.js', 'https://fonts.googleapis.com/css2']) {
      expect(t.request(url).handled).toBe(false)
    }
    expect(t.request(`${SCOPE}claims.json`, { method: 'POST' }).handled).toBe(false)
    expect(t.request(`${SCOPE}assets/Today-1.js`, { range: true }).handled).toBe(false)
    expect(t.request(`${SCOPE}today?nosw=1`, { mode: 'navigate' }).handled).toBe(false)
  })

  test('the source touches no storage API but Cache, and names no kernelspace key', () => {
    const code = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|IDBFactory|kernelspace:/)
  })
})

describe('the kill message from ?nosw=1', () => {
  test('retires the worker and stops it handling fetches', async () => {
    const t = worldFor(sourceFor(BUILD))
    await t.fire('install')
    await t.fire('message', { data: { t: 'kill' } })
    expect(t.world.unregistered).toBe(1)
    expect([...t.world.store.keys()]).toEqual([])
    expect(t.request(`${SCOPE}assets/Today-1.js`).handled).toBe(false)
  })
})
