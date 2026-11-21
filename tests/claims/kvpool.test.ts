/** K0-D2: the paper's 16-token block as its own claim, and the two claims for where vLLM's KV pool size comes from. */
import { describe, expect, test } from 'bun:test'
import { getClaim } from '../../src/data/claims'
import { VLLM_PIN } from '../../src/data/claims/engines'
import { KVPOOL_CLAIMS } from '../../src/data/claims/lazy/kvpool'

describe('lazy/kvpool', () => {
  test('the paper claim is 16, a spec, unpinned, and cites an arXiv version', () => {
    const c = getClaim('serving.pagedattention.paper-block-size')
    expect(c.value).toBe(16)
    expect(c.kind).toBe('spec')
    expect(c.pin).toBeUndefined()
    expect(c.source?.url).toMatch(/arxiv\.org\/abs\/2309\.06180v\d+$/)
    expect(c.source?.quote).toContain('default block size as 16')
  })

  test.each(['production.vllm.extensible-kv-cache', 'production.vllm.gpu-memory-utilization'])('%s is pinned to VLLM_PIN and its url names the tag', (id) => {
    const c = getClaim(id)
    expect(c.kind).toBe('status')
    expect(c.pin).toEqual(VLLM_PIN)
    expect(c.ttlDays).toBe(60)
    expect(c.source?.url).toContain(`/${VLLM_PIN.ref}/vllm/config/cache.py`)
  })

  test('the group holds exactly these three claims', () => {
    expect(KVPOOL_CLAIMS.map((c) => c.id)).toEqual([
      'serving.pagedattention.paper-block-size',
      'production.vllm.extensible-kv-cache',
      'production.vllm.gpu-memory-utilization',
    ])
  })
})
