import { Suspense, lazy, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'
import ErrataTab from '@/pages/changes/ErrataTab'
import FieldNotesTab from '@/pages/changes/FieldNotesTab'
import ErrorBoundary from '@/components/ErrorBoundary'
import RouteFallback from '@/components/RouteFallback'
import { cn } from '@/lib/utils'

// The registry table pulls in the whole claims dataset; load it only when the tab opens.
const ClaimsTable = lazy(() => import('@/components/ClaimsTable'))

/**
 * Changes surface (PLAN-100X §5.2 S1, §7.3): `/freshness`. The active tab lives in `?tab=`
 * so /field-notes can redirect straight to the Field Notes tab.
 */
const TABS = [
  { id: 'errata', label: 'Errata' },
  { id: 'field-notes', label: 'Field Notes' },
  { id: 'claims', label: 'Claims' },
] as const

type TabId = (typeof TABS)[number]['id']

const isTabId = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value)

export default function Changes() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const active: TabId = isTabId(requested) ? requested : TABS[0].id

  const select = (id: TabId) => setParams({ tab: id }, { replace: true })

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = TABS[(index + step + TABS.length) % TABS.length]
    select(next.id)
    document.getElementById(`changes-tab-${next.id}`)?.focus()
  }

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        changes · errata, field notes and claims
      </p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-text-1 sm:text-5xl">
        What changed, and which lesson it changes
      </h1>

      <div role="tablist" aria-label="Changes" className="mt-8 flex gap-6 border-b border-line">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`changes-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`changes-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px border-b-2 py-3 font-mono text-body-sm transition-colors duration-150',
              active === tab.id
                ? 'border-accent text-text-1'
                : 'border-transparent text-text-3 hover:text-text-1',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`changes-panel-${active}`}
        aria-labelledby={`changes-tab-${active}`}
        className="mt-8"
      >
        {active === 'errata' && <ErrataTab />}
        {active === 'field-notes' && <FieldNotesTab />}
        {active === 'claims' && (
          <ErrorBoundary label="the claims table">
            <Suspense fallback={<RouteFallback label="loading claims" />}>
              <ClaimsTable />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
