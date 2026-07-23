/**
 * RustLab — ownership & concurrency teaching machine.
 *
 * Mounted as a mode inside AllocatorSim (host simId: sim-allocator).
 * Two tabs:
 *   - Ownership: steppable box/arrow diagrams for moves, borrows, lifetimes,
 *     and the arena-index refactor.
 *   - Concurrency: channel pipeline, mutex Amdahl collapse, atomic ping-pong,
 *     and the Rc-is-not-Send compile error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  MessageSquare,
  Play,
  RefreshCcw,
  RotateCcw,
  Shuffle,
  Zap,
} from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
} from '@/components/sims/PlaygroundShell'

const HOST_SIM_ID = 'sim-allocator'

const COLORS = {
  mint: '#3EF2A4',
  cyan: '#22D3EE',
  violet: '#A78BFA',
  amber: '#FBBF24',
  rose: '#FF5C6C',
  text1: '#E8E8EF',
  text2: '#A0A0B0',
  text3: '#6E6E80',
  surface2: '#1E1E2E',
  line: '#2E2E40',
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function useTickLog() {
  const { lines, log, clear } = useSimLog()
  const tickRef = useRef(0)
  const bump = useCallback(() => {
    tickRef.current += 1
    return tickRef.current
  }, [])
  return { lines, log, clear, bump }
}

function fmtNs(ns: number): string {
  if (ns >= 1000) return `${(ns / 1000).toFixed(1)} µs`
  return `${Math.round(ns)} ns`
}

function fmtMops(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} Gops/s`
  return `${m.toFixed(1)} Mops/s`
}

/* ------------------------------------------------------------------ */
/* Ownership tab                                                      */
/* ------------------------------------------------------------------ */

type OwnScenario = 'move' | 'borrow' | 'lifetime' | 'arena'

interface OwnStep {
  line: number
  caption: string
  error?: string
  errorLine?: number
}

interface OwnScenarioDef {
  label: string
  code: string[]
  steps: OwnStep[]
  fixLabel?: string
}

const OWN_SCENARIOS: Record<OwnScenario, OwnScenarioDef> = {
  move: {
    label: 'move',
    code: [
      'fn main() {',
      '    let a = String::from("hello");',
      '    let b = a;',
      '    println!("{}", a);',
      '}',
    ],
    steps: [
      { line: 1, caption: '`a` owns the heap String.' },
      { line: 2, caption: 'Ownership moves to `b`; `a` is now uninitialized.' },
      {
        line: 3,
        caption: 'Borrow checker rejects use of moved value `a`.',
        error: 'error[E0382]: borrow of moved value: `a`\n  --> src/main.rs:4:20\n   |\n 3 |     let b = a;\n   |         - value moved here\n 4 |     println!("{}", a);\n   |                    ^ value borrowed here after move',
        errorLine: 3,
      },
    ],
  },
  borrow: {
    label: 'shared + mutable',
    code: [
      'fn main() {',
      '    let mut v = vec![1, 2];',
      '    let r1 = &v;',
      '    let r2 = &v;',
      '    v.push(3);',
      '    println!("{} {}", r1, r2);',
      '}',
    ],
    steps: [
      { line: 1, caption: '`v` owns the Vec on the heap.' },
      { line: 2, caption: 'Shared borrow `r1` is live.' },
      { line: 3, caption: 'A second shared borrow `r2` is allowed.' },
      {
        line: 4,
        caption: 'Cannot mutate `v` while shared borrows are live.',
        error: 'error[E0502]: cannot borrow `v` as mutable because it is also borrowed as immutable\n  --> src/main.rs:5:5\n   |\n 3 |     let r1 = &v;\n   |     ----------- immutable borrow occurs here\n 5 |     v.push(3);\n   |     ^^^^^^^^^ mutable borrow occurs here',
        errorLine: 4,
      },
      { line: 5, caption: 'After the borrows end, the shared refs are readable.' },
    ],
  },
  lifetime: {
    label: 'lifetime',
    code: [
      'fn dangling() -> &String {',
      '    let s = String::from("x");',
      '    &s',
      '}',
    ],
    fixLabel: 'return owned',
    steps: [
      { line: 0, caption: 'Function promises to return a reference.' },
      { line: 1, caption: '`s` is a local owned value on the stack.' },
      {
        line: 2,
        caption: 'Returning `&s` would point into a dead stack frame.',
        error: 'error[E0106]: missing lifetime specifier\n  --> src/main.rs:1:19\n   |\n 1 | fn dangling() -> &String {\n   |                   ^ expected named lifetime parameter\nhelp: consider returning an owned value',
        errorLine: 2,
      },
    ],
  },
  arena: {
    label: 'arena refactor',
    code: [
      'struct Node { next: &Node }',
      'let mut arena: Vec<Node> = vec![];',
      'arena.push(Node { next: &arena[0] });',
    ],
    fixLabel: 'use indices',
    steps: [
      {
        line: 0,
        caption: 'Self-referential structs fight the borrow checker.',
        error: 'error[E0106]: missing lifetime specifier\n  --> src/main.rs:1:22\n   |\n 1 | struct Node { next: &Node }\n   |                      ^ expected named lifetime parameter',
        errorLine: 0,
      },
      {
        line: 2,
        caption: 'Arena indices break the aliasing problem: they are just numbers.',
      },
    ],
  },
}

