/**
 * Every canvas in the Mirrors B sims names its DOM mirror (wave-2.md §12, task 2b-08).
 *
 * The sims need a canvas and a machine, so this checks by source: each canvas carries an
 * aria-describedby, and each id it names is the id of a SimMirror in the same file. One mirror per
 * canvas, so MatrixBench has one pair, QuantizerSim two and WgslSim two.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const SIMS = [
  { file: 'MatrixBench.tsx', canvases: 1 },
  { file: 'QuantizerSim.tsx', canvases: 2 },
  { file: 'WgslSim.tsx', canvases: 2 },
]

describe('canvas to SimMirror wiring', () => {
  for (const { file, canvases } of SIMS) {
    test(`${file}: ${canvases} canvas(es), each described by its own SimMirror`, () => {
      const src = readFileSync(join(ROOT, 'src', 'components', 'sims', file), 'utf8')
      // a canvas tag ends at its self-closing '/>' (handlers inside it hold '=>', so '[^>]' would stop early)
      const tags = [...src.matchAll(/<canvas\b[\s\S]*?\n\s*\/>/g)].map(m => m[0])
      expect(tags.length).toBe(canvases)
      const described = tags.map(t => /aria-describedby=\{(\w+)\}/.exec(t)?.[1] ?? '')
      const mirrors = [...src.matchAll(/<SimMirror\s+id=\{(\w+)\}/g)].map(m => m[1])
      expect(described.length).toBe(canvases)
      expect(new Set(described).size).toBe(canvases)
      for (const id of described) expect(mirrors).toContain(id)
    })
  }
})
