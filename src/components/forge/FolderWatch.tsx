/**
 * Folder watch (docs/specs/wave-2.md §16.3): pick the folder that holds `target/` once and re-run on every rebuild, in
 * Chromium, with the drop zone above as the fallback. Where the browser has no directory picker (Firefox, Safari) the
 * component renders only its hidden marker, so those learners see the page they had.
 *
 * `onModule` is ForgeLab's own `onFile`, the handler a drop calls: a rebuilt `.wasm` goes through the same grading,
 * credit and ledger path as a dropped one. The watcher itself (src/lib/forge/watch.ts) reads only `target/`, uploads
 * nothing and keeps no handle past this page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { ForgeLab } from '@/data/labs'
import { createWatcher, pickBuildFolder, watchLine, watchSupported, type Watcher, type WatchStatus } from '@/lib/forge/watch'

export interface FolderWatchProps {
  lab: ForgeLab
  /** Grades a module the watcher found: what a drop on the zone calls. */
  onModule(file: File): void | Promise<void>
}

const BUTTON =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-sm border border-line-bright bg-surface-3 px-3 py-1.5 text-body-sm text-text-1 transition-colors duration-150 hover:bg-surface-2 [@media(pointer:coarse)]:min-h-11'

export function FolderWatch({ lab, onModule }: FolderWatchProps) {
  // Decided once at mount: the page is client-rendered, and with no `window` (a static render) it is the hidden marker.
  const [supported] = useState(() => watchSupported())
  const [status, setStatus] = useState<WatchStatus | null>(null)
  const watcher = useRef<Watcher | null>(null)
  // The watcher calls the latest handler, so a re-render of the page never needs a new watcher.
  const handler = useRef(onModule)
  useEffect(() => {
    handler.current = onModule
  }, [onModule])

  const stop = useCallback(() => {
    watcher.current?.stop()
    watcher.current = null
    setStatus(null)
  }, [])
  // A watcher belongs to one lab's page; leaving it (or switching labs) stops the poll.
  useEffect(() => stop, [stop, lab.id])

  const start = async () => {
    let root
    try {
      root = await pickBuildFolder()
    } catch {
      return
    }
    if (!root) return
    watcher.current?.stop()
    const next = createWatcher({ root, artifact: lab.artifact, onModule: (f) => handler.current(f), onStatus: setStatus })
    watcher.current = next
    setStatus(next.status)
    next.start()
  }

  if (!supported) return <div hidden data-folder-watch={lab.id} />

  const file = lab.artifact.split('/').pop() ?? lab.artifact
  // 'denied' ends the watch: the button goes back to "watch" so the learner can pick again.
  const watching = status !== null && status.kind !== 'denied'
  return (
    <div data-folder-watch={lab.id} className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        {watching ? (
          <button type="button" className={BUTTON} onClick={stop}>
            <EyeOff size={14} aria-hidden /> Stop watching
          </button>
        ) : (
          <button type="button" className={BUTTON} onClick={() => void start()}>
            <Eye size={14} aria-hidden /> Watch my build folder
          </button>
        )}
        <p className="min-w-0 max-w-md font-mono text-[11px] text-text-3">
          Chromium only · pick the folder that holds target/ · reads only {lab.artifact} · nothing is uploaded · forgotten when you leave the page
        </p>
      </div>
      <p role="status" data-watch-status className="mt-3 min-w-0 break-words text-body-sm text-text-2">
        {watchLine(status, file)}
      </p>
    </div>
  )
}

export default FolderWatch
