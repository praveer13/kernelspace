/**
 * Version-pinned claims (docs/specs/wave-2.md §8.5, §5.3, §10.5; invariant W13): the pin rule verify-claims
 * enforces, the claims every Wave 2 card and generator family reads, and the tokenizer corpus against the
 * Qwen3 counts that `scripts/engine/qwen3-counts.py` produced.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { CLAIMS, byId, isEngineSetting, pinProblems, type Claim } from '../../src/data/claims'
import { TOKEN_CORPUS, TOKEN_CORPUS_IDS } from '../../src/data/engine/token-corpus'

const base: Claim = {
  id: 'production.vllm.example',
  kind: 'status',
  value: 1,
  label: 'Example',
  source: { url: 'https://raw.githubusercontent.com/vllm-project/vllm/v0.31.0/vllm/config/cache.py', title: 'Example source', quote: 'x = 1' },
  verifiedAt: '2026-10-05',
  ttlDays: 60,
  pin: { repo: 'vllm-project/vllm', ref: 'v0.31.0' },
}

describe('pinProblems', () => {
  test('a pinned claim whose source url contains the ref is clean', () => {
    expect(pinProblems(base)).toEqual([])
  })

  test('fails a pinned claim whose source url does not contain pin.ref', () => {
    const moved = { ...base, source: { ...base.source!, url: 'https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/config/cache.py' } }
    expect(pinProblems(moved).join('\n')).toContain('does not contain pin.ref "v0.31.0"')
    const docs = { ...base, source: { ...base.source!, url: 'https://docs.vllm.ai/en/latest/configuration/optimization/' } }
    expect(pinProblems(docs)).toHaveLength(1)
  })

  test('fails a status claim about engine settings without a pin', () => {
    const { pin: _pin, ...unpinned } = base
    void _pin
    expect(isEngineSetting(unpinned)).toBe(true)
    expect(pinProblems(unpinned).join('\n')).toContain('needs pin')
    expect(pinProblems({ ...unpinned, id: 'production.sglang.example' })).toHaveLength(1)
  })

  test('an unpinned claim that is not an engine setting needs no pin', () => {
    const { pin: _pin, ...unpinned } = base
    void _pin
    expect(pinProblems({ ...unpinned, id: 'production.glibc.example', kind: 'spec' })).toEqual([])
    expect(pinProblems({ ...unpinned, id: 'hw.h100-sxm.example' })).toEqual([])
    // only status claims are engine settings: a spec of the same engine is read from a fixed document
    expect(isEngineSetting({ id: 'production.vllm.example', kind: 'spec' })).toBe(false)
  })

  test('rejects a moving ref, an empty ref and a repo that is not owner/name', () => {
    for (const ref of ['main', 'latest', 'HEAD', 'stable', ' ']) {
      expect(pinProblems({ ...base, pin: { repo: 'vllm-project/vllm', ref } }).length).toBeGreaterThan(0)
    }
    expect(pinProblems({ ...base, pin: { repo: 'vllm', ref: 'v0.31.0' } }).join('\n')).toContain('owner/name')
  })

  test('derived and synthetic claims have no source to pin, and a pinned claim needs a source', () => {
    expect(pinProblems({ ...base, kind: 'synthetic', source: undefined }).join('\n')).toContain('no source to pin')
    expect(pinProblems({ ...base, source: undefined }).join('\n')).toContain('needs a source')
  })
})

describe('the registry', () => {
  test('every pinned claim passes the rule, and every engine setting is pinned', () => {
    for (const c of CLAIMS) expect(pinProblems(c)).toEqual([])
    const engine = CLAIMS.filter(isEngineSetting)
    expect(engine.length).toBeGreaterThanOrEqual(10)
    for (const c of engine) expect(c.pin).toBeDefined()
  })

  test('the In-production card reads one vLLM release and one SGLang release', () => {
    const refs = (prefix: string) => new Set(CLAIMS.filter((c) => isEngineSetting(c) && c.id.startsWith(prefix)).map((c) => `${c.pin!.repo}@${c.pin!.ref}`))
    expect([...refs('production.vllm.')]).toEqual(['vllm-project/vllm@v0.31.0'])
    expect([...refs('production.sglang.')]).toEqual(['sgl-project/sglang@v0.5.21'])
  })

  /** A claim a learner-facing card or family quotes must carry its source, its words and the day a person checked them. */
  function expectQuoted(id: string) {
    const c = byId[id]
    expect(c, `${id} exists`).toBeDefined()
    expect(c.source?.url, `${id} url`).toMatch(/^https:\/\//)
    expect(c.source?.quote?.trim(), `${id} quote`).toBeTruthy()
    expect(c.verifiedAt, `${id} verifiedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }

  test('§8.5: every In-production row has its claims, each quoted from the pinned release', () => {
    const rows = [
      'production.vllm.scheduling-policy',
      'production.sglang.schedule-policy',
      'production.sglang.schedule-conservativeness',
      'production.vllm.watermark',
      'production.vllm.v1-preemption',
      'production.sglang.retract',
      'production.vllm.max-num-seqs',
      'production.sglang.max-running-requests',
      'production.vllm.max-num-batched-tokens',
      'production.sglang.chunked-prefill-size',
    ]
    for (const id of rows) expectQuoted(id)
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  test('§5.3: the constants the goodput, cost, memory and spec families read', () => {
    for (const id of [
      'price.h100.median',
      'price.b200.median',
      'serving.cache.anthropic-read-multiplier',
      'serving.cache.anthropic-opus-5-5-read-multiplier',
      'serving.cache.anthropic-fable-5-1-read-multiplier',
      'serving.sglang-deepseek.output-tps-per-node',
      'serving.sglang-deepseek.input-tps-per-node',
      'serving.sglang-deepseek.gpus-per-node',
      'serving.sglang-deepseek.cost-per-mtok',
      'serving.nvfp4.bits-per-weight',
      'model.deepseek-v3.total-params',
      'model.deepseek-v3.active-params',
      'model.deepseek-r1.total-params',
      'model.deepseek-r1.active-params',
      'hw.h100-sxm.hbm-capacity',
      'hw.dgx-b200.hbm-total',
    ]) {
      expectQuoted(id)
    }
    expect(byId['hw.b200.hbm-capacity'].kind).toBe('derived') // per GPU, from the DGX total above
    // the lessons' "$2 per GPU-hour" is an assumption, so it is a synthetic claim and carries no source
    expect(byId['synthetic.cost.gpu-hourly'].kind).toBe('synthetic')
    expect(byId['synthetic.cost.gpu-hourly'].value).toBe(2)
  })

  test('the throughput and price claims reproduce the lessons\' $0.20 per million output tokens', () => {
    const tps = byId['serving.sglang-deepseek.output-tps-per-node'].value as number
    const gpus = byId['serving.sglang-deepseek.gpus-per-node'].value as number
    const dollars = (byId['synthetic.cost.gpu-hourly'].value as number) * gpus * 24
    const perMtok = dollars / ((tps * 86_400) / 1e6)
    expect(perMtok).toBeCloseTo(byId['serving.sglang-deepseek.cost-per-mtok'].value as number, 2)
  })

  test('NVFP4 is not a flat four bits, and the 671B example lands on 377 GB', () => {
    const bits = byId['serving.nvfp4.bits-per-weight'].value as number
    expect(bits).toBeGreaterThan(4)
    expect(((byId['model.deepseek-v3.total-params'].value as number) * bits) / 8).toBeCloseTo(377.4, 1)
  })

  test('§16.2: the Codespaces billing note\'s free core-hours is a quoted claim', () => {
    expectQuoted('price.codespaces.free-core-hours')
    expect(byId['price.codespaces.free-core-hours'].value).toBe(120)
  })
})

describe('the tokenizer corpus (§10.5)', () => {
  const sha12 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
  const countClaim = (id: string) => byId[`model.qwen3-tokenizer.tokens-${id}`]

  test('has the eight texts of the spec, in order', () => {
    expect(TOKEN_CORPUS_IDS).toEqual(['prose', 'python', 'json', 'numbers', 'url', 'chinese', 'emoji', 'rust'])
    expect(new Set(TOKEN_CORPUS.map((t) => t.text)).size).toBe(8)
    for (const t of TOKEN_CORPUS) expect(t.text.length).toBeGreaterThan(10)
  })

  test('every text has one Qwen3 count claim of kind benchmark, and every count claim has its text', () => {
    for (const t of TOKEN_CORPUS) {
      const c = countClaim(t.id)
      expect(c, `${t.id} has a count claim`).toBeDefined()
      expect(c.kind).toBe('benchmark')
      expect(Number.isInteger(c.value) && (c.value as number) > 0).toBe(true)
    }
    const counted = CLAIMS.filter((c) => c.id.startsWith('model.qwen3-tokenizer.tokens-')).map((c) => c.id.slice('model.qwen3-tokenizer.tokens-'.length))
    expect(counted.sort()).toEqual([...TOKEN_CORPUS_IDS].sort())
  })

  test('each claim records the hash of the text it counted, so editing a text fails here until it is recounted', () => {
    for (const t of TOKEN_CORPUS) {
      expect(countClaim(t.id).boundary, `${t.id} text changed since qwen3-counts.py ran`).toContain(sha12(t.text))
      expect(countClaim(t.id).boundary).toContain(`${t.text.length}-character`)
    }
  })

  test('the counts and the vocabulary size share one tokenizer revision, and the source url is that revision', () => {
    const vocab = byId['model.qwen3-tokenizer.vocab-size']
    expect(vocab.kind).toBe('benchmark')
    expect(vocab.value).toBeGreaterThan(150_000)
    expect(vocab.value).toBeLessThan(152_000)
    expect(vocab.pin?.repo).toBe('Qwen/Qwen3-0.6B')
    expect(vocab.pin?.ref).toMatch(/^[0-9a-f]{40}$/)
    for (const t of TOKEN_CORPUS) expect(countClaim(t.id).pin).toEqual(vocab.pin)
  })

  test('qwen3-counts.py pins the same revision as the claims', async () => {
    const py = await Bun.file('scripts/engine/qwen3-counts.py').text()
    expect(py).toContain(`REVISION = '${byId['model.qwen3-tokenizer.vocab-size'].pin!.ref}'`)
    expect(py).toContain('COUNT_ID = ')
  })

  test('byte-heavy texts cost more tokens per character than prose', () => {
    const perChar = (id: string) => (countClaim(id).value as number) / TOKEN_CORPUS.find((t) => t.id === id)!.text.length
    expect(perChar('numbers')).toBeGreaterThan(perChar('prose'))
    expect(perChar('emoji')).toBeGreaterThan(perChar('prose'))
  })
})
