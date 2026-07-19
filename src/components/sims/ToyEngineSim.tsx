/**
 * ToyEngineSim — SIM-09 `sim-engine` (playground.md §12, capstone.md §4).
 * The toy inference engine in free play: tokenize → embed → forward →
 * greedy decode → KV cache → continuous batching → TTFT/ITL, all visible.
 *
 * Default export wraps itself in PlaygroundShell (shared contract).
 * Named exports (EngineGlyph, GLYPH_STAGES) are reused by the Capstone page.
 * All engine logic lives in ./engine-core (pure TS, deterministic).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import {
  Pause,
  Play,
  RotateCcw,
  StepForward,
} from 'lucide-react'
import PlaygroundShell from './PlaygroundShell'
import {
  TOY_MODEL,
  SAMPLE_PROMPTS,
  KV_BLOCK_SIZE,
  tokenizeWithTrace,
  scriptIdsFor,
  greedyDecode,
  forwardAll,
  makeWorkload,
  simulateSchedule,
  tokenLabel,
  detokenize,
  EOS_ID,
} from './engine-core'
import type { Model } from './engine-core'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-engine'

const TASKS = [
  { id: 'tokenize', text: 'Tokenize a prompt and watch every merge round', xp: 60 },
  { id: 'forward', text: 'Run a full forward pass (reach the first decoded token)', xp: 60 },
  { id: 'decode', text: 'Naive-decode 8 tokens and watch the waste counter spin', xp: 60 },
  { id: 'kv', text: 'Enable the KV cache and cut mean ITL by 5× or more', xp: 60 },
  { id: 'batch', text: 'Run 4 concurrent sequences with continuous batching', xp: 60 },
]

type StageId = 'tokenize' | 'embed' | 'forward' | 'decode' | 'kv' | 'batch'

const STAGE_TABS: { id: StageId; label: string }[] = [
  { id: 'tokenize', label: 'tokenize' },
  { id: 'embed', label: 'embed' },
  { id: 'forward', label: 'forward' },
  { id: 'decode', label: 'decode' },
  { id: 'kv', label: 'kv cache' },
  { id: 'batch', label: 'batch' },
]

/* ------------------------------------------------------------------ */
/* EngineGlyph — the architecture diagram, reused by the capstone.     */
/* ------------------------------------------------------------------ */

export const GLYPH_STAGES = [
  { id: 'tokenize', short: 'TOK', label: 'tokenizer' },
  { id: 'embed', short: 'EMB', label: 'embed' },
  { id: 'forward', short: 'FWD', label: 'blocks ×2' },
  { id: 'decode', short: 'DEC', label: 'sampler' },
  { id: 'kv-cache', short: 'KV', label: 'kv cache' },
  { id: 'batch', short: 'BAT', label: 'batcher' },
  { id: 'measure', short: 'MSR', label: 'metrics' },
] as const

