/**
 * The Attention Zoo's second reader (docs/specs/wave-2.md §11.3): the script stays independent of the app, and its
 * committed fixture is well formed. The fixture itself is re-read from Hugging Face by
 * `bun scripts/zoo/second-reader.ts --check`, which needs the network and so is not part of this suite.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CONTEXTS, deriveModel, parseSource, readConfig, type Fixture } from '../../scripts/zoo/second-reader'

const script = readFileSync('scripts/zoo/second-reader.ts', 'utf8')
const fixture = JSON.parse(readFileSync('tests/fixtures/zoo/second-reader.json', 'utf8')) as Fixture
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))

describe('second reader independence', () => {
  test('imports nothing under src/ and none of the app model files', () => {
    const specifiers = [...script.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const s of specifiers) {
      expect(s.startsWith('node:') || s === 'bun:test' || s.startsWith('./')).toBe(true)
      expect(s).not.toMatch(/(^|\/)src\//)
      expect(s).not.toMatch(/kv-zoo|claims/)
    }
    expect(script).not.toMatch(/['"`][^'"`\n]*(\.\.\/)+src\//)
  })

  test('takes the (repo, revision sha) list it is handed and bakes none in', () => {
    expect(parseSource('a/b@' + 'f'.repeat(40))).toEqual({ repo: 'a/b', revision: 'f'.repeat(40) })
    expect(() => parseSource('a/b@main')).toThrow('40-character')
    expect(() => parseSource('a/b')).toThrow('40-character')
    expect(script).not.toMatch(/[0-9a-f]{40}/)
  })
})

describe('second reader fixture', () => {
  test('lists every config at a full revision sha with its sha256', () => {
    expect(fixture.contexts).toEqual([...CONTEXTS])
    expect(fixture.contexts).toEqual([1024, 32768, 131072, 1048576])
    expect(fixture.models.length).toBe(7)
    for (const m of fixture.models) {
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(m.configSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(m.configUrl).toBe(`https://huggingface.co/${m.repo}/raw/${m.revision}/config.json`)
      expect(Object.keys(m.contexts)).toEqual(fixture.contexts.map(String))
    }
  })

  test('its curves are consistent with its own slopes and read at most the stored bytes plus the indexer', () => {
    for (const m of fixture.models) {
      const at = fixture.contexts.map((t) => m.contexts[String(t)])
      for (let i = 0; i < at.length; i++) {
        const c = at[i]
        expect(c.readTotal).toBe(c.readMain + c.readIndexer)
        expect(c.readMain).toBeLessThanOrEqual(c.stored)
        expect(c.stored).toBe(Object.values(c.byKind).reduce((s, k) => s + k.stored, 0))
        if (i > 0) expect(c.stored).toBeGreaterThan(at[i - 1].stored)
      }
      const last = fixture.contexts[fixture.contexts.length - 1]
      expect(at[at.length - 1].stored).toBe(m.bytesPerToken * last + m.constantBytes)
    }
  })

  test('Llama-3-70B is the 327,680 B/token baseline', () => {
    const llama = fixture.models.find((m) => m.repo.endsWith('Meta-Llama-3-70B'))
    expect(llama?.bytesPerToken).toBe(327680)
    expect(llama?.contexts['1024'].stored).toBe(327680 * 1024)
  })
})

describe('second reader arithmetic', () => {
  test('a GQA config reproduces 2 * layers * kvHeads * headDim * b', () => {
    const cfg = { model_type: 'llama', hidden_size: 8192, num_attention_heads: 64, num_hidden_layers: 80, num_key_value_heads: 8, torch_dtype: 'bfloat16' }
    const m = deriveModel({ repo: 'a/b', revision: 'a'.repeat(40) }, enc(cfg))
    expect(m.bytesPerToken).toBe(2 * 80 * 8 * 128 * 2)
    expect(m.contexts['131072'].readMain).toBe(m.contexts['131072'].stored)
  })

  test('an unknown model type is a named error, not a guess', () => {
    expect(() => readConfig({ model_type: 'mamba7', torch_dtype: 'bfloat16' })).toThrow('model type the second reader cannot read yet: mamba7')
  })

  test('a DeepSeek-V4 config with a compress ratio it does not know is refused', () => {
    const cfg = {
      model_type: 'deepseek_v4', torch_dtype: 'bfloat16', num_hidden_layers: 2, compress_ratios: [4, 16, 0], head_dim: 512,
      num_key_value_heads: 1, sliding_window: 128, index_topk: 1024, index_head_dim: 128,
    }
    expect(() => readConfig(cfg)).toThrow('compress ratio')
  })
})
