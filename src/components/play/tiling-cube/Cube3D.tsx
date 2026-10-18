/**
 * The cube's tile as a box (docs/specs/wave-3.md §16.1, D9): the same three faces as Mirror2D, drawn where they meet.
 * C's tile (Tm × Tn) is the top face, A's slab (Tm × k) one side and B's slab (k × Tn) the other, so the box is Tm × Tn × k
 * and its volume is the tile's FLOPs. It adds no number the 2D view and the DOM table do not already carry; it is a second
 * picture of the same model, opened on request (View3D) on any level, never by default.
 *
 * Budgets (games-3d.md:250–255): one InstancedMesh holds every cell of the box's shell (at most 1,536 quads, 16 per edge
 * like the 2D gridlines), one line set draws its edges, so a frame is 2 draw calls against a budget of 100; the loop is
 * `demand` (a frame is drawn when the model or the camera changes, never on a clock); the pixel ratio is capped at 1.5; no
 * texture, no drei. Nothing animates, so reduced motion needs no branch, and the camera turns by buttons, never by a drag
 * (WCAG 2.5.7). This module and three + R3F are one lazy chunk that View3D loads on the press.
 */

/* eslint-disable react-refresh/only-export-components -- the shell, its budgets and its legend sit beside the scene so one test reads both */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CubeLevel } from '@/lib/world/tiling'
import { MAX_LINES, fixed, layoutFaces, type Explore } from './session'

/** The pixel ratio the canvas never exceeds. */
export const MAX_DPR = 1.5
/** The scene's draw-call budget; it draws 2. */
export const DRAW_CALL_BUDGET = 100
/** A shell has six faces of at most MAX_LINES × MAX_LINES cells each. */
export const MAX_INSTANCES = 6 * MAX_LINES * MAX_LINES

/** The longest edge of the box, in scene units; the camera is placed to frame it from any turn. */
const LONGEST = 2
const RADIUS = 6.5
const ELEVATION = (28 * Math.PI) / 180
/** The first view looks at the corner where A's, B's and C's faces meet. */
const START_AZIMUTH = Math.PI / 4
const TURN = Math.PI / 4
/** A cell is drawn this fraction of its slot, so the gap between cells reads as the grid. */
const FILL = 0.92

export type Tone = 'a' | 'b' | 'c' | 'rest'

/** One quad of the box's shell: the face it lies on (axis 0 to 2 = x, y, z; sign), its slot in that face and where it sits. */
export interface ShellCell {
  axis: 0 | 1 | 2
  sign: 1 | -1
  tone: Tone
  /** the cell's centre */
  center: readonly [number, number, number]
  /** its extent along the face's two axes, (axis + 1) % 3 then (axis + 2) % 3 */
  du: number
  dv: number
}

export interface Shell {
  /** x = the tile's columns (Tn), y = the slab depth (k, or d for attention), z = the tile's rows (Tm) */
  size: readonly [number, number, number]
  counts: readonly [number, number, number]
  cells: readonly ShellCell[]
}

/** Cells along an edge of `count` elements: the same rule as the 2D gridlines, so at most MAX_LINES. */
export function cellsPerEdge(count: number): number {
  let unit = 1
  while (count / unit > MAX_LINES) unit *= 2
  return Math.max(1, Math.ceil(count / unit))
}

/** The face tones of a box seen from the + corner: A on x (its rows are Tm along z, its columns k along y), C on y, B on z; the faces behind are plain. */
const toneOf = (axis: number, sign: number): Tone => (sign < 0 ? 'rest' : axis === 0 ? 'a' : axis === 1 ? 'c' : 'b')

/**
 * The shell of a scene. Lengths come from the 2D layout, so the box has the proportions the faces have there (clamped thin
 * for a small tile, on a log scale for FlashAttention), scaled so its longest edge is LONGEST.
 */
export function shellOf(level: CubeLevel, e: Explore): Shell {
  const f = layoutFaces(e, level.id === 'flash')
  const raw = [f.c.w, f.a.w, f.c.h] as const
  const scale = LONGEST / Math.max(...raw)
  const size = [raw[0] * scale, raw[1] * scale, raw[2] * scale] as const
  const counts = [cellsPerEdge(f.dims.c[1]), cellsPerEdge(f.dims.a[1]), cellsPerEdge(f.dims.c[0])] as const
  const cells: ShellCell[] = []
  for (const axis of [0, 1, 2] as const) {
    const u = (axis + 1) % 3
    const v = (axis + 2) % 3
    const du = size[u] / counts[u]
    const dv = size[v] / counts[v]
    for (const sign of [1, -1] as const) {
      for (let i = 0; i < counts[u]; i++) {
        for (let j = 0; j < counts[v]; j++) {
          const center: [number, number, number] = [0, 0, 0]
          center[axis] = (sign * size[axis]) / 2
          center[u] = -size[u] / 2 + (i + 0.5) * du
          center[v] = -size[v] / 2 + (j + 0.5) * dv
          cells.push({ axis, sign, tone: toneOf(axis, sign), center, du, dv })
        }
      }
    }
  }
  return { size, counts, cells }
}

