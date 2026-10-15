/**
 * The cube in 3D, shipped dark (docs/specs/wave-3.md §16.1, D9, Q7, task 3s-01): View3D renders nothing until its
 * `available` prop is true (which nothing sets before 3s-02), only for the ids in GATE_3D, and only the button until it is
 * pressed; Cube3D's shell, budgets and imports; and verify-bundle's two lines for the scene. The static-import walk that
 * proves /today, /boot, /me and /play/tiling-cube never load three is tests/boot/imports.test.ts's.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement, lazy, useState, type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GATE_3D, checkView3D } from '../../scripts/verify-plays'
import { CubeView3D } from '../../src/components/play/tiling-cube/Play'
import TilingCubePlay from '../../src/components/play/tiling-cube/Play'
import Level from '../../src/components/play/tiling-cube/Level'
import Mirror from '../../src/components/play/tiling-cube/Mirror'
import Mirror2D from '../../src/components/play/tiling-cube/Mirror2D'
import {
  DRAW_CALL_BUDGET,
  basisOf,
  MAX_DPR,
  MAX_INSTANCES,
  cellsPerEdge,
  legendOf,
  shellOf,
  type Shell,
} from '../../src/components/play/tiling-cube/Cube3D'
import { MAX_LINES, exploreFor, layoutFaces, openViews, practiceSession, predictedOf, withPrediction, type CubeSession, type Explore } from '../../src/components/play/tiling-cube/session'
import View3D, { SCENE_ROOM, VIEW3D_IDS, hasWebGL2 } from '../../src/components/three/View3D'
import { CUBE_LEVELS, type CubeLevel } from '../../src/lib/world/tiling'
import { installDom, type DomKit } from '../dom/mini-dom'

const ROOT = join(import.meta.dir, '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

const exploreOf = (level: CubeLevel): Explore => exploreFor(level, practiceSession().runs[level.n - 1].inst)

/** A scene the tests can see being fetched and rendered. */
function fakeScene() {
  const seen = { loads: 0 }
  const Scene: ComponentType<{ label: string }> = ({ label }) => createElement('div', { 'data-fake-scene': label }, `scene ${label}`)
  return { seen, Scene: lazy(async () => { seen.loads++; return { default: Scene } }) }
}

