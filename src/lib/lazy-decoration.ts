import { lazy, type ComponentType } from 'react'

/**
 * Chunks that only decorate a page (the Home particle field) must degrade silently: if one will
 * not load, the page looks plainer, and the learner is not reloaded.
 *
 * Vite reports a failed dynamic import by dispatching `vite:preloadError` from inside its import
 * helper, before the import's own promise rejects, so a `.catch` on the import cannot stop the
 * reload handler in main.tsx. `lazyDecoration` therefore claims the error object it caught, and
 * the handler skips claimed errors (it waits one task for the claim to land).
 */
const claimed = new WeakSet<object>()

/** True once a `lazyDecoration` loader has caught this chunk-load error. */
export function isDecorationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && claimed.has(error)
}

const renderNothing = () => null

/** `lazy()` for a purely decorative component: a chunk that fails to load renders nothing and never reloads the page. */
export function lazyDecoration<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      if (typeof error === 'object' && error !== null) claimed.add(error)
      return { default: renderNothing }
    }),
  )
}
