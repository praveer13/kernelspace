/**
 * Claim tokens in lesson prose (Wave 1 stage 0, task K3-1): `[[c:<id>]]` for a claim's value and unit, `[[c:<id>|pin]]`
 * for its cite. The words come from `claims.tokens.generated.ts` — only the ids lessons render as tokens — so the prose
 * chunk never imports the full lesson snapshot or the claims registry (K0-Z-D12). The export and the gates use the same
 * functions.
 */
import { LESSON_TOKEN_VALUES } from '@/data/lessons/claims.tokens.generated'
import { claimTokenPattern } from '@/lib/claim-token-syntax'

const CLAIM_TOKEN = claimTokenPattern()

const row = (id: string) => {
  const r = Object.hasOwn(LESSON_TOKEN_VALUES, id) ? LESSON_TOKEN_VALUES[id] : undefined
  if (!r) throw new Error(`claim ${id} is not in claims.tokens.generated.ts; render it as [[c:${id}]] and run bun scripts/gen-lesson-claims.ts`)
  return r
}

/** The value with its unit. */
export function claimText(id: string): string {
  return row(id).text
}

/** The value with its unit, release and read date. */
export function claimCite(id: string): string {
  return row(id).cite
}

/** The day the claim was read. */
export function claimRead(id: string): string {
  return row(id).read
}

/** The text a plain reader gets: the value (or the cite, which carries its own date), the claim id and the read day. */
export function claimTokenText(id: string, pin: boolean): string {
  return pin ? `${claimCite(id)} (claim ${id})` : `${claimText(id)} (claim ${id}, read ${claimRead(id)})`
}

/** Every claim token in prose replaced by its claim's current words; fenced and inline code stay literal. */
export function replaceClaimTokens(text: string): string {
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      const parts = line.split('`')
      return parts
        .map((part, i) =>
          i % 2 === 1 ? part : part.replace(CLAIM_TOKEN, (_, id: string, pin: string | undefined) => claimTokenText(id, pin === 'pin')),
        )
        .join('`')
    })
    .join('\n')
}