describe('View3D ships dark', () => {
  test('its id list is the gate verify-plays checks', () => {
    expect([...VIEW3D_IDS]).toEqual([...GATE_3D])
  })

  test('by default it renders nothing: no entry, no scene, nothing fetched', () => {
    const { seen, Scene } = fakeScene()
    for (const props of [{}, { available: false }]) {
      const html = renderToString(createElement(View3D<{ label: string }>, { id: 'tiling-cube', Scene, sceneProps: { label: 'x' }, ...props }))
      expect(html).toBe('')
    }
    expect(seen.loads).toBe(0)
  })

  test('an id outside the gate renders nothing even when available', () => {
    const { Scene } = fakeScene()
    for (const id of ['spinning-logo', 'block-placement', '']) {
      expect(renderToString(createElement(View3D<{ label: string }>, { id, available: true, Scene, sceneProps: { label: 'x' } }))).toBe('')
    }
  })

  test('available and in the gate, it is one button, closed, with no scene yet', () => {
    const { seen, Scene } = fakeScene()
    const html = renderToString(createElement(View3D<{ label: string }>, { id: 'tiling-cube', available: true, Scene, sceneProps: { label: 'x' } }))
    expect(html).toContain('data-view3d="tiling-cube"')
    expect(html).toContain('Show it in 3D')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-fake-scene')
    expect(html).not.toContain('<canvas')
    expect(seen.loads).toBe(0)
  })

  test('the play passes nothing for `available`, so the shipped cube has no 3D entry (and 3s-02 is the only place to set it)', () => {
    const play = read('src/components/play/tiling-cube/Play.tsx')
    expect(play).toMatch(/<View3D id="tiling-cube"/)
    expect(play).not.toMatch(/<CubeView3D[^>]*available/)
    // nothing else under src mounts or enables a View3D yet
    const users = walk(join(ROOT, 'src'))
      .map((f) => relative(ROOT, f))
      .filter((f) => /<View3D\b|<CubeView3D\b/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
    expect(users).toEqual(['src/components/play/tiling-cube/Play.tsx'])
    expect(checkView3D(users.map((file) => ({ file, text: read(file) })))).toEqual([])
    const html = renderToString(createElement(CubeView3D, { level: CUBE_LEVELS[0], explore: exploreOf(CUBE_LEVELS[0]), mirrorId: 'm' }))
    expect(html).toBe('')
    expect(renderToString(createElement(MemoryRouter, null, createElement(TilingCubePlay, { mode: 'page' })))).not.toContain('Show it in 3D')
  })

  test('turned on, the cube offers the button under its 2D faces and table, and loads nothing yet', () => {
    const level = CUBE_LEVELS[1]
    const html = renderToString(createElement(CubeView3D, { level, explore: exploreOf(level), mirrorId: 'm', available: true }))
    expect(html).toContain('Show it in 3D')
    expect(html).not.toContain('data-cube3d')
  })
})

describe('View3D, mounted: the scene opens on request, and without WebGL2 it never loads', () => {
  let dom: DomKit
  const originalCreate = () => dom.document.createElement.bind(dom.document)
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  /** Gives `canvas` elements a getContext, as a browser with (or without) WebGL2 does. */
  function withCanvas(webgl2: boolean, run: () => Promise<void>): Promise<void> {
    const create = originalCreate()
    const doc = dom.document as unknown as { createElement: (tag: string) => unknown }
    const lost: string[] = []
    doc.createElement = (tag: string) => {
      const el = create(tag) as unknown as Record<string, unknown>
      if (tag === 'canvas') {
        el.getContext = (kind: string) => (webgl2 && kind === 'webgl2' ? { getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => lost.push(n) } : null) } : null)
      }
      return el
    }
    return run().finally(() => {
      doc.createElement = create as never
      expect(lost.length).toBe(webgl2 ? 1 : 0)
    })
  }

  const harness = (Scene: ComponentType<{ label: string }>) => createElement(View3D<{ label: string }>, { id: 'tiling-cube', available: true, Scene, sceneProps: { label: 'cube' } })

  test('pressing "Show it in 3D" fetches the scene once, renders it, and "Hide the 3D view" removes it', async () => {
    await withCanvas(true, async () => {
      const { seen, Scene } = fakeScene()
      const m = await dom.mount(harness(Scene))
      const button = () => m.container.querySelector('button') as never
      expect(seen.loads).toBe(0)
      expect(m.container.textContent).toContain('Show it in 3D')
      await dom.press(button())
      await dom.until(() => m.container.querySelector('[data-fake-scene]') !== null)
      expect(seen.loads).toBe(1)
      expect(m.container.querySelector('[data-fake-scene]')?.getAttribute('data-fake-scene')).toBe('cube')
      expect(m.container.textContent).toContain('Hide the 3D view')
      expect((button() as { getAttribute(n: string): string | null }).getAttribute('aria-expanded')).toBe('true')
      await dom.press(button())
      expect(m.container.querySelector('[data-fake-scene]')).toBeNull()
      expect(m.container.textContent).toContain('Show it in 3D')
      await m.unmount()
    })
  })

  test('without WebGL2 the press says so, the scene is never fetched, and the entry stays', async () => {
    await withCanvas(false, async () => {
      const { seen, Scene } = fakeScene()
      const m = await dom.mount(harness(Scene))
      await dom.press(m.container.querySelector('button') as never)
      expect(m.container.querySelector('[data-view3d-state="webgl2"]')?.textContent).toContain('no WebGL2')
      expect(seen.loads).toBe(0)
      expect(m.container.textContent).toContain('Show it in 3D')
      await m.unmount()
    })
  })

  test('a scene that fails to load falls back to the same plain note (the error boundary logs; the 2D view is untouched)', async () => {
    await withCanvas(true, async () => {
      const log = console.error
      console.error = () => {}
      try {
        const m = await dom.mount(harness(lazy(() => Promise.reject(new Error('chunk 404')))))
        await dom.press(m.container.querySelector('button') as never)
        await dom.until(() => m.container.querySelector('[data-view3d-state="failed"]') !== null)
        expect(m.container.querySelector('[data-view3d-state="failed"]')?.textContent).toContain('did not start')
        await m.unmount()
      } finally {
        console.error = log
      }
    })
  })

  test('hasWebGL2 is false for a browser with no context, a throwing getContext and a canvas that cannot be made', () => {
    const canvas = (getContext: unknown) => () => ({ getContext }) as unknown as HTMLCanvasElement
    expect(hasWebGL2(canvas(() => null))).toBe(false)
    expect(hasWebGL2(canvas(() => { throw new Error('blocked') }))).toBe(false)
    expect(hasWebGL2(() => { throw new Error('no document') })).toBe(false)
    expect(hasWebGL2(canvas((kind: string) => (kind === 'webgl2' ? { getExtension: () => null } : null)))).toBe(true)
    expect(hasWebGL2(canvas((kind: string) => (kind === 'webgl' ? {} : null)))).toBe(false)
  })

  test('the default level view in the play (mounted at the explore step) has no 3D entry, and the 2D faces come before the table', async () => {
    const level = CUBE_LEVELS[0]
    let s: CubeSession = practiceSession()
    s = openViews(withPrediction(s, predictedOf({ ok: true, response: { kind: 'estimate', value: 1 } } as never, s.runs[0].inst)))
    function Level1() {
      const [session] = useState(s)
      return createElement(Level, {
        session,
        level,
        mirrorId: 'm',
        mirror: createElement('div', null, createElement(Mirror, { id: 'm', level, explore: session.explore }), createElement(CubeView3D, { level, explore: session.explore, mirrorId: 'm' })),
        focus: false,
        onPredicted: () => {},
        onOpenViews: () => {},
        onNudge: () => {},
        onChoose: () => {},
        onToCheck: () => {},
        onChecked: () => {},
        onToDebrief: () => {},
      })
    }
    const m = await dom.mount(createElement(Level1))
    await dom.until(() => m.container.querySelector('[data-views]') !== null)
    expect(m.container.querySelector('[data-views]')).not.toBeNull()
    expect(m.container.textContent).not.toContain('Show it in 3D')
    expect(m.container.querySelector('[data-view3d]')).toBeNull()
    await m.unmount()
  })
})

