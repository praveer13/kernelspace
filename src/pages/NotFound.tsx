import { LinkButton } from '@/components/Button'

/** 404 — styled as a segfault (design.md §11). */
export default function NotFound() {
  return (
    <section className="relative flex min-h-[70dvh] items-center overflow-hidden">
      <div aria-hidden className="absolute inset-0 bg-blueprint opacity-60" />
      <div className="relative mx-auto max-w-xl px-6 py-24 text-center">
        <p className="font-mono text-label uppercase text-danger">0x?? — page fault</p>
        <h1 className="mt-4 font-mono text-h2 text-text-1">
          Segmentation fault <span className="text-text-3">(core dumped)</span>
        </h1>
        <p className="mt-4 font-mono text-body-sm text-text-3">
          dereferenced address <span className="text-danger">0x0</span> — this route does not
          map to a valid page.
        </p>
        <div className="mt-8 flex justify-center">
          <LinkButton to="/" variant="secondary">
            return to safety →
          </LinkButton>
        </div>
      </div>
    </section>
  )
}
