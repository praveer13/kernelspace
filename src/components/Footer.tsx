import { Link } from 'react-router'

const LEARN_LINKS = [
  { to: '/curriculum', label: 'Curriculum' },
  { to: '/lab', label: 'Lab' },
  { to: '/capstone', label: 'Capstone' },
  { to: '/glossary', label: 'Glossary' },
  { to: '/progress', label: 'Progress' },
]

const META_LINKS = [
  { href: '#method', label: 'Method' },
  { href: '#faq', label: 'FAQ' },
  { href: 'https://github.com', label: 'GitHub', external: true },
]

/**
 * Footer (design.md §9.14) — marketing routes only; app routes keep StatusBar.
 * Top border carries a 64px blueprint grid strip fading out.
 */
export default function Footer() {
  return (
    <footer className="relative border-t border-line">
      {/* blueprint grid strip fading out */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-blueprint [mask-image:linear-gradient(to_top,black,transparent)]"
      />
      <div className="mx-auto max-w-app px-6 py-16 lg:px-12">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link to="/" className="font-mono text-[15px] font-medium text-text-1">
              [<span className="wordmark-cursor" />]_kernelspace
            </Link>
            <p className="mt-4 max-w-xs font-display text-h4 text-text-1">
              From cache lines to continuous batching.
            </p>
            <p className="mt-3 max-w-xs text-body-sm text-text-3">
              Runs 100% in your browser. Your progress never leaves <code>localStorage</code>.
            </p>
          </div>

          {/* Learn */}
          <nav aria-label="Learn">
            <h3 className="font-mono text-label uppercase text-text-3">Learn</h3>
            <ul className="mt-4 space-y-2.5">
              {LEARN_LINKS.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-body-sm text-text-2 transition-colors duration-150 hover:text-accent"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Meta */}
          <nav aria-label="Meta">
            <h3 className="font-mono text-label uppercase text-text-3">Meta</h3>
            <ul className="mt-4 space-y-2.5">
              {META_LINKS.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...('external' in l ? { target: '_blank', rel: 'noreferrer' } : {})}
                    className="text-body-sm text-text-2 transition-colors duration-150 hover:text-accent"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 font-mono text-[11px] tracking-wide text-text-3 sm:flex-row sm:items-center sm:justify-between">
          <span>built static · deployed on the edge · no tracking</span>
          <span>© {new Date().getFullYear()} kernelspace</span>
        </div>
      </div>
    </footer>
  )
}