function OwnershipDiagram({
  scenario,
  step,
  fixed,
}: {
  scenario: OwnScenario
  step: number
  fixed: boolean
}) {
  if (scenario === 'move') {
    const aDead = step >= 1
    const bOwns = step >= 1
    const err = step === 2
    return (
      <svg viewBox="0 0 420 220" className="h-auto w-full max-w-[420px]">
        {/* stack */}
        <rect x="20" y="20" width="160" height="180" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="30" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          stack
        </text>
        {/* var a */}
        <motion.rect
          x="40"
          y="60"
          width="120"
          height="44"
          rx="3"
          fill={aDead ? '#252530' : COLORS.surface2}
          stroke={aDead ? COLORS.line : COLORS.cyan}
          animate={{ opacity: aDead ? 0.45 : 1 }}
        />
        <text x="55" y="85" fill={aDead ? COLORS.text3 : COLORS.cyan} className="font-mono text-[12px]">
          a
        </text>
        {aDead && (
          <text x="55" y="105" fill={COLORS.text3} className="font-mono text-[9px]">
            moved
          </text>
        )}
        {/* var b */}
        <motion.rect
          x="40"
          y="130"
          width="120"
          height="44"
          rx="3"
          fill={bOwns ? `${COLORS.mint}14` : COLORS.surface2}
          stroke={bOwns ? COLORS.mint : COLORS.line}
          animate={{ opacity: bOwns ? 1 : 0.45 }}
        />
        <text x="55" y="155" fill={bOwns ? COLORS.mint : COLORS.text3} className="font-mono text-[12px]">
          b
        </text>

        {/* heap */}
        <rect x="240" y="20" width="160" height="180" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="250" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          heap
        </text>
        <motion.rect
          x="260"
          y="80"
          width="120"
          height="60"
          rx="3"
          fill={bOwns ? `${COLORS.mint}14` : `${COLORS.cyan}14`}
          stroke={bOwns ? COLORS.mint : COLORS.cyan}
        />
        <text x="275" y="115" fill={COLORS.text1} className="font-mono text-[12px]">
          "hello"
        </text>

        {/* ownership arrow */}
        <motion.path
          d={bOwns ? 'M160 152 L260 110' : 'M160 82 L260 110'}
          fill="none"
          stroke={bOwns ? COLORS.mint : COLORS.cyan}
          strokeWidth="2"
          markerEnd="url(#arrow)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3 }}
        />
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill={COLORS.text2} />
          </marker>
        </defs>

        {err && (
          <g>
            <rect x="90" y="160" width="240" height="44" rx="4" fill={`${COLORS.rose}18`} stroke={COLORS.rose} />
            <text x="105" y="185" fill={COLORS.rose} className="font-mono text-[10px]">
              use of moved value: `a`
            </text>
          </g>
        )}
      </svg>
    )
  }

  if (scenario === 'borrow') {
    const showR1 = step >= 1
    const showR2 = step >= 2
    const err = step === 3
    return (
      <svg viewBox="0 0 440 240" className="h-auto w-full max-w-[440px]">
        <rect x="20" y="20" width="160" height="200" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="30" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          stack
        </text>

        {/* v */}
        <rect x="40" y="60" width="120" height="40" rx="3" fill={`${COLORS.amber}14`} stroke={COLORS.amber} />
        <text x="55" y="85" fill={COLORS.amber} className="font-mono text-[12px]">
          v
        </text>

        {/* r1 */}
        <motion.rect
          x="40"
          y="120"
          width="120"
          height="34"
          rx="3"
          fill={showR1 ? `${COLORS.cyan}14` : COLORS.surface2}
          stroke={showR1 ? COLORS.cyan : COLORS.line}
          animate={{ opacity: showR1 ? 1 : 0.3 }}
        />
        <text x="55" y="141" fill={showR1 ? COLORS.cyan : COLORS.text3} className="font-mono text-[12px]">
          r1 = &v
        </text>

        {/* r2 */}
        <motion.rect
          x="40"
          y="166"
          width="120"
          height="34"
          rx="3"
          fill={showR2 ? `${COLORS.violet}14` : COLORS.surface2}
          stroke={showR2 ? COLORS.violet : COLORS.line}
          animate={{ opacity: showR2 ? 1 : 0.3 }}
        />
        <text x="55" y="187" fill={showR2 ? COLORS.violet : COLORS.text3} className="font-mono text-[12px]">
          r2 = &v
        </text>

        {/* heap */}
        <rect x="260" y="20" width="160" height="200" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="270" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          heap
        </text>
        <rect x="280" y="80" width="120" height="80" rx="3" fill={`${COLORS.amber}14`} stroke={COLORS.amber} />
        <text x="295" y="125" fill={COLORS.text1} className="font-mono text-[12px]">
          Vec [1, 2]
        </text>

        {/* borrow arrows */}
        {showR1 && (
          <motion.path
            d="M160 137 L280 120"
            fill="none"
            stroke={COLORS.cyan}
            strokeWidth="2"
            markerEnd="url(#arrow)"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
          />
        )}
        {showR2 && (
          <motion.path
            d="M160 183 L280 140"
            fill="none"
            stroke={COLORS.violet}
            strokeWidth="2"
            markerEnd="url(#arrow)"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
          />
        )}

        {err && (
          <g>
            <rect x="70" y="185" width="300" height="44" rx="4" fill={`${COLORS.rose}18`} stroke={COLORS.rose} />
            <text x="85" y="210" fill={COLORS.rose} className="font-mono text-[10px]">
              cannot borrow `v` as mutable because shared borrows are live
            </text>
          </g>
        )}
      </svg>
    )
  }

  if (scenario === 'lifetime') {
    const err = !fixed && step === 2
    return (
      <svg viewBox="0 0 440 220" className="h-auto w-full max-w-[440px]">
        <rect x="20" y="20" width="180" height="180" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="30" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          stack frame of dangling()
        </text>
        <motion.rect
          x="40"
          y="80"
          width="140"
          height="50"
          rx="3"
          fill={fixed ? `${COLORS.mint}14` : `${COLORS.rose}14`}
          stroke={fixed ? COLORS.mint : COLORS.rose}
        />
        <text x="55" y="110" fill={COLORS.text1} className="font-mono text-[12px]">
          {fixed ? 'String "x"' : 's (about to drop)'}
        </text>

        <rect x="260" y="20" width="160" height="180" rx="4" fill="#151520" stroke={COLORS.line} />
        <text x="270" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
          caller
        </text>
        <motion.path
          d="M180 105 L260 105"
          fill="none"
          stroke={fixed ? COLORS.mint : COLORS.rose}
          strokeWidth="2"
          strokeDasharray={fixed ? undefined : '4 4'}
          markerEnd="url(#arrow)"
        />
        <text x="270" y="110" fill={COLORS.text1} className="font-mono text-[11px]">
          {fixed ? 'owns the value' : 'dangling reference'}
        </text>

        {err && (
          <g>
            <rect x="60" y="155" width="320" height="50" rx="4" fill={`${COLORS.rose}18`} stroke={COLORS.rose} />
            <text x="75" y="175" fill={COLORS.rose} className="font-mono text-[10px]">
              `s` dropped while borrowed
            </text>
            <text x="75" y="192" fill={COLORS.rose} className="font-mono text-[9px]">
              return an owned String instead
            </text>
          </g>
        )}
      </svg>
    )
  }

  // arena
  const useIdx = fixed || step >= 1
  return (
    <svg viewBox="0 0 460 240" className="h-auto w-full max-w-[460px]">
      <rect x="20" y="20" width="180" height="200" rx="4" fill="#151520" stroke={COLORS.line} />
      <text x="30" y="42" fill={COLORS.text3} className="font-mono text-[10px] uppercase">
        arena Vec
      </text>

      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="40" y={60 + i * 50} width="140" height="38" rx="3" fill={COLORS.surface2} stroke={COLORS.line} />
          <text x="55" y={83 + i * 50} fill={COLORS.text1} className="font-mono text-[12px]">
            {useIdx ? `Node ${i} → ${i === 2 ? 0 : i + 1}` : `Node ${i} → &Node${i === 2 ? 0 : i + 1}`}
          </text>
        </g>
      ))}

      {!useIdx && (
        <g>
          <rect x="240" y="160" width="200" height="60" rx="4" fill={`${COLORS.rose}18`} stroke={COLORS.rose} />
          <text x="255" y="185" fill={COLORS.rose} className="font-mono text-[10px]">
            self-referential struct
          </text>
          <text x="255" y="205" fill={COLORS.rose} className="font-mono text-[9px]">
            cannot name a lifetime for `&Node`
          </text>
        </g>
      )}

      {useIdx && (
        <g>
          <rect x="240" y="160" width="200" height="60" rx="4" fill={`${COLORS.mint}18`} stroke={COLORS.mint} />
          <text x="255" y="185" fill={COLORS.mint} className="font-mono text-[10px]">
            indices are just usize
          </text>
          <text x="255" y="205" fill={COLORS.mint} className="font-mono text-[9px]">
            no borrows, cache-friendly, compiles
          </text>
        </g>
      )}
    </svg>
  )
}

