import { useState } from 'react'
import { Bot, ClipboardCopy, ExternalLink } from 'lucide-react'

/**
 * AgentActions — agent-native tutoring entry points for a lesson.
 * The student brings their OWN agent (Claude Code, Codex, ChatGPT…);
 * we never see a key. Three affordances:
 *   copy md  — the lesson as markdown, ready to paste anywhere
 *   Claude   — claude.ai deep link with the lesson context prefilled
 *   ChatGPT  — chatgpt.com deep link, same
 */
export default function AgentActions({ lessonId, title }: { lessonId: string; title: string }) {
  const [copied, setCopied] = useState(false)

  const fetchMd = async (): Promise<string> => {
    const res = await fetch(`/lessons-md/${lessonId}.md`)
    return res.ok ? res.text() : `Lesson ${lessonId}: ${title}`
  }

  const copyMd = async () => {
    const md = await fetchMd()
    await navigator.clipboard.writeText(md)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const openAgent = async (base: string) => {
    const md = await fetchMd()
    const prefill =
      `I'm studying the kernelspace lesson "${title}" (${lessonId}). ` +
      `Answer my questions Socratically — I'm learning; don't dump answers.\n\n` +
      md.slice(0, 1800)
    window.open(`${base}${encodeURIComponent(prefill)}`, '_blank', 'noopener')
  }

  const btn =
    'inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 font-mono text-[10px] text-text-3 transition-colors hover:border-accent/50 hover:text-accent'

  return (
    <span className="inline-flex items-center gap-1.5" title="bring your own agent — no key ever touches this site">
      <button onClick={() => void copyMd()} className={btn}>
        {copied ? <Bot size={11} className="text-accent" /> : <ClipboardCopy size={11} />}
        {copied ? 'copied md ✓' : 'copy md'}
      </button>
      <button onClick={() => void openAgent('https://claude.ai/new?q=')} className={btn}>
        <ExternalLink size={11} /> ask claude
      </button>
      <button onClick={() => void openAgent('https://chatgpt.com/?q=')} className={btn}>
        <ExternalLink size={11} /> ask chatgpt
      </button>
    </span>
  )
}
