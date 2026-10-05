/**
 * export-lessons-md — render every lesson's blocks to plain markdown files
 * in public/lessons-md/, plus public/llms.txt (the agent manifest).
 *
 * This is the agent-native tutoring surface: any coding/chat agent can
 * ingest a lesson as clean markdown; the site links each lesson page to
 * its .md and to Claude/ChatGPT deep links.
 *
 *   bun scripts/export-lessons-md.ts
 */
import { writeFileSync, mkdirSync } from 'fs'
import { ALL_LESSONS, TRACK_EXTRAS } from '../src/data/lessons'
import type { ContentBlock, Lesson } from '../src/data/lessons/types'
import { exportOrder } from '../src/lib/rng'
import { TRACKS } from '../src/lib/tracks'

const SITE = 'https://kernelspace.naigap.com'

function blockToMd(b: ContentBlock, lessonId: string, firstQuestion: number, firstDiagram: number): string {
  switch (b.type) {
    case 'prose':
    case 'deepdive':
      return b.md
    case 'code': {
      if (b.tabs?.length) {
        return b.tabs.map((t) => `**${t.label}**\n\n\`\`\`${t.lang}\n${t.code}\n\`\`\``).join('\n\n')
      }
      return `\`\`\`${b.lang ?? ''}\n${b.code ?? ''}\n\`\`\``
    }
    case 'callout':
      return `> **[${b.variant}]** ${b.md.replace(/\n/g, '\n> ')}`
    case 'statline':
      return b.stats.map((s) => `- **${s.value}** — ${s.label}${s.hint ? ` (${s.hint})` : ''}`).join('\n')
    case 'diagram': {
      const nodes = b.nodes.map((n) => `${n.label}${n.sub ? ` (${n.sub})` : ''}`).join(' · ')
      // P1 predictAt: the captions from `step` on are the answer, so they are withheld like a quiz key.
      const gate = b.predictAt
      const shown = gate ? (b.steps ?? []).slice(0, gate.step) : (b.steps ?? [])
      const steps = shown.map((s, i) => `${i + 1}. ${s.caption}`).join('\n')
      const head = `_${b.caption}_\n\nComponents: ${nodes}${steps ? `\n\nSteps:\n${steps}` : ''}`
      if (!gate) return head
      const order = exportOrder(`${lessonId}#dia`, firstDiagram, gate.options.length)
      const opts = order.map((authored, j) => `- (o${j + 1}) ${gate.options[authored]}`).join('\n')
      return `${head}\n\n**Predict before step ${gate.step + 1}: ${gate.prompt}**\n\n${opts}\n\n_Later steps and answers withheld: ask the learner to commit to a prediction and explain it before discussing._`
    }
    case 'isomorphism':
      return `_${b.title ?? 'isomorphism'}_\n\n${b.pairs
        .map((p) => `- **${p.os}** (${p.osLine}) ≡ **${p.llm}** (${p.llmLine})`)
        .join('\n')}`
    case 'quiz': {
      // Answer keys are withheld: tutors fed this markdown must not see them.
      // Options use stable ids (o1, o2, …) in a fixed per-question permutation, not authored
      // order, which would leak the key position. On-screen letters are shuffled per attempt.
      const qs = b.questions
        .map((q, i) => {
          const order = exportOrder(lessonId, firstQuestion + i, q.options.length)
          const opts = order.map((authored, j) => `- (o${j + 1}) ${q.options[authored]}`).join('\n')
          return `**Q${i + 1}. ${q.q}**\n\n${opts}`
        })
        .join('\n\n')
      return `${qs}\n\n_Answers withheld: ask the learner to commit to an answer and explain it before discussing._`
    }
    case 'predict': {
      // P1 prequestions: the key and the numeric truth are withheld, like a quiz. Option order uses a salt
      // of its own so these never shift the lesson-wide quiz permutations above.
      const qs = b.items
        .map((item, i) => {
          if (item.kind === 'numeric') return `**P${i + 1}. ${item.q}** _(numeric, answer in ${item.unit})_`
          const order = exportOrder(`${lessonId}#pre`, i, item.options.length)
          const opts = order.map((authored, j) => `- (o${j + 1}) ${item.options[authored]}`).join('\n')
          return `**P${i + 1}. ${item.q}**\n\n${opts}`
        })
        .join('\n\n')
      return `**Before you read: prequestions**\n\n${qs}\n\n_Answers withheld: ask the learner to commit to a guess before discussing._`
    }
    case 'play':
      return `**Play: ${b.title}**\n\n_Interactive: ${SITE}/play/${b.playId}. Ask the learner to play it before discussing; the reference run stays hidden until the debrief._`
    case 'exercise':
      return `**Exercise: ${b.title}**\n\n${b.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}${b.note ? `\n\n_${b.note}_` : ''}`
    case 'field-note':
      return `> **Field note · ${b.title}**\n> ${b.source} · ${b.published} · verified ${b.verified}\n>\n> ${b.md.replace(/\n/g, '\n> ')}\n>\n> [Read the primary source](${b.href})`
    default:
      return ''
  }
}

