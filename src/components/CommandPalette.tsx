import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import Fuse from 'fuse.js'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, FileText, ArrowRight } from 'lucide-react'
import { TRACKS, CAPSTONE, SIMS } from '@/lib/tracks'
import { cn } from '@/lib/utils'

interface Item {
  id: string
  group: 'Pages' | 'Tracks' | 'Simulators'
  title: string
  crumb: string
  to: string
  keywords: string[]
}

const INDEX: Item[] = [
  { id: 'home', group: 'Pages', title: 'Home', crumb: '~/', to: '/', keywords: ['landing', 'start'] },
  { id: 'curriculum', group: 'Pages', title: 'Curriculum', crumb: '~/curriculum', to: '/curriculum', keywords: ['tracks', 'lessons', 'map'] },
  { id: 'lab', group: 'Pages', title: 'Lab', crumb: '~/lab', to: '/lab', keywords: ['simulators', 'playground'] },
  { id: 'capstone', group: 'Pages', title: 'Capstone', crumb: '~/capstone', to: '/capstone', keywords: ['project', 'engine', 'build'] },
  { id: 'glossary', group: 'Pages', title: 'Glossary', crumb: '~/glossary', to: '/glossary', keywords: ['terms', 'isomorphism', 'concepts'] },
  { id: 'progress', group: 'Pages', title: 'Progress', crumb: '~/progress', to: '/progress', keywords: ['dashboard', 'xp', 'rank', 'streak'] },
  ...TRACKS.map<Item>((t) => ({
    id: `track-${t.id}`,
    group: 'Tracks',
    title: `${t.code} — ${t.name}`,
    crumb: `track · ${t.lessons} lessons`,
    to: `/tracks/${t.id}`,
    keywords: [t.name.toLowerCase(), t.code.toLowerCase()],
  })),
  { id: 'track-capstone', group: 'Tracks', title: `${CAPSTONE.code} — ${CAPSTONE.name}`, crumb: 'capstone · 7 steps', to: '/capstone', keywords: ['capstone', 'inference engine'] },
  ...SIMS.map<Item>((s) => ({
    id: `sim-${s.id}`,
    group: 'Simulators',
    title: s.name,
    crumb: `simulator · used in ${s.usedIn}`,
    to: `/lab/${s.id}`,
    keywords: [s.name.toLowerCase(), s.hook.toLowerCase()],
  })),
]

const GROUP_ORDER: Item['group'][] = ['Pages', 'Tracks', 'Simulators']

/**
 * CommandPalette (design.md §9.3) — opens on ⌘K / Ctrl+K / `/`.
 * Fuzzy search over a build-time index; ↑↓ navigate, Enter jumps, esc closes.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const navigate = useNavigate()

  const fuse = useMemo(
    () => new Fuse(INDEX, { keys: ['title', 'keywords', 'crumb'], threshold: 0.35 }),
    [],
  )

  const results = useMemo(() => {
    const items = query.trim() ? fuse.search(query).map((r) => r.item) : INDEX
    const grouped = new Map<Item['group'], Item[]>()
    for (const g of GROUP_ORDER) grouped.set(g, [])
    for (const item of items.slice(0, 12)) grouped.get(item.group)?.push(item)
    const groups = GROUP_ORDER.map((g) => ({ group: g, items: grouped.get(g) ?? [] })).filter(
      (g) => g.items.length > 0,
    )
    // flat row offset of each group's first item (cursor indexes into `flat`)
    return groups.map((g, i) => ({
      ...g,
      start: groups.slice(0, i).reduce((n, x) => n + x.items.length, 0),
    }))
  }, [query, fuse])

  const flat = useMemo(() => results.flatMap((g) => g.items), [results])

  useEffect(() => {
    const open_ = () => {
      setOpen(true)
      setQuery('')
      setCursor(0)
    }
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setCursor(0)
      } else if (e.key === '/' && !typing) {
        e.preventDefault()
        open_()
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('ks:command-palette', open_)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('ks:command-palette', open_)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const jump = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(flat.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter' && flat[cursor]) {
      jump(flat[cursor].to)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[90] flex items-start justify-center bg-ink/60 px-4 pt-[14vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[640px] overflow-hidden rounded-lg border border-line-bright bg-surface-1 shadow-[0_24px_80px_rgba(0,0,0,.6)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onListKey}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={16} strokeWidth={1.75} className="shrink-0 text-text-3" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setCursor(0)
                }}
                placeholder="Search lessons, tracks, simulators…"
                className="h-12 w-full bg-transparent font-mono text-sm text-text-1 outline-none placeholder:text-text-3"
              />
              <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
                esc
              </kbd>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {flat.length === 0 && (
                <p className="px-3 py-8 text-center font-mono text-xs text-text-3">
                  no matches — try “paging”, “rust”, “batch”…
                </p>
              )}
              {results.map(({ group, items, start }) => (
                <div key={group} className="mb-1">
                  <p className="px-3 pb-1 pt-2 font-mono text-label uppercase text-text-3">
                    {group}
                  </p>
                  {items.map((item, i) => {
                    const idx = start + i
                    const active = idx === cursor
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => jump(item.to)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-100',
                          active ? 'bg-surface-3' : 'bg-transparent',
                        )}
                      >
                        <FileText size={15} strokeWidth={1.75} className="shrink-0 text-text-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body-sm text-text-1">
                            {item.title}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-text-3">
                            {item.crumb}
                          </span>
                        </span>
                        {active && (
                          <ArrowRight size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
