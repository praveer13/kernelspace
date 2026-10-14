/**
 * The Attention Zoo's pure model (wave-2.md §11.1–11.3, task 2b-05): each layer kind's stored and read bytes on
 * hand-checkable numbers, the presets built only from the `zoo.*` claims (and identical to what the config reader
 * makes of those claims' own quoted JSON lines), the reader's named errors, Llama-3-70B's 327,680 B/token, pins
 * for every preset at 1k, 32k, 128k and 1M tokens, and the determinism scope (no Math.pow, no log).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byId, CLAIMS, claimNumber } from '../../src/data/claims'
import {
  DEFAULT_ELEMENT_BYTES,
  ZOO_CONTEXTS,
  ZOO_PRESETS,
  layerBytes,
  layerCount,
  parseConfig,
  zooBytes,
  zooCurves,
  zooPresetById,
  type ZooLayer,
  type ZooModel,
} from '../../src/lib/kv-zoo'

const preset = (id: string): ZooModel => {
  const p = zooPresetById(id)
  if (!p) throw new Error(`no preset ${id}`)
  return p
}

const one = (layer: ZooLayer, count = 1): ZooModel => ({ id: 't', name: 't', groups: [{ count, layer, label: 't' }], note: '', claimIds: [] })

/* ------------------------------------------------------------------ */
/* Per-kind formulas, on small numbers worked by hand                   */
/* ------------------------------------------------------------------ */

