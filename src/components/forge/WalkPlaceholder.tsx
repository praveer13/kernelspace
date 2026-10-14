/**
 * What stands where the PRIMM walk will be while its chunk loads (docs/specs/wave-2.md §13.1). A lab with a Forge bundle
 * never draws the plain page first: ForgeLab knows from the registry's glob keys, without loading anything, that the walk
 * is coming, so it lays out this placeholder with the walk's shape (five step tabs, a lead-in, a card) and the walk
 * replaces it in place. Nothing below it moves much and the drop zone mounts once, inside the walk.
 *
 * It is static: no timers, no motion, nothing to focus. The status line says what is happening; the walk's real
 * controls arrive with the chunk.
 */

const TABS = ['w-20', 'w-14', 'w-24', 'w-16', 'w-16']

export function WalkPlaceholder() {
  return (
    <div data-walk-placeholder aria-busy="true" className="space-y-3">
      <p role="status" className="font-mono text-[11px] text-text-3">
        loading the walk…
      </p>
      <ol className="flex flex-wrap gap-1.5" aria-hidden>
        {TABS.map((w, i) => (
          <li key={i} className={`h-[26px] rounded-xs border border-line bg-surface-1 [@media(pointer:coarse)]:h-11 ${w}`} />
        ))}
      </ol>
      <div aria-hidden className="h-5 max-w-xl rounded-xs bg-surface-1" />
      <div aria-hidden className="h-56 rounded-sm border border-line bg-surface-2" />
    </div>
  )
}

export default WalkPlaceholder
