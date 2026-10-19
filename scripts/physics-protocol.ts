/**
 * physics-protocol — the one reader of the S5 gate protocol (docs/specs/s5.md §5.1, S5-D46, S5-D52, S5-D63).
 *
 * docs/physics/protocol.md carries exactly one fenced block with the info string `json s5-protocol`. That block is the
 * single source of every constant the replay, the fit, the gate and the decision tables read: scripts and tests call
 * `readProtocol()` and never copy a number out of it. The reader checks the block's shape (every key, its type, and no
 * key the types below do not name), so a block edited without this file fails loudly rather than reading `undefined`.
 * It also reads docs/physics/protocol-history.json, whose last entry must carry protocol.md's sha256 and the block's
 * `version` (verify:physics, S5-07, enforces it). No side effects on import.
 *
 *   bun scripts/physics-protocol.ts        prints the version, the sha256 and the history check
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PROTOCOL_PATH = fileURLToPath(new URL('../docs/physics/protocol.md', import.meta.url))
export const HISTORY_PATH = fileURLToPath(new URL('../docs/physics/protocol-history.json', import.meta.url))

/** The fence that opens the machine block, alone on its line; the block ends at the next line that is exactly ```. */
export const BLOCK_FENCE = '```json s5-protocol'

/* ------------------------------ types ------------------------------ */

/** A grid axis of the fit, searched exhaustively (S5-D35). */
export interface GridAxis { readonly from: number; readonly to: number; readonly step: number }

/** One calibrated row: chip × engine release × weight precision; every string but `key`, `hardware` and `precision` is a claim id. */
export interface ProtocolRow {
  readonly key: string
  readonly hardware: string
  readonly precision: string
  readonly fitTp: readonly number[]
  readonly boxTp: readonly number[]
  readonly bw: string
  readonly peak: string
  readonly hbm: string
  readonly weightBytes: string
}

export interface ProtocolControl { readonly hardware: string; readonly precision: string; readonly batchTokens: number }

export interface TpotGate { readonly metric: string; readonly population: string; readonly meanMax: number; readonly p90Max: number }

export interface Protocol {
  readonly id: string
  readonly version: number
  readonly date: string
  readonly status: string
  readonly snapshot: {
    readonly url: string
    readonly rawSha256: string
    readonly rawBytes: number
    readonly rawRows: number
    readonly fetched: string
    readonly harness: { readonly repo: string; readonly ref: string }
  }
  /** Field equalities every selected row meets (the rows' hardware and precision restrict it further). */
  readonly select: { readonly framework: string; readonly spec_method: string; readonly disagg: boolean; readonly is_multinode: boolean }
  /** Claim ids of the model shape. */
  readonly model: { readonly params: string; readonly layers: string; readonly hidden: string; readonly kvBytesPerToken: string }
  readonly rows: readonly ProtocolRow[]
  readonly controls: readonly ProtocolControl[]
  readonly filters: { readonly gpuMemUtil: number; readonly kvRule: string; readonly ttftMaxSeconds: number; readonly expectDropped: readonly string[] }
  readonly split: { readonly fitConc: readonly number[]; readonly heldOutConc: readonly number[] }
  /** `batchTokens` and `blockSize` are claim ids (S5-D34); `seed` and `order` are rules in words. */
  readonly replay: {
    readonly promptsPerConc: number
    readonly rangeRatio: number
    readonly batchTokens: string
    readonly blockSize: string
    readonly seed: string
    readonly order: string
  }
  readonly fit: {
    readonly etaMem: GridAxis
    readonly etaFlop: GridAxis
    readonly etaFlopStart: number
    readonly linear: readonly string[]
    readonly objective: string
    readonly ttftRounds: number
    readonly ttftPoints: string
    readonly harness: string
    readonly memo: string
  }
  readonly stats: { readonly error: string; readonly mean: string; readonly p90: string; readonly max: string; readonly median: string }
  readonly gates: {
    readonly G1: TpotGate
    readonly G2: TpotGate
    readonly G3: { readonly metric: string; readonly population: string; readonly meanMax: number; readonly decides: string }
    readonly G4: {
      readonly etaMem: readonly [number, number]
      readonly etaFlop: readonly [number, number]
      readonly layerUsMax: number
      readonly seqUsMax: number
      readonly linkGBsMax: number
      readonly harnessMsMax: number
    }
    readonly G5: {
      readonly fitPointsMin: number
      readonly tpValuesMin: number
      readonly concValuesMin: number
      readonly shapesMin: number
      readonly shapeRequired: readonly [number, number]
    }
  }
  readonly printed: readonly string[]
  readonly consistency: { readonly configsPerRow: number; readonly sum: string; readonly tpotMaxAbsUs: number; readonly ttftMaxAbsUs: string }
  readonly h1: { readonly scope: string; readonly tolerance: string; readonly separation: string; readonly membership: string; readonly agreement: string }
  readonly fairness: {
    readonly doneRule: string
    readonly answerShareMax: number
    readonly blindWithin10Max: number
    readonly blindWithin30Max: number
    readonly readerWithin10Min: number
  }
  readonly frontier: {
    readonly concs: readonly number[]
    readonly floorFrom: number
    readonly floorTo: number
    readonly floorStep: number
    readonly classWidthMin: number
    readonly classesMin: number
    readonly sampling: string
    readonly replaySeed: string
    readonly replays: string
    readonly classesCount: string
    readonly sweepMaxMs: number
  }
  readonly items: { readonly instances: number; readonly constantCoverMax: number; readonly answerSpanMin: number; readonly ratioRule: string }
}