describe('layer kinds (§11.1)', () => {
  test('full: 2 · kvHeads · headDim · b · t, read = stored', () => {
    const l: ZooLayer = { kind: 'full', kvHeads: 8, headDim: 128 }
    expect(layerBytes(l, 1)).toEqual({ stored: 4096, read: 4096 })
    expect(layerBytes(l, 1000)).toEqual({ stored: 4_096_000, read: 4_096_000 })
    expect(layerBytes(l, 1000, 1)).toEqual({ stored: 2_048_000, read: 2_048_000 })
  })

  test('mla: (d_c + d_rope) · b · t, one latent per token whatever the head count', () => {
    const l: ZooLayer = { kind: 'mla', latentDim: 512, ropeDim: 64 }
    expect(layerBytes(l, 1)).toEqual({ stored: 1152, read: 1152 })
    expect(layerBytes(l, 10)).toEqual({ stored: 11_520, read: 11_520 })
  })

  test('swa: stops growing at the window plus sinks', () => {
    const l: ZooLayer = { kind: 'swa', kvHeads: 2, headDim: 4, window: 100, sinks: 4 }
    // 2 · 2 · 4 · 2 = 32 bytes a token
    expect(layerBytes(l, 50).stored).toBe(32 * 50)
    expect(layerBytes(l, 104).stored).toBe(32 * 104)
    expect(layerBytes(l, 105).stored).toBe(32 * 104)
    expect(layerBytes(l, 1_000_000)).toEqual({ stored: 32 * 104, read: 32 * 104 })
  })

  test('dsa: stores every token (base + index key), reads top-k of the base plus every index key', () => {
    const l: ZooLayer = { kind: 'dsa', base: { kind: 'mla', latentDim: 10, ropeDim: 2 }, topK: 100, indexKeyDim: 4 }
    // below top-k nothing is skipped: 16 elements a token, read in full
    expect(layerBytes(l, 50, 1)).toEqual({ stored: 16 * 50, read: 16 * 50 })
    // past top-k: stored keeps growing at 16 a token, reads grow only by the 4 index elements a token
    expect(layerBytes(l, 1000, 1)).toEqual({ stored: 16_000, read: 12 * 100 + 4 * 1000 })
    const onFull: ZooLayer = { kind: 'dsa', base: { kind: 'full', kvHeads: 1, headDim: 3 }, topK: 10, indexKeyDim: 0 }
    expect(layerBytes(onFull, 20, 1)).toEqual({ stored: 6 * 20, read: 6 * 10 })
  })

  test('csa: ⌈t / m⌉ entries plus the window; reads top-k entries, the window and every index key', () => {
    const l: ZooLayer = { kind: 'csa', entryDim: 10, ratio: 4, window: 8, topK: 5, indexKeyDim: 2 }
    // t = 3: one partial entry, window holds 3
    expect(layerBytes(l, 3, 1)).toEqual({ stored: 10 * (1 + 3) + 2 * 1, read: 10 * (1 + 3) + 2 * 1 })
    // t = 13: ⌈13/4⌉ = 4 entries (still under top-k), window 8
    expect(layerBytes(l, 13, 1)).toEqual({ stored: 10 * 12 + 2 * 4, read: 10 * 12 + 2 * 4 })
    // t = 100: 25 entries, reads 5 of them
    expect(layerBytes(l, 100, 1)).toEqual({ stored: 10 * (25 + 8) + 2 * 25, read: 10 * (5 + 8) + 2 * 25 })
  })

  test('hca: ⌈t / m′⌉ entries plus the window, all read', () => {
    const l: ZooLayer = { kind: 'hca', entryDim: 10, ratio: 128, window: 8 }
    expect(layerBytes(l, 1, 1)).toEqual({ stored: 10 * 2, read: 10 * 2 })
    expect(layerBytes(l, 128, 1).stored).toBe(10 * (1 + 8))
    expect(layerBytes(l, 129, 1).stored).toBe(10 * (2 + 8))
  })

  test('linear: heads · d_k · d_v · b, the same at 1 token and at 1M', () => {
    const l: ZooLayer = { kind: 'linear', heads: 4, keyDim: 8, valueDim: 16 }
    expect(layerBytes(l, 1)).toEqual({ stored: 1024, read: 1024 })
    expect(layerBytes(l, 1_048_576)).toEqual({ stored: 1024, read: 1024 })
  })

  test('nothing is stored at t = 0, and a context must be a whole number of tokens', () => {
    for (const p of ZOO_PRESETS) expect(zooBytes(p, 0)).toMatchObject({ stored: 0, read: 0 })
    expect(() => layerBytes({ kind: 'full', kvHeads: 1, headDim: 1 }, 1.5)).toThrow(RangeError)
    expect(() => zooBytes(preset('llama3-70b'), -1)).toThrow(RangeError)
  })

  test('a group of n layers is n times one layer, and zooBytes sums the groups', () => {
    const l: ZooLayer = { kind: 'mla', latentDim: 7, ropeDim: 1 }
    expect(zooBytes(one(l, 5), 9).stored).toBe(5 * layerBytes(l, 9).stored)
    for (const p of ZOO_PRESETS) {
      const z = zooBytes(p, 131072)
      expect(z.groups).toHaveLength(p.groups.length)
      expect(z.stored).toBe(z.groups.reduce((n, g) => n + g.stored, 0))
      expect(z.read).toBe(z.groups.reduce((n, g) => n + g.read, 0))
      expect(z.read).toBeLessThanOrEqual(z.stored)
    }
  })

  test('zooCurves gives both curves at the requested contexts', () => {
    const p = preset('deepseek-v3-2')
    const c = zooCurves(p, ZOO_CONTEXTS)
    expect(c.contexts).toEqual([...ZOO_CONTEXTS])
    expect(c.stored).toEqual(ZOO_CONTEXTS.map((t) => zooBytes(p, t).stored))
    expect(c.read).toEqual(ZOO_CONTEXTS.map((t) => zooBytes(p, t).read))
    // FP8 halves both curves exactly
    const fp8 = zooCurves(p, ZOO_CONTEXTS, 1)
    expect(fp8.stored.map((x) => x * 2)).toEqual(c.stored)
    expect(fp8.read.map((x) => x * 2)).toEqual(c.read)
    expect(DEFAULT_ELEMENT_BYTES).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

describe('presets from claims (§11.2)', () => {
  test('the seven presets of §11.2, in order', () => {
    expect(ZOO_PRESETS.map((p) => p.id)).toEqual([
      'llama3-70b',
      'deepseek-v3',
      'gpt-oss-120b',
      'qwen3-5-397b',
      'kimi-linear',
      'deepseek-v3-2',
      'deepseek-v4-pro',
    ])
    expect(ZOO_PRESETS.map((p) => p.groups.map((g) => g.layer.kind))).toEqual([
      ['full'],
      ['mla'],
      ['swa', 'full'],
      ['linear', 'full'],
      ['linear', 'mla'],
      ['dsa'],
      ['hca', 'csa'],
    ])
  })

  test('every number comes from a zoo.* claim of that model, and every config claim is pinned', () => {
    for (const p of ZOO_PRESETS) {
      expect(p.claimIds.length).toBeGreaterThan(0)
      for (const id of p.claimIds) {
        const c = byId[id]
        expect(c, id).toBeDefined()
        expect(id.startsWith(`zoo.${p.id}.`)).toBe(true)
        if (c.kind === 'spec' && c.source?.url.includes('huggingface.co')) {
          expect(c.pin, id).toBeDefined()
          expect(c.source.url).toContain(c.pin!.ref)
        }
      }
      // the layer counts are the config's num_hidden_layers
      expect(layerCount(p)).toBe(claimNumber(`zoo.${p.id}.layers`))
    }
  })

  test('Llama-3-70B reproduces 327,680 B/token, the t5.l4 baseline', () => {
    const llama = preset('llama3-70b')
    expect(zooBytes(llama, 1)).toMatchObject({ stored: 327_680, read: 327_680 })
    expect(zooBytes(llama, 1).stored).toBe(claimNumber('zoo.llama3-70b.kv-bytes-per-token'))
    for (const t of ZOO_CONTEXTS) expect(zooBytes(llama, t).stored).toBe(327_680 * t)
  })

  // Hand arithmetic at b = 2 (BF16), per token or per layer as noted:
  //   llama3-70b      80 full · 2·8·128·2 = 327,680 B/token
  //   deepseek-v3     61 mla · (512+64)·2 = 70,272 B/token
  //   gpt-oss-120b    18 swa · 2·8·64·2·128 = 4,718,592 B flat; 18 full · 2,048 = 36,864 B/token
  //   qwen3-5-397b    45 linear · 64·128·128·4 = 188,743,680 B flat (state is float32: mamba_ssm_dtype); 15 full · 2·2·256·2 = 30,720 B/token
  //   kimi-linear     20 linear · 32·128·128·2 = 20,971,520 B flat; 7 mla · 1,152 = 8,064 B/token
  //   deepseek-v3-2   61 dsa: stored (576+128)·2·61 = 85,888 B/token; read 576·2·61·min(t, 2048) + 128·2·61·t
  //   deepseek-v4-pro 31 hca: 512·(⌈t/128⌉ + 128) elements;
  //                   30 csa: 512·(⌈t/4⌉ + 128) + 128·⌈t/4⌉ elements, reads min(⌈t/4⌉, 1024) entries
  const PINS: Record<string, readonly (readonly [number, number])[]> = {
    'llama3-70b': [
      [335_544_320, 335_544_320],
      [10_737_418_240, 10_737_418_240],
      [42_949_672_960, 42_949_672_960],
      [343_597_383_680, 343_597_383_680],
    ],
    'deepseek-v3': [
      [71_958_528, 71_958_528],
      [2_302_672_896, 2_302_672_896],
      [9_210_691_584, 9_210_691_584],
      [73_685_532_672, 73_685_532_672],
    ],
    'gpt-oss-120b': [
      [42_467_328, 42_467_328],
      [1_212_678_144, 1_212_678_144],
      [4_836_556_800, 4_836_556_800],
      [38_659_424_256, 38_659_424_256],
    ],
    'qwen3-5-397b': [
      [220_200_960, 220_200_960],
      [1_195_376_640, 1_195_376_640],
      [4_215_275_520, 4_215_275_520],
      [32_400_998_400, 32_400_998_400],
    ],
    'kimi-linear': [
      [29_229_056, 29_229_056],
      [285_212_672, 285_212_672],
      [1_077_936_128, 1_077_936_128],
      [8_476_688_384, 8_476_688_384],
    ],
    'deepseek-v3-2': [
      [87_949_312, 87_949_312],
      [2_814_377_984, 655_622_144],
      [11_257_511_936, 2_190_737_408],
      [90_060_095_488, 16_518_479_872],
    ],
    'deepseek-v4-pro': [
      [18_079_744, 18_079_744],
      [330_694_656, 110_493_696],
      [1_298_792_448, 323_616_768],
      [10_334_371_840, 2_312_765_440],
    ],
  }

  test('pins: stored and read bytes for every preset at 1k, 32k, 128k and 1M tokens', () => {
    expect(ZOO_CONTEXTS).toEqual([1024, 32768, 131072, 1048576])
    expect(Object.keys(PINS)).toEqual(ZOO_PRESETS.map((p) => p.id))
    for (const p of ZOO_PRESETS) {
      const got = ZOO_CONTEXTS.map((t) => {
        const z = zooBytes(p, t)
        return [z.stored, z.read]
      })
      expect(got, p.id).toEqual(PINS[p.id].map((r) => [...r]))
    }
  })

  test('the shapes the zoo tasks lean on', () => {
    const t128k = 131072
    // MLA: Llama-3-70B ÷ DeepSeek-V3 bytes per token = 327,680 / 70,272
    expect(zooBytes(preset('llama3-70b'), 1).stored * 549).toBe(zooBytes(preset('deepseek-v3'), 1).stored * 2560)
    // gpt-oss's window layers are flat past 128 tokens
    const oss = preset('gpt-oss-120b')
    expect(zooBytes(oss, 128).groups[0].stored).toBe(zooBytes(oss, 1_048_576).groups[0].stored)
    expect(zooBytes(oss, 127).groups[0].stored).toBeLessThan(zooBytes(oss, 128).groups[0].stored)
    // DSA separates capacity from bandwidth: reads ≪ stored at 128k
    const v32 = zooBytes(preset('deepseek-v3-2'), t128k)
    expect(v32.read * 5).toBeLessThan(v32.stored)
    // a linear layer's state at 1M equals its state at 1k
    const kimi = preset('kimi-linear')
    expect(zooBytes(kimi, 1_048_576).groups[0].stored).toBe(zooBytes(kimi, 1024).groups[0].stored)
    // Kimi Linear's MLA layers hold most of its KV at 128k
    const k = zooBytes(kimi, t128k)
    expect(k.groups[1].stored * 100).toBeGreaterThan(k.stored * 98)
  })
})

/* ------------------------------------------------------------------ */
/* The config.json reader                                              */
/* ------------------------------------------------------------------ */

/**
 * A config rebuilt from one model's claims: each quote is the JSON line the value was read from, placed under
 * the parent key its `row` names (`text_config.…`, `linear_attn_config.…`).
 */
function configFromClaims(slug: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const c of CLAIMS) {
    if (!c.id.startsWith(`zoo.${slug}.`) || !c.pin || !c.source?.quote || !c.source.row) continue
    const fragment = JSON.parse(`{${c.source.quote.trim().replace(/,$/, '')}}`) as Record<string, unknown>
    const key = c.source.row.split(' ')[0]
    const dot = key.lastIndexOf('.')
    let target = root
    if (dot > 0) {
      const parent = key.slice(0, dot)
      target = (root[parent] ??= {}) as Record<string, unknown>
    }
    Object.assign(target, fragment)
  }
  return root
}

const parsed = (input: unknown): ZooModel => {
  const r = parseConfig(input)
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`)
  return r.model
}

const layersOf = (m: ZooModel) => m.groups.map((g) => [g.count, g.layer])

describe('parseConfig (§11.2)', () => {
  test("each preset's claims, read back as config.json, give the preset exactly", () => {
    for (const p of ZOO_PRESETS) {
      const cfg = configFromClaims(p.id)
      expect(cfg.num_hidden_layers ?? (cfg.text_config as Record<string, unknown> | undefined)?.num_hidden_layers, p.id).toBeDefined()
      const m = parsed(JSON.stringify(cfg))
      expect(layersOf(m), p.id).toEqual(layersOf(p))
      for (const t of ZOO_CONTEXTS) {
        const a = zooBytes(m, t)
        const b = zooBytes(p, t)
        expect([a.stored, a.read], `${p.id} at ${t}`).toEqual([b.stored, b.read])
      }
    }
  })

  test('a pasted model is named custom and carries no claims', () => {
    const m = parsed({ num_hidden_layers: 2, num_attention_heads: 4, hidden_size: 64 })
    expect(m).toMatchObject({ id: 'custom', name: 'Pasted config', claimIds: [] })
    expect(layersOf(m)).toEqual([[2, { kind: 'full', kvHeads: 4, headDim: 16 }]])
  })

  test('uniform configs: GQA, Mistral-style sliding window, MLA, DSA on full attention', () => {
    const gqa = { num_hidden_layers: 4, num_attention_heads: 8, num_key_value_heads: 2, head_dim: 64 }
    expect(layersOf(parsed(gqa))).toEqual([[4, { kind: 'full', kvHeads: 2, headDim: 64 }]])
    expect(layersOf(parsed({ ...gqa, sliding_window: 4096 }))).toEqual([[4, { kind: 'swa', kvHeads: 2, headDim: 64, window: 4096, sinks: 0 }]])
    expect(layersOf(parsed({ ...gqa, sliding_window: 4096, use_sliding_window: false }))).toEqual([[4, { kind: 'full', kvHeads: 2, headDim: 64 }]])
    expect(layersOf(parsed({ ...gqa, sliding_window: null }))).toEqual([[4, { kind: 'full', kvHeads: 2, headDim: 64 }]])
    expect(layersOf(parsed({ num_hidden_layers: 3, kv_lora_rank: 256, qk_rope_head_dim: 32 }))).toEqual([[3, { kind: 'mla', latentDim: 256, ropeDim: 32 }]])
    expect(layersOf(parsed({ ...gqa, index_topk: 512, index_head_dim: 64 }))).toEqual([
      [4, { kind: 'dsa', base: { kind: 'full', kvHeads: 2, headDim: 64 }, topK: 512, indexKeyDim: 64 }],
    ])
  })

  test('a multimodal config is read from text_config', () => {
    const m = parsed({ vision_config: { depth: 27 }, text_config: { num_hidden_layers: 2, num_attention_heads: 2, head_dim: 8 } })
    expect(layersOf(m)).toEqual([[2, { kind: 'full', kvHeads: 2, headDim: 8 }]])
  })

  test('an unknown layer type is a named error', () => {
    const r = parseConfig({ num_hidden_layers: 2, num_attention_heads: 2, head_dim: 8, layer_types: ['full_attention', 'mamba'] })
    expect(r).toEqual({
      ok: false,
      error: { kind: 'unknown-layer-type', field: 'mamba', message: 'this config has a layer type the zoo cannot read yet: mamba' },
    })
    const chunked = parseConfig({ num_hidden_layers: 1, num_attention_heads: 2, head_dim: 8, layer_types: ['chunked_attention'] })
    expect(!chunked.ok && chunked.error.message).toBe('this config has a layer type the zoo cannot read yet: chunked_attention')
    for (const [cfg, named] of [
      [{ num_hidden_layers: 2, model_type: 'mamba', hidden_size: 8, num_attention_heads: 1 }, 'mamba'],
      [{ num_hidden_layers: 2, hidden_size: 8, num_attention_heads: 1, hybrid_override_pattern: 'M*' }, 'hybrid_override_pattern'],
      [{ num_hidden_layers: 2, num_key_value_heads: 1, head_dim: 8, sliding_window: 4, compress_ratios: [4, 0] }, 'compress ratio 0'],
      [{ num_hidden_layers: 2, num_attention_heads: 2, head_dim: 8, sliding_window: 4, cache_implementation: 'hybrid' }, 'a hybrid cache'],
      [{ text_config: { num_hidden_layers: 2, num_attention_heads: 2, head_dim: 8, attention_chunk_size: 8192 } }, 'attention_chunk_size'],
      [
        { num_hidden_layers: 3, num_key_value_heads: 1, head_dim: 8, sliding_window: 4, index_topk: 2, index_head_dim: 2, compress_ratios: [4, 16, 64] },
        'a third compress ratio',
      ],
    ] as const) {
      const e = parseConfig(cfg)
      expect(e.ok ? 'ok' : e.error.kind, named).toBe('unknown-layer-type')
      if (!e.ok) expect(e.error.message).toContain(`the zoo cannot read yet: ${named}`)
    }
  })

  test('compress_ratios: two ratios with an indexer are CSA and HCA; MTP entries past the layer count are dropped', () => {
    const cfg = { num_hidden_layers: 3, num_key_value_heads: 1, head_dim: 8, sliding_window: 4, index_topk: 2, index_head_dim: 2, compress_ratios: [16, 4, 16, 0] }
    expect(layersOf(parsed(cfg))).toEqual([
      [2, { kind: 'hca', entryDim: 8, ratio: 16, window: 4 }],
      [1, { kind: 'csa', entryDim: 8, ratio: 4, window: 4, topK: 2, indexKeyDim: 2 }],
    ])
  })

  test('named errors for input that is not a usable config', () => {
    const kind = (input: unknown) => {
      const r = parseConfig(input)
      return r.ok ? 'ok' : r.error.kind
    }
    expect(kind('{ "num_hidden_layers": ')).toBe('not-json')
    expect(kind('[1, 2]')).toBe('not-object')
    expect(kind(null)).toBe('not-object')
    expect(kind({ num_attention_heads: 2, head_dim: 8 })).toBe('missing-field')
    expect(kind({ num_hidden_layers: 2, num_attention_heads: 2 })).toBe('missing-field')
    // two compress ratios need the indexer that makes the smaller one CSA
    expect(kind({ num_hidden_layers: 2, num_key_value_heads: 1, head_dim: 8, sliding_window: 4, compress_ratios: [4, 16] })).toBe('missing-field')
    expect(kind({ num_hidden_layers: 0, num_attention_heads: 2, head_dim: 8 })).toBe('bad-field')
    expect(kind({ num_hidden_layers: 2, num_attention_heads: 3, hidden_size: 8 })).toBe('bad-field')
    expect(kind({ num_hidden_layers: '2', num_attention_heads: 2, head_dim: 8 })).toBe('bad-field')
    expect(kind({ num_hidden_layers: 3, num_attention_heads: 2, head_dim: 8, layer_types: ['full_attention'] })).toBe('layer-count')
    const missing = parseConfig({ text_config: { num_hidden_layers: 2, layer_types: ['linear_attention', 'linear_attention'] } })
    expect(missing).toMatchObject({ ok: false, error: { kind: 'missing-field', field: 'text_config.linear_num_value_heads' } })
  })
})

/* ------------------------------------------------------------------ */
/* Determinism scope                                                   */
/* ------------------------------------------------------------------ */

test('kv-zoo.ts uses products and sums only: no Math.pow, exp, log or **', () => {
  const src = readFileSync(join(import.meta.dir, '../../src/lib/kv-zoo.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  expect(code).not.toMatch(/Math\.(pow|exp|log|log2|log10|sin|cos|tan|atan2|cbrt|hypot)\b/)
  expect(code).not.toMatch(/\*\*/)
  expect(code).not.toMatch(/Math\.random|Date\.now|new Date\(/)
})
