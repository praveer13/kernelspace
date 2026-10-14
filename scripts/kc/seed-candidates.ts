/**
 * seed-candidates — the KC review worksheet (docs/specs/wave-1.md §4.3; wave-2.md §4.1, §4.4). Not run in CI.
 *
 * For each lesson it prints the raw material a KC is seeded from: H2 headings (one candidate concept
 * each; merge siblings until the lesson has 2-3 KCs), statline chip rows (one `fact` KC per row),
 * isomorphism pairs (LLM-side concepts and `confusable` candidates), inline lesson cross-references
 * (candidate `requires` edges), lab readiness (lab check KCs require the readiness lessons' KCs) and
 * the checkpoint items still to be tagged. Beside each lesson it shows what the graph already says,
 * so a reviewer reads one worksheet instead of nine files.
 *
 * For the content tasks that tag T3-T7 (wave-2 2a-22 … 2a-28) it also lists the KCs a lesson's `Lesson.kcs`
 * may name (those that list the lesson and are introduced there or earlier, the verify-kc rule) and the
 * stem of each untagged checkpoint item, so a tagger reads the item and the candidates side by side.
 *
 *   bun scripts/kc/seed-candidates.ts            # T3-T7 (the Wave 2 scope)
 *   bun scripts/kc/seed-candidates.ts --wave1    # R and T0-T2
 *   bun scripts/kc/seed-candidates.ts t4 t5      # any tracks
 *   bun scripts/kc/seed-candidates.ts --all
 */
import type { ContentBlock, Lesson, TrackId } from '../../src/data/lessons/types'
import { ALL_LESSONS, TRACK_IDS } from '../../src/data/lessons'
import { FORGE_LABS } from '../../src/data/labs'
import { KC_GRAPH } from '../../src/data/kc'

const args = process.argv.slice(2)
const tracks: TrackId[] = args.includes('--all')
  ? TRACK_IDS
  : args.includes('--wave1')
    ? ['r', 't0', 't1', 't2']
    : args.length > 0
      ? TRACK_IDS.filter((t) => args.includes(t))
      : ['t3', 't4', 't5', 't6', 't7']

/** An item stem on one line, cut for the worksheet. */
const stem = (q: string) => {
  const line = q.replace(/\s+/g, ' ').trim()
  return line.length > 90 ? `${line.slice(0, 89)}…` : line
}

/** `T1.L4`, `t2.l7`, `R.L3` inside prose. */
const XREF = /\b(r|t[0-7])\.l(\d{1,2})\b/gi

function blockText(b: ContentBlock): string {
  switch (b.type) {
    case 'prose':
    case 'callout':
    case 'deepdive':
    case 'field-note':
      return b.md
    case 'diagram':
      return [b.caption, ...b.steps.map((s) => s.caption)].join('\n')
    case 'isomorphism':
      return b.pairs.map((p) => `${p.osLine}\n${p.llmLine}\n${p.breaks ?? ''}`).join('\n')
    case 'quiz':
      return b.questions.map((q) => [q.q, ...q.options, q.explanation ?? ''].join('\n')).join('\n')
    case 'exercise':
      return [b.title, ...b.tasks, b.note ?? ''].join('\n')
    default:
      return ''
  }
}

const h2s = (l: Lesson): string[] =>
  l.blocks.flatMap((b) => (b.type === 'prose' ? [...b.md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()) : []))

function xrefs(l: Lesson): string[] {
  const out = new Set<string>()
  for (const b of l.blocks) {
    for (const m of blockText(b).matchAll(XREF)) {
      const id = `${m[1].toLowerCase()}.l${Number(m[2])}`
      if (id !== l.id) out.add(id)
    }
  }
  return [...out].sort()
}

const order = new Map(ALL_LESSONS.map((l, i) => [l.id, i]))
const kcsTeaching = (lessonId: string) => KC_GRAPH.kcs.filter((k) => k.lessons.includes(lessonId))

let lessons = 0
let headings = 0
let chips = 0
let pairs = 0
let items = 0
let edgesInScope = 0
for (const l of ALL_LESSONS) {
  if (!tracks.includes(l.trackId)) continue
  lessons++
  console.log(`\n## ${l.id} · ${l.title}  (${l.minutes} min)`)

  const hs = h2s(l)
  headings += hs.length
  console.log(`  H2 (${hs.length}):`)
  for (const h of hs) console.log(`    - ${h}`)

  const rows = l.blocks.filter((b) => b.type === 'statline')
  for (const [i, b] of rows.entries()) {
    chips += b.stats.length
    console.log(`  statline row ${i + 1} → one fact KC: ${b.stats.map((s) => `${s.value} ${s.label}`).join(' · ')}`)
  }

  for (const b of l.blocks) {
    if (b.type !== 'isomorphism') continue
    for (const p of b.pairs) {
      pairs++
      console.log(`  pair: ${p.os} ≡ ${p.llm}`)
    }
  }

  const refs = xrefs(l)
  const back = refs.filter((r) => (order.get(r) ?? Infinity) < (order.get(l.id) ?? -1))
  const inScope = back.filter((r) => tracks.some((t) => r.startsWith(`${t}.`)))
  edgesInScope += inScope.length
  if (refs.length > 0) console.log(`  cross-refs: back ${back.join(', ') || '-'} · forward ${refs.filter((r) => !back.includes(r)).join(', ') || '-'}`)

  const labs = FORGE_LABS.filter((lab) => lab.readiness?.lessonIds.includes(l.id))
  if (labs.length > 0) console.log(`  readiness for: ${labs.map((lab) => lab.id).join(', ')}`)
  const hosted = FORGE_LABS.filter((lab) => lab.lessonId === l.id)
  if (hosted.length > 0) console.log(`  hosts lab: ${hosted.map((lab) => `${lab.id} (${lab.checks.map((c) => c.id).join(', ')})`).join('; ')}`)

  let qi = 0
  const untagged: { i: number; q: string }[] = []
  for (const b of l.blocks) {
    if (b.type !== 'quiz') continue
    for (const q of b.questions) {
      if (!q.kcs?.length) untagged.push({ i: qi, q: q.q })
      qi++
    }
  }
  items += qi
  console.log(`  checkpoint items: ${qi}${untagged.length > 0 ? ` (untagged: #${untagged.map((u) => u.i).join(', #')})` : ', all tagged'}`)
  for (const u of untagged) console.log(`    #${u.i} ${stem(u.q)}`)

  const graph = kcsTeaching(l.id)
  console.log(`  graph: ${graph.map((k) => `${k.id}${k.lessons[0] === l.id ? '' : ' (revisit)'}`).join(', ') || '(none yet)'}`)
  // Lesson.kcs may name only KCs that list this lesson and are introduced here or earlier (verify-kc)
  const at = order.get(l.id) ?? -1
  const nameable = graph.filter((k) => (order.get(k.lessons[0]) ?? Infinity) <= at)
  console.log(`  Lesson.kcs may name (${nameable.length}): ${nameable.map((k) => `${k.id} [${k.kind}${k.gen?.length ? `, gen ${k.gen.join('+')}` : ''}]`).join(', ') || '-'}`)
  if (nameable.length < 2) console.log('  ! fewer than 2 nameable KCs: Lesson.kcs cannot hold 2-3 here')
  if (l.kcs) console.log(`  Lesson.kcs: ${l.kcs.join(', ')}`)
}

console.log(
  `\n${lessons} lessons · ${headings} H2 · ${chips} chips · ${pairs} isomorphism pairs · ${items} checkpoint items · ${edgesInScope} backward cross-refs inside the selected tracks`,
)
