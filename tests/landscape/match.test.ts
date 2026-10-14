/**
 * The watcher backtest harness (docs/specs/wave-2.md §18, task 2a-20): the watchlist and window, the pure matcher on
 * fixtures (llm-d's fs-connector deprecation and Dynamo's KVBM deprecation among them), the scorer and its refusal
 * of ratings that list matcher output, and the committed snapshot and candidates files.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inWindow, pastWindow, pickReleases, windowBounds, type ApiRelease, type Snapshot } from '../../scripts/landscape/fetch'
import {
  CANDIDATE_FIELDS,
  DOSSIER_TAGS,
  buildIndex,
  cleanLine,
  headOf,
  keywordHits,
  lineKey,
  matchLine,
  matchSnapshot,
  normalize,
  novelLines,
  releaseLines,
  type Candidate,
  type Corpus,
} from '../../scripts/landscape/match'
import { KEEP_BAR, checkRatings, isSigned, judge, score, wilson, type Ratings } from '../../scripts/landscape/score'
import { WATCHLIST, WATCH_REPO_COUNT, WATCH_WINDOW, watchRepo } from '../../scripts/landscape/watchlist'

/** The two lines the planning backtest was built around, verbatim from the committed snapshot. */
const FS_CONNECTOR =
  '`llm-d/llm-d-kv-cache/llmd-fs-connector` has been integrated upstream into vLLM under the `OffloadingConnector` and is thus DEPRECATED. This has the major benefit of existing in tree and out of the box with the container image - no independent installation required.'
const KVBM =
  '- **KVBM (KV Block Manager) is deprecated in v1.5.0 and removal is targeted for v1.6.0; the `kvbm` wheel and the vLLM KVBM launch and deploy examples ship unchanged for this release**.'

const corpus: Corpus = {
  lessons: [
    { id: 't5.l6', title: 'Prefix Caching', h2s: ['Automatic Prefix Caching: the block-hash design', 'Summary'], text: 'Prefix Caching. vLLM hashes blocks; see production.vllm.block-size and LMCache.' },
    { id: 't6.l3', title: 'E/P/D', h2s: ['Summary'], text: 'llm-d moved code upstream. KVBM is deprecated. NIXL moves the bytes.' },
    { id: 't5.l9', title: 'Tiers', h2s: ['Summary'], text: 'llm-d and Dynamo tier KV. KVBM was GA plumbing.' },
    { id: 't2.l4', title: 'Scheduling', h2s: ['Summary'], text: 'Round robin and a burn of the CPU.' },
  ],
  claims: [
    { id: 'production.vllm.block-size', repo: 'vllm-project/vllm' },
    { id: 'production.vllm.scheduling-policy', repo: 'vllm-project/vllm' },
    { id: 'hw.h100-sxm.hbm-capacity' },
  ],
  kcs: [{ id: 't5.paged-attention', title: 'Paged attention block table', lessons: ['t5.l6'], claims: [] }],
}
const index = buildIndex(corpus)

function novel(repo: string, text: string, tag = 'v1', n = 1) {
  return { repo, tag, releaseUrl: `https://example.test/${repo}/${tag}`, n, text: cleanLine(text), key: lineKey(repo, text), seen: 1 }
}

