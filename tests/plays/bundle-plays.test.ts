import { describe, expect, test } from 'bun:test'
import { playChunkKey, resolvePlay, type PlayManifestChunk } from '../../scripts/bundle-plays'

// verify-bundle budgets /play/tiling-cube and /play/eplb before either play exists (wave-3.md §2.2, task 3a-02).
// A row whose playSrc file is missing must be skipped, never handed the scheduler's hoisted `_Play-*` chunk.
const chunk = (file: string, extra: Partial<PlayManifestChunk> = {}): PlayManifestChunk => ({ file: `assets/${file}`, ...extra })
const PAGE = 'src/pages/Play.tsx'
const BP = 'src/components/play/block-placement/Play.tsx'
const SCHED = 'src/components/play/scheduler/Play.tsx'
const CUBE = 'src/components/play/tiling-cube/Play.tsx'
const EPLB = 'src/components/play/eplb/Play.tsx'
const ALL = [BP, SCHED, CUBE, EPLB]

/** The build today: block placement under its source path, the scheduler hoisted to `_Play-*` with no `src`. */
function built(): Record<string, PlayManifestChunk> {
  return {
    'index.html': chunk('index.js'),
    [PAGE]: chunk('Play-page.js', { name: 'Play', src: PAGE, isDynamicEntry: true, imports: ['index.html', '_PlayBlock-b.js'] }),
    '_PlayBlock-b.js': chunk('PlayBlock-b.js', { name: 'PlayBlock', isDynamicEntry: true, imports: ['index.html'], dynamicImports: [BP, '_Play-s.js'] }),
    [BP]: chunk('Play-bp.js', { name: 'Play', src: BP, isDynamicEntry: true, imports: ['index.html'] }),
    '_Play-s.js': chunk('Play-s.js', { name: 'Play', isDynamicEntry: true, imports: ['index.html'], dynamicImports: ['src/components/play/scheduler/Compose.tsx'] }),
    'src/components/play/scheduler/Compose.tsx': chunk('Compose-c.js', { name: 'Compose', src: 'src/components/play/scheduler/Compose.tsx', isDynamicEntry: true, imports: ['index.html', '_Play-s.js'] }),
  }
}

describe('a play row whose source file does not exist yet', () => {
  const onDisk = new Set([BP, SCHED])
  const exists = (src: string) => onDisk.has(src)

  test('is skipped with the route and path named, and never resolves to another play’s chunk', () => {
    const manifest = built()
    // The hazard the skip guards: the by-name fallback does hand a missing play the scheduler's hoisted chunk.
    expect(playChunkKey(manifest, CUBE, PAGE, ALL)).toBe('_Play-s.js')
    expect(playChunkKey(manifest, EPLB, PAGE, ALL)).toBe('_Play-s.js')
    for (const [route, src] of [['/play/tiling-cube', CUBE], ['/play/eplb', EPLB]] as const) {
      expect(resolvePlay(manifest, route, src, PAGE, ALL, exists)).toEqual({ skip: `skip ${route}: ${src} does not exist yet` })
    }
  })

  test('is skipped before any chunk lookup', () => {
    const manifest = new Proxy(built(), {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop !== 'then' && !(prop in target)) throw new Error(`looked up ${prop}`)
        return Reflect.get(target, prop, receiver)
      },
    })
    expect('skip' in resolvePlay(manifest, '/play/eplb', EPLB, PAGE, ALL, exists)).toBe(true)
  })

  test('once the file exists the row resolves like any other play', () => {
    const manifest = built()
    expect(resolvePlay(manifest, '/play/block-placement', BP, PAGE, ALL, exists)).toEqual({ key: BP })
    expect(resolvePlay(manifest, '/play/scheduler', SCHED, PAGE, ALL, exists)).toEqual({ key: '_Play-s.js' })
    const cubeBuilt = { ...manifest, [CUBE]: chunk('Play-cube.js', { name: 'Play', src: CUBE, isDynamicEntry: true, imports: ['index.html'] }) }
    expect(resolvePlay(cubeBuilt, '/play/tiling-cube', CUBE, PAGE, ALL, (s) => exists(s) || s === CUBE)).toEqual({ key: CUBE })
  })

  test('an existing play with no chunk is still left to the caller to fail, not skipped', () => {
    const manifest = built()
    delete manifest['_Play-s.js']
    manifest['_PlayBlock-b.js'].dynamicImports = [BP]
    expect(resolvePlay(manifest, '/play/scheduler', SCHED, PAGE, ALL, exists)).toEqual({ key: undefined })
  })
})