function OwnershipTab({
  log,
  bump,
}: {
  log: (tick: number, tag: string, msg: string, level?: 'op' | 'ok' | 'warn' | 'err') => void
  bump: () => number
}) {
  const [scenario, setScenario] = useState<OwnScenario>('move')
  const [step, setStep] = useState(0)
  const [fixed, setFixed] = useState(false)
  const [visitedSteps, setVisitedSteps] = useState<Partial<Record<OwnScenario, Set<number>>>>({
    move: new Set([0]),
  })

  const def = OWN_SCENARIOS[scenario]
  const maxStep = def.steps.length - 1
  const current = def.steps[step]


  const selectScenario = useCallback((nextScenario: OwnScenario) => {
    setScenario(nextScenario)
    setStep(0)
    setFixed(false)
    setVisitedSteps((previous) => ({
      ...previous,
      [nextScenario]: new Set(previous[nextScenario] ?? []).add(0),
    }))
  }, [])

  const go = useCallback(
    (dir: number) => {
      const next = Math.max(0, Math.min(maxStep, step + dir))
      setStep(next)
      setVisitedSteps((previous) => ({
        ...previous,
        [scenario]: new Set(previous[scenario] ?? []).add(next),
      }))
      const t = bump()
      log(t, 'OWN', `${def.label} step ${next + 1}/${def.steps.length}`)
    },
    [def, maxStep, step, bump, log, scenario],
  )

  const reset = useCallback(() => {
    setStep(0)
    setFixed(false)
    setVisitedSteps((previous) => ({
      ...previous,
      [scenario]: new Set(previous[scenario] ?? []).add(0),
    }))
    log(bump(), 'OWN', 'reset scenario')
  }, [bump, log, scenario])

  const toggleFix = useCallback(() => {
    setFixed((v) => {
      const next = !v
      log(bump(), 'OWN', next ? 'fixed: return owned value / use indices' : 'reverted to borrow-checker error')
      return next
    })
  }, [bump, log])

  // Complete only after the learner has traversed the relevant proof state.
  useEffect(() => {
    const seen = visitedSteps[scenario]
    if (!seen) return
    if (scenario === 'move' && seen.has(0) && seen.has(1) && seen.has(2)) {
      completeSimTask(HOST_SIM_ID, 't-rust-move', 60)
    }
    if (scenario === 'borrow' && seen.has(1) && seen.has(2) && seen.has(3)) {
      completeSimTask(HOST_SIM_ID, 't-rust-borrow', 60)
    }
    if (scenario === 'lifetime' && seen.has(2)) {
      completeSimTask(HOST_SIM_ID, 't-rust-lifetime', 60)
    }
    if (scenario === 'arena' && seen.has(0) && fixed) {
      completeSimTask(HOST_SIM_ID, 't-rust-arena', 60)
    }
  }, [fixed, scenario, visitedSteps])

  const errorToShow = current.error && !fixed ? current.error : undefined
  const errorLine = current.errorLine ?? current.line

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
          <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
            scenario: {def.label}
          </span>
          <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
            step {step + 1}/{def.steps.length}
          </span>
          {errorToShow && (
            <span className="rounded-sm border border-danger/40 bg-danger/10 px-2 py-0.5 text-danger">
              borrow-checker error
            </span>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* code panel */}
          <div className="min-w-[260px] shrink-0 rounded-md border border-line bg-surface-1 p-3 font-mono text-[12px]">
            {def.code.map((ln, i) => {
              const isActive = i === current.line
              const isErr = errorToShow && i === errorLine
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 px-2 py-1"
                  style={{
                    backgroundColor: isErr ? `${COLORS.rose}18` : isActive ? '#2A2A3A' : 'transparent',
                    borderRadius: 2,
                  }}
                >
                  <span className="w-5 shrink-0 text-right text-text-3 select-none">{i + 1}</span>
                  <span className={isErr ? 'text-danger' : isActive ? 'text-text-1' : 'text-text-2'}>{ln}</span>
                </div>
              )
            })}
          </div>

          {/* diagram */}
          <div className="flex-1">
            <OwnershipDiagram scenario={scenario} step={step} fixed={fixed} />
          </div>
        </div>

        <AnimatePresence>
          {errorToShow && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mt-5 max-w-2xl rounded-md border border-danger/40 bg-danger/10 p-3 font-mono text-[10px] leading-relaxed text-danger whitespace-pre-wrap"
            >
              <div className="mb-2 flex items-center gap-2 font-mono text-[11px]">
                <AlertTriangle size={12} />
                <span>rustc</span>
              </div>
              {errorToShow}
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
          {current.caption}
          {def.fixLabel && (
            <>
              {' '}
              Toggle <span className="text-text-1">{def.fixLabel}</span> to see the accepted version.
            </>
          )}
        </p>
      </div>

      {/* controls */}
      <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[300px] lg:border-l lg:border-t-0">
        <ControlGroup label="scenario">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(OWN_SCENARIOS) as OwnScenario[]).map((s) => (
              <ChipButton key={s} active={scenario === s} onClick={() => selectScenario(s)}>
                {OWN_SCENARIOS[s].label}
              </ChipButton>
            ))}
          </div>
        </ControlGroup>

        <ControlGroup label="stepper">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous ownership step"
              onClick={() => go(-1)}
              disabled={step === 0}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex-1 text-center font-mono text-[11px] text-text-2">
              step {step + 1} / {def.steps.length}
            </div>
            <button
              type="button"
              aria-label="Next ownership step"
              onClick={() => go(1)}
              disabled={step === maxStep}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-2 text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface-2 py-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text-1"
          >
            <RotateCcw size={12} /> reset
          </button>
        </ControlGroup>

        {def.fixLabel && (
          <ControlGroup label="refactor" className="border-b-0">
            <ChipButton active={fixed} color={COLORS.mint} onClick={toggleFix}>
              {fixed ? def.fixLabel : `enable: ${def.fixLabel}`}
            </ChipButton>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              {scenario === 'lifetime'
                ? 'Returning an owned value transfers ownership to the caller — no dangling reference possible.'
                : 'Indices into a Vec are plain numbers, not references, so aliasing rules disappear.'}
            </p>
          </ControlGroup>
        )}
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Concurrency tab                                                    */
/* ------------------------------------------------------------------ */

