/**
 * The one door to a 3D scene (docs/specs/wave-3.md §16.1, D9, Q7). It is dark by default: it renders nothing unless the id
 * is in the 3D gate AND its `available` prop is true. The Tiling Cube sets it on every level, a plain opt-in (the owner's
 * answer of 2026-10-15; with the dormant study on, only on the levels its split gives 3D, cube-views.ts). Once it is
 * available the 2D view the learner already has stays first; this adds one button, and the scene (three and R3F, a lazy
 * chunk of about 240 KB) is fetched only when the button is pressed.
 *
 * This file imports neither three nor R3F: the scene is a `lazy` component the caller made, so a page that mounts a View3D
 * loads them only on the request, and tests/boot/imports.test.ts holds that /today, /boot, /me and /play/tiling-cube reach no three.
 * Without WebGL2 (three has been WebGL2-only since r163) the press says so and the scene is never fetched; a context that
 * fails later, or a chunk that does not load, lands in the same plain note, and the 2D view above is untouched.
 */

/* eslint-disable react-refresh/only-export-components -- the gate's ids and the WebGL2 probe sit beside the component so one test reads all three */

import { Suspense, useId, useState, type ComponentType } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'

/**
 * The ids that may render a 3D view. scripts/verify-plays.ts holds the same list as GATE_3D (it reads node:fs, so a page
 * cannot import it) and fails any `<View3D` outside it; tests/plays/view3d.test.ts holds the two copies equal.
 */
export const VIEW3D_IDS: readonly string[] = ['tiling-cube', 'device-mesh']

/** Whether this browser can make a WebGL2 context. The probe context is released at once, so it does not count against the page's limit. */
export function hasWebGL2(make: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const gl = make().getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** The room the scene holds while it loads, so the page below it moves once and not twice. */
export const SCENE_ROOM = 'h-64 sm:h-80'

function SceneLoading() {
  return (
    <div data-view3d-state="loading" className={`${SCENE_ROOM} rounded-md border border-line bg-surface-1 p-3`}>
      <p role="status" className="font-mono text-body-sm text-text-3">
        Loading the 3D view…
      </p>
    </div>
  )
}

/** What replaces the scene when it could not run; the 2D view and its table are all still there. */
export function SceneUnavailable({ why }: { why: 'webgl2' | 'failed' }) {
  return (
    <p role="status" data-view3d-state={why} className="rounded-md border border-line bg-surface-1 p-3 text-body-sm text-text-2">
      {why === 'webgl2'
        ? 'This browser has no WebGL2, so there is no 3D view here. The 2D faces above show everything the box would.'
        : 'The 3D view did not start (you may be offline, or the graphics context failed). The 2D faces above show everything the box would.'}
    </p>
  )
}

export interface View3DProps<P extends object> {
  /** One of VIEW3D_IDS; write it as a literal, because verify-plays reads this attribute. */
  id: string
  /** Off by default; the caller turns it on where the view is offered. */
  available?: boolean
  /** The scene, made with `lazy(() => import(...))` at module level, so its chunk is fetched when the press first renders it and no earlier. */
  Scene: ComponentType<P>
  sceneProps: P
}

export default function View3D<P extends object>({ id, available = false, Scene, sceneProps }: View3DProps<P>) {
  const uid = useId()
  const [state, setState] = useState<'closed' | 'open' | 'no-webgl2'>('closed')
  if (!available || !VIEW3D_IDS.includes(id)) return null
  const request = () => setState(state === 'open' ? 'closed' : hasWebGL2() ? 'open' : 'no-webgl2')
  return (
    <section aria-label="3D view" data-view3d={id} className="space-y-3">
      <p className="text-body-sm text-text-2">The 2D faces are the whole picture. The 3D view draws the same tile as a box and adds no numbers.</p>
      <button
        type="button"
        aria-expanded={state === 'open'}
        aria-controls={`${uid}-scene`}
        onClick={request}
        className="inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 hover:border-line-bright hover:text-text-1 focus-visible:outline-2 focus-visible:outline-accent motion-safe:transition-colors motion-safe:duration-150"
      >
        {state === 'open' ? 'Hide the 3D view' : 'Show it in 3D'}
      </button>
      <div id={`${uid}-scene`}>
        {state === 'no-webgl2' && <SceneUnavailable why="webgl2" />}
        {state === 'open' && (
          <ErrorBoundary fallback={<SceneUnavailable why="failed" />}>
            <Suspense fallback={<SceneLoading />}>
              <Scene {...sceneProps} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </section>
  )
}