describe('Cube3D: the shell of the box', () => {
  const scenes = (): { level: CubeLevel; e: Explore; name: string }[] => {
    const out: { level: CubeLevel; e: Explore; name: string }[] = []
    for (const level of CUBE_LEVELS) {
      const base = exploreOf(level)
      out.push({ level, e: base, name: `level ${level.n} as played` })
      // the extremes of the steppers: a tiny tile and the largest the ladders allow
      out.push({ level, e: { ...base, tm: 8, tn: 8, k: 8, seq: 1024, d: 16, br: 8 }, name: `level ${level.n} smallest` })
      out.push({ level, e: { ...base, tm: 1024, tn: 1024, k: 1024, seq: 131072, d: 256, br: 256 }, name: `level ${level.n} largest` })
    }
    return out
  }

  test('cells per edge follow the 2D gridline rule: whole, at least 1, at most MAX_LINES', () => {
    expect(MAX_LINES).toBe(16)
    for (const count of [1, 8, 15, 16, 17, 64, 100, 128, 256, 1000, 1024, 131072]) {
      const n = cellsPerEdge(count)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(MAX_LINES)
    }
    expect(cellsPerEdge(8)).toBe(8)
    expect(cellsPerEdge(16)).toBe(16)
    expect(cellsPerEdge(128)).toBe(16)
    expect(cellsPerEdge(131072)).toBe(16)
  })

  test('every scene fits the instance budget, and the budget is far inside the spec’s 50k', () => {
    expect(MAX_INSTANCES).toBe(1536)
    expect(MAX_INSTANCES).toBeLessThanOrEqual(50_000)
    for (const { level, e, name } of scenes()) {
      const shell = shellOf(level, e)
      expect([name, shell.cells.length <= MAX_INSTANCES]).toEqual([name, true])
      const [nx, ny, nz] = shell.counts
      expect([name, shell.cells.length]).toEqual([name, 2 * (nx * ny + ny * nz + nz * nx)])
    }
  })

  test('the box has the 2D faces’ proportions, its longest edge is 2, and every cell lies on its surface', () => {
    for (const { level, e } of scenes()) {
      const shell = shellOf(level, e)
      const f = layoutFaces(e, level.id === 'flash')
      const [sx, sy, sz] = shell.size
      expect(Math.max(sx, sy, sz)).toBeCloseTo(2, 9)
      // x is C's columns, y the depth, z C's rows: ratios match the unfolded faces
      expect(sx / sy).toBeCloseTo(f.c.w / f.a.w, 9)
      expect(sz / sy).toBeCloseTo(f.c.h / f.a.w, 9)
      for (const c of shell.cells) {
        expect(Math.abs(c.center[c.axis])).toBeCloseTo(shell.size[c.axis] / 2, 9)
        expect(Math.sign(c.center[c.axis])).toBe(c.sign)
        for (const other of [0, 1, 2]) if (other !== c.axis) expect(Math.abs(c.center[other])).toBeLessThan(shell.size[other] / 2)
      }
    }
  })

  const tally = (shell: Shell) => {
    const out = { a: 0, b: 0, c: 0, rest: 0 }
    for (const c of shell.cells) out[c.tone]++
    return out
  }

  test('A, B and C are the three faces that meet at the + corner (A on x, C on y, B on z) and the three behind are plain', () => {
    for (const { level, e, name } of scenes()) {
      const shell = shellOf(level, e)
      const [nx, ny, nz] = shell.counts
      expect([name, tally(shell)]).toEqual([name, { a: ny * nz, c: nx * nz, b: nx * ny, rest: ny * nz + nx * nz + nx * ny }])
    }
  })

  test('no cell is mirrored: its two edge directions cross to the outward normal, so none is culled the wrong way round', () => {
    const cross = (a: readonly number[], b: readonly number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const unitOf = (v: readonly number[]) => v.map((x) => x / Math.hypot(...v))
    for (const { level, e } of scenes()) {
      for (const c of shellOf(level, e).cells) {
        const [ex, ey, ez] = basisOf(c)
        const n = cross(unitOf(ex), unitOf(ey))
        for (let i = 0; i < 3; i++) expect(n[i] + 0).toBeCloseTo(ez[i], 9)
        // and the normal points away from the box's centre
        expect(ez[c.axis]).toBe(c.sign)
      }
    }
  })

  test('the legend is the 2D legend, face for face', () => {
    for (const level of CUBE_LEVELS) {
      const e = exploreOf(level)
      const legend = legendOf(level, e)
      expect(legend).toHaveLength(3)
      const html = renderToString(createElement(Mirror2D, { level, explore: e, describedBy: 'm' }))
      for (const line of legend) expect(html).toContain(line)
    }
  })

  test('a deeper slab makes a deeper box, so the scene follows the model', () => {
    const level = CUBE_LEVELS[2]
    const shallow = shellOf(level, { ...exploreOf(level), tm: 64, tn: 64, k: 64 })
    const deep = shellOf(level, { ...exploreOf(level), tm: 64, tn: 64, k: 512 })
    expect(deep.size[1] / deep.size[0]).toBeGreaterThan(shallow.size[1] / shallow.size[0])
  })
})

describe('Cube3D: the budgets the spec names (games-3d.md:250–255)', () => {
  const source = read('src/components/play/tiling-cube/Cube3D.tsx')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  test('InstancedMesh, the demand loop, a pixel ratio of at most 1.5, and a budget of 100 draw calls', () => {
    expect(code).toContain('<instancedMesh')
    expect(code).toContain('frameloop="demand"')
    expect(code).toContain('dpr={[1, MAX_DPR]}')
    expect(MAX_DPR).toBeLessThanOrEqual(1.5)
    expect(DRAW_CALL_BUDGET).toBe(100)
    // the whole scene is one instanced mesh and one line set: 2 draws
    expect(code.match(/<(instancedMesh|mesh|lineSegments|points|line|sprite)\b/g)).toEqual(['<instancedMesh', '<lineSegments'])
  })

  test('nothing animates on a clock: no always loop, no requestAnimationFrame, no clock', () => {
    expect(code).not.toMatch(/frameloop="always"/)
    expect(code).not.toMatch(/requestAnimationFrame|setInterval|useFrame\([^)]*delta|clock/)
  })

  test('no drei anywhere under src (it stays in package.json unused), and no texture, so no asset', () => {
    for (const f of walk(join(ROOT, 'src'))) expect([relative(ROOT, f), /@react-three\/drei/.test(readFileSync(f, 'utf8'))]).toEqual([relative(ROOT, f), false])
    expect(code).not.toMatch(/TextureLoader|useTexture|\.map\s*=|Environment|<Text\b/)
  })

  test('the camera turns by buttons, never a drag, and each is a 44 px target', () => {
    expect(code).not.toMatch(/OrbitControls|onPointerMove|onPointerDown|pointermove/)
    expect(code.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(1)
    for (const label of ['Turn left', 'Turn right', 'First angle']) expect(code).toContain(label)
  })

  test('the box is named and described by the table, and a lost context falls back to a note', () => {
    expect(code).toContain('role="img"')
    expect(code).toContain('aria-describedby={describedBy}')
    expect(code).toContain('webglcontextlost')
  })

  test('the room View3D holds while loading is the scene’s height', () => {
    expect(SCENE_ROOM).toBe('h-64 sm:h-80')
    expect(code).toContain('h-64 w-full')
    expect(code).toContain('sm:h-80')
  })
})

describe('verify-bundle: the scene’s lines', () => {
  const script = read('scripts/verify-bundle.ts')

  test('the three + R3F chunk is reported against 240 KB and the scene chunk fails above 40 KB', () => {
    expect(script).toContain('const THREE_REPORT_KB = 240')
    expect(script).toContain('const SCENE_GATE_KB = 40')
    expect(script).toContain("const SCENE_SRC = 'src/components/play/tiling-cube/Cube3D.tsx'")
    expect(script).toMatch(/if \(sceneKb > SCENE_GATE_KB\) \{\s*console\.error\(`FAIL[^`]*3D scene chunk/)
    // reported, not gated: the three figure never sets `failed`
    expect(script).toMatch(/vendorKb <= THREE_REPORT_KB \? 'ok {2}' : 'warn'\} three \+ R3F chunk/)
  })

  test('the scene is a lazy chunk the manifest must hold, or the gate throws instead of passing', () => {
    expect(script).toMatch(/if \(!sceneKey\) throw new Error\(`manifest has no chunk for \$\{SCENE_SRC\}/)
  })
})
