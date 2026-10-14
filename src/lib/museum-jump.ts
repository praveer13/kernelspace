/**
 * Going to an Error Museum entry (docs/specs/wave-2.md §15.6): scroll to it and move focus to its heading, the same two
 * things a deep-link load does. A bare `#E0597` anchor scrolls but leaves focus where it was (on `body`, after a click on
 * a chip), so the next Tab starts from the top of the page and a screen reader says nothing about the entry it landed on.
 *
 * Plain functions over the slice of the document they use, so a test drives them with a fake.
 */

export interface EntryHeading {
  focus(options?: { preventScroll?: boolean }): void
}

export interface EntryLike {
  scrollIntoView(options?: { behavior?: 'auto' | 'instant' | 'smooth' }): void
  querySelector(selector: string): EntryHeading | null
}

export interface EntryScope {
  getElementById(id: string): EntryLike | null
}

/**
 * Scrolls to the entry with this id and focuses its `h2` (which is `tabIndex={-1}`). `behavior` is `instant` for a
 * deep link, which jumps as the browser's own fragment scroll would, and the learner's motion preference (`scrollBehavior`
 * in lesson-scroll.ts: `auto` under reduced motion) for a click. False when the page has no such entry.
 */
export function jumpToEntry(scope: EntryScope, id: string, behavior: 'auto' | 'instant' | 'smooth'): boolean {
  const entry = scope.getElementById(id)
  if (entry === null) return false
  entry.scrollIntoView({ behavior })
  // preventScroll: the scroll above is the only one, so reduced motion is honoured and a smooth scroll is not cut short
  entry.querySelector('h2')?.focus({ preventScroll: true })
  return true
}

/** A plain left click: a modified one (new tab, download) keeps the link's own behaviour. */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