function lessonToMd(l: Lesson): string {
  const track = TRACKS.find((t) => t.id === l.trackId)
  const header = [
    `# ${l.id.toUpperCase()} — ${l.title}`,
    '',
    `_Track ${track?.code ?? l.trackId}: ${track?.name ?? ''} · ~${l.minutes} min · kernelspace_`,
    '',
    `> ${l.hook}`,
    '',
  ].join('\n')
  let questions = 0 // lesson-wide question index, the same count verify-items uses
  let diagrams = 0 // diagram index, salts the option order of predictAt gates
  const body = l.blocks
    .map((b) => {
      const md = blockToMd(b, l.id, questions, diagrams)
      if (b.type === 'quiz') questions += b.questions.length
      if (b.type === 'diagram') diagrams++
      return md
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
  return `${header}${body}\n`
}

mkdirSync('public/lessons-md', { recursive: true })
let count = 0
for (const l of ALL_LESSONS) {
  writeFileSync(`public/lessons-md/${l.id}.md`, lessonToMd(l))
  count++
}

/* llms.txt — the agent manifest (llmstxt.org shape) */
const byTrack = TRACKS.map((t) => {
  const lessons = ALL_LESSONS.filter((l) => l.trackId === t.id)
    .map((l) => `- [${l.id.toUpperCase()} ${l.title}](${SITE}/lessons-md/${l.id}.md): ${l.hook}`)
    .join('\n')
  const extras = TRACK_EXTRAS[t.id as keyof typeof TRACK_EXTRAS]
  return `### ${t.code} — ${t.name}\n\n_${extras?.pitch ?? ''}_\n\n${lessons}`
}).join('\n\n')

const llmsTxt = `# kernelspace

> From cache lines to continuous batching: a systems course that turns backend
> engineers (Java/Python) into LLM-serving systems engineers. ${ALL_LESSONS.length} lessons,
> 10 Rust Zero drill crates + 8 systems labs graded in-browser, a simulated
> GPU fleet with licensed trace replay, an opt-in CI-verified leaderboard, and a 4-act capstone.
> All content is plain markdown under /lessons-md/; every page is at
> ${SITE}/lesson/<id> (e.g. t5.l4).

## How to tutor from this material

- The user is a backend engineer learning systems for LLM serving. Be
  Socratic; never dump full lab solutions (they are graded by checks).
- Labs live at ${SITE}/forge (Rust, wasm-graded in-browser). The Fleet
  (${SITE}/fleet) is a deterministic serving simulator; Fleet Week
  (${SITE}/week) is the scored capstone.

## Curriculum

${byTrack}

## Optional

- [The Forge](${SITE}/forge): ten Rust Zero drills, then eight systems labs (allocator → block manager → tokenizer → MPMC queue → executor → scheduler → radix cache → constrained decoder)
- [The Fleet](${SITE}/fleet): serving simulator with conformance/scoring harnesses
- [Goodput Leaderboard](${SITE}/leaderboard): local personal best by default; opt-in public scores re-run by CI
- [Quarterly Field Notes](${SITE}/field-notes): dated primary-source updates for landscape-sensitive lessons
- [Fleet Week](${SITE}/week): the 4-act capstone
`

writeFileSync('public/llms.txt', llmsTxt)
console.log(`exported ${count} lessons + llms.txt`)