/** One version of protocol.md (S5-D63). */
export interface HistoryEntry { readonly version: number; readonly date: string; readonly sha256: string }

/* ------------------------------ shape ------------------------------ */

/** A shape: a leaf type, a fixed-length tuple of numbers, an array of one shape, or an object with exactly these keys. */
type Shape = 'string' | 'number' | 'boolean' | 'pair' | readonly [Shape] | { readonly [key: string]: Shape }

const GRID: Shape = { from: 'number', to: 'number', step: 'number' }
const TPOT_GATE: Shape = { metric: 'string', population: 'string', meanMax: 'number', p90Max: 'number' }

const PROTOCOL_SHAPE: Shape = {
  id: 'string',
  version: 'number',
  date: 'string',
  status: 'string',
  snapshot: {
    url: 'string', rawSha256: 'string', rawBytes: 'number', rawRows: 'number', fetched: 'string',
    harness: { repo: 'string', ref: 'string' },
  },
  select: { framework: 'string', spec_method: 'string', disagg: 'boolean', is_multinode: 'boolean' },
  model: { params: 'string', layers: 'string', hidden: 'string', kvBytesPerToken: 'string' },
  rows: [{
    key: 'string', hardware: 'string', precision: 'string', fitTp: ['number'], boxTp: ['number'],
    bw: 'string', peak: 'string', hbm: 'string', weightBytes: 'string',
  }],
  controls: [{ hardware: 'string', precision: 'string', batchTokens: 'number' }],
  filters: { gpuMemUtil: 'number', kvRule: 'string', ttftMaxSeconds: 'number', expectDropped: ['string'] },
  split: { fitConc: ['number'], heldOutConc: ['number'] },
  replay: { promptsPerConc: 'number', rangeRatio: 'number', batchTokens: 'string', blockSize: 'string', seed: 'string', order: 'string' },
  fit: {
    etaMem: GRID, etaFlop: GRID, etaFlopStart: 'number', linear: ['string'], objective: 'string',
    ttftRounds: 'number', ttftPoints: 'string', harness: 'string', memo: 'string',
  },
  stats: { error: 'string', mean: 'string', p90: 'string', max: 'string', median: 'string' },
  gates: {
    G1: TPOT_GATE,
    G2: TPOT_GATE,
    G3: { metric: 'string', population: 'string', meanMax: 'number', decides: 'string' },
    G4: { etaMem: 'pair', etaFlop: 'pair', layerUsMax: 'number', seqUsMax: 'number', linkGBsMax: 'number', harnessMsMax: 'number' },
    G5: { fitPointsMin: 'number', tpValuesMin: 'number', concValuesMin: 'number', shapesMin: 'number', shapeRequired: 'pair' },
  },
  printed: ['string'],
  consistency: { configsPerRow: 'number', sum: 'string', tpotMaxAbsUs: 'number', ttftMaxAbsUs: 'string' },
  h1: { scope: 'string', tolerance: 'string', separation: 'string', membership: 'string', agreement: 'string' },
  fairness: { doneRule: 'string', answerShareMax: 'number', blindWithin10Max: 'number', blindWithin30Max: 'number', readerWithin10Min: 'number' },
  frontier: {
    concs: ['number'], floorFrom: 'number', floorTo: 'number', floorStep: 'number', classWidthMin: 'number', classesMin: 'number',
    sampling: 'string', replaySeed: 'string', replays: 'string', classesCount: 'string', sweepMaxMs: 'number',
  },
  items: { instances: 'number', constantCoverMax: 'number', answerSpanMin: 'number', ratioRule: 'string' },
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function shapeProblems(value: unknown, shape: Shape, at: string, out: string[]): void {
  if (shape === 'string' || shape === 'boolean') {
    if (typeof value !== shape) out.push(`${at}: expected a ${shape}`)
  } else if (shape === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) out.push(`${at}: expected a finite number`)
  } else if (shape === 'pair') {
    if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      out.push(`${at}: expected two finite numbers`)
    }
  } else if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length === 0) {
      out.push(`${at}: expected a non-empty array`)
    } else {
      value.forEach((v, i) => shapeProblems(v, shape[0], `${at}[${i}]`, out))
    }
  } else if (!isRecord(value)) {
    out.push(`${at}: expected an object`)
  } else {
    const fields = shape as { readonly [key: string]: Shape }
    for (const key of Object.keys(fields)) {
      if (!(key in value)) out.push(`${at}.${key}: missing`)
      else shapeProblems(value[key], fields[key], `${at}.${key}`, out)
    }
    for (const key of Object.keys(value)) if (!(key in fields)) out.push(`${at}.${key}: not a protocol key (extend scripts/physics-protocol.ts with the block)`)
  }
}