export function EngineGlyph({
  lit,
  active,
  className,
}: {
  /** number of stages lit (left→right) or stage ids when `litIds` used */
  lit: number
  /** index of the currently-active stage (pulsing ring) */
  active?: number
  className?: string
}) {
  const W = 92
  const G = 12
  const H = 52
  const y = 34
  const total = GLYPH_STAGES.length * W + (GLYPH_STAGES.length - 1) * G
  const ox = (720 - total) / 2
  return (
    <svg
      viewBox="0 0 720 120"
      className={className}
      role="img"
      aria-label={`Engine architecture: ${GLYPH_STAGES.map((s) => s.label).join(' → ')}`}
    >
      <defs>
        <linearGradient id="glyph-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3EF2A4" />
          <stop offset="50%" stopColor="#22D3EE" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      {GLYPH_STAGES.map((s, i) => {
        const x = ox + i * (W + G)
        const isLit = i < lit
        const isActive = active === i
        return (
          <g key={s.id}>
            {i > 0 && (
              <line
                x1={x - G}
                y1={y + H / 2}
                x2={x}
                y2={y + H / 2}
                stroke={i <= lit ? 'url(#glyph-grad)' : '#2C3A4F'}
                strokeWidth={1}
                strokeDasharray="4 4"
                className={i <= lit ? 'animate-dash-flow' : undefined}
              />
            )}
            <rect
              x={x}
              y={y}
              width={W}
              height={H}
              rx={8}
              fill={isLit ? 'rgba(62,242,164,.08)' : '#182130'}
              stroke={isLit ? 'url(#glyph-grad)' : '#2C3A4F'}
              strokeWidth={isLit ? 1.5 : 1}
              style={isLit ? { filter: 'drop-shadow(0 0 10px rgba(62,242,164,.25))' } : undefined}
            />
            {isActive && (
              <rect
                x={x - 3}
                y={y - 3}
                width={W + 6}
                height={H + 6}
                rx={10}
                fill="none"
                stroke="#3EF2A4"
                strokeWidth={1}
                className="animate-breathe"
              />
            )}
            <text
              x={x + W / 2}
              y={y + 22}
              textAnchor="middle"
              className="fill-text-1"
              fontSize={13}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={700}
            >
              {s.short}
            </text>
            <text
              x={x + W / 2}
              y={y + 40}
              textAnchor="middle"
              fontSize={10}
              fontFamily="JetBrains Mono, monospace"
              className={isLit ? 'fill-accent' : 'fill-text-3'}
            >
              {s.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Small view helpers                                                  */
/* ------------------------------------------------------------------ */

interface LogLine {
  id: number
  text: string
  kind: 'op' | 'hit' | 'warn' | 'err'
}

const LOG_KIND_CLASS: Record<LogLine['kind'], string> = {
  op: 'text-text-2',
  hit: 'text-accent',
  warn: 'text-amber',
  err: 'text-danger',
}

function fmtMs(ms: number): string {
  return ms >= 100 ? `${ms.toFixed(0)}ms` : `${ms.toFixed(1)}ms`
}

function fmtFlops(f: number): string {
  if (f >= 1e9) return `${(f / 1e9).toFixed(2)} GFLOP`
  if (f >= 1e6) return `${(f / 1e6).toFixed(2)} MFLOP`
  if (f >= 1e3) return `${(f / 1e3).toFixed(1)} KFLOP`
  return `${f.toFixed(0)} FLOP`
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: 'mint' | 'amber' }) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-mono text-body-sm font-medium',
          tone === 'amber' ? 'text-amber' : tone === 'mint' ? 'text-accent' : 'text-text-1',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stage panels                                                        */
/* ------------------------------------------------------------------ */

function TokenizePanel({
  text,
  shown,
  total,
  ids,
}: {
  text: string
  shown: number
  total: number
  ids: number[]
}) {
  const trace = useMemo(() => tokenizeWithTrace(text), [text])
  const idsNow = shown <= 0 ? [...text].map((c) => c.charCodeAt(0) - 30 + 2) : shown >= total ? ids : trace.events[shown - 1].idsAfter
  const lastEvent = shown > 0 && shown <= total ? trace.events[shown - 1] : null
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {idsNow.map((id, i) => (
          <span
            key={`${i}-${id}`}
            className={cn(
              'rounded-sm border px-2 py-1 font-mono text-xs transition-colors duration-200',
              lastEvent && i === lastEvent.at
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line bg-surface-2 text-text-2',
            )}
          >
            {tokenLabel(id).replace(' ', '␣')}
            <span className="ml-1.5 text-[9px] text-text-3">{id}</span>
          </span>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        merge rounds {Math.min(shown, total)}/{total}
        {lastEvent && (
          <span className="ml-2 text-accent">
            {tokenLabel(lastEvent.a)} + {tokenLabel(lastEvent.b)} → {tokenLabel(lastEvent.out)}
          </span>
        )}
      </p>
    </div>
  )
}

function EmbedPanel({ model, ids }: { model: Model; ids: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const unique = useMemo(() => [...new Set(ids)].slice(0, 24), [ids])
  const pts = useMemo(() => {
    const raw = unique.map((id) => ({ id, x: model.emb[id][0], y: model.emb[id][1] }))
    const xs = raw.map((p) => p.x)
    const ys = raw.map((p) => p.y)
    const mm = (arr: number[]) => [Math.min(...arr), Math.max(...arr)] as const
    const [x0, x1] = mm(xs)
    const [y0, y1] = mm(ys)
    const nx = (x: number) => 24 + ((x - x0) / Math.max(1e-9, x1 - x0)) * (480 - 48)
    const ny = (y: number) => 24 + ((y - y0) / Math.max(1e-9, y1 - y0)) * (220 - 48)
    return raw.map((p) => ({ ...p, cx: nx(p.x), cy: ny(p.y) }))
  }, [model, unique])
  const neighbors = useMemo(() => {
    if (hover == null) return []
    const h = model.emb[hover]
    return unique
      .filter((id) => id !== hover)
      .map((id) => ({
        id,
        dist: Math.sqrt(model.emb[id].reduce((s, v, c) => s + (v - h[c]) ** 2, 0)),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
  }, [model, unique, hover])
  return (
    <div className="flex flex-col gap-3 md:flex-row">
      <svg
        viewBox="0 0 480 220"
        className="w-full max-w-[480px] rounded-md border border-line bg-ink"
        role="img"
        aria-label="2D projection of the embedding table"
      >
        {pts.map((p) => (
          <g key={p.id}>
            <circle
              cx={p.cx}
              cy={p.cy}
              r={hover === p.id ? 7 : 5}
              className={cn(
                'cursor-crosshair transition-all duration-150',
                hover === p.id ? 'fill-accent' : 'fill-info/70',
              )}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
            />
            <text
              x={p.cx + 9}
              y={p.cy + 3}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              className="fill-text-3"
            >
              {tokenLabel(p.id).replace(' ', '␣')}
            </text>
          </g>
        ))}
      </svg>
      <div className="min-w-[180px] font-mono text-[11px] text-text-3">
        {hover == null ? (
          <p>hover a point — dims 0×1 of d={model.d}, nearest neighbors by full-vector distance</p>
        ) : (
          <>
            <p className="text-text-1">
              {tokenLabel(hover)} <span className="text-text-3">id {hover}</span>
            </p>
            <p className="mt-2 text-accent">nearest:</p>
            {neighbors.map((n) => (
              <p key={n.id} className="mt-1">
                {tokenLabel(n.id)} · d={n.dist.toFixed(3)}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function ForwardPanel({ model, ids }: { model: Model; ids: number[] }) {
  const [layer, setLayer] = useState(0)
  const [cell, setCell] = useState<{ i: number; j: number } | null>(null)
  const trace = useMemo(() => forwardAll(model, ids), [model, ids])
  const attn = trace.layers[Math.min(layer, trace.layers.length - 1)].attn
  const n = ids.length
  const size = 220
  const cellPx = size / n
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-text-3">
        <span>layer</span>
        {trace.layers.map((_, li) => (
          <button
            key={li}
            type="button"
            onClick={() => setLayer(li)}
            className={cn(
              'rounded-sm border px-2 py-0.5 transition-colors',
              li === layer
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
            )}
          >
            {li}
          </button>
        ))}
        <span className="ml-2">
          {cell
            ? `w[${cell.i}][${cell.j}] = ${attn[cell.i][cell.j].toFixed(3)} — "${tokenLabel(ids[cell.i])}" attends "${tokenLabel(ids[cell.j])}"`
            : 'hover a cell — causal mask keeps the upper triangle at 0'}
        </span>
      </div>
      <div className="flex items-start gap-3">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full max-w-[260px] rounded-md border border-line bg-ink"
          role="img"
          aria-label={`Attention weight heatmap, layer ${layer}`}
        >
          {attn.map((row, i) =>
            row.map((w, j) => (
              <rect
                key={`${i}-${j}`}
                x={j * cellPx}
                y={i * cellPx}
                width={cellPx}
                height={cellPx}
                fill={j > i ? '#111722' : `rgba(62,242,164,${0.06 + w * 0.9})`}
                stroke={
                  cell && ((cell.i === i && cell.j === j) || cell.i === j || cell.j === i)
                    ? '#FFB224'
                    : 'transparent'
                }
                strokeWidth={1}
                onMouseEnter={() => setCell({ i, j })}
                onMouseLeave={() => setCell(null)}
                className="cursor-crosshair"
              />
            )),
          )}
        </svg>
        <div className="hidden flex-col gap-1 font-mono text-[10px] text-text-3 sm:flex">
          {ids.map((id, i) => (
            <span
              key={i}
              className={cn(
                'rounded-sm px-1.5 py-0.5',
                cell && (cell.i === i || cell.j === i) && 'bg-amber/15 text-amber',
              )}
            >
              {i} {tokenLabel(id).replace(' ', '␣')}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        softmax rows sum to 1 · d={model.d} · logits over vocab {model.vocab}
      </p>
    </div>
  )
}

function KVPanel({ tokens, useCache }: { tokens: number; useCache: boolean }) {
  const totalBlocks = 12
  const needBlocks = Math.ceil(Math.max(1, tokens) / KV_BLOCK_SIZE)
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] text-text-3">
        block table — seq 0 · {tokens} tokens · {needBlocks}/{totalBlocks} blocks (
        {KV_BLOCK_SIZE} tok/block)
      </p>
      <div className="grid max-w-[480px] grid-cols-12 gap-1">
        {Array.from({ length: totalBlocks }, (_, b) => {
          const allocated = b < needBlocks
          const fill = Math.min(
            KV_BLOCK_SIZE,
            Math.max(0, tokens - b * KV_BLOCK_SIZE),
          ) / KV_BLOCK_SIZE
          return (
            <div
              key={b}
              className={cn(
                'relative h-8 overflow-hidden rounded-sm border',
                allocated ? 'border-info/60' : 'border-line',
              )}
              title={`block ${b}`}
            >
              <div className="absolute inset-0 bg-surface-3" />
              {allocated && (
                <div
                  className="absolute inset-y-0 left-0 bg-info/50 transition-all duration-300"
                  style={{ width: `${fill * 100}%` }}
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] text-text-2">
                {allocated ? `0x${b.toString(16).padStart(2, '0')}` : 'free'}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[11px]">
        {useCache ? (
          <span className="text-accent">cache ON — each decode step reuses stored K/V (O(n) not O(n²))</span>
        ) : (
          <span className="text-amber">cache OFF — every step recomputes K/V for the whole prefix</span>
        )}
      </p>
    </div>
  )
}

function BatchPanel({ iter }: { iter: number }) {
  const result = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'continuous' }),
    [],
  )
  const upto = Math.min(iter, result.snapshots.length - 1)
  const snap = result.snapshots[Math.max(0, upto)]
  const genCount = (reqId: number) =>
    result.snapshots.slice(0, upto + 1).filter((s) => s.running.includes(reqId)).length
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-3">
        <span>
          iter {snap.iter} · max batch 2 · mem {snap.memBlocks}/8 blk
        </span>
        {snap.admitted.length > 0 && (
          <span className="text-accent">ADMIT {snap.admitted.map((i) => `req-${'abcd'[i]}`).join(', ')}</span>
        )}
        {snap.finished.length > 0 && (
          <span className="text-info">DONE {snap.finished.map((i) => `req-${'abcd'[i]}`).join(', ')}</span>
        )}
        {snap.preempted.length > 0 && (
          <span className="text-amber">PREEMPT {snap.preempted.map((i) => `req-${'abcd'[i]}`).join(', ')}</span>
        )}
      </div>
      <div className="space-y-2">
        {result.requests.map((r) => {
          const g = genCount(r.id)
          const isRunning = snap.running.includes(r.id)
          const done = g >= r.scriptIds.length
          const waiting = !isRunning && !done
          return (
            <div key={r.id} className="flex items-center gap-3">
              <span className="w-14 shrink-0 font-mono text-[11px] text-text-2">{r.name}</span>
              <div className="flex h-6 flex-1 items-center gap-px overflow-hidden rounded-sm border border-line bg-surface-2 px-1">
                <span className="mr-1 shrink-0 rounded-sm bg-t4/25 px-1 font-mono text-[9px] text-t4">
                  {r.promptIds.length}p
                </span>
                {Array.from({ length: Math.min(g, r.scriptIds.length) }, (_, t) => (
                  <span
                    key={t}
                    className={cn(
                      'h-3.5 w-2 shrink-0 rounded-[1px]',
                      t === r.scriptIds.length - 1 ? 'bg-info' : 'bg-accent/70',
                    )}
                  />
                ))}
                {waiting && g === 0 && (
                  <span className="ml-1 font-mono text-[9px] text-text-3">waiting…</span>
                )}
              </div>
              <span
                className={cn(
                  'w-16 shrink-0 text-right font-mono text-[10px]',
                  done ? 'text-info' : isRunning ? 'text-accent' : 'text-text-3',
                )}
              >
                {done ? 'done' : isRunning ? 'running' : 'queued'}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        iteration-level admission — a finished sequence's slot is refilled on the very next tick
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main sim                                                            */
/* ------------------------------------------------------------------ */

export default function ToyEngineSim() {
  const reduced = useReducedMotion()
  const model = TOY_MODEL
  const recordSimVisit = useProgress((s) => s.recordSimVisit)
  const recordSimTask = useProgress((s) => s.recordSimTask)

  const [promptIdx, setPromptIdx] = useState(0)
  const [useCache, setUseCache] = useState(true)
  const [batchMode, setBatchMode] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [stage, setStage] = useState<StageId>('tokenize')
  const [playing, setPlaying] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'tokenizing' | 'decoding' | 'done'>('idle')
  const [mergeShown, setMergeShown] = useState(0)
  const [tokShown, setTokShown] = useState(0)
  const [batchIter, setBatchIter] = useState(0)
  const [log, setLog] = useState<LogLine[]>([])
  const logId = useRef(0)

  const prompt = SAMPLE_PROMPTS[promptIdx]
  const tokTrace = useMemo(() => tokenizeWithTrace(prompt.text), [prompt.text])
  const scriptIds = useMemo(() => scriptIdsFor(prompt.script), [prompt.script])
  const maxTokens = scriptIds.length

  const decode = useMemo(
    () => greedyDecode(model, tokTrace.ids, { useCache, scriptIds, maxTokens }),
    [model, tokTrace.ids, scriptIds, maxTokens, useCache],
  )
  const naiveDecode = useMemo(
    () => greedyDecode(model, tokTrace.ids, { useCache: false, scriptIds, maxTokens }),
    [model, tokTrace.ids, scriptIds, maxTokens],
  )
  const cachedDecode = useMemo(
    () => greedyDecode(model, tokTrace.ids, { useCache: true, scriptIds, maxTokens }),
    [model, tokTrace.ids, scriptIds, maxTokens],
  )
  const schedule = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'continuous' }),
    [],
  )

  const pushLog = (text: string, kind: LogLine['kind'] = 'op') => {
    setLog((l) => [...l.slice(-60), { id: logId.current++, text, kind }])
  }

  useEffect(() => {
    recordSimVisit(SIM_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reset = () => {
    setPlaying(false)
    setPhase('idle')
    setMergeShown(0)
    setTokShown(0)
    setBatchIter(0)
    setLog([])
  }

  const run = () => {
    reset()
    setPhase(batchMode ? 'decoding' : 'tokenizing')
    setPlaying(true)
    pushLog(`RUN "${prompt.text}" — ${tokTrace.ids.length} prompt tokens`, 'hit')
  }

  /* master clock */
  useEffect(() => {
    if (!playing) return
    const tickMs = reduced ? 1 : Math.max(16, 140 / speed)
    const t = window.setTimeout(() => {
      if (batchMode) {
        setBatchIter((i) => {
          const next = i + 1
          const snap = schedule.snapshots[Math.min(next, schedule.snapshots.length - 1)]
          for (const a of snap.admitted) pushLog(`[t+${String(snap.iter).padStart(3, '0')}] ADMIT req-${'abcd'[a]}`, 'hit')
          for (const f of snap.finished) pushLog(`[t+${String(snap.iter).padStart(3, '0')}] EOS req-${'abcd'[f]} ✓`, 'op')
          if (next >= schedule.snapshots.length - 1) {
            setPlaying(false)
            setPhase('done')
            recordSimTask(SIM_ID, 'batch')
            pushLog(`all 4 sequences done in ${schedule.iters} iterations`, 'hit')
          }
          return Math.min(next, schedule.snapshots.length - 1)
        })
        return
      }
      if (phase === 'tokenizing') {
        setMergeShown((m) => {
          const next = m + 1
          const ev = tokTrace.events[m]
          if (ev) {
            pushLog(`MERGE ${tokenLabel(ev.a)}+${tokenLabel(ev.b)}→${tokenLabel(ev.out)} @${ev.at}`, 'op')
          }
          if (next >= tokTrace.events.length) {
            setPhase('decoding')
            recordSimTask(SIM_ID, 'tokenize')
            pushLog(`tokenized → [${tokTrace.ids.join(', ')}]`, 'hit')
          }
          return next
        })
        return
      }
      if (phase === 'decoding') {
        setTokShown((n) => {
          const next = n + 1
          const tok = decode.tokens[n]
          if (tok) {
            pushLog(
              `DECODE t${n} → "${tok.text || '<eos>'}" id=${tok.id} itl=${fmtMs(tok.itlMs)}`,
              tok.id === EOS_ID ? 'hit' : 'op',
            )
          }
          if (next === 1) recordSimTask(SIM_ID, 'forward')
          if (next >= 8) {
            if (!useCache) recordSimTask(SIM_ID, 'decode')
            else {
              const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
              const ratio =
                mean(naiveDecode.tokens.slice(0, 8).map((t) => t.itlMs)) /
                Math.max(1e-9, mean(cachedDecode.tokens.slice(0, 8).map((t) => t.itlMs)))
              if (ratio >= 5) recordSimTask(SIM_ID, 'kv')
            }
          }
          if (next >= decode.tokens.length) {
            setPlaying(false)
            setPhase('done')
            pushLog(`EOS — TTFT ${fmtMs(decode.ttftMs)} · total ${fmtMs(decode.totalMs)}`, 'hit')
          }
          return Math.min(next, decode.tokens.length)
        })
      }
    }, tickMs)
    return () => window.clearTimeout(t)
  }, [
    playing,
    speed,
    reduced,
    batchMode,
    phase,
    schedule,
    tokTrace,
    decode,
    naiveDecode,
    cachedDecode,
    useCache,
    recordSimTask,
  ])

  const stepOnce = () => {
    if (phase === 'idle') {
      setPhase(batchMode ? 'decoding' : 'tokenizing')
      return
    }
    if (batchMode) {
      setBatchIter((i) => Math.min(i + 1, schedule.snapshots.length - 1))
      return
    }
    if (phase === 'tokenizing') {
      setMergeShown((m) => {
        const next = m + 1
        if (next >= tokTrace.events.length) setPhase('decoding')
        return next
      })
      return
    }
    if (phase === 'decoding') {
      setTokShown((n) => {
        const next = Math.min(n + 1, decode.tokens.length)
        if (next >= decode.tokens.length) setPhase('done')
        return next
      })
    }
  }

  const shownTokens = decode.tokens.slice(0, tokShown)
  const waste = useMemo(() => {
    if (tokShown === 0) return 0
    let w = 0
    for (let i = 0; i < Math.min(tokShown, naiveDecode.tokens.length); i++) {
      w += naiveDecode.tokens[i].flops - cachedDecode.tokens[i].flops
    }
    return w
  }, [tokShown, naiveDecode, cachedDecode])
  const lastItl = shownTokens.length ? shownTokens[shownTokens.length - 1].itlMs : 0
  const contextTokens = tokTrace.ids.length + tokShown
  const streamedText = prompt.text + detokenize(shownTokens.map((t) => t.id))

  return (
    <PlaygroundShell
      simId={SIM_ID}
      title="Toy Inference Engine"
      subtitle="tokenize → forward → decode → batch — the whole serving loop, ticking live"
      tasks={TASKS}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* ---------------- left: stage + transport + log ---------------- */}
        <div className="min-w-0">
          <EngineGlyph
            lit={phase === 'done' ? 7 : phase === 'decoding' ? 4 : phase === 'tokenizing' ? 1 : 0}
            active={
              phase === 'tokenizing' ? 0 : phase === 'decoding' ? (batchMode ? 5 : useCache ? 4 : 3) : undefined
            }
            className="w-full rounded-md border border-line bg-ink"
          />

          {/* stage tabs */}
          <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Pipeline stages">
            {STAGE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={stage === t.id}
                onClick={() => setStage(t.id)}
                className={cn(
                  'rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors duration-150',
                  stage === t.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line bg-surface-2 text-text-3 hover:border-line-bright hover:text-text-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* stage panel */}
          <div className="mt-3 min-h-[220px] rounded-md border border-line bg-surface-1 p-4">
            {stage === 'tokenize' && (
              <TokenizePanel
                text={prompt.text}
                shown={mergeShown}
                total={tokTrace.events.length}
                ids={tokTrace.ids}
              />
            )}
            {stage === 'embed' && <EmbedPanel model={model} ids={[...tokTrace.ids, ...scriptIds]} />}
            {stage === 'forward' && <ForwardPanel model={model} ids={tokTrace.ids} />}
            {stage === 'decode' && (
              <div>
                <p className="mb-2 rounded-sm border border-line bg-ink px-3 py-2 font-mono text-body-sm text-text-1">
                  {streamedText}
                  <span className="wordmark-cursor ml-0.5" />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shownTokens.map((t, i) => (
                    <span
                      key={i}
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
                        t.id === EOS_ID
                          ? 'border-info/50 bg-info/10 text-info'
                          : 'border-line bg-surface-2 text-text-2',
                      )}
                    >
                      {t.id === EOS_ID ? '<eos>' : t.text.replace(' ', '␣')} · {fmtMs(t.itlMs)}
                    </span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Chip label="TTFT" value={fmtMs(decode.ttftMs)} />
                  <Chip label="last ITL" value={tokShown ? fmtMs(lastItl) : '—'} />
                  <Chip
                    label={useCache ? 'flops saved' : 'flops wasted'}
                    value={fmtFlops(waste)}
                    tone={useCache ? 'mint' : 'amber'}
                  />
                  <Chip label="ctx tokens" value={String(contextTokens)} />
                </div>
              </div>
            )}
            {stage === 'kv' && <KVPanel tokens={contextTokens} useCache={useCache} />}
            {stage === 'batch' && <BatchPanel iter={batchIter} />}
          </div>

          {/* transport */}
          <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2">
            <button
              type="button"
              onClick={() => (playing ? setPlaying(false) : phase === 'idle' || phase === 'done' ? run() : setPlaying(true))}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-1 transition-all duration-150 ease-snap hover:border-line-bright active:scale-95"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              type="button"
              onClick={stepOnce}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-1 transition-all duration-150 ease-snap hover:border-line-bright active:scale-95"
              aria-label="Step forward"
            >
              <StepForward size={15} />
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex h-9 w-9 items-center justify-center rounded-sm border border-danger/50 text-danger transition-all duration-150 ease-snap hover:bg-danger/10 active:scale-95"
              aria-label="Reset"
            >
              <RotateCcw size={15} />
            </button>
            <div className="ml-1 flex items-center gap-2 font-mono text-[11px] text-text-3">
              <span>speed</span>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.25}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-accent"
                aria-label="Playback speed"
              />
              <span className="w-10 text-text-2">{speed.toFixed(2)}×</span>
            </div>
            <span className="ml-auto font-mono text-[11px] text-text-3">
              t = {batchMode ? batchIter : phase === 'tokenizing' ? mergeShown : tokShown}
            </span>
          </div>

          {/* log console */}
          <div
            className="mt-3 h-36 overflow-y-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed scrollbar-slim"
            aria-live="polite"
          >
            {log.length === 0 ? (
              <p className="text-text-3">[t+000] engine idle — press ▶ to run the pipeline</p>
            ) : (
              log.map((l) => (
                <p key={l.id} className={LOG_KIND_CLASS[l.kind]}>
                  {l.text}
                </p>
              ))
            )}
          </div>
        </div>

        {/* ---------------- right: control panel ---------------- */}
        <aside className="rounded-md border border-line bg-surface-1 p-4">
          <p className="font-mono text-label uppercase tracking-[0.10em] text-text-3">controls</p>

          <label className="mt-4 block font-mono text-[11px] text-text-3">
            prompt
            <select
              value={promptIdx}
              onChange={(e) => {
                setPromptIdx(Number(e.target.value))
                reset()
              }}
              className="mt-1 w-full rounded-sm border border-line bg-surface-3 px-2 py-1.5 font-mono text-xs text-text-1 focus:border-line-bright focus:outline-none"
            >
              {SAMPLE_PROMPTS.map((p, i) => (
                <option key={p.text} value={i}>
                  "{p.text}"
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 space-y-3">
            <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
              <span>
                KV cache
                <span className="block text-[10px] text-text-3">O(n²) recompute → O(n) append</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={useCache}
                onClick={() => {
                  setUseCache((v) => !v)
                  reset()
                }}
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
                  useCache ? 'border-accent bg-accent/30' : 'border-line bg-surface-3',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text-1 transition-transform duration-200',
                    useCache ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px]',
                  )}
                />
              </button>
            </label>

            <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
              <span>
                continuous batching
                <span className="block text-[10px] text-text-3">4 requests · max batch 2</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={batchMode}
                onClick={() => {
                  setBatchMode((v) => !v)
                  reset()
                  setStage('batch')
                }}
                className={cn(
                  'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
                  batchMode ? 'border-accent bg-accent/30' : 'border-line bg-surface-3',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-text-1 transition-transform duration-200',
                    batchMode ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px]',
                  )}
                />
              </button>
            </label>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="font-mono text-label uppercase tracking-[0.10em] text-text-3">readouts</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Chip label="TTFT" value={fmtMs(decode.ttftMs)} />
              <Chip
                label="mean ITL"
                value={
                  decode.tokens.length
                    ? fmtMs(
                        decode.tokens.reduce((a, t) => a + t.itlMs, 0) /
                          Math.max(1, decode.tokens.filter((t) => t.id !== EOS_ID).length),
                      )
                    : '—'
                }
              />
              <Chip
                label="throughput"
                value={`${(1000 / Math.max(1e-9, decode.tokens[0]?.itlMs ?? 1)).toFixed(0)} tok/s`}
              />
              <Chip
                label="model"
                value={`d=${model.d} · ${model.nLayers}L · v${model.vocab}`}
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4 font-mono text-[10px] leading-relaxed text-text-3">
            <p>≡ page table → KV block table</p>
            <p>≡ scheduler → continuous batcher</p>
            <p className="mt-2">greedy decode · scripted-bias logits · deterministic seed 1337</p>
          </div>
        </aside>
      </div>
    </PlaygroundShell>
  )
}
