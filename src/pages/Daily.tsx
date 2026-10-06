import { Link } from 'react-router'

/**
 * /daily (docs/specs/wave-2.md §9.7): the Fleet Daily. A placeholder until 2b-19 builds it. The route, its nav
 * entry, its precache (build-sw-manifest) and its 200 KB gate (verify-bundle) exist now, so the page that
 * replaces this file changes none of them.
 */
export default function Daily() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="daily" data-pending>
      <p className="section-label">0x00 — daily</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Fleet Daily</h1>
      <p className="mt-3 text-body-sm text-text-2">
        One new incident on a serving fleet each day, the same one for everybody on your date: read the alert, pick a
        suspect, probe, fix. It is not open yet.
      </p>
      <p className="mt-4">
        <Link to="/fleet" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Meanwhile, run the fleet yourself
        </Link>
      </p>
    </section>
  )
}
