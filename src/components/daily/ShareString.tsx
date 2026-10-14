import { useState } from 'react'

export interface ShareStringProps {
  /** `KS-Daily #47 · 3 probes · burn 18%` (world/daily's `shareString`): no hashes, seeds or components */
  text: string
}

/**
 * Step 7 (docs/specs/wave-2.md §9.7): the share string, copied to the clipboard or handed to Web Share where the
 * browser has it. A blocked clipboard says so and leaves the text selectable; both results are announced.
 */
export default function ShareString({ text }: ShareStringProps) {
  const [status, setStatus] = useState('')
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied to the clipboard.')
    } catch {
      setStatus('Copying was blocked. Select the text above and copy it.')
    }
  }
  async function share() {
    try {
      await navigator.share({ text })
      setStatus('Shared.')
    } catch (e) {
      // closing the share sheet is a choice, not an error
      if ((e as { name?: string }).name !== 'AbortError') setStatus('Sharing failed. Copy the text instead.')
    }
  }
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-share>
      <h3 className="font-display text-[16px] text-text-1">Share</h3>
      <p className="mt-2 select-all break-words rounded-md border border-line bg-ink p-3 font-mono text-[13px] text-text-1" data-share-string>
        {text}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
        >
          Copy result
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright">
            Share
          </button>
        )}
      </div>
      <p role="status" className="mt-2 min-h-5 text-[12px] text-text-2" data-share-status>
        {status}
      </p>
    </div>
  )
}
