/* Scroll helpers the lesson page shares with its tests (no DOM globals are read at import time). */

/**
 * The surfaces the sticky finish bar must never sit over: the exit ticket and the test-out. The checkpoint quiz is
 * deliberately not here: it can stay partly on screen to the end of the lesson, and the bar's 'Continue anyway (read)'
 * has to show there. The page pads its scroll area instead while the bar is up.
 */
export const GRADED_SURFACES = '[data-ks-ticket], [data-ks-testout]'

interface Box {
  getBoundingClientRect(): { top: number; bottom: number; height: number }
}

/** Whether any matching surface is (even partly) on screen. `doc` and `viewportHeight` default to the live page. */
export function gradedSurfaceInView(
  doc: { querySelectorAll(sel: string): Iterable<Box> } = document,
  viewportHeight: number = window.innerHeight,
): boolean {
  for (const el of doc.querySelectorAll(GRADED_SURFACES)) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.top < viewportHeight && r.bottom > 0) return true
  }
  return false
}

/** Every scroll a page starts by itself: smooth, unless the learner asked for reduced motion. */
export function scrollBehavior(
  matchMedia: (q: string) => { matches: boolean } = (q) => window.matchMedia(q),
): 'auto' | 'smooth' {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** scroll-padding-bottom while the finish bar is up: the tab bar, the bar (~96 px tall at 360) and a margin. */
export const FINISH_BAR_SCROLL_PADDING = 'calc(11rem + env(safe-area-inset-bottom))'
