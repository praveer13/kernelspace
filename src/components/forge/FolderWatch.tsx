/**
 * Folder watch (docs/specs/wave-2.md §16.3): pick the crate's build folder once and re-run on every rebuild, in
 * Chromium, with the drop zone as the fallback. A stub until task 2c-08 fills it; the props are final and ForgeLab
 * mounts it with them, so that task never edits the page.
 *
 * `onModule` is ForgeLab's own `onFile`, the handler a drop calls: a rebuilt `.wasm` goes through the same grading,
 * credit and ledger path as a dropped one.
 */

import type { ForgeLab } from '@/data/labs'

export interface FolderWatchProps {
  lab: ForgeLab
  /** Grades a module the watcher found: what a drop on the zone calls. */
  onModule(file: File): void | Promise<void>
}

/** A hidden marker for now: it shows where the finished component mounts, and for which lab. */
export function FolderWatch({ lab }: FolderWatchProps) {
  return <div hidden data-folder-watch={lab.id} />
}

export default FolderWatch