const STAGE_MAX = 4
const CS_MIN_NS = 50
const CS_MAX_NS = 50000

function pipelineThroughput(stages: number): number {
  const base = 120 // Mops/s ideal single stage
  const overhead = 8
  return (base * stages) / (overhead + stages)
}

function mutexThroughput(csNs: number, threads = 16): number {
  const baseNs = 20
  const serialFraction = csNs / (baseNs + csNs)
  // Amdahl-ish: max throughput limited by serial fraction
  const maxOps = 1000 / Math.max(baseNs, csNs)
  return maxOps * (1 - serialFraction) * Math.sqrt(threads) * 0.5
}

function atomicThroughput(shards: boolean, threads = 16): number {
  const base = 180 // Mops/s on one cache line
  if (!shards) return base / (1 + threads / 8)
  const shardCount = 8
  return (base * shardCount) / (1 + threads / (shardCount * 3))
}

function ThroughputBar({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  const pct = Math.min(100, Math.max(2, (value / max) * 100))
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
        <span className="text-text-2">{label}</span>
        <span className="text-text-1">{fmtMops(value)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.35 }}
        />
      </div>
    </div>
  )
}

function ConcurrencyTab({
  log,
  bump,
}: {
  log: (tick: number, tag: string, msg: string, level?: 'op' | 'ok' | 'warn' | 'err') => void
  bump: () => number
}) {
  const reducedMotion = usePrefersReducedMotion()

  const [pipelineStages, setPipelineStages] = useState(1)
  const [pipelineRan, setPipelineRan] = useState(false)
  const [pipelineRuns, setPipelineRuns] = useState<Set<number>>(new Set())

  const [csNs, setCsNs] = useState(50)
  const [mutexRan, setMutexRan] = useState(false)
  const [mutexRuns, setMutexRuns] = useState<Set<number>>(new Set())

  const [atomicShards, setAtomicShards] = useState(false)
  const [atomicRan, setAtomicRan] = useState(false)
  const [atomicModesRun, setAtomicModesRun] = useState<Set<'single' | 'sharded'>>(new Set())

  const [sendMode, setSendMode] = useState<'rc' | 'arc'>('rc')
  const [sendRan, setSendRan] = useState(false)
  const [sendModesRun, setSendModesRun] = useState<Set<'rc' | 'arc'>>(new Set())

  const pipeTp = useMemo(() => pipelineThroughput(pipelineStages), [pipelineStages])
  const mutexTp = useMemo(() => mutexThroughput(csNs), [csNs])
  const atomicTp = useMemo(() => atomicThroughput(atomicShards), [atomicShards])

  const runPipeline = useCallback(() => {
    const t = bump()
    setPipelineRan(true)
    setPipelineRuns((previous) => new Set(previous).add(pipelineStages))
    log(t, 'CHAN', `pipeline ${pipelineStages} stage${pipelineStages === 1 ? '' : 's'} → ${fmtMops(pipeTp)}`, 'ok')
  }, [bump, log, pipelineStages, pipeTp])

  const runMutex = useCallback(() => {
    const t = bump()
    setMutexRan(true)
    setMutexRuns((previous) => new Set(previous).add(csNs))
    log(t, 'MUTEX', `critical section ${fmtNs(csNs)} → ${fmtMops(mutexTp)}`, csNs > 1000 ? 'warn' : 'ok')
  }, [bump, log, csNs, mutexTp])

  const runAtomic = useCallback(() => {
    const t = bump()
    setAtomicRan(true)
    setAtomicModesRun((previous) => new Set(previous).add(atomicShards ? 'sharded' : 'single'))
    log(
      t,
      'ATOMIC',
      `${atomicShards ? 'sharded' : 'single-line'} 16 threads → ${fmtMops(atomicTp)}`,
      atomicShards ? 'ok' : 'warn',
    )
  }, [bump, log, atomicShards, atomicTp])

  const runSend = useCallback(() => {
    const t = bump()
    setSendRan(true)
    setSendModesRun((previous) => new Set(previous).add(sendMode))
    if (sendMode === 'rc') {
      log(t, 'SEND', 'Rc<String> cannot be sent across threads safely', 'err')
    } else {
      log(t, 'SEND', 'Arc<String> sent to 16 threads and counted down', 'ok')
    }
  }, [bump, log, sendMode])

  useEffect(() => {
    if (pipelineRuns.has(1) && pipelineRuns.has(4)) {
      completeSimTask(HOST_SIM_ID, 't-rust-pipeline', 60)
    }
  }, [pipelineRuns])

  useEffect(() => {
    if (mutexRuns.has(CS_MIN_NS) && mutexRuns.has(CS_MAX_NS)) {
      completeSimTask(HOST_SIM_ID, 't-rust-mutex', 60)
    }
  }, [mutexRuns])

  useEffect(() => {
    if (atomicModesRun.has('single') && atomicModesRun.has('sharded')) {
      completeSimTask(HOST_SIM_ID, 't-rust-atomic', 60)
    }
  }, [atomicModesRun])

  useEffect(() => {
    if (sendModesRun.has('rc')) {
      completeSimTask(HOST_SIM_ID, 't-rust-send', 60)
    }
  }, [sendModesRun])

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* pipeline card */}
          <div className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase text-text-3">
              <MessageSquare size={12} /> channel pipeline
            </div>
            <div className="mb-3 flex items-center gap-1">
              {Array.from({ length: STAGE_MAX }, (_, i) => (
                <div key={i} className="flex items-center">
                  <motion.div
                    className="flex h-8 w-12 items-center justify-center rounded-sm border font-mono text-[10px]"
                    style={{
                      borderColor: i < pipelineStages ? COLORS.cyan : COLORS.line,
                      backgroundColor: i < pipelineStages ? `${COLORS.cyan}14` : 'transparent',
                      color: i < pipelineStages ? COLORS.cyan : COLORS.text3,
                    }}
                    animate={
                      !reducedMotion && pipelineRan && i < pipelineStages
                        ? { opacity: [0.5, 1, 0.5] }
                        : { opacity: 1 }
                    }
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                  >
                    s{i + 1}
                  </motion.div>
                  {i < STAGE_MAX - 1 && (
                    <ArrowRight size={12} className="mx-1 text-text-3" />
                  )}
                </div>
              ))}
            </div>
            <ThroughputBar label="throughput" value={pipeTp} max={180} color={COLORS.cyan} />
            {pipelineRan && (
              <p className="font-mono text-[10px] text-text-3">
                {pipelineStages} stage{pipelineStages === 1 ? '' : 's'}: {fmtMops(pipeTp)} handoff throughput.
              </p>
            )}
          </div>

          {/* mutex card */}
          <div className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase text-text-3">
              <Lock size={12} /> mutex contention
            </div>
            <div className="mb-3 flex items-center gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <motion.div
                  key={i}
                  className="h-7 w-7 rounded-sm border font-mono text-[9px] flex items-center justify-center"
                  style={{
                    borderColor: mutexRan ? COLORS.amber : COLORS.line,
                    color: mutexRan ? COLORS.amber : COLORS.text3,
                  }}
                  animate={
                    !reducedMotion && mutexRan
                      ? { opacity: csNs > 1000 ? [1, 0.4, 1] : [0.6, 1, 0.6] }
                      : { opacity: 1 }
                  }
                  transition={{ duration: 0.4 + csNs / 50000, repeat: Infinity, delay: i * 0.05 }}
                >
                  T{i + 1}
                </motion.div>
              ))}
            </div>
            <ThroughputBar label="throughput" value={mutexTp} max={180} color={COLORS.amber} />
            {mutexRan && (
              <p className="font-mono text-[10px] text-text-3">
                {fmtNs(csNs)} critical section serializes {((1 - mutexTp / 180) * 100).toFixed(0)}% of work.
              </p>
            )}
          </div>

          {/* atomic card */}
          <div className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase text-text-3">
              <Zap size={12} /> hot atomic
            </div>
            <div className="mb-3 flex items-center gap-2">
              {!atomicShards ? (
                <div
                  className="flex h-10 w-full items-center justify-center rounded-sm border font-mono text-[10px]"
                  style={{ borderColor: COLORS.rose, color: COLORS.rose, backgroundColor: `${COLORS.rose}14` }}
                >
                  one cache line — 16 threads ping-pong
                </div>
              ) : (
                <div className="flex w-full flex-wrap gap-1">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div
                      key={i}
                      className="flex h-8 flex-1 items-center justify-center rounded-sm border font-mono text-[9px]"
                      style={{ borderColor: COLORS.mint, color: COLORS.mint, backgroundColor: `${COLORS.mint}14` }}
                    >
                      c{i}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <ThroughputBar label="throughput" value={atomicTp} max={400} color={atomicShards ? COLORS.mint : COLORS.rose} />
            {atomicRan && (
              <p className="font-mono text-[10px] text-text-3">
                {atomicShards
                  ? 'Sharded counters live on separate cache lines — no ping-pong.'
                  : 'Single cache line bounces between cores; throughput plateaus.'}
              </p>
            )}
          </div>

          {/* send card */}
          <div className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase text-text-3">
              <Shuffle size={12} /> Send inspector
            </div>
            <div className="mb-3 rounded-sm border border-line bg-ink p-3 font-mono text-[11px]">
              <div className="flex items-center gap-2 text-text-2">
                <span className="text-text-3">1</span>
                <span>
                  let data = <span className={sendMode === 'rc' ? 'text-danger' : 'text-accent'}>{sendMode === 'rc' ? 'Rc' : 'Arc'}</span>::new(String::from("x"));
                </span>
              </div>
              <div className="flex items-center gap-2 text-text-2">
                <span className="text-text-3">2</span>
                <span>thread::spawn(move || drop(data));</span>
              </div>
            </div>
            {sendRan && sendMode === 'rc' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-2 font-mono text-[9px] leading-relaxed text-danger"
              >
                {'error[E0277]: `Rc<String>` cannot be sent between threads safely\n  the trait bound `Rc<String>: Send` is not satisfied'}
              </motion.div>
            )}
            {sendRan && sendMode === 'arc' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mb-3 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 p-2 font-mono text-[10px] text-accent"
              >
                <Check size={12} /> compiles and runs
              </motion.div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={sendMode === 'rc'} color={COLORS.rose} onClick={() => setSendMode('rc')}>
                use Rc
              </ChipButton>
              <ChipButton active={sendMode === 'arc'} color={COLORS.mint} onClick={() => setSendMode('arc')}>
                use Arc
              </ChipButton>
            </div>
          </div>
        </div>
      </div>

      {/* controls */}
      <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[300px] lg:border-l lg:border-t-0">
        <ControlGroup label="channel pipeline">
          <SliderRow
            label="stages"
            value={pipelineStages}
            display={`${pipelineStages}`}
            min={1}
            max={STAGE_MAX}
            step={1}
            onChange={setPipelineStages}
          />
          <button
            type="button"
            onClick={runPipeline}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
          >
            <Play size={15} /> run pipeline
          </button>
        </ControlGroup>

        <ControlGroup label="mutex critical section">
          <SliderRow
            label="locked work"
            value={csNs}
            display={fmtNs(csNs)}
            min={CS_MIN_NS}
            max={CS_MAX_NS}
            step={50}
            onChange={setCsNs}
          />
          <button
            type="button"
            onClick={runMutex}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-mono text-[11px] text-text-1 transition-colors hover:bg-surface-3"
          >
            <Lock size={14} /> measure mutex
          </button>
        </ControlGroup>

        <ControlGroup label="hot atomic counter">
          <div className="flex items-center justify-between font-mono text-[11px] text-text-2">
            <span>16 threads</span>
            <span className="text-text-1">{atomicShards ? 'sharded' : 'single line'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ChipButton active={!atomicShards} color={COLORS.rose} onClick={() => setAtomicShards(false)}>
              single line
            </ChipButton>
            <ChipButton active={atomicShards} color={COLORS.mint} onClick={() => setAtomicShards(true)}>
              shard counters
            </ChipButton>
          </div>
          <button
            type="button"
            onClick={runAtomic}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-mono text-[11px] text-text-1 transition-colors hover:bg-surface-3"
          >
            <Zap size={14} /> measure atomic
          </button>
        </ControlGroup>

        <ControlGroup label="Send inspector" className="border-b-0">
          <p className="font-mono text-[10px] leading-relaxed text-text-3">
            Rc uses non-atomic reference counting and is intentionally <span className="text-danger">!Send</span>.
            Swap to Arc for thread-safe shared ownership.
          </p>
          <button
            type="button"
            onClick={runSend}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-mono text-[11px] text-text-1 transition-colors hover:bg-surface-3"
          >
            <Shuffle size={14} /> attempt send
          </button>
          <button
            type="button"
            onClick={() => {
              setPipelineRan(false)
              setMutexRan(false)
              setAtomicRan(false)
              setSendRan(false)
              setPipelineStages(1)
              setCsNs(50)
              setAtomicShards(false)
              setSendMode('rc')
              setPipelineRuns(new Set())
              setMutexRuns(new Set())
              setAtomicModesRun(new Set())
              setSendModesRun(new Set())
              log(bump(), 'CONC', 'reset all concurrency experiments')
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface-2 py-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text-1"
          >
            <RefreshCcw size={12} /> reset
          </button>
        </ControlGroup>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                     */
/* ------------------------------------------------------------------ */

export default function RustLab({
  initialTab = 'ownership',
}: {
  initialTab?: 'ownership' | 'concurrency'
}) {
  const { embed } = usePlaygroundContext()
  const { lines, log, clear, bump } = useTickLog()
  const [tab, setTab] = useState<'ownership' | 'concurrency'>(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const onTabChange = useCallback(
    (next: 'ownership' | 'concurrency') => {
      setTab(next)
      log(bump(), 'UI', `switched to ${next} tab`)
    },
    [bump, log],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-surface-1 px-4 py-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="RustLab tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ownership'}
            onClick={() => onTabChange('ownership')}
            className="rounded-sm border px-3 py-1.5 font-mono text-[11px] transition-colors duration-150"
            style={
              tab === 'ownership'
                ? { borderColor: `${COLORS.cyan}66`, backgroundColor: `${COLORS.cyan}14`, color: COLORS.cyan }
                : { borderColor: COLORS.line, color: COLORS.text2 }
            }
          >
            ownership
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'concurrency'}
            onClick={() => onTabChange('concurrency')}
            className="rounded-sm border px-3 py-1.5 font-mono text-[11px] transition-colors duration-150"
            style={
              tab === 'concurrency'
                ? { borderColor: `${COLORS.amber}66`, backgroundColor: `${COLORS.amber}14`, color: COLORS.amber }
                : { borderColor: COLORS.line, color: COLORS.text2 }
            }
          >
            concurrency
          </button>
        </div>
      </div>

      {tab === 'ownership' ? <OwnershipTab log={log} bump={bump} /> : <ConcurrencyTab log={log} bump={bump} />}

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
