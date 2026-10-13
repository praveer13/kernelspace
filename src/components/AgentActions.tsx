import { useState } from 'react'
import { Bot, ClipboardCopy } from 'lucide-react'
import AskButtons from '@/components/mentor/AskButtons'
import { useProgress } from '@/lib/progress'
import { buildPacket, claimsFor, fetchLessonMd, learnerNotes, plainHeading, sectionsOf } from '@/lib/mentor/packet'
import type { Packet } from '@/lib/mentor/packet'

/**
 * AgentActions — agent-native tutoring entry points for a lesson (docs/specs/wave-2.md §14).
 * The student brings their OWN agent (Claude Code, Codex, ChatGPT…); we never see a key. Three affordances:
 *   copy md      — the lesson as markdown, ready to paste anywhere
 *   ask claude   — copies a context packet (the section you are reading, your last misses, sourced claims), then opens
 *   ask chatgpt    claude.ai or chatgpt.com with a short instruction to paste it. The link carries no lesson text.
 */

/** The H2 of the lesson the learner is reading: the last one whose top edge has passed 40 % of the viewport. */
function currentHeading(md: string): string | undefined {
  const known = new Set(sectionsOf(md).map((s) => plainHeading(s.title)))
  const heads = [...document.querySelectorAll('h2')].filter((h) => known.has(plainHeading(h.textContent ?? '')))
  if (heads.length === 0) return undefined
  const line = window.innerHeight * 0.4
  const passed = heads.filter((h) => h.getBoundingClientRect().top <= line)
  return (passed.length > 0 ? passed[passed.length - 1] : heads[0]).textContent?.trim()
}

const engine = () => useProgress.controls.engine()

export default function AgentActions({ lessonId, title }: { lessonId: string; title: string }) {
  const [copied, setCopied] = useState(false)

  const copyMd = async () => {
    const md = (await fetchLessonMd(lessonId)) || `Lesson ${lessonId}: ${title}`
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const build = async (): Promise<Packet> => {
    const [md, notes, claims] = await Promise.all([fetchLessonMd(lessonId), learnerNotes(engine, { lessonId }), claimsFor({ lessonId })])
    return buildPacket({ scope: { kind: 'lesson', lessonId, title, h2: currentHeading(md) }, notes, claims, md })
  }

  const btn =
    'inline-flex min-h-6 items-center gap-1 rounded border border-line px-2 py-0.5 font-mono text-[10px] text-text-3 transition-colors hover:border-accent/50 hover:text-accent [@media(pointer:coarse)]:min-h-11'

  return (
    <div className="inline-flex items-center gap-1.5" title="bring your own agent — no key ever touches this site">
      <AskButtons
        packetRef={`packet:lesson/${lessonId}`}
        label={`lesson ${lessonId}`}
        build={build}
        about={`lesson ${lessonId}`}
        lead={
          <button onClick={() => void copyMd()} className={btn}>
            {copied ? <Bot size={11} className="text-accent" aria-hidden /> : <ClipboardCopy size={11} aria-hidden />}
            {copied ? 'copied md ✓' : 'copy md'}
          </button>
        }
      />
    </div>
  )
}