/** The legend of the three faces, in the 2D legend's words. */
export function legendOf(level: CubeLevel, e: Explore): string[] {
  const flash = level.id === 'flash'
  const f = layoutFaces(e, flash)
  const name = (letter: 'A' | 'B' | 'C'): string => (flash ? (letter === 'A' ? 'Q block' : letter === 'B' ? 'Kᵀ' : 'S block') : letter === 'A' ? 'A slab' : letter === 'B' ? 'B slab' : 'C tile')
  const size = (letter: 'A' | 'B' | 'C', [r, c]: [number, number]) => `${name(letter)} ${fixed(r)} × ${fixed(c)}`
  return [size('A', f.dims.a), size('B', f.dims.b), size('C', f.dims.c)]
}

/** The tones are the 2D faces' (tailwind info, amber, accent) and a plain slate for the faces behind. */
const TONE_HEX: Record<Tone, string> = { a: '#5CA8FF', b: '#FFB224', c: '#3EF2A4', rest: '#2C3A4F' }
/** A fixed shade per face direction, so the box reads as solid without a light. */
const SHADE = [0.82, 1, 0.92] as const
const BEHIND_SHADE = 0.75

type Vec = readonly [number, number, number]
const AXES: readonly Vec[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const scaled = (v: Vec, k: number): Vec => [v[0] * k, v[1] * k, v[2] * k]

/**
 * A cell's quad as three basis vectors: its two edges (scaled to the slot, with the gap) and its outward normal. ex × ey = ez
 * for every cell, so no instance is mirrored (a mirrored one would be culled the wrong way round).
 */
export function basisOf(c: ShellCell): readonly [Vec, Vec, Vec] {
  return [scaled(AXES[(c.axis + 1) % 3], c.sign * c.du * FILL), scaled(AXES[(c.axis + 2) % 3], c.dv * FILL), scaled(AXES[c.axis], c.sign)]
}

/** The 12 edges of the unit box, as line-segment endpoints. */
const BOX_EDGES = (() => {
  const out: number[] = []
  for (const a of [0, 1, 2]) {
    const b = (a + 1) % 3
    const c = (a + 2) % 3
    for (const sb of [-0.5, 0.5]) {
      for (const sc of [-0.5, 0.5]) {
        const p = [0, 0, 0]
        p[b] = sb
        p[c] = sc
        const q = [...p]
        p[a] = -0.5
        q[a] = 0.5
        out.push(...p, ...q)
      }
    }
  }
  return new Float32Array(out)
})()

function Shell({ shell }: { shell: Shell }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const edges = useRef<THREE.LineSegments>(null)
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const basis = new THREE.Matrix4()
    const colour = new THREE.Color()
    const ex = new THREE.Vector3()
    const ey = new THREE.Vector3()
    const ez = new THREE.Vector3()
    shell.cells.forEach((c, i) => {
      const [bx, by, bz] = basisOf(c)
      basis.makeBasis(ex.set(...bx), ey.set(...by), ez.set(...bz)).setPosition(c.center[0], c.center[1], c.center[2])
      m.setMatrixAt(i, basis)
      m.setColorAt(i, colour.set(TONE_HEX[c.tone]).multiplyScalar(c.sign < 0 ? BEHIND_SHADE : SHADE[c.axis]))
    })
    m.count = shell.cells.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    edges.current?.scale.set(shell.size[0], shell.size[1], shell.size[2])
    invalidate()
  }, [shell, invalidate])
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_INSTANCES]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial />
      </instancedMesh>
      <lineSegments ref={edges} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[BOX_EDGES, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#A3B0C2" />
      </lineSegments>
    </>
  )
}

/** Places the camera for the current turn and asks for the one frame it changes. */
function Rig({ turn }: { turn: number }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    const az = START_AZIMUTH + turn * TURN
    camera.position.set(RADIUS * Math.sin(az) * Math.cos(ELEVATION), RADIUS * Math.sin(ELEVATION), RADIUS * Math.cos(az) * Math.cos(ELEVATION))
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    invalidate()
  }, [turn, camera, invalidate])
  return null
}

