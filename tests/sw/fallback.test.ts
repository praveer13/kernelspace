import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { patchSw, type SwBuild } from '../../scripts/build-sw-manifest'

/**
 * The shell fallback of public/sw.js (docs/specs/wave-1.md §6.10, 1c review follow-up). A navigation that
 * times out or fails is answered with the cached app shell, which is right for a route of the SPA and wrong
 * for /capstone-sandbox.html: that page is the Capstone's sandboxed frame, and the shell inside it never
 * answers the sandbox handshake. This file runs the real worker source against a fake scope (the same
 * approach as manifest.test.ts, kept small here).
 */
const SW_SOURCE = readFileSync(resolve(import.meta.dir, '../../public/sw.js'), 'utf8')

const BUILD: SwBuild = { id: 'abc', schema: 4, shell: 'index.html', precache: ['assets/index-1.js', 'index.html'] }

function worldFor(base: string) {
  const scope = `https://ks.test${base}`
  const listeners = new Map<string, (event: unknown) => void>()
  const store = new Map<string, Map<string, Response>>()
  const cache = (name: string) => ({
    async put(r: Request | string, res: Response) {
      store.get(name)!.set(typeof r === 'string' ? r : r.url, res)
    },
    async match(r: Request | string) {
      return store.get(name)!.get(typeof r === 'string' ? r : r.url)?.clone()
    },
    async addAll(rs: Request[]) {
      for (const r of rs) store.get(name)!.set(r.url, new Response(`shell:${r.url}`, { status: 200 }))
    },
  })
  const world = { online: true, hang: false, timers: [] as (() => void)[], fetched: [] as string[] }
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
    registration: { scope, unregister: async () => {}, update: async () => {} },
    location: { origin: 'https://ks.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
  }
  const fetchFake = (r: Request | string): Promise<Response> => {
    world.fetched.push(typeof r === 'string' ? r : r.url)
    if (world.hang) return new Promise(() => {})
    if (!world.online) return Promise.reject(new TypeError('offline'))
    return Promise.resolve(new Response(`net:${typeof r === 'string' ? r : r.url}`, { status: 200 }))
  }
  new Function('self', 'caches', 'fetch', 'setTimeout', 'clearTimeout', patchSw(SW_SOURCE, BUILD))(self, caches, fetchFake, (fn: () => void) => world.timers.push(fn), () => {})

  const waits: Promise<unknown>[] = []
  const install = async () => {
    listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => void waits.push(p) })
    await Promise.all(waits.splice(0))
  }
  const navigate = (path: string) => {
    let responded: Promise<Response> | null = null
    const req = new Request(`${scope}${path}`)
    Object.defineProperty(req, 'mode', { value: 'navigate' })
    listeners.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)), waitUntil: () => {} })
    return responded as Promise<Response> | null
  }
  return { world, install, navigate, scope }
}

describe('shell fallback', () => {
  for (const base of ['/', '/kernelspace/']) {
    describe(`served from ${base}`, () => {
      test('a route of the app falls back to the cached shell offline', async () => {
        const t = worldFor(base)
        await t.install()
        t.world.online = false
        const res = await t.navigate('today')!
        expect(await res.text()).toBe(`shell:${t.scope}index.html`)
      })

      test('a route of the app falls back to the cached shell after the timeout', async () => {
        const t = worldFor(base)
        await t.install()
        t.world.hang = true
        const pending = t.navigate('boot')!
        t.world.timers[0]()
        expect(await (await pending).text()).toBe(`shell:${t.scope}index.html`)
      })

      test('the Capstone sandbox frame is never answered with the shell, offline or slow', async () => {
        const t = worldFor(base)
        await t.install()
        // the worker does not take the request at all: the browser goes to the network and gets a real answer or a real error
        expect(t.navigate('capstone-sandbox.html')).toBeNull()
        t.world.online = false
        expect(t.navigate('capstone-sandbox.html')).toBeNull()
        t.world.hang = true
        expect(t.navigate('capstone-sandbox.html')).toBeNull()
        expect(t.world.timers).toEqual([])
      })
    })
  }
})
