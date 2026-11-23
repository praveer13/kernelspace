/**
 * K0-CLOSE-A: the closing fix round for T5.L10 and T6.L3, their claims and errata, and the t5 errata sources.
 * - Dynamo's first major release is a claim (status.dynamo.release-first-major), and t5.l10 reads its release from it.
 * - t6.l3's Mooncake paragraph keeps its point and links but types none of the figures no claim holds.
 * - t6.l3's KVBM quiz explanation says KVBM is deprecated, not gone, as erratum 2026-11-21-dynamo-kvbm-removal-v1-7-0 says.
 * - t6.l3 names llm-d's founders from the same claim t5.l10 reads.
 * - The C8b erratum says the table says which cells were checked, as the caption does, not that the table is dated.
 * - The Rust radix-tree sentences read their release from twin.sglang.treecore, the claim that holds the Rust default.
 * - The caption no longer counts vLLM's Rust front end as checked: no claim holds that release-notes line.
 * - Every erratum this wave adds (dated 2026-11-21 or later) carries an https source with a title.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lessonById } from '@/data/lessons'
import { claimCite, claimRelease } from '@/data/lessons/claims'
import { LANDSCAPE_T6_CLAIMS } from '@/data/claims/lazy/landscape-t6'
import { TWIN_CLAIMS } from '@/data/claims/lazy/twins'
import { lazyGroupFor } from '@/data/claims/homes'
import type { Erratum } from '@/data/errata/schema'
import table from '@/data/errata/2026-11-23-t5-l10-trtllm-pytorch-only'
import itl from '@/data/errata/2026-11-22-t5-l3-itl-reading-speed'
import blockExplorer from '@/data/errata/2026-11-22-t5-l5-block-explorer-40-token-prompt'

type Block = { type: string; md?: string; questions?: { q: string; explanation?: string }[] }
const blocks = (id: string): Block[] => (lessonById(id) as unknown as { blocks: Block[] }).blocks
const prose = (id: string, start: string): string => {
  const b = blocks(id).find((x) => x.type === 'prose' && x.md !== undefined && x.md.includes(start))
  if (b?.md === undefined) throw new Error(`${id} has no prose block with ${start}`)
  return b.md
}
const root = join(import.meta.dir, '../..')
const src = (rel: string): string => readFileSync(join(root, rel), 'utf8')
const PRODUCTION_STACK = 'src/data/lessons/t5/production-stack.ts'

describe('Dynamo\'s first major release is a claim, and t5.l10 reads it', () => {
  const claim = LANDSCAPE_T6_CLAIMS.find((c) => c.id === 'status.dynamo.release-first-major')
  test('the claim lives in the landscape-t6 group under a registered prefix, pinned to the tag its url names', () => {
    expect(claim).toBeDefined()
    expect(lazyGroupFor(claim!.id)).toBe('lazy/landscape-t6')
    expect(claim!.kind).toBe('status')
    expect(claim!.pin).toEqual({ repo: 'ai-dynamo/dynamo', ref: 'v1.0.0' })
    expect(claim!.source!.url).toBe('https://github.com/ai-dynamo/dynamo/releases/tag/v1.0.0')
    expect(claim!.source!.quote).toContain('Dynamo v1.0.0 is the first major release of the open-source distributed inference platform.')
    expect(claim!.source!.quote).toContain('production-grade disaggregated serving')
  })
  test('the Dynamo sentence names the release through the claim and types no release or date', () => {
    const s = src(PRODUCTION_STACK)
    const sentence = s.slice(s.indexOf('Since T3.L6 was written'), s.indexOf('is the newest release we have read'))
    expect(sentence).toContain("claimRelease('status.dynamo.release-first-major')")
    expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(sentence).not.toMatch(/\bv\d+\.\d+/)
    expect(prose('t5.l10', '## Dynamo: the data plane')).toContain(
      `The notes of ${claimRelease('status.dynamo.release-first-major')} call it "the first major release"`,
    )
  })
})

describe('t6.l3: the Mooncake paragraph types no figure that no claim holds', () => {
  const md = prose('t6.l3', '## Mooncake grows up')
  const para = md.slice(0, md.indexOf('**llm-d** is the packaging answer'))
  test('none of the benchmark, production or announcement figures is typed', () => {
    for (const figure of ['224k', '288k', '115%', '107%', '128 H200', '16 nodes', '2,000', 'February 2026', 'July 2025', 'A800', 'H800']) {
      expect(para).not.toContain(figure)
    }
  })
  test('it keeps its point and links to both sources', () => {
    expect(para).toContain('is a *benchmark*, not Moonshot\'s production')
    expect(para).toContain('(https://lmsys.org/blog/2025-07-20-k2-large-scale-ep/)')
    expect(para).toContain('(https://www.usenix.org/conference/fast25/presentation/qin)')
    expect(para).toContain('a different one')
  })
})

describe('t6.l3: KVBM is deprecated, not gone', () => {
  const item = blocks('t6.l3')
    .flatMap((b) => b.questions ?? [])
    .find((q) => q.q.startsWith('Dynamo\'s KVBM'))
  test('the quiz explanation says the product is deprecated, as the KVBM erratum says', () => {
    expect(item?.explanation).toContain('The idea is outliving the product: KVBM is deprecated, and engines now ship the tiering themselves.')
    expect(item?.explanation).not.toContain('outlived')
  })
})

describe('t6.l3: llm-d\'s founders come from the claim t5.l10 reads', () => {
  test('the opening names them through status.llm-d.founders', () => {
    const md = prose('t6.l3', 'T5.L9\'s rule still holds')
    expect(md).toContain(`**llm-d** (${claimCite('status.llm-d.founders')})`)
    expect(md).not.toContain('Red Hat/Google/CoreWeave')
  })
})

describe('the C8b erratum says what the caption says', () => {
  const caption = (): string => {
    const md = prose('t5.l10', '## The comparison, compressed')
    return md.slice(0, md.indexOf('| |'))
  }
  test('the title, after and why say which cells were checked, not that the table is dated', () => {
    expect(table.title).toBe('TensorRT-LLM now has only the PyTorch backend, and the comparison table says which cells were checked')
    expect(table.after).toContain('The table names the cells it checked.')
    expect(table.why).toContain('the table now says which cells were read.')
    for (const text of [table.title, table.after, table.why!]) {
      expect(text).not.toContain('is dated')
      expect(text).not.toContain('and when')
    }
    expect(table.title.length).toBeLessThanOrEqual(240)
    expect(table.after.length).toBeLessThanOrEqual(240)
  })
  test('the caption says the cells it names were checked against a source', () => {
    expect(caption()).toContain('were checked against a source')
    expect(caption()).toContain('the course\'s summary')
  })
})

describe('the Rust radix-tree sentences rest on twin.sglang.treecore', () => {
  const treecore = TWIN_CLAIMS.find((c) => c.id === 'twin.sglang.treecore')!
  test('the claim they read holds the Rust default', () => {
    expect(treecore.value).toBe('rust')
    expect(treecore.source!.quote).toBe('SGLANG_UNIFIED_RADIX_TREE_CORE_BACKEND = EnvStr("rust")')
  })
  test('both places read the treecore claim, none borrows the hardware claim\'s release, and the switch is named by its PR', () => {
    const s = src(PRODUCTION_STACK)
    expect(s.split("claimRelease('twin.sglang.treecore')").length - 1).toBe(2)
    expect(s).not.toContain("claimRelease('status.sglang.hardware')")
    expect(prose('t5.l10', '**What it is now:**')).toContain(
      'the release notes that switched it (PR #39627) say the prefix cache "now runs on a Rust core by default"',
    )
  })
})

describe('the caption counts only cells a claim holds', () => {
  test('vLLM\'s Rust front end is no longer listed as checked, and no unrelated release sits beside it', () => {
    const s = src(PRODUCTION_STACK)
    const cap = s.slice(s.indexOf('## The comparison, compressed'), s.indexOf('| |', s.indexOf('## The comparison, compressed')))
    expect(cap).not.toContain("claimRelease('twin.vllm.scheduler')")
    expect(cap).not.toContain('Rust frontends')
    expect(cap).toContain('Three were checked against a source.')
  })
})

describe('every erratum this wave adds has an https source with a title', () => {
  const dir = join(root, 'src/data/errata')
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.ts$/.test(f) && f.slice(0, 10) >= '2026-11-21')
  test('each one dated 2026-11-21 or later names an https source and a title', async () => {
    expect(files.length).toBeGreaterThan(0)
    const missing: string[] = []
    for (const f of files) {
      const e = (await import(join(dir, f))).default as Erratum
      if (!e.source || !e.source.url.startsWith('https://') || e.source.title.trim() === '') missing.push(f)
    }
    expect(missing).toEqual([])
  })
  test('the t5.l3 erratum cites the words-per-token rule its after uses', () => {
    expect(itl.source?.url).toBe('https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them')
    expect(itl.after).toContain('0.75 words per token')
  })
  test('the t5.l5 erratum cites lab 02\'s copy-on-write rule at a pinned commit', () => {
    expect(blockExplorer.source?.url).toMatch(
      /^https:\/\/github\.com\/[^/]+\/kernelspace\/blob\/[0-9a-f]{40}\/labs\/kv-block-manager\/src\/manager\.rs#L33-L35$/,
    )
  })
})
