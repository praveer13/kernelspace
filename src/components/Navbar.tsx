import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { ChevronDown, Menu, X, Search } from 'lucide-react'
import ProgressRing from '@/components/ProgressRing'
import { BUILD_LINKS, DESTINATIONS, SECONDARY_LINKS, destinationOf } from '@/components/nav-links'
import { selectRings } from '@/lib/economy'
import { useProgress, selectOverallPct } from '@/lib/progress'
import { openCommandPalette } from '@/lib/command-palette'
import { cn } from '@/lib/utils'

const LINK = 'relative whitespace-nowrap py-1 text-body-sm font-medium transition-colors duration-150'

/** The 2px accent bar that scales in under the active destination. */
function Underline({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -bottom-[2px] left-0 h-[2px] w-full origin-left bg-accent transition-transform duration-200 ease-out-expo',
        active ? 'scale-x-100' : 'scale-x-0',
      )}
    />
  )
}

/**
 * Build is a menu (wave-1.md §6.9): a disclosure button over six links. Enter or Space opens it, Tab walks the
 * links, Escape closes it and returns focus to the button, and so do a click elsewhere and focus leaving it.
 */
function BuildMenu({ active }: { active: boolean }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Close on navigation (adjust state during render, not in an effect)
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (open && !root.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={cn(LINK, 'flex items-center gap-1', active ? 'text-text-1' : 'text-text-2 hover:text-text-1')}
      >
        Build
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={cn('transition-transform duration-150', open && 'rotate-180')} />
        <Underline active={active} />
      </button>
      <ul
        id={menuId}
        hidden={!open}
        className="absolute left-1/2 top-full z-50 mt-3 w-48 -translate-x-1/2 rounded-md border border-line bg-surface-1 p-1 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
      >
        {BUILD_LINKS.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-10 items-center rounded-sm px-3 text-body-sm transition-colors duration-150 hover:bg-surface-2 hover:text-text-1',
                  isActive ? 'text-accent' : 'text-text-2',
                )
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * TopNavbar (design.md §9.1, wave-1.md §6.9).
 * sticky top-0 z-50 — stays in normal document flow; pages never compensate
 * for nav height. On `/` it starts transparent over the hero and gains the
 * surface-1/80 blur background after 24px of scroll (250ms ease-out-expo).
 *
 * Four destinations (Today, Path, Build, Me) plus ⌘K from lg up. Below lg the bottom tab bar carries the
 * four and the hamburger keeps only secondary links. It reads the snapshot-backed store and the pure ring
 * selector, never the ledger engine, so it stays in the entry chunk without pulling the engine in.
 */
export default function Navbar() {
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const overallPct = useProgress(selectOverallPct)
  const ring = useProgress((s) => selectRings(s.aggregate).rank)
  const here = destinationOf(pathname)

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

          {/* Center: the four destinations (lg+) */}
          <nav className="hidden items-center gap-8 lg:flex" aria-label="Primary">
            {DESTINATIONS.map((d) =>
              d.id === 'build' ? (
                <BuildMenu key={d.id} active={here === 'build'} />
              ) : (
                <Link
                  key={d.id}
                  to={d.to}
                  aria-current={pathname === d.to ? 'page' : here === d.id ? 'true' : undefined}
                  className={cn(LINK, here === d.id ? 'text-text-1' : 'text-text-2 hover:text-text-1')}
                >
                  {d.label}
                  <Underline active={here === d.id} />
                </Link>
              ),
            )}
          </nav>

          {/* Right: search, ring chip, hamburger */}
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
              aria-label={`Progress ${overallPct}% — highest ring earned ${ring}`}
            >
              <ProgressRing value={overallPct} size={28} showLabel={false} strokeWidth={3} />
              <span className="hidden whitespace-nowrap rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-accent md:inline-block">
                {ring}
              </span>
            </Link>

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2 transition-colors hover:border-line-bright hover:text-text-1 lg:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={18} strokeWidth={1.75} /> : <Menu size={18} strokeWidth={1.75} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile full-screen menu (secondary links only): always mounted, faded and hidden from focus with CSS while closed */}
      <div
        className={cn(
          'fixed inset-0 z-40 flex flex-col bg-ink/95 pt-16 backdrop-blur-md transition-[opacity,visibility] duration-180 lg:hidden',
          menuOpen ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        <nav className="flex flex-col gap-1 overflow-y-auto px-6 pt-8" aria-label="More">
          {SECONDARY_LINKS.map((link, i) => (
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
                end={link.to === '/'}
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
          {overallPct}% ALLOCATED · {ring}
        </div>
      </div>
    </>
  )
}
