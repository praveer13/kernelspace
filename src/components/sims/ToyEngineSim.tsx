/**
 * ToyEngineSim — SIM-09 `sim-engine` (playground.md §12, capstone.md §4).
 * The toy inference engine in free play: tokenize → embed → forward →
 * greedy decode → KV cache → continuous batching → TTFT/ITL, all visible.
 *
 * Default export wraps itself in PlaygroundShell (shared contract).
 * Named exports (EngineGlyph, GLYPH_STAGES) are reused by the Capstone page.
 * All engine logic lives in ./engine-core (pure TS, deterministic).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useSearchParams } from 'react-router'
import {
  Pause,
  Play,
  RotateCcw,
  StepForward,
} from 'lucide-react'
import PlaygroundShell, { completeSimTask } from './PlaygroundShell'
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
import { ENGINE_EXT_TASKS } from './engineExt.tasks'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-engine'

const TASKS = [
  { id: 'tokenize', text: 'Tokenize a prompt and watch every merge round', xp: 60 },
  { id: 'forward', text: 'Run a full forward pass (reach the first decoded token)', xp: 60 },
  { id: 'decode', text: 'Naive-decode 8 tokens and watch the waste counter spin', xp: 60 },
  { id: 'kv', text: 'Enable the KV cache and cut mean ITL by 5× or more', xp: 60 },
  { id: 'batch', text: 'Run 4 concurrent sequences with continuous batching', xp: 60 },
  ...ENGINE_EXT_TASKS,
]

type StageId = 'tokenize' | 'embed' | 'forward' | 'decode' | 'kv' | 'batch' | 'context' | 'gqa' | 'executor'

const STAGE_TABS: { id: StageId; label: string }[] = [
  { id: 'tokenize', label: 'tokenize' },
  { id: 'embed', label: 'embed' },
  { id: 'forward', label: 'forward' },
  { id: 'decode', label: 'decode' },
  { id: 'kv', label: 'kv cache' },
  { id: 'batch', label: 'batch' },
  { id: 'context', label: 'context' },
  { id: 'gqa', label: 'gqa' },
  { id: 'executor', label: 'executor' },
]

type EngineMachine = 'executor' | 'transformer' | 'tokenizer'

function isEngineMachine(value: string | null): value is EngineMachine {
  return value === 'executor' || value === 'transformer' || value === 'tokenizer'
}

const MACHINE_STAGE: Record<EngineMachine, StageId> = {
  executor: 'executor',
  transformer: 'forward',
  tokenizer: 'tokenize',
}

const STAGE_MACHINE: Partial<Record<StageId, EngineMachine>> = {
  executor: 'executor',
  forward: 'transformer',
  context: 'transformer',
  gqa: 'transformer',
  tokenize: 'tokenizer',
}

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

function fmtBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(2)} KB`
  return `${b.toFixed(0)} B`
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

const COMPARISON_PRESETS = [
  {
    key: 'en',
    label: 'English',
    text: 'Hello, how are you today?',
    note: 'ASCII text — tokenized normally',
  },
  {
    key: 'b64',
    label: 'base64',
    text: 'SGVsbG8sIGhvdyBhcmUgeW91IHRvZGF5Pw==',
    note: 'ASCII text in base64 — ~4/3 bytes per token',
  },
  {
    key: 'jp',
    label: 'Japanese (fallback)',
    text: 'こんにちは、今日は元気ですか。',
    note: 'Multilingual bytes — this tokenizer only handles printable ASCII, so we count raw bytes as a fallback',
  },
] as const

type ComparisonPreset = (typeof COMPARISON_PRESETS)[number]['key']

function TokenizePanel({
  text,
  shown,
  total,
  ids,
  comparePreset,
  setComparePreset,
  onComparisonViewed,
  onWordEstimate,
}: {
  text: string
  shown: number
  total: number
  ids: number[]
  comparePreset: ComparisonPreset
  setComparePreset: (p: ComparisonPreset) => void
  onComparisonViewed: (preset: ComparisonPreset) => void
  onWordEstimate: () => void
}) {
  const trace = useMemo(() => tokenizeWithTrace(text), [text])
  const idsNow = shown <= 0 ? [...text].map((c) => c.charCodeAt(0) - 30 + 2) : shown >= total ? ids : trace.events[shown - 1].idsAfter
  const lastEvent = shown > 0 && shown <= total ? trace.events[shown - 1] : null
  const [sample, setSample] = useState('unbelievable')
  const [contextCapacity, setContextCapacity] = useState(128_000)
  const [wordsPerToken, setWordsPerToken] = useState(0.75)
  const sampleTokens = useMemo(() => tokenizeWithTrace(sample).ids.length, [sample])
  const spacedTokens = useMemo(() => tokenizeWithTrace(` ${sample}`).ids.length, [sample])

  const comparison = useMemo(() => {
    const preset = COMPARISON_PRESETS.find((p) => p.key === comparePreset) ?? COMPARISON_PRESETS[0]
    const bytes = new TextEncoder().encode(preset.text).length
    if (preset.key === 'jp') {
      return {
        preset,
        tokens: bytes,
        bytes,
        tpb: bytes / bytes,
        fallback: true,
      }
    }
    const toks = tokenizeWithTrace(preset.text).ids.length
    return {
      preset,
      tokens: toks,
      bytes,
      tpb: toks / bytes,
      fallback: false,
    }
  }, [comparePreset])

  const wordsEstimate = Math.floor(contextCapacity * wordsPerToken)

  return (
    <div className="space-y-4">
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
      <p className="font-mono text-[11px] text-text-3">
        merge rounds {Math.min(shown, total)}/{total}
        {lastEvent && (
          <span className="ml-2 text-accent">
            {tokenLabel(lastEvent.a)} + {tokenLabel(lastEvent.b)} → {tokenLabel(lastEvent.out)}
          </span>
        )}
      </p>

      <div className="rounded-md border border-line bg-surface-2 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">token-density comparison</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {COMPARISON_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setComparePreset(p.key)
                onComparisonViewed(p.key)
              }}
              className={cn(
                'rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors',
                comparePreset === p.key
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-surface-3 text-text-2 hover:border-line-bright',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-text-2">“{comparison.preset.text}”</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Chip label="tokens" value={String(comparison.tokens)} />
          <Chip label="bytes" value={String(comparison.bytes)} />
          <Chip label="tokens/byte" value={comparison.tpb.toFixed(3)} />
        </div>
        <p className={cn('mt-2 font-mono text-[10px]', comparison.fallback ? 'text-amber' : 'text-text-3')}>
          {comparison.preset.note}
        </p>
      </div>

      <div className="rounded-md border border-line bg-surface-2 p-3">
        <label className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
          custom BPE / leading-space probe
          <input
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            className="mt-2 w-full rounded-sm border border-line bg-surface-3 px-2 py-1.5 font-mono text-xs normal-case text-text-1 focus:border-line-bright focus:outline-none"
          />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Chip label="as typed" value={`${sampleTokens} tokens`} />
          <Chip label="+ leading space" value={`${spacedTokens} tokens`} tone={sampleTokens !== spacedTokens ? 'amber' : undefined} />
        </div>
        <p className="mt-2 font-mono text-[10px] text-text-3">
          Try “unbelievable”, a rare surname, then hunt for a word whose leading space changes the merge path.
        </p>
      </div>

      <div className="rounded-md border border-line bg-surface-2 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">context word estimator</p>
        <label className="mt-2 block font-mono text-[10px] text-text-3">
          context: {contextCapacity.toLocaleString()} tokens
          <input
            type="range"
            min={8_000}
            max={128_000}
            step={8_000}
            value={contextCapacity}
            onChange={(event) => {
              setContextCapacity(Number(event.target.value))
              onWordEstimate()
            }}
            className="mt-1 w-full accent-accent"
          />
        </label>
        <div className="mt-2 flex gap-2">
          {[0.75, 0.45].map((ratio) => (
            <button
              key={ratio}
              type="button"
              onClick={() => {
                setWordsPerToken(ratio)
                onWordEstimate()
              }}
              className={cn(
                'rounded-sm border px-2.5 py-1 font-mono text-[11px]',
                wordsPerToken === ratio ? 'border-accent bg-accent/10 text-accent' : 'border-line text-text-2',
              )}
            >
              {ratio === 0.75 ? 'prose · 0.75' : 'source code · 0.45'}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-body-sm text-text-1">
          {contextCapacity.toLocaleString()} tokens × {wordsPerToken} ≈{' '}
          <span className="text-accent">{wordsEstimate.toLocaleString()} words</span>
        </p>
        <p className="mt-1 font-mono text-[10px] text-text-3">
          Estimates are workload assumptions: punctuation and syntax make source code denser in tokens than prose.
        </p>
      </div>
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

/** Per-token decode FLOP breakdown for an 8B-class model.
 *  Model dims fixed to the LLaMA-3-8B shape used by the lessons. */
