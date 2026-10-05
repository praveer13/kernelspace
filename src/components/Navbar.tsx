import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Menu, X, Search } from 'lucide-react'
import ProgressRing from '@/components/ProgressRing'
import { useProgress, selectOverallPct, rankForXp } from '@/lib/progress'
import { openCommandPalette } from '@/lib/command-palette'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { to: '/curriculum', label: 'Curriculum' },
  { to: '/lab', label: 'Lab' },
  { to: '/forge', label: 'Forge' },
  { to: '/fleet', label: 'Fleet' },
  { to: '/week', label: 'Fleet Week' },
  { to: '/freshness', label: 'Notes' },
  { to: '/capstone', label: 'Capstone' },
  { to: '/glossary', label: 'Glossary' },
]

const MOBILE_LINKS = [
  { to: '/', label: 'Home' },
  ...NAV_LINKS,
  { to: '/progress', label: 'Progress' },
]

/**
 * TopNavbar (design.md §9.1, home.md §0).
 * sticky top-0 z-50 — stays in normal document flow; pages never compensate
 * for nav height. On `/` it starts transparent over the hero and gains the
 * surface-1/80 blur background after 24px of scroll (250ms ease-out-expo).
 */
export default function Navbar() {
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const xp = useProgress((s) => s.xp)
  const overallPct = useProgress(selectOverallPct)
  const rank = rankForXp(xp)

  const isHome = pathname === '/'
  const solid = !isHome || scrolled

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile menu on navigation (adjust state during render, not in an effect)
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setMenuOpen(false)
  }

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-50 h-16 border-b transition-[background-color,border-color,backdrop-filter] duration-250 ease-out-expo',
          solid
            ? 'border-line bg-surface-1/80 backdrop-blur-md'
            : 'border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-full max-w-app items-center justify-between gap-4 px-6 lg:px-12">
          {/* Left: wordmark */}
          <Link to="/" className="group flex items-center gap-2.5" aria-label="kernelspace home">
            <span className="whitespace-nowrap font-mono text-[15px] font-medium text-text-1">
              [<span className="wordmark-cursor" />]_
              <span className="group-hover:text-accent transition-colors duration-150">
                kernelspace
              </span>
            </span>
            <span className="hidden rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-text-3 sm:inline-block">
              v0.9
            </span>
          </Link>

          {/* Center: primary links (lg+) */}
          <nav className="hidden items-center gap-6 xl:flex" aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'relative whitespace-nowrap py-1 text-body-sm font-medium transition-colors duration-150',
                    isActive ? 'text-text-1' : 'text-text-2 hover:text-text-1',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {link.label}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute -bottom-[2px] left-0 h-[2px] w-full origin-left bg-accent transition-transform duration-200 ease-out-expo',
                        isActive ? 'scale-x-100' : 'scale-x-0',
                      )}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Right: search, progress donut, rank chip, hamburger */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openCommandPalette}
              className="hidden items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-3 transition-colors duration-150 hover:border-line-bright hover:text-text-2 sm:flex"
              aria-label="Open command palette"
            >
              <Search size={13} strokeWidth={1.75} />
              <span className="hidden md:inline">search</span>
              <kbd className="rounded border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-text-2">
                ⌘K
              </kbd>
            </button>

            <Link
              to="/progress"
              className="flex items-center gap-2.5"
              aria-label={`Progress ${overallPct}% — rank ${rank.name}`}
            >
              <ProgressRing value={overallPct} size={28} showLabel={false} strokeWidth={3} />
              <span className="hidden whitespace-nowrap rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-accent md:inline-block">
                {rank.name}
              </span>
            </Link>

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2 transition-colors hover:border-line-bright hover:text-text-1 xl:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={18} strokeWidth={1.75} /> : <Menu size={18} strokeWidth={1.75} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile full-screen menu: always mounted, faded and hidden from focus with CSS while closed */}
      <div
        className={cn(
          'fixed inset-0 z-40 flex flex-col bg-ink/95 pt-16 backdrop-blur-md transition-[opacity,visibility] duration-180 xl:hidden',
          menuOpen ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        <nav className="flex flex-col gap-1 px-6 pt-8" aria-label="Mobile">
          {MOBILE_LINKS.map((link, i) => (
            <div
              key={link.to}
              className={cn(
                'transition-[opacity,transform] duration-300 ease-out-expo',
                menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
              )}
              style={{ transitionDelay: menuOpen ? `${0.06 * i}s` : '0s' }}
            >
              <NavLink
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-12 items-center justify-between border-b border-line py-3 font-display text-h3',
                    isActive ? 'text-accent' : 'text-text-1',
                  )
                }
              >
                {link.label}
                <span className="font-mono text-label text-text-3">0x0{i}</span>
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="mt-auto px-6 pb-10 font-mono text-label text-text-3">
          {overallPct}% ALLOCATED · {rank.name}
        </div>
      </div>
    </>
  )
}