describe('watchlist and window', () => {
  test('twenty distinct repos, Dynamo included, each with an owner/name', () => {
    expect(WATCHLIST.length).toBe(WATCH_REPO_COUNT)
    expect(new Set(WATCHLIST.map((w) => w.repo.toLowerCase())).size).toBe(20)
    expect(new Set(WATCHLIST.map((w) => w.id)).size).toBe(20)
    expect(watchRepo('AI-Dynamo/Dynamo')?.id).toBe('dynamo')
    for (const w of WATCHLIST) expect(w.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
  })

  test('the dossier names exactly these twenty', () => {
    const dossier = ['vllm', 'sglang', 'dynamo', 'llm-d', 'TensorRT-LLM', 'flashinfer', 'flash-attention', 'DeepEP', 'DeepGEMM', 'Mooncake', 'LMCache', 'verl', 'slime', 'AReaL', 'mistral.rs', 'candle', 'burn', 'cudarc', 'InferenceX', 'gateway-api-inference-extension']
    expect(WATCHLIST.map((w) => w.id)).toEqual(dossier)
  })

  test('the window is at least 8 weeks and holds the KVBM deprecation', () => {
    const { start, end } = windowBounds(WATCH_WINDOW)
    expect((end - start) / 86_400_000).toBeGreaterThanOrEqual(56)
    expect(inWindow('2026-09-21T10:00:00Z', WATCH_WINDOW)).toBe(true)
    expect(inWindow('2026-09-30T23:59:59Z', WATCH_WINDOW)).toBe(true)
    expect(inWindow('2026-10-01T00:00:00Z', WATCH_WINDOW)).toBe(false)
    expect(inWindow('2026-07-31T23:59:59Z', WATCH_WINDOW)).toBe(false)
  })
})

describe('fetch helpers', () => {
  const api = (tag: string, published: string, extra: Partial<ApiRelease> = {}): ApiRelease => ({
    tag_name: tag,
    name: tag,
    body: 'a\r\nb',
    html_url: `https://example.test/${tag}`,
    draft: false,
    prerelease: false,
    created_at: published,
    published_at: published,
    ...extra,
  })

  test('pickReleases keeps published releases in the window, newest first, with line endings normalized', () => {
    const page = [api('v3', '2026-10-02T00:00:00Z'), api('v2', '2026-09-01T00:00:00Z'), api('d', '2026-09-02T00:00:00Z', { draft: true, published_at: null }), api('v1', '2026-08-01T00:00:00Z'), api('v0', '2026-07-31T12:00:00Z')]
    const picked = pickReleases(page, WATCH_WINDOW)
    expect(picked.map((r) => r.tag)).toEqual(['v2', 'v1'])
    expect(picked[0].body).toBe('a\nb')
  })

  test('paging stops only once a whole page is older than the window and its margin', () => {
    expect(pastWindow([], WATCH_WINDOW)).toBe(true)
    expect(pastWindow([api('x', '2026-06-01T00:00:00Z')], WATCH_WINDOW)).toBe(true)
    expect(pastWindow([api('x', '2026-07-20T00:00:00Z')], WATCH_WINDOW)).toBe(false)
    expect(pastWindow([api('a', '2026-08-20T00:00:00Z'), api('b', '2026-06-01T00:00:00Z')], WATCH_WINDOW)).toBe(false)
  })
})

describe('lines and keywords', () => {
  test('the dossier rule: deprecated, removed, default, renamed, GA', () => {
    expect(keywordHits('Deprecated the old flag')).toEqual(['Deprecated'])
    expect(keywordHits('KVBM is DEPRECATED; removal in v1.6')).toEqual(['DEPRECATED', 'removal'])
    expect(keywordHits('now defaults to FP8')).toEqual(['defaults'])
    expect(keywordHits('WVA renamed llm-d-autoscaling')).toEqual(['renamed'])
    expect(keywordHits('Disaggregated serving is GA')).toEqual(['GA'])
  })

  test('GA is a word and an upper-case one; other words must start the word', () => {
    expect(keywordHits('a gateway for the saga of vegas')).toEqual([])
    expect(keywordHits('ga is not GAme')).toEqual([])
    expect(keywordHits('undefaulted and nonremoved')).toEqual([])
  })

  test('cleanLine strips list, quote and heading markers; releaseLines skips rules, tables dividers and changelog links', () => {
    expect(cleanLine('  - **Bold:** text  here ')).toBe('**Bold:** text here')
    expect(cleanLine('### Deprecations')).toBe('Deprecations')
    expect(cleanLine('  > **Migrate:** use it')).toBe('**Migrate:** use it')
    const lines = releaseLines({ name: 'v1.5.0 release', body: '# Title line\n\n---\n|---|---|\n- **Full Changelog**: x\nFull Changelog: https://example.test\n- Removed the thing in 1.5\n' })
    expect(lines).toEqual([
      { n: 0, text: 'v1.5.0 release' },
      { n: 1, text: 'Title line' },
      { n: 7, text: 'Removed the thing in 1.5' },
    ])
  })

  test('normalize reads llmd-fs-connector and LLMD fs_connector alike; headOf takes the head of a heading', () => {
    expect(normalize('llmd-fs-connector')).toBe('llmd fs connector')
    expect(normalize('`OffloadingConnector`')).toBe('offloadingconnector')
    expect(headOf('Automatic Prefix Caching: the block-hash design')).toBe('Automatic Prefix Caching')
    expect(headOf('Paged attention (the long version)')).toBe('Paged attention')
  })
})

describe('the term index', () => {
  const byLabel = (needle: string) => index.terms.find((t) => t.label.includes(needle))

  test('KC titles, H2 heads, claim ids and the dossier tags become terms with their lessons and claims', () => {
    expect(byLabel('kc:Paged attention block table')?.lessons).toEqual(['t5.l6'])
    expect(byLabel('h2:Automatic Prefix Caching')?.lessons).toEqual(['t5.l6'])
    const claim = byLabel('claim:block size')
    expect(claim?.claims).toEqual(['production.vllm.block-size'])
    expect(claim?.lessons).toEqual(['t5.l6'])
    expect(claim?.repos).toEqual(['vllm-project/vllm'])
    expect(byLabel('tag:KVBM')?.lessons).toEqual(['t5.l9', 't6.l3'])
    expect(byLabel('tag:NIXL')?.lessons).toEqual(['t6.l3'])
    expect(DOSSIER_TAGS).toEqual(['KVBM', 'InferenceMAX', 'NIXL'])
  })

  test('a generic heading and a tag no lesson names add no term', () => {
    expect(byLabel('h2:Summary')).toBeUndefined()
    expect(byLabel('tag:InferenceMAX')).toBeUndefined()
  })

  test('repo anchors are the lessons that name the project, with case rules for short names', () => {
    expect(index.anchors['llm-d/llm-d']).toEqual(['t5.l9', 't6.l3'])
    expect(index.anchors['vllm-project/vllm']).toEqual(['t5.l6'])
    // "burn of the CPU" is English, and no lesson names slime
    expect(index.anchors['thudm/slime']).toEqual([])
    expect(index.anchors['tracel-ai/burn']).toEqual([])
    expect(index.repoClaims['vllm-project/vllm']).toEqual(['production.vllm.block-size', 'production.vllm.scheduling-policy'])
  })
})

describe('matchLine', () => {
  test("flags llm-d's fs-connector deprecation, which no dossier tag maps, through the repo anchor", () => {
    const line = novel('llm-d/llm-d', FS_CONNECTOR, 'v0.10.0', 33)
    // the dossier's tags alone do not know the line
    const tagsOnly = index.terms.filter((t) => t.source === 'tag')
    expect(tagsOnly.some((t) => ` ${normalize(line.text)} `.includes(` ${t.phrase} `))).toBe(false)
    const c = matchLine(line, index)
    expect(c).not.toBeNull()
    expect(c?.via).toBe('repo')
    expect(c?.lessons).toEqual(['t5.l9', 't6.l3'])
    expect(c?.keywords).toEqual(['DEPRECATED'])
    expect(c?.id).toBe('llm-d/llm-d@v0.10.0#33')
  })

  test("flags Dynamo's KVBM deprecation through the dossier tag, with every lesson that names KVBM", () => {
    const c = matchLine(novel('ai-dynamo/dynamo', KVBM, 'v1.5.0', 151), index)
    expect(c?.via).toBe('term')
    expect(c?.terms).toEqual(['tag:KVBM'])
    expect(c?.lessons).toEqual(['t5.l9', 't6.l3'])
  })

  test('a claim term is scoped to its repo and names the claim', () => {
    const line = 'The default block size is now 32 tokens'
    const vllm = matchLine(novel('vllm-project/vllm', line), index)
    expect(vllm?.via).toBe('term')
    expect(vllm?.claims).toEqual(['production.vllm.block-size'])
    // the same words in another repo's notes do not touch a vLLM claim
    const sglang = matchLine(novel('sgl-project/sglang', line), index)
    expect(sglang).toBeNull()
  })

  test('a repo anchor carries the claims about the repo', () => {
    const c = matchLine(novel('vllm-project/vllm', 'Removed the legacy engine'), index)
    expect(c?.via).toBe('repo')
    expect(c?.claims).toEqual(['production.vllm.block-size', 'production.vllm.scheduling-policy'])
  })

  test('no keyword, no flag, however well the line maps', () => {
    expect(matchLine(novel('ai-dynamo/dynamo', 'KVBM gains a faster pool allocator'), index)).toBeNull()
  })

  test('a keyword with nothing to map to is not flagged (no tag, and no lesson names the repo)', () => {
    expect(matchLine(novel('huggingface/candle', 'Removed the unused flag'), index)).toBeNull()
    expect(matchLine(novel('THUDM/slime', 'Deprecated the old trainer'), index)).toBeNull()
  })

  test('lines from a repo off the watchlist are not flagged by anchor', () => {
    expect(matchLine(novel('someone/else', 'Removed the old API'), index)).toBeNull()
  })
})

describe('matchSnapshot and novelLines', () => {
  const rel = (tag: string, publishedAt: string, body: string) => ({ tag, name: '', publishedAt, url: `https://example.test/${tag}`, prerelease: false, body })
  const snapshot = {
    repos: [
      {
        id: 'llm-d',
        repo: 'llm-d/llm-d',
        complete: true,
        releases: [
          rel('v2-rc2', '2026-09-03T00:00:00Z', '- Removed the CUDA image\n- Fixed a typo in the docs'),
          rel('v2-rc1', '2026-09-02T00:00:00Z', '- Removed the CUDA image\n- Fixed a typo in the docs'),
          rel('v1', '2026-09-01T00:00:00Z', '- Deprecated the fs-connector'),
        ],
      },
    ],
  }

  test('a line repeated in later releases is read once, at its first appearance', () => {
    const lines = novelLines(snapshot)
    expect(lines.map((l) => [l.tag, l.text, l.seen])).toEqual([
      ['v1', 'Deprecated the fs-connector', 1],
      ['v2-rc1', 'Removed the CUDA image', 2],
      ['v2-rc1', 'Fixed a typo in the docs', 2],
    ])
  })

  test('candidates come out in snapshot order and the matcher neither mutates nor depends on anything else', () => {
    const before = JSON.stringify(snapshot)
    const a = matchSnapshot(snapshot, index)
    const b = matchSnapshot(JSON.parse(before), index)
    expect(JSON.stringify(snapshot)).toBe(before)
    expect(a).toEqual(b)
    expect(a.map((c) => c.id)).toEqual(['llm-d/llm-d@v1#1', 'llm-d/llm-d@v2-rc1#1'])
    expect(a.every((c) => c.lessons.length > 0)).toBe(true)
  })

  test('every candidate has exactly the fields CANDIDATE_FIELDS and the rest of the schema name', () => {
    const [c] = matchSnapshot(snapshot, index)
    for (const f of CANDIDATE_FIELDS) expect(c).toHaveProperty(f)
  })
})

describe('score', () => {
  const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((t, i) => novel(i < 4 ? 'llm-d/llm-d' : 'ai-dynamo/dynamo', `Removed thing ${t} entirely`, 'v1', i + 1))
  const cand = (i: number, via: 'term' | 'repo' = 'repo', lessons: string[] = ['t6.l3']): Candidate => ({
    id: `${lines[i].repo}@v1#${i + 1}`,
    repo: lines[i].repo,
    tag: 'v1',
    releaseUrl: lines[i].releaseUrl,
    n: i + 1,
    line: lines[i].text,
    key: lines[i].key,
    keywords: ['Removed'],
    via,
    terms: [],
    lessons,
    claims: [],
  })
  const rating = (i: number, shouldChange?: { lessons?: string[] }) => ({ repo: lines[i].repo, line: lines[i].text, ...(shouldChange ? { shouldChange } : {}) })
  const ratings = (idx: number[], extra: Partial<Ratings> = {}): Ratings => ({ schema: 1, rater: 'owner', ratedAt: '2026-10-12', sawMatcherOutput: false, lines: idx.map((i) => rating(i)), ...extra })
  const window = { from: '2026-08-01', to: '2026-09-30' }

  test('precision is flagged and true over flagged, recall flagged and true over true, per repo and pooled', () => {
    // flagged 0,1,2 (llm-d) and 4 (dynamo); true 1,2,3 (llm-d) and 4,5 (dynamo): tp = 1,2,4
    const r = score([cand(0), cand(1), cand(2), cand(4)], ratings([1, 2, 3, 4, 5]), lines, window)
    expect(r.pooled).toMatchObject({ flagged: 4, truth: 5, tp: 3, precision: 0.75, recall: 0.6 })
    expect(r.perRepo['llm-d/llm-d']).toMatchObject({ flagged: 3, truth: 3, tp: 2 })
    expect(r.perRepo['ai-dynamo/dynamo']).toMatchObject({ flagged: 1, truth: 2, tp: 1, precision: 1, recall: 0.5 })
    expect(new Set(r.missed.map((m) => m.line))).toEqual(new Set([lines[3].text, lines[5].text]))
  })

  test('the by-route table splits precision between term and repo flags', () => {
    const r = score([cand(0, 'term'), cand(1, 'repo'), cand(2, 'repo')], ratings([0, 1, 5]), lines, window)
    expect(r.byVia.term).toMatchObject({ flagged: 1, tp: 1, precision: 1 })
    expect(r.byVia.repo).toMatchObject({ flagged: 2, tp: 1, precision: 0.5 })
  })

  test('zero flags or zero true lines give null rates, not NaN', () => {
    const none = score([], ratings([1]), lines, window)
    expect(none.pooled.precision).toBeNull()
    expect(none.pooled.recall).toBe(0)
    const noTruth = score([cand(0)], ratings([]), lines, window)
    expect(noTruth.pooled.recall).toBeNull()
    expect(noTruth.pooled.precision).toBe(0)
  })

  test('mapping counts true flagged lines whose candidate names a lesson the rater named', () => {
    const rs: Ratings = { ...ratings([]), lines: [rating(0, { lessons: ['t6.l3'] }), rating(1, { lessons: ['t9.l9'] }), rating(2)] }
    const r = score([cand(0), cand(1), cand(2)], rs, lines, window)
    expect(r.mapping).toEqual({ rated: 2, hit: 1 })
  })

  test('Wilson intervals bracket the estimate and are wide for small n', () => {
    expect(wilson(0, 0)).toBeNull()
    const w = wilson(8, 10)
    expect(w && w.lo).toBeLessThan(0.8)
    expect(w && w.hi).toBeGreaterThan(0.8)
    expect(wilson(80, 100)!.hi - wilson(80, 100)!.lo).toBeLessThan(w!.hi - w!.lo)
  })

  test('the verdict follows the pre-registered bar', () => {
    const base = { flagged: 100, truth: 30, tp: 27, precision: 0.27, recall: 0.9, precisionCi: null, recallCi: null }
    const rs = ratings([])
    expect(judge(base, 70, rs, []).outcome).toBe('keep')
    expect(judge({ ...base, tp: 20, recall: 20 / 30 }, 70, rs, []).failures[0]).toMatch(/recall/)
    expect(judge({ ...base, precision: 0.2 }, 70, rs, []).failures[0]).toMatch(/precision/)
    expect(judge(base, 120, rs, []).failures[0]).toMatch(/flags a week/)
    expect(judge({ ...base, truth: 19 }, 70, rs, []).outcome).toBe('underpowered')
  })

  test('a known deprecation rated true and not flagged fails the bar', () => {
    const base = { flagged: 100, truth: 30, tp: 27, precision: 0.27, recall: 0.9, precisionCi: null, recallCi: null }
    const kvbm = { repo: 'ai-dynamo/dynamo', line: KVBM }
    const fs = { repo: 'llm-d/llm-d', line: FS_CONNECTOR }
    const rs: Ratings = { ...ratings([]), lines: [kvbm, fs] }
    const flaggedFs = { ...cand(0), key: lineKey(fs.repo, fs.line) }
    const v = judge(base, 70, rs, [flaggedFs])
    expect(v.outcome).toBe('drop')
    expect(v.failures).toHaveLength(1)
    expect(v.failures[0]).toMatch(/kvbm/)
  })

  describe('ratings that list matcher output are refused', () => {
    const flagged = new Set([0, 1, 2, 3].map((i) => lines[i].key))
    const check = (raw: unknown) => checkRatings(raw, lines, flagged)

    test('an independent rating passes', () => {
      const ok = check({ ...ratings([1, 4]) })
      expect(ok.errors).toEqual([])
      expect(ok.ratings?.lines).toHaveLength(2)
      expect(ok.keys.size).toBe(2)
    })

    test('a top-level matcher field is refused', () => {
      for (const k of ['candidates', 'flagged', 'matcher', 'stats', 'precision']) {
        const r = check({ ...ratings([1]), [k]: [] })
        expect(r.ratings).toBeUndefined()
        expect(r.errors.join('\n')).toMatch(/matcher output/)
      }
    })

    test('a per-line matcher field is refused', () => {
      for (const k of CANDIDATE_FIELDS) {
        const r = check({ ...ratings([]), lines: [{ ...rating(1), [k]: k === 'via' ? 'term' : [] }] })
        expect(r.ratings).toBeUndefined()
        expect(r.errors.join('\n')).toContain(`"${k}"`)
        expect(r.errors.join('\n')).toMatch(/only the matcher writes/)
      }
    })

    test('sawMatcherOutput must be the boolean false', () => {
      for (const v of [true, undefined, 'false', 0]) expect(check({ ...ratings([1]), sawMatcherOutput: v }).ratings).toBeUndefined()
    })

    test('a rated set that is exactly the flagged set is the matcher output copied', () => {
      const r = check(ratings([0, 1, 2, 3]))
      expect(r.ratings).toBeUndefined()
      expect(r.errors.join('\n')).toMatch(/exactly the matcher/)
      expect(check(ratings([0, 1, 2, 4])).errors).toEqual([])
    })

    test('a line the snapshot lacks, a repo off the watchlist, a duplicate and an unknown field are refused', () => {
      expect(check({ ...ratings([]), lines: [{ repo: 'llm-d/llm-d', line: 'Removed something nobody wrote' }] }).errors[0]).toMatch(/no such line/)
      expect(check({ ...ratings([]), lines: [{ repo: 'someone/else', line: lines[0].text }] }).errors[0]).toMatch(/not on the watchlist/)
      expect(check({ ...ratings([]), lines: [rating(1), rating(1)] }).errors.join()).toMatch(/rated twice/)
      expect(check({ ...ratings([]), lines: [{ ...rating(1), confidence: 0.9 }] }).errors.join()).toMatch(/unknown field/)
      expect(check({ ...ratings([1]), extra: 1 }).errors.join()).toMatch(/unknown top-level/)
      expect(check(null).errors).toEqual(['ratings must be a JSON object'])
    })

    test('a rating finds its line whatever the markdown around it, and shouldChange takes only lessons and claims', () => {
      const dressed = { repo: lines[1].repo, line: `- **${lines[1].text}**`.replace(/\*\*/g, '') }
      expect(check({ ...ratings([]), lines: [dressed] }).errors).toEqual([])
      const bad = check({ ...ratings([]), lines: [{ ...rating(1), shouldChange: { via: ['x'] } }] })
      expect(bad.errors.join()).toMatch(/shouldChange takes only lessons and claims/)
    })
  })

  test('the keep bar is the one the pre-registration states, and it is unsigned until the owner signs', () => {
    const prereg = readFileSync('docs/prereg/watcher.md', 'utf8')
    expect(prereg).toContain(`Recall at least ${KEEP_BAR.minRecall.toFixed(2)}`)
    expect(prereg).toContain(`Precision at least ${KEEP_BAR.minPrecision.toFixed(2)}`)
    expect(prereg).toContain(`At most ${KEEP_BAR.maxFlagsPerWeek} flags a week`)
    expect(prereg).toContain(`At least ${KEEP_BAR.minTrueLines} lines rated true`)
    expect(isSigned('Signed: P. Naigaonkar 2026-10-12\n')).toBe(true)
    expect(isSigned('Signed: (pending owner)\n')).toBe(false)
    expect(isSigned('Signed:\n')).toBe(false)
    expect(isSigned('see `Signed: A B 2026-10-12` above')).toBe(false)
  })
})

describe('the committed backtest files', () => {
  const rawSnapshot = readFileSync('docs/backtest/snapshot.json', 'utf8')
  const snapshot = JSON.parse(rawSnapshot) as Snapshot
  const candidates = JSON.parse(readFileSync('docs/backtest/candidates.json', 'utf8')) as {
    snapshot: { sha256: string }
    stats: { candidates: number; novelLines: number }
    candidates: Candidate[]
  }

  test('the snapshot covers all 20 repos in the fixed window, none unverified', () => {
    expect(snapshot.schema).toBe(1)
    expect(snapshot.window).toEqual(WATCH_WINDOW)
    expect(snapshot.repos.map((r) => r.repo)).toEqual(WATCHLIST.map((w) => w.repo))
    for (const r of snapshot.repos) {
      expect(r.complete).toBe(true)
      expect(r.unverified).toBeUndefined()
      expect(new Set(r.releases.map((x) => x.tag)).size).toBe(r.releases.length)
      for (const rel of r.releases) expect(inWindow(rel.publishedAt, WATCH_WINDOW)).toBe(true)
    }
    expect(snapshot.repos.reduce((n, r) => n + r.releases.length, 0)).toBeGreaterThan(100)
  })

  test('Dynamo v1.5.0 and llm-d v0.10.0 are in the snapshot with the lines the backtest is built around', () => {
    const dynamo = snapshot.repos.find((r) => r.id === 'dynamo')?.releases.find((x) => x.tag === 'v1.5.0')
    const llmd = snapshot.repos.find((r) => r.id === 'llm-d')?.releases.find((x) => x.tag === 'v0.10.0')
    expect(dynamo?.publishedAt.slice(0, 10)).toBe('2026-09-21')
    expect(dynamo?.body).toMatch(/KVBM[^\n]*deprecated/)
    expect(llmd?.body).toMatch(/llmd-fs-connector[^\n]*DEPRECATED/)
  })

  test('candidates.json was matched from this snapshot and every candidate is a keyword line of it', () => {
    expect(candidates.snapshot.sha256).toBe(createHash('sha256').update(rawSnapshot).digest('hex'))
    const lines = novelLines(snapshot)
    expect(candidates.stats.novelLines).toBe(lines.length)
    expect(candidates.stats.candidates).toBe(candidates.candidates.length)
    const byKey = new Map(lines.map((l) => [l.key, l]))
    for (const c of candidates.candidates) {
      const l = byKey.get(c.key)
      expect(l).toBeDefined()
      expect(l?.repo).toBe(c.repo)
      expect(l?.tag).toBe(c.tag)
      expect(keywordHits(c.line).length).toBeGreaterThan(0)
      expect(c.lessons.length + c.claims.length).toBeGreaterThan(0)
    }
  })

  test('the frozen candidates flag both known deprecations with lesson ids', () => {
    const find = (repo: string, re: RegExp) => candidates.candidates.find((c) => c.repo === repo && re.test(c.line))
    const fs = find('llm-d/llm-d', /llmd-fs-connector.*DEPRECATED/)
    const kvbm = find('ai-dynamo/dynamo', /KVBM \(KV Block Manager\) is deprecated/)
    expect(fs?.lessons.length).toBeGreaterThan(0)
    expect(kvbm?.lessons.length).toBeGreaterThan(0)
  })

  test('the flag volume fits the weekly triage budget the bar allows', () => {
    const weeks = (windowBounds(WATCH_WINDOW).end - windowBounds(WATCH_WINDOW).start) / 86_400_000 / 7
    expect(candidates.candidates.length / weeks).toBeLessThanOrEqual(KEEP_BAR.maxFlagsPerWeek)
  })
})
