import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { LESSON_CLAIMS, lessonClaimReads, OUT } from '../../scripts/gen-lesson-claims'

const root = fileURLToPath(new URL('../../', import.meta.url))
function run(...args: string[]) {
  const r = Bun.spawnSync(['bun', 'scripts/gen-lesson-claims.ts', ...args], { cwd: root, env: process.env })
  return { code: r.exitCode, err: r.stderr.toString() }
}

describe('gen-lesson-claims --check runs in the unit suite (K0-E2)', () => {
  test('--check exits 0 on the tree', () => {
    expect(run('--check').code).toBe(0)
  })

  test('--check --out exits 1 with the stale message on a stale copy', () => {
    const dir = mkdtempSync(`${tmpdir()}/ks-lesson-claims-`)
    try {
      const copy = `${dir}/claims.generated.ts`
      const text = readFileSync(OUT, 'utf8')
      const stale = text.replace(/value: (\d+(?:\.\d+)?)/, (_m, v) => `value: ${Number(v) + 1}`)
      expect(stale).not.toBe(text)
      writeFileSync(copy, stale)
      const r = run('--check', '--out', copy)
      expect(r.code).toBe(1)
      expect(r.err).toContain('is stale')
      writeFileSync(copy, text)
      expect(run('--check', '--out', copy).code).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--out without a path fails', () => {
    expect(run('--check', '--out').code).toBe(2)
  })
})

describe('the ids are collected from the readers, not typed', () => {
  test('the computed list is the 14 ids the tip typed, then the ids tasks added', () => {
    expect(new Set(LESSON_CLAIMS)).toEqual(
      new Set([
        'production.vllm.block-size',
        'production.vllm.extensible-kv-cache',
        'production.vllm.gpu-memory-utilization',
        'serving.pagedattention.paper-block-size',
        'serving.pagedattention.fig2-vllm-token-states',
        'synthetic.kv.paged-waste',
        'model.kv.static-utilization-low',
        'model.kv.static-utilization-high',
        'model.llama3-8b.kv-bytes-per-token',
        'serving.pagedattention.throughput-gain-low',
        'serving.pagedattention.throughput-gain-high',
        'serving.pagedattention.ft-request-rate',
        'serving.pagedattention.kernel-overhead-low',
        'serving.pagedattention.kernel-overhead-high',
        'status.rust.polonius',
      ]),
    )
    expect(LESSON_CLAIMS).toEqual([...LESSON_CLAIMS].sort())
  })

  test('the generator types no claim id', () => {
    expect(readFileSync(`${root}scripts/gen-lesson-claims.ts`, 'utf8')).not.toMatch(/'(?:production|serving|synthetic|model)\.[a-z0-9-]+\.[a-z0-9.-]+'/)
  })

  test('the scan reads the lessons and the importers of the reader', () => {
    const { files } = lessonClaimReads()
    expect(files.some((f) => f.includes('/src/data/lessons/'))).toBe(true)
  })
})
