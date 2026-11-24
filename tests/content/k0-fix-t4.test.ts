import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import prefill from '@/data/errata/2026-11-22-t4-l3-prefill-ai-and-5ms-floor'
import fourWarps from '@/data/errata/2026-11-22-t4-l4-l7-four-warps-shared-memory'

/**
 * Lane t4 fix round: the prefill erratum cites its source; t4.l5's vec_add listing indexes a 256 x 256 dispatch in two
 * dimensions and the playground sentence says the playground counts workgroups without modelling their shape; t4.l2
 * presents the H100 ratio as the simulator's assumption; the four-warp erratum says two blocks fit, not fill.
 */
const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const lessonText = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return strings(l.blocks).join('\n')
}

describe('t4.l3 prefill erratum', () => {
  test('cites an https source with a title', () => {
    expect(prefill.source?.url).toMatch(/^https:\/\//)
    expect((prefill.source?.title ?? '').length).toBeGreaterThan(0)
  })
})

describe('t4.l5 vec_add listing and the playground', () => {
  const src = read('src/data/lessons/t4/wgsl-playground.ts')
  const listing = src.slice(src.indexOf('@compute @workgroup_size(256)'), src.indexOf('// NOTE: AI'))
  const WG = 256
  const DISPATCH = { x: 256, y: 256 }
  const N = 16_777_216

  test('the shader builds its index from gid.y and gid.x, not gid.x alone', () => {
    expect(listing).not.toMatch(/let i = gid\.x;/)
    expect(listing).toContain('let i = gid.y * (nwg.x * 256u) + gid.x;')
    expect(listing).toContain('@builtin(num_workgroups) nwg: vec3<u32>')
    expect(listing).toContain('dispatchWorkgroups(256, 256)')
  })

  test('with dispatchWorkgroups(256, 256) that index reaches every element exactly once', () => {
    const seen = new Uint8Array(N)
    const rowWidth = DISPATCH.x * WG // nwg.x * 256
    for (let gy = 0; gy < DISPATCH.y; gy++) {
      for (let gx = 0; gx < rowWidth; gx++) seen[gy * rowWidth + gx]++
    }
    expect(seen.every((c) => c === 1)).toBe(true)
    // gid.x alone would reach only one row
    expect(rowWidth).toBe(N / DISPATCH.y)
  })

  test('the playground sentence does not say it models the 2-D shape', () => {
    const start = src.indexOf('## In the playground')
    expect(start).toBeGreaterThan(-1)
    const para = src.slice(start, src.indexOf("simId: 'sim-wgsl'", start))
    expect(para).not.toContain('256 x 256 in two dimensions')
    expect(para).toContain('does not model their two-dimensional shape')
  })
})

describe('t4.l2 shared memory on the H100', () => {
  const text = lessonText('t4.l2')
  test('the H100 ratio is the simulator\'s assumption, not evidence that a gap narrows', () => {
    expect(text).not.toContain('gap narrows')
    expect(text).toContain('simulator assumes 20 TB/s')
    expect(text).toContain('simulator assumes about 6×')
    expect(text).toContain('not a measurement')
  })
})

describe('t4.l4/t4.l7 four-warp erratum and item', () => {
  test('two 100 KiB blocks fit in the 228 KiB, they do not fill it', () => {
    expect(fourWarps.after).not.toContain('fill the 228')
    expect(fourWarps.after).toContain('fit in the 228 KiB')
    expect(fourWarps.after.length).toBeLessThanOrEqual(240)
    expect(read('src/data/lessons/t4/quantization.ts')).not.toContain('two 100 KiB blocks fill it')
  })
})

describe('t4.l6 FlashAttention lineage', () => {
  test('FlashAttention-2 sits between the 2022 paper and FlashAttention-3', () => {
    const text = lessonText('t4.l6')
    const i2 = text.indexOf('FlashAttention-2')
    expect(i2).toBeGreaterThan(-1)
    expect(i2).toBeLessThan(text.indexOf('FlashAttention-3'))
  })
})
