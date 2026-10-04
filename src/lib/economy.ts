/**
 * XP, ranks and the local-day key. Pure (no zustand, no DOM), so the ledger core can
 * use them under `bun test`. `progress.ts` re-exports every name, so imports from
 * `@/lib/progress` keep working unchanged.
 */

export const XP = {
  lesson: 100,
  quiz: 40,
  exercise: 60,
  capstoneStep: 150,
  lab: 200,
  fleetWeekAct: 250,
} as const

export interface Rank {
  name: string
  minXp: number
}

/** XP → Rank: progress rendered as privilege escalation (design.md §10). */
export const RANKS: Rank[] = [
  { name: 'ROOT', minXp: 5000 },
  { name: 'RING 0', minXp: 3000 },
  { name: 'RING 1', minXp: 1500 },
  { name: 'RING 2', minXp: 500 },
  { name: 'RING 3', minXp: 0 },
]

export function rankForXp(xp: number): Rank {
  return RANKS.find((r) => xp >= r.minXp) ?? RANKS[RANKS.length - 1]
}

export function nextRank(xp: number): Rank | null {
  const sorted = [...RANKS].sort((a, b) => a.minXp - b.minXp)
  return sorted.find((r) => r.minXp > xp) ?? null
}

/** YYYY-MM-DD from the learner's LOCAL calendar fields (not UTC), so a day rolls over at their midnight. */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
