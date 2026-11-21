import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getClaim } from '@/data/claims'
import { claimCite } from '@/data/lessons/claims'
import '@/data/claims/lazy/kvpool'
import { ALL_LESSONS } from '@/data/lessons'
import { MIX, mixRange } from '@/data/lessons/pagedMix'
import { SWEEP_SIZES } from '@/lib/sims/models/blocks'
import { BLOCK_TABLE_EXPLORER_TASKS } from '@/components/sims/blockTableExplorer.tasks'

/**
 * K0-FIX2-RULES: the closing rules check on wave-k0-repin. A lesson types no number its claims do not hold (0.92), dates no
 * feature from the tag it was read at ('Since vLLM v0.34.0'), states vLLM's default with the erratum's CUDA qualifier, and
 * keeps the block-table exercise's sweep text with the sim, not with the claim.
 */

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const lessonText = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return strings(l).join('\n')
}
const root = new URL('../../', import.meta.url).pathname
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')
const cite = claimCite('production.vllm.block-size')

describe('t5.l5 types no number or date without a claim', () => {
  const text = lessonText('t5.l5')

  test("the estimate-sized fallback of gpu_memory_utilization is not typed (no claim's value holds it)", () => {
    expect(text).not.toContain('0.92')
    expect(text).toContain('with it on (a lower default, set in the same file, applies where the cache is sized from an estimate instead)')
  })

  test('the extensible KV cache is stated at the release it was read at, not as arriving there', () => {
    expect(text).not.toMatch(/\bSince vLLM v\d/)
    expect(text).toContain('At vLLM v')
  })
})

describe("vLLM's default carries the erratum's qualifier where t5.l5's and t1.l4's prose states it", () => {
  for (const [id, words] of [
    ['t5.l5', `vLLM's default on CUDA is ${cite}; ROCm keeps`],
    ['t1.l4', `vLLM's default on CUDA is ${cite} (ROCm's paged attention keeps its own size, and an explicit \`--block-size\` wins)`],
  ] as const) {
    test(id, () => {
      expect(lessonText(id)).toContain(words)
      expect(lessonText(id)).toContain('--block-size')
      expect(read(`public/lessons-md/${id}.md`)).toContain(words)
    })
  }
})

describe("the block-table exercise's sweep text follows the sim", () => {
  const sweep = BLOCK_TABLE_EXPLORER_TASKS.find((t) => t.id === 'blk.sweep')
  const lo = Math.min(...SWEEP_SIZES)
  const hi = Math.max(...SWEEP_SIZES)

  test('the sim grades the sweep at the slider top', () => {
    expect(sweep?.observe).toBe(`blk.sweep-tail-${hi}`)
  })

  test('the lesson names the slider range, read from no claim', () => {
    expect(lessonText('t5.l5')).toContain(`Predict the tail waste at ${hi}-token blocks for a 48-token prompt, then sweep block size ${lo} → ${hi}: name what a ${hi}-token block saves and what it costs.`)
    const line = read('src/data/lessons/t5/pagedattention-deep-dive.ts')
      .split('\n')
      .find((l) => l.includes('Predict the tail waste'))
    expect(line).toBeDefined()
    expect(line).not.toContain('ENGINE_BLOCK')
  })
})

describe('the mixed batch is typed once', () => {
  test("t1.l4's mix equals the fragmentation item family's pinned mix", () => {
    const pinned = /mix: '([\d,]+)'/.exec(read('src/lib/items/families/frag.ts'))?.[1]
    expect(pinned).toBe(MIX.join(','))
  })

  test("t1.l4 prints the mix's range from the mix", () => {
    expect(mixRange()).toBe(`${Math.min(...MIX)} to ${Math.max(...MIX)}`)
    expect(lessonText('t1.l4')).toContain(`eight sequences (${mixRange()} tokens)`)
    expect(read('src/data/lessons/t1/fragmentation.ts')).not.toMatch(/\(\d+ to \d+ tokens\)/)
  })
})

describe('labels and comments name no stale or wrong source', () => {
  test("the paper claim's label says the paper chose it, not that it is vLLM's default", () => {
    const label = getClaim('serving.pagedattention.paper-block-size').label
    expect(label).not.toMatch(/vLLM/)
    expect(label).toContain('PagedAttention paper (SOSP 2023): the block size it chose')
  })

  test('no source comment names an SGLang or vLLM release older than the pins', () => {
    for (const f of ['src/components/play/scheduler/session.ts', 'src/components/forge/TwinPanel.tsx']) {
      expect(read(f)).not.toMatch(/v0\.5\.21|v0\.31\.0/)
    }
  })
})
