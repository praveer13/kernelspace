/**
 * The codec's shared bounds live in one place (docs/specs/wave-3.md D35, D48): `MAX_QID_LENGTH`, `MAX_PROVE_IDS`,
 * `MAX_PROVE_CALLS`, `MAX_ACT_RUNS` and `RUBRIC_KEYS` are declared in src/lib/ledger/constants.ts and nowhere else, and the
 * files that once held copies (the codec, the façade, the rubric's exemplars, the donation and the partner report) read
 * them from there. The façade still never loads the codec for them.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { MAX_ACT_RUNS, MAX_PROVE_CALLS, MAX_PROVE_IDS, MAX_QID_LENGTH, RUBRIC_KEYS } from '../../src/lib/ledger/constants'

const ROOT = path.resolve(import.meta.dir, '../..')
const SHARED = ['MAX_QID_LENGTH', 'MAX_PROVE_IDS', 'MAX_PROVE_CALLS', 'MAX_ACT_RUNS', 'RUBRIC_KEYS']
const HOME = 'src/lib/ledger/constants.ts'

/** Every .ts and .tsx file under `dir`, repo-relative. */
function sources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return sources(rel)
    return /\.tsx?$/.test(e.name) ? [rel] : []
  })
}
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

describe('the codec’s shared bounds (D35, D48)', () => {
  test('the values are the codec’s rules of wave-3.md §3.2', () => {
    expect(MAX_QID_LENGTH).toBe(40)
    expect(MAX_PROVE_IDS).toBe(12)
    expect(MAX_PROVE_CALLS).toBe(12)
    expect(MAX_ACT_RUNS).toBe(20)
    expect([...RUBRIC_KEYS]).toEqual(['capacity', 'slo', 'cost', 'failure'])
  })

  test('no file but ledger/constants.ts declares one, or spells out the rubric’s keys', () => {
    const declares = new RegExp(`\\b(?:const|let|var)\\s+(${SHARED.join('|')})\\s*[:=]`)
    const spelled = /\[\s*'capacity',\s*'slo',\s*'cost',\s*'failure'\s*\]/
    const copies = sources('src').filter((rel) => rel !== HOME && (declares.test(read(rel)) || spelled.test(read(rel))))
    expect(copies).toEqual([])
    expect(read(HOME)).toMatch(declares)
  })

  test('the files that held copies read them from ledger/constants.ts, and the façade still does not load the codec', () => {
    const readers: Record<string, string[]> = {
      'src/lib/ledger/codec.ts': ['MAX_QID_LENGTH', 'MAX_PROVE_IDS', 'MAX_PROVE_CALLS', 'MAX_ACT_RUNS', 'RUBRIC_KEYS'],
      'src/lib/progress.ts': ['MAX_QID_LENGTH', 'MAX_PROVE_IDS', 'MAX_PROVE_CALLS', 'MAX_ACT_RUNS', 'RUBRIC_KEYS'],
      'src/data/fleetweek/exemplars.ts': ['RUBRIC_KEYS'],
      'src/lib/learner/redact.ts': ['MAX_PROVE_CALLS', 'RUBRIC_KEYS'],
      'src/lib/learner/outcomes.ts': ['RUBRIC_KEYS'],
    }
    for (const [rel, names] of Object.entries(readers)) {
      const imports = [...read(rel).matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].filter(([, , from]) => /(?:ledger\/constants|^\.\/constants)$/.test(from))
      const named = imports.flatMap(([, list]) => list.split(',').map((x) => x.trim()))
      for (const name of names) expect(named, `${rel} imports ${name}`).toContain(name)
    }
    expect(read('src/lib/progress.ts')).not.toMatch(/from '\.\/ledger\/codec'/)
  })
})
