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
import { TRACKS } from '../src/lib/tracks'

const SITE = 'https://kernelspace.naigap.com'

function blockToMd(b: ContentBlock): string {
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
      const steps = (b.steps ?? []).map((s, i) => `${i + 1}. ${s.caption}`).join('\n')
      return `_${b.caption}_\n\nComponents: ${nodes}${steps ? `\n\nSteps:\n${steps}` : ''}`
    }
    case 'isomorphism':
      return `_${b.title ?? 'isomorphism'}_\n\n${b.pairs
        .map((p) => `- **${p.os}** (${p.osLine}) ≡ **${p.llm}** (${p.llmLine})`)
        .join('\n')}`
    case 'quiz':
      return b.questions
        .map((q, i) => {
          const opts = q.options.map((o, j) => `   ${String.fromCharCode(65 + j)}. ${o}`).join('\n')
          const correct = q.correct.map((c) => String.fromCharCode(65 + c)).join(', ')
          return `**Q${i + 1}. ${q.q}**\n${opts}\n   Answer: ${correct} — ${q.explanation}`
        })
        .join('\n\n')
    case 'exercise':
      return `**Exercise: ${b.title}**\n\n${b.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}${b.note ? `\n\n_${b.note}_` : ''}`
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
  const body = l.blocks.map(blockToMd).filter(Boolean).join('\n\n---\n\n')
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
> engineers (Java/Python) into LLM-serving systems engineers. 55 lessons,
> 6 Rust labs graded in-browser, a simulated GPU fleet, and a 4-act capstone.
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

- [The Forge labs](${SITE}/forge): six Rust labs (allocator → block manager → tokenizer → MPMC queue → executor → scheduler)
- [The Fleet](${SITE}/fleet): serving simulator with conformance/scoring harnesses
- [Fleet Week](${SITE}/week): the 4-act capstone
`

writeFileSync('public/llms.txt', llmsTxt)
console.log(`exported ${count} lessons + llms.txt`)
