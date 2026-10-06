/**
 * build-sw-manifest — the service worker's precache manifest (docs/specs/wave-1.md §6.10, B23).
 *
 * Run after `npm run build`. It walks dist/.vite/manifest.json and writes dist/sw.js from public/sw.js with the
 * BUILD placeholder filled in: the build id, the schema version this bundle was built for, the shell and the
 * precache list. The list is the entry closure, the /today and /boot closures with their direct lazy chunks,
 * the ledger engine and notices the entry loads on every page, the lazy ⌘K palette, the generator family
 * chunks, the generated search index chunk and claims.json. Family and search index chunks are picked up when
 * they exist; the scaffold has neither until their tasks land. Re-running it is safe: it always starts from
 * public/sw.js.
 *
 *   bun scripts/build-sw-manifest.ts
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { SCHEMA_VERSION } from '../src/lib/ledger/constants'

export interface ManifestChunk {
  file: string
  name?: string
  src?: string
  isDynamicEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  css?: string[]
  assets?: string[]
}

export interface SwBuild {
  /** Names this build's caches; changes whenever any precached file does. */
  id: string
  /** The ledger SCHEMA_VERSION this bundle was built for (the handshake's baseline). */
  schema: number
  /** The precached SPA shell, relative to the worker's scope. */
  shell: string
  /** Every precached file, relative to the worker's scope. */
  precache: string[]
}

/** The routes whose closures are precached. */
export const ROUTES = [
  { route: '/today', src: 'src/pages/Today.tsx' },
  { route: '/boot', src: 'src/pages/Boot.tsx' },
]

/**
 * Chunks the entry loads lazily on every page: the ledger engine (Today and Boot read the ledger through it),
 * its notices, and the ⌘K palette. Each must exist, so a rename fails here instead of dropping offline support.
 */
export const SHELL_LAZY = ['src/lib/ledger/engine.ts', 'src/components/ledger/LedgerNotices.tsx', 'src/components/CommandPalette.tsx']

/** Plain files in dist/ that are precached. */
export const PUBLIC_FILES = ['claims.json']

const FAMILY_PREFIX = 'src/lib/items/families/'
const SEARCH_INDEX = /search-index/

/** The manifest key of a lazy route's chunk: its source path, or the dynamic-entry chunk with the page's name (see verify-bundle.ts). */
function routeKey(manifest: Record<string, ManifestChunk>, src: string): string | undefined {
  if (manifest[src]) return src
  const name = src.split('/').pop()!.replace(/\.[^.]+$/, '')
  return Object.keys(manifest).find((k) => manifest[k].isDynamicEntry && manifest[k].name === name)
}

/** The precache list for a Vite manifest: dist-relative paths, sorted and unique. `publicFiles` are checked by the caller. */
export function collectPrecache(manifest: Record<string, ManifestChunk>): string[] {
  const files = new Set<string>()
  const seen = new Set<string>()
  const visit = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`manifest has no chunk ${key}`)
    files.add(chunk.file)
    for (const f of [...(chunk.css ?? []), ...(chunk.assets ?? [])]) files.add(f)
    for (const dep of chunk.imports ?? []) visit(dep)
  }
  const entry = manifest['index.html']
  if (!entry) throw new Error('manifest has no index.html entry; is build.manifest on?')
  visit('index.html')

  for (const { route, src } of ROUTES) {
    const key = routeKey(manifest, src)
    if (!key) throw new Error(`manifest has no chunk for ${src}; is ${route} still a lazy route?`)
    visit(key)
    // A route's own lazy chunks (Boot's later steps) belong to its offline flow.
    for (const dyn of manifest[key].dynamicImports ?? []) visit(dyn)
  }
  for (const key of SHELL_LAZY) {
    if (!manifest[key]) throw new Error(`manifest has no chunk ${key}; update SHELL_LAZY in scripts/build-sw-manifest.ts`)
    visit(key)
  }
  for (const [key, chunk] of Object.entries(manifest)) {
    if (key.startsWith(FAMILY_PREFIX) || SEARCH_INDEX.test(key) || SEARCH_INDEX.test(chunk.file)) visit(key)
  }
  for (const file of PUBLIC_FILES) files.add(file)
  files.add('index.html')
  return [...files].sort()
}

export function buildSw(manifest: Record<string, ManifestChunk>, indexHtml: string): SwBuild {
  const precache = collectPrecache(manifest)
  const id = createHash('sha256').update(indexHtml).update('\0').update(precache.join('\n')).digest('hex').slice(0, 12)
  return { id, schema: SCHEMA_VERSION, shell: 'index.html', precache }
}

export const PLACEHOLDER = '/*__SW_BUILD__*/ null'

/** `sw.js` source with the placeholder replaced by the build. Throws if the placeholder is missing (the worker would stay in kill mode). */
export function patchSw(source: string, build: SwBuild): string {
  if (!source.includes(PLACEHOLDER)) throw new Error('sw.js has no BUILD placeholder to fill')
  return source.replace(PLACEHOLDER, () => JSON.stringify(build, null, 2))
}

if (import.meta.main) {
  const dist = new URL('../dist/', import.meta.url)
  const manifestUrl = new URL('.vite/manifest.json', dist)
  if (!existsSync(manifestUrl)) throw new Error('dist/.vite/manifest.json is missing; run npm run build first')
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as Record<string, ManifestChunk>
  const indexHtml = await readFile(new URL('index.html', dist), 'utf8')

  const build = buildSw(manifest, indexHtml)
  for (const file of build.precache) {
    if (!existsSync(new URL(file, dist))) throw new Error(`precache lists ${file}, which is not in dist/`)
  }
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  await writeFile(new URL('sw.js', dist), patchSw(source, build))

  let gzip = 0
  for (const file of build.precache) gzip += gzipSync(await readFile(new URL(file, dist))).length
  console.log(`build-sw-manifest: sw.js build ${build.id}, schema ${build.schema}, ${build.precache.length} precached files, ${(gzip / 1000).toFixed(1)} KB gzip`)
}
