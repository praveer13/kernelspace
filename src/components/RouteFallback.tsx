/**
 * Suspense fallback for lazy routes and heavy panels. Static on purpose (no
 * spinner, no animation) so it is calm for reduced-motion users; the live
 * region announces the wait to screen readers.
 */
export default function RouteFallback({ label = 'loading page' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-5xl px-6 py-24">
      <p className="section-label">0x00 — {label}</p>
      <p className="mt-3 font-mono text-body-sm text-text-3">mapping pages into memory…</p>
    </div>
  )
}
