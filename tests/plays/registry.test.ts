import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import PlayBlock from '../../src/components/blocks/PlayBlock'
import { PENDING_PLAYS, PLAY_REGISTRY, resolvePlay } from '../../src/components/play/registry'
import { PLAY_IDS } from '../../src/data/plays'

/**
 * The play registry (docs/specs/wave-2.md §2.3, task 2a-02): /play/:playId and the lesson's play block resolve
 * ids through src/components/play/registry.ts. A registered id is a component, a pending id ('scheduler') renders
 * nothing so content can place the block before the play ships, and an unknown id is an error card.
 */
const root = resolve(import.meta.dir, '../..')

const block = (playId: string) => renderToString(createElement(PlayBlock, { lessonId: 't5.l7', playId, title: 'A play', trackColor: '#fff' }))

describe('resolvePlay', () => {
  test('block-placement is registered, with an intro for its page', () => {
    const r = resolvePlay('block-placement')
    expect(r.kind).toBe('play')
    if (r.kind === 'play') expect(r.entry.intro.length).toBeGreaterThan(0)
  })

  test('scheduler is pending, and pending is not registered', () => {
    expect(PENDING_PLAYS).toEqual(['scheduler'])
    expect(resolvePlay('scheduler').kind).toBe('pending')
  })

  test('anything else is unknown, including prototype names and the empty id', () => {
    for (const id of ['nope', '', 'constructor', 'toString', '__proto__', 'Scheduler', 'block-placement ']) {
      expect([id, resolvePlay(id).kind]).toEqual([id, 'unknown'])
    }
  })

  test('the registry and the pending list are disjoint, so the pending list cannot go stale', () => {
    for (const id of PENDING_PLAYS) expect(Object.hasOwn(PLAY_REGISTRY, id)).toBe(false)
  })

  test('every registered play has a definition in src/data/plays.ts (verify-plays reads it) and the reverse', () => {
    expect(Object.keys(PLAY_REGISTRY).sort()).toEqual([...PLAY_IDS].sort())
  })
})

describe('the play block', () => {
  test('renders nothing for a pending id', () => {
    expect(block('scheduler')).toBe('')
  })

  test('renders an error card for an unknown id, naming it', () => {
    const html = block('nope')
    expect(html).toContain('data-block="play"')
    expect(html).toContain('data-play-error="nope"')
    expect(html).toContain('There is no play called nope.')
  })

  test('escapes the id it echoes', () => {
    const html = block('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  test('a registered id gets its section, with the play loading inside', () => {
    const html = block('block-placement')
    expect(html).toContain('data-play="block-placement"')
    expect(html).not.toContain('data-play-error')
  })
})

describe('no hard-coded play ids outside the registry', () => {
  for (const file of ['src/components/blocks/PlayBlock.tsx', 'src/pages/Play.tsx']) {
    test(`${file} imports no play component and names no play id`, () => {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(source).not.toMatch(/block-placement/)
      expect(source).toContain('@/components/play/registry')
    })
  }
})

describe('the Wave 2 routes (spec §2.2)', () => {
  const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

  test('/daily, /errors and /play/:playId are routes, each its own lazy page', () => {
    const app = read('src/App.tsx')
    for (const [path, page] of [['/daily', 'Daily'], ['/errors', 'Errors'], ['/play/:playId', 'Play']]) {
      expect(app).toContain(`<Route path="${path}" element={<${page} />} />`)
      expect(app).toContain(`const ${page} = lazy(() => import('@/pages/${page}'))`)
    }
  })

  test('prepare-pages writes a shell for /daily, /errors and /play/scheduler, so GitHub Pages answers 200', () => {
    const routes = /const staticRoutes = \[([\s\S]*?)\]/.exec(read('scripts/prepare-pages.mjs'))![1]
    for (const r of ['daily', 'errors', 'play/scheduler', 'play/block-placement']) expect(routes).toContain(`'${r}'`)
  })

  test('verify-bundle gates /daily at 200 KB and only reports /play/scheduler and /errors', () => {
    const source = read('scripts/verify-bundle.ts')
    expect(source).toContain("{ route: '/daily', src: 'src/pages/Daily.tsx', budgetKb: 200 }")
    expect(source).toMatch(/route: '\/play\/scheduler'[^}]*budgetKb: null/)
    expect(source).toMatch(/route: '\/errors'[^}]*budgetKb: null/)
  })
})
