import { useEffect, useState } from 'react'

type PaletteComponent = typeof import('@/components/CommandPalette').default

let loaded: PaletteComponent | null = null
let loading: Promise<void> | null = null

/** Fetch the palette chunk once. */
function loadPalette(): Promise<void> {
  loading ??= import('@/components/CommandPalette')
    .then((m) => {
      loaded = m.default
    })
    .catch(() => {
      loading = null // main.tsx reloads once on a stale chunk; a later keypress retries
    })
  return loading
}

/**
 * The part of the ⌘K palette that lives in the entry chunk: a key listener and a lazy mount
 * (spec §6.9). The palette itself, with its search and index, is fetched when the browser is idle
 * or on the first open. It is held in state rather than behind React.lazy because a Suspense
 * fallback that resolves is revealed no sooner than 300 ms after it committed, which would eat the
 * whole open budget even with the chunk already cached.
 * Opens on ⌘K, Ctrl+K and `/` (not while typing in a field); ⌘K and Ctrl+K toggle.
 */
export default function CommandPaletteHost() {
  const [Palette, setPalette] = useState<PaletteComponent | null>(() => loaded)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const ready = () => loadPalette().then(() => setPalette(() => loaded))
    const show = (toggle: boolean) => {
      setOpen((v) => (toggle ? !v : true))
      void ready()
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show(true)
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        show(false)
      }
    }
    const onOpen = () => show(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('ks:command-palette', onOpen)

    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const handle = idle(() => void ready())
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ks:command-palette', onOpen)
      cancel(handle)
    }
  }, [])

  return Palette && <Palette open={open} onClose={() => setOpen(false)} />
}
