import { Link } from 'react-router'

/**
 * /errors (docs/specs/wave-2.md §15.6): the Error Museum, a view of the compile bank. A placeholder until 2c-18
 * builds it; the route, nav entry, palette row and bundle report exist now.
 */
export default function Errors() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="errors" data-pending>
      <p className="section-label">0x00 — errors</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Error Museum</h1>
      <p className="mt-3 text-body-sm text-text-2">
        The compiler errors Rust learners meet most, each with the code that causes it and the fix. It is not open yet.
      </p>
      <p className="mt-4">
        <Link to="/curriculum" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Back to the curriculum
        </Link>
      </p>
    </section>
  )
}
