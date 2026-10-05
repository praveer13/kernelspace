import { CalendarCheck, Hammer, Route, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The four primary destinations (wave-1.md §6.9) and what each one holds. Shared by the Navbar (lg and up) and
 * the bottom tab bar (below lg). Entry-chunk code: it imports no page, no data and no framer-motion.
 */
export type DestinationId = 'today' | 'path' | 'build' | 'me'

export interface Destination {
  id: DestinationId
  to: string
  label: string
  icon: LucideIcon
  /** Pathname prefixes under this destination, so a lesson or a lab still lights its tab. */
  holds: readonly string[]
}

export const DESTINATIONS: readonly Destination[] = [
  // Changes (`/freshness`) belongs to Today: "review, Up Next, changes, the week".
  { id: 'today', to: '/today', label: 'Today', icon: CalendarCheck, holds: ['/today', '/freshness', '/field-notes'] },
  { id: 'path', to: '/curriculum', label: 'Path', icon: Route, holds: ['/curriculum', '/tracks', '/lesson', '/glossary', '/play'] },
  { id: 'build', to: '/forge', label: 'Build', icon: Hammer, holds: ['/forge', '/lab', '/fleet', '/week', '/capstone', '/leaderboard'] },
  { id: 'me', to: '/progress', label: 'Me', icon: UserRound, holds: ['/progress'] },
]

/** What the Build menu lists (a menu from lg up; below lg these live in the hamburger). */
export const BUILD_LINKS: readonly { to: string; label: string }[] = [
  { to: '/forge', label: 'Forge' },
  { to: '/lab', label: 'Sims' },
  { to: '/fleet', label: 'Fleet' },
  { to: '/week', label: 'Fleet Week' },
  { to: '/capstone', label: 'Capstone' },
  { to: '/leaderboard', label: 'Leaderboard' },
]

/** The hamburger below lg: only what the four tabs do not reach in one tap. */
export const SECONDARY_LINKS: readonly { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  ...BUILD_LINKS.filter((l) => l.to !== '/forge'),
  { to: '/glossary', label: 'Glossary' },
  { to: '/freshness', label: 'Changes' },
]

const under = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** The destination a pathname belongs to, or null (Home, Boot, 404). */
export function destinationOf(pathname: string): DestinationId | null {
  return DESTINATIONS.find((d) => d.holds.some((p) => under(pathname, p)))?.id ?? null
}
