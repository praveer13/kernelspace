import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import prefill from '@/data/errata/2026-11-22-t4-l3-prefill-ai-and-5ms-floor'

/**
 * Lane t4, second fix round. (A) t4.l5's reduce.wgsl listing flattens a two-dimensional dispatch, so the 256 x 256 first
 * pass the prose describes sums every element once, and the prose says it is the first pass's workgroups that launch in
 * two dimensions. (B) the at-least-about-5 ms per token is the 8B FP16 model's floor, and both the erratum and the
 * t4.l3 quiz explanation say so.
 */
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

describe('t4.l5 reduce.wgsl over a 256 x 256 first pass', () => {
  const src = read('src/data/lessons/t4/wgsl-playground.ts')
  const start = src.indexOf("filename: 'reduce.wgsl")
  const listing = src.slice(start, src.indexOf('chips:', start))
  const WG = 256
  const N = 16_777_216

  test('the shader flattens wid.y and wid.x into one workgroup index and writes its partial there', () => {
    expect(start).toBeGreaterThan(-1)
    expect(listing).toContain('@builtin(num_workgroups) nwg: vec3<u32>')
    expect(listing).toContain('let wg = wid.y * nwg.x + wid.x;')
    expect(listing).toContain('let g = wg * 256u + lid.x;')
    expect(listing).toContain('partials[wg] = tile[0];')
    expect(listing).not.toMatch(/let g = wid\.x \* 256u/)
    expect(listing).not.toContain('partials[wid.x]')
  })

  test('first pass (256, 256) reads every element once and fills 65,536 distinct partials; pass two (256, 1) fills 256', () => {
    const pass = (nx: number, ny: number, n: number) => {
      const seen = new Uint8Array(n)
      const slots = new Uint8Array(nx * ny)
      for (let wy = 0; wy < ny; wy++)
        for (let wx = 0; wx < nx; wx++) {
          const wg = wy * nx + wx
          slots[wg]++
          for (let l = 0; l < WG; l++) seen[wg * WG + l]++
        }
      return { seen, slots }
    }
    const p1 = pass(256, 256, N)
    expect(p1.seen.every((c) => c === 1)).toBe(true)
    expect(p1.slots.length).toBe(N / WG)
    expect(p1.slots.every((c) => c === 1)).toBe(true)
    const p2 = pass(256, 1, N / WG)
    expect(p2.seen.every((c) => c === 1)).toBe(true)
    expect(p2.slots.length).toBe(256)
  })

  test('the prose says the first pass launches as 256 x 256, not the partials', () => {
    const para = src.slice(src.indexOf('2. **Across workgroups**'), src.indexOf('This shape'))
    expect(para).not.toContain('65,536 partials remain (a real dispatch launches them as 256 x 256')
    expect(para).toContain("the first pass's 65,536 workgroups launch as 256 x 256")
  })
})

describe('the 5 ms floor names its model', () => {
  test('the erratum after says the floor is for an 8B FP16 model, 16 GB of weights', () => {
    expect(prefill.after).toContain('at least about 5 ms per token for an 8B FP16 model (16 GB of weights)')
    expect(prefill.after.length).toBeLessThanOrEqual(240)
  })

  test("the t4.l3 AI = 1 explanation ties the 5 ms to the 8B model, not to every AI = 1 kernel", () => {
    const l3 = ALL_LESSONS.find((l) => l.id === 't4.l3')
    if (!l3) throw new Error('t4.l3 not found')
    const text = JSON.stringify(l3.blocks)
    expect(text).not.toContain('the bandwidth floor that makes each token take at least about 5 ms')
    expect(text).toContain("the bandwidth floor behind the 8B FP16 model's at-least-about-5 ms per token")
  })
})
