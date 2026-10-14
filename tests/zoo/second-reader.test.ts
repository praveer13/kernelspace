/**
 * The Attention Zoo's second reader (docs/specs/wave-2.md §11.3): the script stays independent of the app, its
 * committed fixture is well formed, and each family's reader (GQA, MLA and DSA, gpt-oss, Qwen, Kimi, DeepSeek-V4)
 * is checked offline against hand arithmetic on small configs. The fixture itself is re-read from Hugging Face by
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
        // indexer keys are stored (the convention both readers share), so a step never reads more than is held
        expect(c.readTotal).toBeLessThanOrEqual(c.stored)
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

  const SRC = { repo: 'a/b', revision: 'a'.repeat(40) }
  const model = (cfg: unknown) => deriveModel(SRC, enc(cfg))

  test('MLA stores (kv_lora_rank + qk_rope_head_dim) * b per layer per token, and reads all of it', () => {
    const m = model({ model_type: 'deepseek_v3', torch_dtype: 'bfloat16', num_hidden_layers: 4, kv_lora_rank: 512, qk_rope_head_dim: 64 })
    expect(m.bytesPerToken).toBe(4 * (512 + 64) * 2) // 4,608
    expect(m.constantBytes).toBe(0)
    expect(m.contexts['1024']).toMatchObject({ stored: 4_718_592, readMain: 4_718_592, readIndexer: 0, readTotal: 4_718_592 })
  })

  test('DSA on MLA stores the indexer keys too, and reads top-k latents plus every key', () => {
    const m = model({ model_type: 'deepseek_v32', torch_dtype: 'bfloat16', num_hidden_layers: 4, kv_lora_rank: 512, qk_rope_head_dim: 64, index_topk: 2048, index_head_dim: 128 })
    expect(m.bytesPerToken).toBe(4 * (512 + 64 + 128) * 2) // 5,632: latent, rope key and indexer key
    // 1k tokens, all under top-k: 4 * 1152 * 1024 latents read, 4 * 256 * 1024 index keys read
    expect(m.contexts['1024']).toMatchObject({ stored: 5_767_168, readMain: 4_718_592, readIndexer: 1_048_576, readTotal: 5_767_168 })
    // 32k: the main attention reads 2,048 latents, the indexer still reads all 32,768 keys
    expect(m.contexts['32768']).toMatchObject({ stored: 184_549_376, readMain: 9_437_184, readIndexer: 33_554_432, readTotal: 42_991_616 })
  })

  test('gpt-oss: window layers stop growing at sliding_window, sinks store no tokens, attention is read as bf16', () => {
    const cfg = {
      model_type: 'gpt_oss', num_hidden_layers: 4, layer_types: ['sliding_attention', 'full_attention', 'sliding_attention', 'full_attention'],
      num_key_value_heads: 8, head_dim: 64, sliding_window: 128,
    }
    const m = model(cfg)
    expect(m.bytesPerElement).toBe(2)
    expect(m.bytesPerToken).toBe(2 * 2 * 8 * 64 * 2) // the two full layers only: 4,096
    expect(m.constantBytes).toBe(2 * 2 * 8 * 64 * 2 * 128) // the two window layers at 128 tokens: 524,288
    expect(m.contexts['1024'].stored).toBe(524_288 + 4_096 * 1024)
    expect(readConfig(cfg).groups.find((g) => g.kind === 'swa')?.stored(64)).toBe(2048 * 64)
    expect(() => model({ ...cfg, layer_types: ['sliding_attention', 'full_attention'] })).toThrow('does not cover')
  })

  test('Qwen3.5: the linear state is priced at mamba_ssm_dtype (float32), the full layers at the config dtype', () => {
    const text = {
      model_type: 'qwen3_5_moe_text', dtype: 'bfloat16', num_hidden_layers: 4, layer_types: ['linear_attention', 'linear_attention', 'linear_attention', 'full_attention'],
      num_key_value_heads: 2, head_dim: 256, linear_num_value_heads: 8, linear_key_head_dim: 16, linear_value_head_dim: 16,
    }
    const f32 = model({ model_type: 'qwen3_5_moe', text_config: { ...text, mamba_ssm_dtype: 'float32' } })
    expect(f32.bytesPerToken).toBe(2 * 2 * 256 * 2) // 2,048: one full layer
    expect(f32.constantBytes).toBe(3 * 8 * 16 * 16 * 4) // three states of 8,192 B: 24,576
    expect(f32.contexts['1024'].stored).toBe(24_576 + 2_048 * 1024)
    expect(f32.contexts['1048576'].readTotal).toBe(f32.contexts['1048576'].stored)
    // with no mamba_ssm_dtype the state follows the config dtype
    const bf16 = model({ model_type: 'qwen3_5_moe', text_config: text })
    expect(bf16.constantBytes).toBe(3 * 8 * 16 * 16 * 2)
    expect(() => model({ model_type: 'qwen3_5_moe', text_config: { ...text, mamba_ssm_dtype: 'float8' } })).toThrow('unknown dtype float8')
  })

  test('Kimi Linear: KDA layers hold a constant num_heads * head_dim^2 state, the full-attention layers are MLA', () => {
    const cfg = {
      model_type: 'kimi_linear', dtype: 'bfloat16', num_hidden_layers: 4, kv_lora_rank: 512, qk_rope_head_dim: 64,
      linear_attn_config: { full_attn_layers: [4], kda_layers: [1, 2, 3], num_heads: 32, head_dim: 128 },
    }
    const m = model(cfg)
    expect(m.bytesPerToken).toBe((512 + 64) * 2) // one MLA layer: 1,152
    expect(m.constantBytes).toBe(3 * 32 * 128 * 128 * 2) // 3,145,728
    expect(m.contexts['1024'].stored).toBe(3_145_728 + 1_152 * 1024)
    expect(() => model({ ...cfg, linear_attn_config: { ...cfg.linear_attn_config, kda_layers: [1, 2, 4] } })).toThrow('partition')
  })

  test('DeepSeek-V4: ratio 4 is CSA with a stored indexer key per entry, ratio 128 is HCA, the MTP slot is not counted', () => {
    const cfg = {
      model_type: 'deepseek_v4', torch_dtype: 'bfloat16', num_hidden_layers: 4, compress_ratios: [128, 4, 128, 128, 0],
      head_dim: 512, num_key_value_heads: 1, sliding_window: 128, index_topk: 1024, index_head_dim: 128,
    }
    const m = model(cfg)
    expect(m.fields).toMatchObject({ csa_layers: 1, hca_layers: 3 })
    // entry = 512 * 1 * 2 = 1,024 B; index key = 128 * 2 = 256 B
    // CSA at 1k: 256 entries -> 1,024 * (256 + 128) + 256 * 256 = 458,752 B; HCA at 1k: 1,024 * (8 + 128) = 139,264 B each
    expect(m.contexts['1024'].byKind.csa.stored).toBe(458_752)
    expect(m.contexts['1024'].byKind.hca.stored).toBe(3 * 139_264)
    expect(m.contexts['1024'].stored).toBe(458_752 + 3 * 139_264)
    // a step reads every entry while there are fewer than index_topk (256 < 1,024), and every index key
    expect(m.contexts['1024']).toMatchObject({ readMain: 1_024 * (256 + 128) + 3 * 139_264, readIndexer: 65_536 })
    // 1M: 262,144 CSA entries, of which the main attention reads 1,024
    expect(m.contexts['1048576'].byKind.csa.stored).toBe(1_024 * (262_144 + 128) + 256 * 262_144)
    expect(m.contexts['1048576'].byKind.csa.readMain).toBe(1_024 * (1_024 + 128))
    expect(m.contexts['1048576'].byKind.csa.readIndexer).toBe(256 * 262_144)
    expect(m.contexts['1048576'].byKind.hca.stored).toBe(3 * 1_024 * (8_192 + 128))
    expect(() => model({ ...cfg, compress_ratios: [128, 4] })).toThrow('shorter than num_hidden_layers')
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