function forwardFlopShares(ctxLen: number, kvHeads: number) {
  const d = 4096
  const layers = 32
  const headDim = d / 32
  // QKV: 3 matmuls of size d×d
  const qkv = 6 * layers * d * d
  // Attention: scores (2·t·d per layer) + weighted sum (2·t·d per layer)
  const attn = 4 * layers * ctxLen * d
  // MLP: up + gate + down projection ≈ 16·d² per layer
  const mlp = 16 * layers * d * d
  // Output head and residuals
  const other = 2 * layers * d * d + d * 100_000
  const total = qkv + attn + mlp + other
  return {
    total,
    qkvPct: (qkv / total) * 100,
    attnPct: (attn / total) * 100,
    mlpPct: (mlp / total) * 100,
    otherPct: (other / total) * 100,
    kvBytesPerToken: 2 * kvHeads * headDim * layers * 2,
  }
}

function FlopMeter({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between font-mono text-[10px] text-text-3">
        <span>{label}</span>
        <span style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function ForwardPanel({ model, ids, ctxLen }: { model: Model; ids: number[]; ctxLen: number }) {
  const [layer, setLayer] = useState(0)
  const [cell, setCell] = useState<{ i: number; j: number } | null>(null)
  const trace = useMemo(() => forwardAll(model, ids), [model, ids])
  const shares = useMemo(() => forwardFlopShares(ctxLen, 32), [ctxLen])
  const attn = trace.layers[Math.min(layer, trace.layers.length - 1)].attn
  const n = ids.length
  const size = 220
  const cellPx = size / n
  return (
    <div>
      <div className="mb-3 rounded-md border border-line bg-surface-2 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">per-stage FLOP share (decode, ctx={ctxLen.toLocaleString()})</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <FlopMeter label="QKV projections" pct={shares.qkvPct} color="#3EF2A4" />
          <FlopMeter label="attention scores" pct={shares.attnPct} color="#22D3EE" />
          <FlopMeter label="MLP (up/gate/down)" pct={shares.mlpPct} color="#A78BFA" />
          <FlopMeter label="output head + residuals" pct={shares.otherPct} color="#FBBF24" />
        </div>
        <p className="mt-2 font-mono text-[10px] text-text-3">
          total modeled decode FLOPs: {fmtFlops(shares.total)} per token
        </p>
      </div>

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
/* Extension panels                                                    */
/* ------------------------------------------------------------------ */

const CONTEXT_POINTS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000]
const WEIGHTS_GB = 16
const HEAD_DIM = 128

function kvGb(ctx: number, kvHeads: number) {
  const bytesPerTok = 2 * kvHeads * HEAD_DIM * 32 * 2
  return (bytesPerTok * ctx) / 1e9
}

function ContextPanel({ kvHeads, onSweepComplete }: { kvHeads: number; onSweepComplete: () => void }) {
  const chartH = 220
  const chartW = 520
  const pad = { l: 50, r: 20, t: 20, b: 40 }
  const innerW = chartW - pad.l - pad.r
  const innerH = chartH - pad.t - pad.b

  const [selectedContext, setSelectedContext] = useState(CONTEXT_POINTS[0])
  const startedAt1k = useRef(false)
  const { points, maxGb } = useMemo(() => {
    const maxGb = Math.max(WEIGHTS_GB, kvGb(128_000, kvHeads))
    const pts = CONTEXT_POINTS.map((ctx) => {
      const gb = kvGb(ctx, kvHeads)
      const x = pad.l + (Math.log2(ctx / 1_000) / Math.log2(128)) * innerW
      const y = pad.t + innerH - (gb / maxGb) * innerH
      return { ctx, gb, x, y }
    })
    return { points: pts, maxGb }
  }, [kvHeads, innerW, innerH, pad.l, pad.t])

  const crossover = useMemo(() => {
    for (let i = 1; i < CONTEXT_POINTS.length; i++) {
      const prev = kvGb(CONTEXT_POINTS[i - 1], kvHeads)
      const cur = kvGb(CONTEXT_POINTS[i], kvHeads)
      if (prev <= WEIGHTS_GB && cur >= WEIGHTS_GB) {
        const ratio = (WEIGHTS_GB - prev) / (cur - prev)
        const ctx = Math.round(CONTEXT_POINTS[i - 1] + (CONTEXT_POINTS[i] - CONTEXT_POINTS[i - 1]) * ratio)
        return ctx
      }
    }
    return null
  }, [kvHeads])

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const weightsY = pad.t + innerH - (WEIGHTS_GB / maxGb) * innerH

  return (
    <div className="space-y-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-3">
        <span>model weights</span>
        <span className="text-accent">{WEIGHTS_GB} GB</span>
        <span className="text-text-2">·</span>
        <span>KV-cache ({kvHeads} heads)</span>
        <span className="text-info">{kvGb(128_000, kvHeads).toFixed(1)} GB @ 128k</span>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Context sweep">
        {CONTEXT_POINTS.map((ctx) => (
          <button
            key={ctx}
            type="button"
            onClick={() => {
              if (ctx === CONTEXT_POINTS[0]) startedAt1k.current = true
              if (ctx === CONTEXT_POINTS[CONTEXT_POINTS.length - 1] && startedAt1k.current) onSweepComplete()
              setSelectedContext(ctx)
            }}
            className={cn(
              'rounded-sm border px-2 py-1 font-mono text-[10px]',
              selectedContext === ctx
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-surface-2 text-text-3 hover:border-line-bright',
            )}
          >
            {ctx / 1_000}k
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Chip label="selected context" value={`${selectedContext.toLocaleString()} tok`} />
        <Chip label="KV cache" value={`${kvGb(selectedContext, kvHeads).toFixed(2)} GB`} />
      </div>
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full max-w-[520px] rounded-md border border-line bg-ink"
        role="img"
        aria-label="KV cache size versus context length"
      >
        <line
          x1={pad.l}
          y1={weightsY}
          x2={pad.l + innerW}
          y2={weightsY}
          stroke="#FBBF24"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={pad.l + innerW - 4} y={weightsY - 6} textAnchor="end" fontSize={9} className="fill-amber">
          weights {WEIGHTS_GB} GB
        </text>
        <path d={pathD} fill="none" stroke="#22D3EE" strokeWidth={2} />
        {points.map((p) => (
          <g key={p.ctx}>
            <circle cx={p.x} cy={p.y} r={3} fill="#22D3EE" />
            <text x={p.x} y={pad.t + innerH + 14} textAnchor="middle" fontSize={8} className="fill-text-3">
              {p.ctx >= 1_000 ? `${p.ctx / 1_000}k` : p.ctx}
            </text>
          </g>
        ))}
        <text x={pad.l} y={pad.t + innerH + 28} fontSize={9} className="fill-text-3">
          context length
        </text>
        <text x={8} y={pad.t + innerH / 2} fontSize={9} transform={`rotate(-90, 8, ${pad.t + innerH / 2})`} className="fill-text-3">
          GB
        </text>
      </svg>
      <p className="mt-3 font-mono text-[11px] text-text-2">
        KV overtakes weights around{' '}
        <span className="text-accent">{crossover ? `${(crossover / 1_000).toFixed(1)}k tokens` : 'never in this range'}</span>
        {crossover && (
          <span className="text-text-3"> — this is the memory cliff that drives T5.L4 and vLLM</span>
        )}
      </p>
    </div>
  )
}

function GQAPanel({
  kvHeads,
  setKvHeads,
  ctxLen,
}: {
  kvHeads: number
  setKvHeads: (n: number) => void
  ctxLen: number
}) {
  const shares = useMemo(() => forwardFlopShares(ctxLen, kvHeads), [ctxLen, kvHeads])
  const kvGbAt128k = kvGb(128_000, kvHeads)
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-surface-2 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">KV-heads selector</p>
        <div className="mt-2 flex gap-2">
          {[32, 8].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setKvHeads(h)}
              className={cn(
                'rounded-sm border px-3 py-1 font-mono text-[11px] transition-colors',
                kvHeads === h
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line bg-surface-3 text-text-2 hover:border-line-bright',
              )}
            >
              {h} heads {h === 32 ? '(MHA)' : '(GQA)'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="KV size / token" value={fmtBytes(shares.kvBytesPerToken)} />
        <Chip label="KV @ 128k" value={fmtBytes(shares.kvBytesPerToken * 128_000)} />
        <Chip label="KV GB @ 128k" value={`${kvGbAt128k.toFixed(1)} GB`} />
        <Chip label="attn cost share" value={`${shares.attnPct.toFixed(1)}%`} />
      </div>
      <p className="font-mono text-[11px] text-text-3">
        GQA divides KV-cache bytes by 4 (32 → 8 heads) at the cost of slightly less expressive attention.
        Decode cost is dominated by reading cached K/V, so the cache-size reduction also lowers memory-bandwidth pressure.
      </p>
    </div>
  )
}

type ExecTaskState = 'pending' | 'running' | 'done' | 'hung' | 'blocked'

interface ExecTask {
  id: number
  name: string
  state: ExecTaskState
  polls: number
  wakeAt?: number
}

function ExecutorPanel({
  tasks,
  setTasks,
  pollCount,
  setPollCount,
  markExperiment,
  resetExperiments,
}: {
  tasks: ExecTask[]
  setTasks: Dispatch<SetStateAction<ExecTask[]>>
  pollCount: number
  setPollCount: Dispatch<SetStateAction<number>>
  markExperiment: (name: string) => void
  resetExperiments: () => void
}) {
  const [running, setRunning] = useState(false)
  const step = useCallback(() => {
    setPollCount((count) => count + 1)
    setTasks((previous) => {
      const blocker = previous.find(
        (task) => task.name === 'blocking sleep' && (task.state === 'running' || task.state === 'blocked'),
      )
      const now = Date.now()
      const next: ExecTask[] = blocker
        ? previous.map((task) =>
            task.id === blocker.id ? { ...task, polls: task.polls + 1, state: 'blocked' as const } : task,
          )
        : previous.map((task) => {
            if (task.state === 'done' || task.state === 'hung' || task.state === 'blocked') return task
            const polls = task.polls + 1
            if (task.name === 'no waker') return { ...task, polls, state: 'hung' }
            if (task.wakeAt && now >= task.wakeAt) return { ...task, polls, state: 'done' }
            return { ...task, polls }
          })
      if (next.every((task) => task.state === 'done' || task.state === 'hung' || task.state === 'blocked')) {
        setRunning(false)
      }
      return next
    })
  }, [setPollCount, setTasks])
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(step, 600)
    return () => window.clearInterval(id)
  }, [running, step])
  const spawnTimers = useCallback(() => {
    const now = Date.now()
    setTasks((previous) => {
      if (previous.some((task) => task.name.startsWith('timer '))) return previous
      const nextId = previous.reduce((max, task) => Math.max(max, task.id), 0) + 1
      return [
        ...previous,
        { id: nextId, name: 'timer A', state: 'running', polls: 0, wakeAt: now + 1200 },
        { id: nextId + 1, name: 'timer B', state: 'running', polls: 0, wakeAt: now + 1800 },
        { id: nextId + 2, name: 'timer C', state: 'running', polls: 0, wakeAt: now + 2400 },
      ]
    })
    setRunning(true)
    markExperiment('timers')
  }, [markExperiment, setTasks])
  const spawnHung = useCallback(() => {
    setTasks((previous) => {
      if (previous.some((task) => task.name === 'no waker' || task.name === 'repaired waker')) return previous
      const nextId = previous.reduce((max, task) => Math.max(max, task.id), 0) + 1
      return [...previous, { id: nextId, name: 'no waker', state: 'pending', polls: 0 }]
    })
    setRunning(true)
    markExperiment('hung')
  }, [markExperiment, setTasks])
  const spawnBlocking = useCallback(() => {
    setTasks((previous) => {
      if (previous.some((task) => task.name === 'blocking sleep' || task.name === 'spawn_blocking sleep')) return previous
      const nextId = previous.reduce((max, task) => Math.max(max, task.id), 0) + 1
      return [...previous, { id: nextId, name: 'blocking sleep', state: 'running', polls: 0 }]
    })
    setRunning(true)
    markExperiment('blocking')
  }, [markExperiment, setTasks])
  const registerMissingWaker = () => {
    const now = Date.now()
    setTasks((previous) =>
      previous.map((task) =>
        task.name === 'no waker' && task.state === 'hung'
          ? { ...task, name: 'repaired waker', state: 'running', wakeAt: now + 600 }
          : task,
      ),
    )
    setRunning(true)
    markExperiment('repaired')
  }
  const moveToBlockingPool = () => {
    const now = Date.now()
    setTasks((previous) =>
      previous.map((task) =>
        task.name === 'blocking sleep' && task.state === 'blocked'
          ? { ...task, name: 'spawn_blocking sleep', state: 'running', wakeAt: now + 600 }
          : task,
      ),
    )
    setRunning(true)
    markExperiment('moved')
  }
  const reset = () => {
    setTasks([])
    setPollCount(0)
    setRunning(false)
    resetExperiments()
  }
  const stateClass: Record<ExecTaskState, string> = {
    pending: 'text-text-3',
    running: 'text-accent',
    done: 'text-info',
    hung: 'text-danger',
    blocked: 'text-amber',
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={spawnTimers} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 hover:border-line-bright">
          spawn 3 timers
        </button>
        <button type="button" onClick={spawnHung} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 hover:border-line-bright">
          spawn no-waker future
        </button>
        <button type="button" onClick={spawnBlocking} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 hover:border-line-bright">
          spawn blocking sleep
        </button>
        <button type="button" onClick={step} className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 hover:border-line-bright">
          poll once
        </button>
        <button type="button" onClick={reset} className="rounded-sm border border-danger/50 px-2.5 py-1 font-mono text-[11px] text-danger hover:bg-danger/10">
          reset
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Chip label="tasks" value={String(tasks.length)} />
        <Chip label="poll cycles" value={String(pollCount)} />
        <Chip label="done" value={String(tasks.filter((task) => task.state === 'done').length)} />
        <Chip label="hung/blocked" value={String(tasks.filter((task) => task.state === 'hung' || task.state === 'blocked').length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {tasks.some((task) => task.name === 'no waker' && task.state === 'hung') && (
          <button type="button" onClick={registerMissingWaker} className="rounded-sm border border-accent/50 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-accent">
            register waker + wake
          </button>
        )}
        {tasks.some((task) => task.name === 'blocking sleep' && task.state === 'blocked') && (
          <button type="button" onClick={moveToBlockingPool} className="rounded-sm border border-info/50 bg-info/10 px-2.5 py-1 font-mono text-[11px] text-info">
            move to spawn_blocking
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {tasks.length === 0 && <p className="font-mono text-[11px] text-text-3">no tasks — spawn a preset to start</p>}
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between rounded-sm border border-line bg-surface-2 px-2.5 py-1.5">
            <span className="font-mono text-[11px] text-text-2">{task.name}</span>
            <div className="flex items-center gap-3 font-mono text-[10px]">
              <span className={stateClass[task.state]}>{task.state}</span>
              <span className="text-text-3">polls {task.polls}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-text-3">
        Pending needs a wake path. Blocking work stalls this executor until it moves to the dedicated blocking pool.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main sim                                                            */
/* ------------------------------------------------------------------ */

export default function ToyEngineSim() {
  const [searchParams, setSearchParams] = useSearchParams()
  const machineParam = searchParams.get('machine')
  const fromParam = searchParams.get('from')
  const sourceKey = `${machineParam ?? ''}|${fromParam ?? ''}`
  const machine = isEngineMachine(machineParam) ? machineParam : null
  const desiredStage: StageId = machine
    ? MACHINE_STAGE[machine]
    : fromParam === 't3.l4'
      ? 'executor'
      : fromParam === 't5.l1'
        ? 'forward'
        : 'tokenize'
  const [stageSelection, setStageSelection] = useState<{ sourceKey: string; stage: StageId }>(
    () => ({ sourceKey, stage: desiredStage }),
  )
  const stage = stageSelection.sourceKey === sourceKey ? stageSelection.stage : desiredStage
  const selectStage = (nextStage: StageId) => {
    const nextParams = new URLSearchParams(searchParams)
    const nextMachine = STAGE_MACHINE[nextStage]
    if (nextMachine) nextParams.set('machine', nextMachine)
    else nextParams.delete('machine')
    const nextSourceKey = `${nextParams.get('machine') ?? ''}|${nextParams.get('from') ?? ''}`
    setStageSelection({ sourceKey: nextSourceKey, stage: nextStage })
    setSearchParams(nextParams, { replace: true })
  }

  const reduced = useReducedMotion()
  const model = TOY_MODEL
  const recordSimVisit = useProgress((s) => s.recordSimVisit)
  const recordSimTask = useProgress((s) => s.recordSimTask)

  const [promptIdx, setPromptIdx] = useState(0)
  const [useCache, setUseCache] = useState(true)
  const [batchMode, setBatchMode] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'tokenizing' | 'decoding' | 'done'>('idle')
  const [mergeShown, setMergeShown] = useState(0)
  const [tokShown, setTokShown] = useState(0)
  const [batchIter, setBatchIter] = useState(0)
  const [log, setLog] = useState<LogLine[]>([])
  const logId = useRef(0)

  const [kvHeads, setKvHeads] = useState(32)
  const [comparePreset, setComparePreset] = useState<ComparisonPreset>('en')
  const [comparisonViews, setComparisonViews] = useState<Set<ComparisonPreset>>(() => new Set(['en']))
  const [execTasks, setExecTasks] = useState<ExecTask[]>([])
  const [execPollCount, setExecPollCount] = useState(0)
  const [execExperiments, setExecExperiments] = useState<Set<string>>(() => new Set())

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

  const pushLog = useCallback((text: string, kind: LogLine['kind'] = 'op') => {
    setLog((lines) => [...lines.slice(-60), { id: logId.current++, text, kind }])
  }, [])

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

  /* task completion side effects */
  useEffect(() => {
    if (stage === 'forward') completeSimTask(SIM_ID, 't-eng-flops')
  }, [stage])

  const viewComparison = useCallback((preset: ComparisonPreset) => {
    setComparisonViews((previous) => {
      if (previous.has(preset)) return previous
      const next = new Set(previous)
      next.add(preset)
      return next
    })
  }, [])

  const markExecutorExperiment = useCallback((name: string) => {
    setExecExperiments((previous) => {
      if (previous.has(name)) return previous
      const next = new Set(previous)
      next.add(name)
      return next
    })
  }, [])

  const resetExecutorExperiments = useCallback(() => {
    setExecExperiments(new Set())
  }, [])

  useEffect(() => {
    if (COMPARISON_PRESETS.every((item) => comparisonViews.has(item.key))) {
      completeSimTask(SIM_ID, 't-eng-tokcmp')
    }
  }, [comparisonViews])

  useEffect(() => {
    if (['timers', 'hung', 'repaired', 'blocking', 'moved'].every((item) => execExperiments.has(item))) {
      completeSimTask(SIM_ID, 't-eng-exec')
    }
  }, [execExperiments])

  useEffect(() => {
    if (kvHeads !== 32) completeSimTask(SIM_ID, 't-eng-gqa')
  }, [kvHeads])

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
    pushLog,
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
                onClick={() => selectStage(t.id)}
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
                comparePreset={comparePreset}
                setComparePreset={setComparePreset}
                onComparisonViewed={viewComparison}
                onWordEstimate={() => completeSimTask(SIM_ID, 't-eng-words')}
              />
            )}
            {stage === 'embed' && <EmbedPanel model={model} ids={[...tokTrace.ids, ...scriptIds]} />}
            {stage === 'forward' && <ForwardPanel model={model} ids={tokTrace.ids} ctxLen={contextTokens} />}
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
            {stage === 'context' && (
              <ContextPanel
                kvHeads={kvHeads}
                onSweepComplete={() => completeSimTask(SIM_ID, 't-eng-ctx')}
              />
            )}
            {stage === 'gqa' && <GQAPanel kvHeads={kvHeads} setKvHeads={setKvHeads} ctxLen={contextTokens} />}
            {stage === 'executor' && (
              <ExecutorPanel
                tasks={execTasks}
                setTasks={setExecTasks}
                pollCount={execPollCount}
                setPollCount={setExecPollCount}
                markExperiment={markExecutorExperiment}
                resetExperiments={resetExecutorExperiments}
              />
            )}
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
                  selectStage('batch')
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
