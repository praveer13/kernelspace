/**
 * SimHost (P2, docs/specs/wave-1.md §10.1): a React context around one sim, not an iframe (a second
 * document would boot a second store). It hands the sim its config and machine, collects the
 * observations the task panels grade, and decides what reaches the URL:
 *
 *   lab    /lab/:simId. Config round-trips through `?cfg=` and `?machine=` exactly as before.
 *   embed  inline in a lesson. Config comes from props and stays in memory; the URL is never written.
 *   phone  inline below 640 px or on a coarse pointer: no sim, just predict → canonical outcome → queue.
 *
 * A sim that renders without a SimHost behaves as in lab mode.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import type { SimId } from '@/data/lessons/types'
import ErrorBoundary from '@/components/ErrorBoundary'
import RouteFallback from '@/components/RouteFallback'
import { TaskList } from '@/components/sims/TaskPanel'
import { SimHostContext, createFinishedStore, createObservationBus, decodeCfg, useTaskStates } from '@/lib/sims/host'
import type { SimHostInternal } from '@/lib/sims/host'
import { resolveTasks } from '@/lib/sims/registry'
import type { SimHostProps } from '@/lib/sims/types'

const NOOP = (): void => {}

// Each simulator is its own chunk; only the one being opened is fetched.
const LOADERS: Record<SimId, () => Promise<{ default: ComponentType }>> = {
  'sim-memory': () => import('@/components/sims/MemoryGridSim'),
  'sim-allocator': () => import('@/components/sims/AllocatorSim'),
  'sim-vm': () => import('@/components/sims/VmPagingSim'),
  'sim-roofline': () => import('@/components/sims/RooflineSim'),
  'sim-wgsl': () => import('@/components/sims/WgslSim'),
  'sim-quant': () => import('@/components/sims/QuantizerSim'),
  'sim-kv': () => import('@/components/sims/KvCacheSim'),
  'sim-batching': () => import('@/components/sims/BatchingSim'),
  'sim-engine': () => import('@/components/sims/ToyEngineSim'),
}

const SIMS = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)]),
) as Record<SimId, LazyExoticComponent<ComponentType>>

export interface SimHostComponentProps extends SimHostProps {
  /** Rendered instead of the sim (tests and previews); default: the sim for `simId`. */
  children?: ReactNode
  /**
   * Inline modes: rendered under the tasks with whether every listed task is finished. The exercise block
   * uses it to keep "what just happened" shut until then.
   */
  renderNote?: (unlocked: boolean) => ReactNode
}

export default function SimHost(props: SimHostComponentProps) {
  return props.mode === 'lab' ? <LabHost {...props} /> : <InlineHost {...props} />
}

function SimView({ simId, lab, children }: { simId: SimId; lab?: boolean; children?: ReactNode }) {
  const Sim = SIMS[simId]
  return (
    <Suspense
      fallback={
        lab ? (
          <RouteFallback label="loading simulator" />
        ) : (
          <p role="status" className="px-5 py-10 font-mono text-body-sm text-text-3">
            loading simulator…
          </p>
        )
      }
    >
      {children ?? <Sim />}
    </Suspense>
  )
}

/* ------------------------------------------------------------------ */
/* lab                                                                 */
/* ------------------------------------------------------------------ */

function LabHost({ simId, machine, taskIds, lessonId, children }: SimHostComponentProps) {
  const [searchParams] = useSearchParams()
  const [initialConfig] = useState<unknown>(() => decodeCfg<unknown>(searchParams.get('cfg')))
  const [bus] = useState(createObservationBus)
  const [finished] = useState(createFinishedStore)
  const urlMachine = searchParams.get('machine') ?? undefined
  const urlFrom = searchParams.get('from') ?? undefined
  const value = useMemo<SimHostInternal>(
    () => ({
      simId,
      mode: 'lab',
      machine: machine ?? urlMachine,
      initialConfig,
      writeConfig: NOOP, // lab sims write ?cfg= and ?machine= through the shell's hooks, which never ask the host
      selectMachine: NOOP,
      observe: bus.emit,
      lessonId: lessonId ?? urlFrom,
      taskIds,
      bus,
      finished,
    }),
    [simId, machine, urlMachine, initialConfig, bus, lessonId, urlFrom, taskIds, finished],
  )

  return (
    <SimHostContext.Provider value={value}>
      <SimView simId={simId} lab>
        {children}
      </SimView>
    </SimHostContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* embed and phone                                                     */
/* ------------------------------------------------------------------ */

/** Inline hosts never call the router, so there is no URL for them to write. */
function InlineHost({ simId, mode, machine: machine0, config, taskIds, lessonId, children, renderNote }: SimHostComponentProps) {
  const [machine, setMachine] = useState(machine0)
  const [initialConfig] = useState<unknown>(config ?? null)
  const [bus] = useState(createObservationBus)
  const [finished] = useState(createFinishedStore)
  const value = useMemo<SimHostInternal>(
    () => ({
      simId,
      mode,
      machine,
      initialConfig,
      writeConfig: NOOP, // the sim keeps its own state; an inline host has nowhere to put a config but memory
      selectMachine: setMachine,
      observe: bus.emit,
      lessonId,
      taskIds,
      bus,
      finished,
    }),
    [simId, mode, machine, initialConfig, bus, lessonId, taskIds, finished],
  )

  return (
    <SimHostContext.Provider value={value}>
      <InlineBody simId={simId} mode={mode} machine={machine} taskIds={taskIds} renderNote={renderNote}>
        {children}
      </InlineBody>
    </SimHostContext.Provider>
  )
}

function InlineBody({
  simId,
  mode,
  machine,
  taskIds,
  renderNote,
  children,
}: Pick<SimHostComponentProps, 'simId' | 'mode' | 'taskIds' | 'renderNote' | 'children'> & { machine?: string }) {
  const tasks = useMemo(() => resolveTasks(simId, machine, taskIds), [simId, machine, taskIds])
  const { finished } = useTaskStates(tasks)
  // A cycle with a missed prediction is finished too. No resolved tasks means nothing to wait for: the
  // lesson test fails an unresolvable `taskIds`, so a learner is never locked out by a typo.
  const unlocked = tasks.every((t) => finished[t.id])
  return (
    <div data-sim-host={simId} data-mode={mode}>
      {mode !== 'phone' && (
        <div className="max-h-[85vh] overflow-auto border-b border-line bg-ink">
          <ErrorBoundary label="this simulator" resetKey={simId}>
            <SimView simId={simId}>{children}</SimView>
          </ErrorBoundary>
        </div>
      )}
      <div className="px-5 py-4">
        <TaskList simId={simId} machine={machine} taskIds={taskIds} />
      </div>
      {renderNote?.(unlocked)}
    </div>
  )
}