/** What `frameCounts` needs of R3F's state: the renderer, with its per-frame counts, and what it draws. */
export interface FrameState {
  gl: { render(scene: THREE.Scene, camera: THREE.Camera): void; info: { render: { calls: number; triangles: number } } }
  scene: THREE.Scene
  camera: THREE.Camera
}

/**
 * Draws one frame and returns the renderer's own counts of it, [draw calls, triangles]. three resets `info.render` when a
 * frame starts (`info.autoReset`), so the counts are read after the draw: read before it, they are the previous frame's,
 * and the first frame of a `demand` loop would read 0.
 */
export function frameCounts({ gl, scene, camera }: FrameState): [number, number] {
  gl.render(scene, camera)
  return [gl.info.render.calls, gl.info.render.triangles]
}

/** Stats' `useFrame` priority: above 0, so it, not R3F, renders the frame, and reads the counts after the draw. */
export const STATS_PRIORITY = 1

/**
 * Renders each frame itself and writes that frame's counts onto the wrapper, so the budget is read off the page, not
 * assumed. R3F renders after every `useFrame` callback has run, so a callback that only reads `gl.info` sees the frame
 * before; a priority above 0 hands the render to this callback instead (R3F then skips its own), and the counts are read
 * after the draw they count.
 */
function Stats({ report }: { report: (calls: number, triangles: number) => void }) {
  useFrame((state) => report(...frameCounts(state)), STATS_PRIORITY)
  return null
}

export interface Cube3DProps {
  level: CubeLevel
  explore: Explore
  /** The id of the DOM table that carries every number the box draws. */
  describedBy: string
}

const buttonClass =
  'inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 hover:border-line-bright hover:text-text-1 focus-visible:outline-2 focus-visible:outline-accent motion-safe:transition-colors motion-safe:duration-150'

export default function Cube3D({ level, explore, describedBy }: Cube3DProps) {
  const [turn, setTurn] = useState(0)
  const [lost, setLost] = useState(false)
  const stats = useRef<HTMLDivElement>(null)
  const report = useCallback((calls: number, triangles: number) => {
    const el = stats.current
    if (!el) return
    el.dataset.drawCalls = String(calls)
    el.dataset.triangles = String(triangles)
  }, [])
  const shell = useMemo(() => shellOf(level, explore), [level, explore])
  const legend = legendOf(level, explore)
  const degrees = (((turn * 45) % 360) + 360) % 360
  if (lost) {
    return (
      <p role="status" data-view3d-state="lost" className="rounded-md border border-line bg-surface-1 p-3 text-body-sm text-text-2">
        The graphics context was lost, so the 3D view stopped. The 2D faces above show everything the box would.
      </p>
    )
  }
  return (
    <figure data-cube3d className="space-y-2">
      <div
        ref={stats}
        role="img"
        aria-label={`The tile as a box: ${legend.join(', ')}. At the first angle A is the right side, B the left side and C the top.`}
        aria-describedby={describedBy}
        data-instances={shell.cells.length}
        className="h-64 w-full overflow-hidden rounded-md border border-line bg-surface-1 sm:h-80"
      >
        <Canvas
          frameloop="demand"
          dpr={[1, MAX_DPR]}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
          camera={{ fov: 30, near: 0.5, far: 30 }}
          onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => setLost(true))}
        >
          <Rig turn={turn} />
          <Shell shell={shell} />
          <Stats report={report} />
        </Canvas>
      </div>
      <div role="group" aria-label="Turn the 3D view" className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setTurn((t) => t - 1)} className={buttonClass}>
          Turn left
        </button>
        <button type="button" onClick={() => setTurn((t) => t + 1)} className={buttonClass}>
          Turn right
        </button>
        <button type="button" onClick={() => setTurn(0)} aria-disabled={turn === 0 || undefined} className={buttonClass}>
          First angle
        </button>
        <span className="font-mono text-[11px] text-text-3" data-turn>
          Turned {degrees}° from the first angle
        </span>
      </div>
      <figcaption className="font-mono text-[11px] text-text-3">
        {legend.join(' · ')}. Blue is A, amber is B and green is C. The box has the faces&apos; proportions and its grid has at most {MAX_LINES} cells along an edge ({shell.counts.join(' × ')} here).
      </figcaption>
    </figure>
  )
}
