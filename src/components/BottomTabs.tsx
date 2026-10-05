import { Link, useLocation } from 'react-router'
import { DESTINATIONS, destinationOf } from '@/components/nav-links'
import { cn } from '@/lib/utils'

/**
 * The bottom tab bar below lg (wave-1.md §6.9): Today, Path, Build and Me, 56 px tall plus the safe area.
 * Build opens the Forge; its other pages (Sims, Fleet, Fleet Week, Capstone, Leaderboard) are in the hamburger.
 * From lg up the Navbar and the StatusBar do this job and the bar is not rendered. Layout pads the page by the
 * same height and sets `scroll-padding-bottom`, so a focused control is never hidden under it (WCAG 2.4.11).
 * It sits at z-30, under the hamburger menu, the lesson's sticky bar and the toasts (z-40 and up), so those
 * keep working where they already were.
 */
export default function BottomTabs() {
  const { pathname } = useLocation()
  const here = destinationOf(pathname)
  return (
    <nav
      aria-label="Primary"
      data-bottom-tabs
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex h-14 max-w-xl">
        {DESTINATIONS.map((d) => {
          const active = here === d.id
          return (
            <li key={d.id} className="flex-1">
              <Link
                to={d.to}
                aria-current={pathname === d.to ? 'page' : active ? 'true' : undefined}
                className={cn(
                  'flex h-full min-h-11 flex-col items-center justify-center gap-0.5 font-mono text-[11px] transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                  active ? 'text-accent' : 'text-text-2 active:text-text-1',
                )}
              >
                <d.icon size={20} strokeWidth={1.75} aria-hidden />
                {d.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