/** Everything wrong with a parsed block's shape, as sentences. Empty means it is a `Protocol`. */
export function protocolProblems(value: unknown): string[] {
  const out: string[] = []
  shapeProblems(value, PROTOCOL_SHAPE, 'protocol', out)
  return out
}

/* ------------------------------ reading ------------------------------ */

/** The JSON text of the one `json s5-protocol` block of `markdown`. Throws unless there is exactly one, closed. */
export function extractProtocolBlock(markdown: string): string {
  const lines = markdown.split('\n')
  const opens = lines.flatMap((line, i) => (line === BLOCK_FENCE ? [i] : []))
  if (opens.length !== 1) throw new Error(`protocol: expected exactly one \`${BLOCK_FENCE}\` block, found ${opens.length}`)
  const start = opens[0] + 1
  const end = lines.indexOf('```', start)
  if (end < 0) throw new Error('protocol: the s5-protocol block is not closed')
  return lines.slice(start, end).join('\n')
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

/** The protocol in `markdown`, parsed, shape-checked and frozen. Throws with every problem when the shape is wrong. */
export function parseProtocol(markdown: string): Protocol {
  const value: unknown = JSON.parse(extractProtocolBlock(markdown))
  const problems = protocolProblems(value)
  if (problems.length > 0) throw new Error(`protocol: the s5-protocol block has the wrong shape:\n  ${problems.join('\n  ')}`)
  return deepFreeze(value as Protocol)
}

/** The committed protocol (docs/physics/protocol.md): the one reader every S5 script and test uses (S5-D46). */
export function readProtocol(file: string = PROTOCOL_PATH): Protocol {
  return parseProtocol(readFileSync(file, 'utf8'))
}

/** The sha256 (hex) of protocol.md's bytes, as protocol-history.json and report.json record it. */
export function protocolSha256(file: string = PROTOCOL_PATH): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** docs/physics/protocol-history.json: every version of the protocol, oldest first (S5-D63). */
export function readProtocolHistory(file: string = HISTORY_PATH): HistoryEntry[] {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const ok = Array.isArray(value) && value.length > 0 && value.every((e) =>
    isRecord(e) && Object.keys(e).length === 3 && Number.isInteger(e.version) && typeof e.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256))
  if (!ok) throw new Error('protocol-history: expected a non-empty array of {version, date: YYYY-MM-DD, sha256: 64 hex}')
  return value as HistoryEntry[]
}

/** Why the history does not match the protocol, as sentences; empty when its last entry has the file's sha256 and the block's version and date. */
export function historyProblems(protocol: Protocol, sha256: string, history: readonly HistoryEntry[]): string[] {
  const out: string[] = []
  history.forEach((e, i) => {
    if (e.version !== i + 1) out.push(`history entry ${i} has version ${e.version}, expected ${i + 1}`)
  })
  const last = history[history.length - 1]
  if (!last) return [...out, 'the history is empty']
  if (last.sha256 !== sha256) out.push(`protocol.md's sha256 is ${sha256}, the last history entry records ${last.sha256}`)
  if (last.version !== protocol.version) out.push(`the block's version is ${protocol.version}, the last history entry records ${last.version}`)
  if (last.date !== protocol.date) out.push(`the block's date is ${protocol.date}, the last history entry records ${last.date}`)
  return out
}

/**
 * The values of a grid axis, each an integer ÷ 100 (protocol.md §5: never by repeated addition, so every run sees the same
 * doubles). Throws when an end or the step is not a whole hundredth, or the step does not land on `to`.
 */
export function gridValues(axis: GridAxis): number[] {
  const [from, to, step] = [axis.from, axis.to, axis.step].map((v) => Math.round(v * 100))
  if ([axis.from, axis.to, axis.step].some((v, i) => [from, to, step][i] / 100 !== v)) throw new Error('grid: not whole hundredths')
  if (step <= 0 || to < from || (to - from) % step !== 0) throw new Error('grid: the step does not land on `to`')
  const out: number[] = []
  for (let k = from; k <= to; k += step) out.push(k / 100)
  return out
}

if (import.meta.main) {
  const protocol = readProtocol()
  const sha = protocolSha256()
  const problems = historyProblems(protocol, sha, readProtocolHistory())
  console.log(`${protocol.id} v${protocol.version} (${protocol.date}): ${protocol.status}`)
  console.log(`protocol.md sha256 ${sha}`)
  console.log(`rows: ${protocol.rows.map((r) => r.key).join(', ')}`)
  if (problems.length > 0) {
    console.error(`protocol-history.json does not match:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log('protocol-history.json: the last entry matches')
}
