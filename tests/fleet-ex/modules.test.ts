/**
 * How the Fleet exercise modules depend on each other (fix BF8). The rate every exercise reports lives in its own
 * module, so an exercise never imports another (a §16.3 exercise reuses it without the knee), and the panel reaches the
 * fleet worker through ./live, whose import of forge/run keeps wave-3a's `run` chunk whole on /daily (D32; the build's
 * own numbers are verify:bundle's).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { SIM_TICK_SECONDS } from '../../src/lib/fleet-model'
import { goodputRps } from '../../src/lib/world/fleet-ex/rate'
import { goodputRps as kneeRate } from '../../src/lib/world/fleet-ex/knee'

const dir = new URL('../../src/lib/world/fleet-ex/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const imports = (src: string) => [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])

describe('the shared rate', () => {
  test('is SLO-met requests over the window in seconds, and the knee re-exports the same function', () => {
    expect(goodputRps(40, 800)).toBe(40 / (800 * SIM_TICK_SECONDS))
    expect(kneeRate).toBe(goodputRps)
  })

  test('no exercise module imports another: each takes the rate from ./rate and its types from ./index', () => {
    const exercises = readdirSync(dir).filter((f) => f.endsWith('.ts') && !['index.ts', 'rate.ts'].includes(f))
    expect(exercises.sort()).toEqual(['knee.ts', 'pd-split.ts'])
    for (const f of exercises) {
      const local = imports(read(f)).filter((p) => p.startsWith('./'))
      expect(local.every((p) => p === './index' || p === './rate')).toBe(true)
      expect(local).toContain('./rate')
    }
    expect(imports(read('rate.ts')).every((p) => !p.startsWith('./'))).toBe(true)
  })
})

describe('the panel’s way to the worker', () => {
  test('FleetExercise loads ./live lazily, and ./live imports forge/run beside fleet-session', () => {
    const panel = readFileSync(new URL('../../src/components/fleet-ex/FleetExercise.tsx', import.meta.url), 'utf8')
    expect(panel).toContain("await import('./live')")
    expect(panel).not.toContain("import('@/lib/fleet-session')")
    expect(imports(panel)).not.toContain('@/lib/fleet-session')
    const live = readFileSync(new URL('../../src/components/fleet-ex/live.ts', import.meta.url), 'utf8')
    expect(imports(live)).toEqual(['@/lib/forge/run', '@/lib/fleet-session', '@/lib/world/fleet-ex'])
  })
})
