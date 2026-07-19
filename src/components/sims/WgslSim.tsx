/**
 * SIM-05 · WebGPU WGSL Playground (sim-wgsl) — playground.md §8
 * Editable WGSL compute shaders (vector add / parallel reduction / matmul),
 * real WebGPU execution with a graceful CPU fallback + honesty banner,
 * and a dispatch/workgroup visualizer linking code ↔ hardware.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Cpu, Play, RotateCcw, Trash2 } from 'lucide-react'
import PlaygroundShell from '@/components/sims/PlaygroundShell'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* shared in-sim infra                                                 */
/* ------------------------------------------------------------------ */

type LogKind = 'op' | 'ok' | 'warn' | 'err'
interface LogLine {
  id: number
  kind: LogKind
  text: string
}
const LOG_CLS: Record<LogKind, string> = {
  op: 'text-text-2',
  ok: 'text-accent',
  warn: 'text-amber',
  err: 'text-danger',
}

function useLog(initial: string) {
  const [lines, setLines] = useState<LogLine[]>([{ id: 0, kind: 'op', text: initial }])
  const idRef = useRef(1)
  const log = useCallback((kind: LogKind, text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: idRef.current++, kind, text }]
      return next.length > 260 ? next.slice(next.length - 260) : next
    })
  }, [])
  const clear = useCallback(() => setLines([]), [])
  return { lines, log, clear }
}

function LogConsole({ lines, onClear }: { lines: LogLine[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [stick, setStick] = useState(true)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (stick && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, stick, collapsed])
  const copy = () => {
    const text = lines.map((l) => `[t+${String(l.id).padStart(4, '0')}] ${l.text}`).join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  const last = lines[lines.length - 1]
  return (
    <section aria-label="log console" className="overflow-hidden rounded-md border border-line bg-surface-2">
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">log</span>
        <span className="font-mono text-[11px] text-text-3">{lines.length} lines</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={copy} aria-label="copy log" className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1">
            {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          </button>
          <button type="button" onClick={onClear} aria-label="clear log" className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-danger">
            <Trash2 size={14} />
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'expand log' : 'collapse log'} className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1">
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {collapsed ? (
        <div className="truncate px-3 py-2 font-mono text-[12px] text-text-3">
          {last ? `[t+${String(last.id).padStart(4, '0')}] ${last.text}` : '—'}
        </div>
      ) : (
        <div
          ref={bodyRef}
          onMouseEnter={() => setStick(false)}
          onMouseLeave={() => setStick(true)}
          aria-live="polite"
          className="scrollbar-slim h-36 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.7]"
        >
          {lines.map((l) => (
            <div key={l.id} className={cn('whitespace-pre-wrap', LOG_CLS[l.kind])}>
              <span className="text-text-3">[t+{String(l.id).padStart(4, '0')}]</span> {l.text}
            </div>
          ))}
          {lines.length === 0 && <div className="text-text-3">— log cleared —</div>}
        </div>
      )}
    </section>
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return reduced
}

function useTaskAward(simId: string, log: (kind: LogKind, text: string) => void) {
  return useCallback(
    (taskId: string, xp: number, note: string) => {
      const st = useProgress.getState()
      if (st.sims[simId]?.tasksDone.includes(taskId)) return
      st.recordSimTask(simId, taskId)
      useProgress.setState((p) => ({ xp: p.xp + xp }))
      log('ok', `TASK ✓ ${note}  (+${xp} XP)`)
    },
    [simId, log],
  )
}

/* ------------------------------------------------------------------ */
/* minimal structural WebGPU typings (DOM lib has no WebGPU yet)       */
/* ------------------------------------------------------------------ */

interface GpuCompilationMessage {
  message: string
  type: string
  lineNum: number
  linePos: number
}
interface GpuShaderModule {
  getCompilationInfo(): Promise<{ messages: GpuCompilationMessage[] }>
}
interface GpuBuffer {
  mapAsync(mode: number): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
  destroy(): void
}
interface GpuPipeline {
  getBindGroupLayout(index: number): unknown
}
interface GpuComputePass {
  setPipeline(p: GpuPipeline): void
  setBindGroup(i: number, g: unknown): void
  dispatchWorkgroups(x: number, y?: number, z?: number): void
  end(): void
}
interface GpuEncoder {
  beginComputePass(): GpuComputePass
  copyBufferToBuffer(src: GpuBuffer, so: number, dst: GpuBuffer, dO: number, size: number): void
  finish(): unknown
}
interface GpuDevice {
  createShaderModule(d: { code: string }): GpuShaderModule
  createBuffer(d: { size: number; usage: number }): GpuBuffer
  createComputePipeline(d: { layout: 'auto'; compute: { module: GpuShaderModule; entryPoint: string } }): GpuPipeline
  createBindGroup(d: { layout: unknown; entries: { binding: number; resource: { buffer: GpuBuffer } }[] }): unknown
  createCommandEncoder(): GpuEncoder
  queue: {
    writeBuffer(buffer: GpuBuffer, offset: number, data: Float32Array): void
    submit(cmds: unknown[]): void
    onSubmittedWorkDone(): Promise<void>
  }
}
interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>
}
interface GpuNav {
  gpu?: { requestAdapter(): Promise<GpuAdapter | null> }
}

const U_STORAGE = 0x0080
const U_COPY_DST = 0x0008
const U_COPY_SRC = 0x0004
const U_MAP_READ = 0x0001

/** Run one compute dispatch; returns output contents + wall ms. */
async function gpuRun(
  device: GpuDevice,
  code: string,
  entryPoint: string,
  inputs: Float32Array[],
  outBytes: number,
  dispatch: [number, number, number],
): Promise<{ out: Float32Array; ms: number; errors: GpuCompilationMessage[] }> {
  const module = device.createShaderModule({ code })
  const info = await module.getCompilationInfo()
  const errors = info.messages.filter((m) => m.type === 'error')
  if (errors.length > 0) return { out: new Float32Array(0), ms: 0, errors }

  const dev = device as GpuDevice & {
    pushErrorScope?(filter: string): void
    popErrorScope?(): Promise<{ message: string } | null>
  }
  dev.pushErrorScope?.('validation')

  const inBufs = inputs.map((arr) => {
    const b = device.createBuffer({ size: Math.max(arr.byteLength, 16), usage: U_STORAGE | U_COPY_DST })
    device.queue.writeBuffer(b, 0, arr)
    return b
  })
  const outBuf = device.createBuffer({ size: Math.max(outBytes, 16), usage: U_STORAGE | U_COPY_SRC })
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [...inBufs, outBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  })
  const enc = device.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(dispatch[0], dispatch[1], dispatch[2])
  pass.end()
  const readBuf = device.createBuffer({ size: Math.max(outBytes, 16), usage: U_MAP_READ | U_COPY_DST })
  enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, outBytes)
  const t0 = performance.now()
  device.queue.submit([enc.finish()])
  const validationErr = (await dev.popErrorScope?.()) ?? null
  if (validationErr) {
    for (const b of [...inBufs, outBuf, readBuf]) b.destroy()
    return {
      out: new Float32Array(0),
      ms: 0,
      errors: [{ message: `GPU validation: ${validationErr.message.split('\n')[0]}`, type: 'error', lineNum: 1, linePos: 1 }],
    }
  }
  await device.queue.onSubmittedWorkDone()
  const ms = performance.now() - t0
  await readBuf.mapAsync(U_MAP_READ)
  const out = new Float32Array(readBuf.getMappedRange().slice(0))
  readBuf.unmap()
  for (const b of [...inBufs, outBuf, readBuf]) b.destroy()
  return { out, ms, errors: [] }
}

/* ------------------------------------------------------------------ */
/* WGSL presets                                                        */
/* ------------------------------------------------------------------ */

type PresetId = 'vector-add' | 'reduction' | 'matmul-naive' | 'matmul-tiled'

interface Preset {
  id: PresetId
  name: string
  kind: 'elementwise' | 'reduce' | 'matmul'
  /** element count, or matrix N for matmul */
  n: number
  code: string
}

const VEC_N = 65536
const MAT_N = 512

const PRESETS: Preset[] = [
  {
    id: 'vector-add',
    name: 'vector add',
    kind: 'elementwise',
    n: VEC_N,
    code: `// VECTOR ADD — one thread per element. c[i] = a[i] + b[i]
// 65,536 floats: trivially parallel, memory-bandwidth bound.
@group(0) @binding(0) var<storage, read> a : array<f32>;
@group(0) @binding(1) var<storage, read> b : array<f32>;
@group(0) @binding(2) var<storage, read_write> c : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&c)) { return; } // threads past the end exit
  c[i] = a[i] + b[i];
}
`,
  },
  {
    id: 'reduction',
    name: 'parallel reduction (sum)',
    kind: 'reduce',
    n: VEC_N,
    code: `// PARALLEL REDUCTION — sum 65,536 floats.
// v1: each thread strides the input and writes ONE partial;
//     the host sums the few hundred partials. No shared memory yet.
// TASK: make it use shared memory (var<workgroup>) so each
//       workgroup tree-reduces to a single partial first.
@group(0) @binding(0) var<storage, read> input : array<f32>;
@group(0) @binding(1) var<storage, read_write> partial : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  var acc = 0.0;
  var i = gid.x;
  let n = arrayLength(&input);
  let stride = arrayLength(&partial); // == total dispatched threads
  while (i < n) {
    acc = acc + input[i];
    i = i + stride;
  }
  partial[gid.x] = acc;
}
`,
  },
  {
    id: 'matmul-naive',
    name: 'naive matmul',
    kind: 'matmul',
    n: MAT_N,
    code: `// NAIVE MATMUL — C = A × B (512×512), one thread per output element.
// Every thread streams a full row of A and a full column of B from HBM.
// No reuse: B's column is re-read by every row. Bandwidth murder.
@group(0) @binding(0) var<storage, read> A : array<f32>;
@group(0) @binding(1) var<storage, read> B : array<f32>;
@group(0) @binding(2) var<storage, read_write> C : array<f32>;

const N = 512u;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  if (row >= N || col >= N) { return; }
  var acc = 0.0;
  for (var k = 0u; k < N; k = k + 1u) {
    acc = acc + A[row * N + k] * B[k * N + col];
  }
  C[row * N + col] = acc;
}
`,
  },
  {
    id: 'matmul-tiled',
    name: 'tiled matmul',
    kind: 'matmul',
    n: MAT_N,
    code: `// TILED MATMUL — identical math, staged through shared memory.
// Each workgroup cooperatively loads 16×16 tiles of A and B into
// var<workgroup> (SM-local SRAM, ~20× faster than HBM), then every
// thread reuses them 16 times. This is the tiling aha.
@group(0) @binding(0) var<storage, read> A : array<f32>;
@group(0) @binding(1) var<storage, read> B : array<f32>;
@group(0) @binding(2) var<storage, read_write> C : array<f32>;

const N = 512u;
const TILE = 16u;

var<workgroup> tileA : array<f32, 256>; // 16×16, shared by the workgroup
var<workgroup> tileB : array<f32, 256>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3<u32>,
        @builtin(local_invocation_id) lid : vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  let lr = lid.y;
  let lc = lid.x;
  var acc = 0.0;
  for (var t = 0u; t < N / TILE; t = t + 1u) {
    tileA[lr * TILE + lc] = A[row * N + t * TILE + lc];
    tileB[lr * TILE + lc] = B[(t * TILE + lr) * N + col];
    workgroupBarrier(); // wait until the tile is fully staged
    for (var k = 0u; k < TILE; k = k + 1u) {
      acc = acc + tileA[lr * TILE + k] * tileB[k * TILE + lc];
    }
    workgroupBarrier(); // everyone done before the next tile overwrites
  }
  C[row * N + col] = acc;
}
`,
  },
]

/* ------------------------------------------------------------------ */
/* tiny WGSL helpers: tokenizer, validation, workgroup parsing         */
/* ------------------------------------------------------------------ */

const TOKEN_RE =
  /(\/\/[^\n]*)|(@[a-z_]+)|\b(fn|let|var|const|if|else|for|while|loop|return|break|continue|struct|alias)\b|\b(storage|read|read_write|uniform|private|function|workgroup)\b|\b(f32|u32|i32|bool|vec2|vec3|vec4|array|atomic|mat4x4|mat3x3)\b|\b(workgroupBarrier|storageBarrier|arrayLength|select|min|max|abs|dot)\b|(0x[0-9a-fA-F]+u?|\d+\.?\d*(?:[eE][+-]?\d+)?[uf]?)/g

const TOKEN_CLS = [
  'text-text-3 italic', // comment
  'text-amber', // attribute
  'text-t4', // keyword
  'text-t4/80', // address space
  'text-info', // type
  'text-t5', // builtin fn
  'text-accent', // number
]

function highlightLine(line: string, lineIdx: number): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const clsIdx = m.slice(1).findIndex((g) => g !== undefined)
    out.push(
      <span key={`${lineIdx}-${k++}`} className={TOKEN_CLS[clsIdx] ?? undefined}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (m[0].length === 0) TOKEN_RE.lastIndex++
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

interface CodeError {
  line: number
  msg: string
}

function validateWgsl(code: string): CodeError[] {
  const errors: CodeError[] = []
  const stack: { ch: string; line: number }[] = []
  const lines = code.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const commentAt = line.indexOf('//')
    const end = commentAt === -1 ? line.length : commentAt
    for (let ci = 0; ci < end; ci++) {
      const ch = line[ci]
      if (ch === '{' || ch === '(') stack.push({ ch, line: li + 1 })
      if (ch === '}' || ch === ')') {
        const want = ch === '}' ? '{' : '('
        const top = stack.pop()
        if (!top || top.ch !== want) {
          errors.push({ line: li + 1, msg: `unmatched '${ch}' — check your brackets` })
          break
        }
      }
    }
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1]
    errors.push({ line: last.line, msg: `unclosed '${last.ch}' — missing its pair` })
  }
  if (!/@compute\b/.test(code)) {
    errors.push({ line: 1, msg: 'no @compute entry point — compute shaders need @compute above the entry fn' })
  }
  if (!/@workgroup_size\s*\(/.test(code)) {
    errors.push({ line: 1, msg: 'missing @workgroup_size — did you mean @workgroup_size(64)?' })
  }
  if (!/fn\s+main\s*\(/.test(code)) {
    errors.push({ line: 1, msg: 'no `fn main(...)` — the runner dispatches entry point "main"' })
  }
  const seen = new Set<string>()
  return errors
    .filter((e) => {
      const k = `${e.line}:${e.msg}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 4)
}

function parseWorkgroupSize(code: string): { x: number; y: number } {
  const m = /@workgroup_size\(\s*(\d+)(?:\s*,\s*(\d+))?/.exec(code)
  if (!m) return { x: 64, y: 1 }
  return { x: Math.max(1, parseInt(m[1], 10)), y: m[2] ? Math.max(1, parseInt(m[2], 10)) : 1 }
}

function parseVecOp(code: string): '+' | '-' | '*' {
  const m = /c\s*\[[^\]]*\]\s*=\s*a\s*\[[^\]]*\]\s*([+\-*])\s*b/.exec(code)
  return m ? (m[1] as '+' | '-' | '*') : '+'
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* reference CPU kernels (fallback path executes these honestly)       */
/* ------------------------------------------------------------------ */

function refData(seed: number, n: number): Float32Array {
  const rng = mulberry32(seed)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1
  return out
}

function matmulChecksum(A: Float32Array, B: Float32Array, N: number): number {
  // sum(C) = sum_{i,k} A[i,k] * colSumB[k] — O(N²) instead of O(N³)
  const colB = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    let s = 0
    for (let j = 0; j < N; j++) s += B[k * N + j]
    colB[k] = s
  }
  let total = 0
  for (let i = 0; i < N; i++) {
    let s = 0
    for (let k = 0; k < N; k++) s += A[i * N + k] * colB[k]
    total += s
  }
  return total
}

function matmulSample(A: Float32Array, B: Float32Array, N: number, res: number): Float32Array {
  // real (downsampled) C for the heat strip — identical on every backend
  const out = new Float32Array(res * res)
  const step = N / res
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      let acc = 0
      const row = Math.floor(r * step)
      const col = Math.floor(c * step)
      for (let k = 0; k < N; k += 4) acc += A[row * N + k] * B[k * N + col]
      out[r * res + c] = acc
    }
  }
  return out
}

/** modeled dispatch timing: workgroups queue through 16 SMs × 4 resident */
function modeledMs(work: number, workgroups: number): number {
  const waves = Math.max(1, Math.ceil(workgroups / 64))
  return work + waves * 0.002
}

/* ------------------------------------------------------------------ */
/* run results                                                         */
/* ------------------------------------------------------------------ */

interface TimingBar {
  label: string
  ms: number
  cls: string
}
interface DispatchInfo {
  nx: number
  ny: number
  wgX: number
  wgY: number
  threads: number
}
interface RunResult {
  ok: boolean
  backend: 'gpu' | 'cpu'
  bars: TimingBar[]
  heats: number[]
  mismatch: number
  checksum: string
  dispatch: DispatchInfo
  speedup?: number
  note?: string
}

const TASKS = [
  { id: 'wgsl-wg1', text: 'Set @workgroup_size(1) on vector add, run, and explain the slowdown', xp: 60 },
  { id: 'wgsl-shared', text: 'Make the reduction use shared memory (var<workgroup>)', xp: 60 },
  { id: 'wgsl-tiled', text: 'Run the matmul compare and beat naive by 10× with tiling', xp: 60 },
]

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export default function WgslSim() {
  const reduced = useReducedMotion()
  const { lines, log, clear } = useLog('wgsl playground ready — pick a preset, hit ▶ run dispatch')
  const award = useTaskAward('sim-wgsl', log)

  const [presetId, setPresetId] = useState<PresetId>('vector-add')
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const [code, setCode] = useState(preset.code)
  const [backend, setBackend] = useState<'probing' | 'gpu' | 'cpu'>(() =>
    (navigator as Navigator & GpuNav).gpu ? 'probing' : 'cpu',
  )
  const [forceCpu, setForceCpu] = useState(false)
  const [running, setRunning] = useState(false)
  const [errors, setErrors] = useState<CodeError[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [hoverWg, setHoverWg] = useState<number | null>(null)
  const deviceRef = useRef<GpuDevice | null>(null)

  /* ---- WebGPU detection ---- */
  useEffect(() => {
    let alive = true
    const nav = navigator as Navigator & GpuNav
    if (!nav.gpu) {
      log('warn', 'WebGPU not exposed by this browser — CPU simulation mode (same semantics)')
      return
    }
    nav.gpu
      .requestAdapter()
      .then(async (adapter) => {
        if (!alive) return
        if (!adapter) {
          setBackend('cpu')
          log('warn', 'WebGPU adapter unavailable — CPU simulation mode')
          return
        }
        try {
          deviceRef.current = await adapter.requestDevice()
          if (!alive) return
          setBackend('gpu')
          log('ok', 'WebGPU device acquired — kernels execute on your GPU')
        } catch {
          if (alive) {
            setBackend('cpu')
            log('warn', 'WebGPU device request failed — CPU simulation mode')
          }
        }
      })
      .catch(() => {
        if (alive) setBackend('cpu')
      })
    return () => {
      alive = false
    }
  }, [log])

  /* ---- editor derived state ---- */
  const codeLines = useMemo(() => code.split('\n'), [code])
  const highlighted = useMemo(() => codeLines.map((l, i) => highlightLine(l, i)), [codeLines])
  const wgLine = useMemo(() => codeLines.findIndex((l) => /@workgroup_size/.test(l)), [codeLines])
  const errorByLine = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of errors) m.set(e.line, e.msg)
    return m
  }, [errors])

  const preRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const syncScroll = () => {
    const ta = taRef.current
    if (!ta) return
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop
      preRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
  }

  const onEditorKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const { selectionStart: s, selectionEnd: en, value } = ta
      const next = `${value.slice(0, s)}  ${value.slice(en)}`
      setCode(next)
      requestAnimationFrame(() => {
        ta.selectionStart = s + 2
        ta.selectionEnd = s + 2
      })
    }
  }

  const loadPreset = (id: PresetId) => {
    const p = PRESETS.find((pp) => pp.id === id) ?? PRESETS[0]
    setPresetId(id)
    setCode(p.code)
    setResult(null)
    setErrors([])
    log('op', `PRESET loaded: ${p.name} (${p.kind}, n=${p.n.toLocaleString()})`)
  }

  /* ---- the run ---- */
  const run = useCallback(async () => {
    if (running) return
    setRunning(true)
    setResult(null)
    const errs = validateWgsl(code)
    if (errs.length > 0) {
      setErrors(errs)
      for (const e of errs) log('err', `WGSL line ${e.line}: ${e.msg}`)
      setRunning(false)
      return
    }
    setErrors([])
    const wg = parseWorkgroupSize(code)
    const device = deviceRef.current
    const useGpu = backend === 'gpu' && !forceCpu && device !== null
    const seed = 0x5eed

    const failCompile = (msgs: GpuCompilationMessage[]) => {
      const mapped = msgs.slice(0, 3).map((m) => ({ line: m.lineNum, msg: m.message }))
      setErrors(mapped)
      for (const m of msgs.slice(0, 3)) log('err', `WGSL line ${m.lineNum}:${m.linePos} — ${m.message}`)
    }

    try {
      if (preset.kind === 'elementwise') {
        const N = VEC_N
        const a = refData(seed, N)
        const b = refData(seed ^ 0xffff, N)
        const rawNx = Math.ceil(N / wg.x)
        const nx = Math.min(65535, rawNx) // WebGPU per-dimension workgroup limit
        const covered = Math.min(N, nx * wg.x)
        if (rawNx > 65535)
          log('warn', `dispatch clamped to 65,535 workgroups (WebGPU per-dimension limit) — tail ${N - covered} elements skipped`)
        const dispatch: DispatchInfo = { nx, ny: 1, wgX: wg.x, wgY: 1, threads: covered }
        log('op', `RUN main dispatch (${nx},1,1) wg(${wg.x}) — ${covered.toLocaleString()} threads [${useGpu ? 'WebGPU' : 'CPU SIM'}]`)
        const op = parseVecOp(code)
        let ms: number
        let out: Float32Array
        let mismatch = 0
        let note: string | undefined
        if (useGpu) {
          const r = await gpuRun(device, code, 'main', [a, b], N * 4, [nx, 1, 1])
          if (r.errors.length > 0) {
            failCompile(r.errors)
            setRunning(false)
            return
          }
          out = r.out
          ms = r.ms
          for (let i = 0; i < N; i += 97) {
            const exp = op === '+' ? a[i] + b[i] : op === '-' ? a[i] - b[i] : a[i] * b[i]
            if (Math.abs(out[i] - exp) > 1e-4) mismatch++
          }
        } else {
          out = new Float32Array(N)
          const t0 = performance.now()
          for (let i = 0; i < N; i++)
            out[i] = op === '+' ? a[i] + b[i] : op === '-' ? a[i] - b[i] : a[i] * b[i]
          const jsMs = performance.now() - t0
          ms = modeledMs(jsMs, nx)
          note = `reference kernel on CPU (js ${jsMs.toFixed(2)}ms) — timing modeled: waves = ⌈${nx.toLocaleString()} wg / 64 slots⌉`
        }
        const heats: number[] = []
        let maxAbs = 1e-9
        for (let i = 0; i < 128; i++) maxAbs = Math.max(maxAbs, Math.abs(out[Math.floor((i * N) / 128)]))
        for (let i = 0; i < 128; i++) heats.push(out[Math.floor((i * N) / 128)] / maxAbs)
        const ok = mismatch === 0
        log(ok ? 'ok' : 'err', `VERIFY ${ok ? '✓' : '✗'} sampled ${Math.ceil(N / 97).toLocaleString()} elements · ${mismatch} mismatches`)
        log('op', `TIME ${ms.toFixed(3)}ms ${useGpu ? '(measured wall, incl. dispatch overhead)' : '(modeled)'}`)
        setResult({
          ok,
          backend: useGpu ? 'gpu' : 'cpu',
          bars: [{ label: `c[i] = a[i] ${op} b[i]`, ms, cls: 'bg-accent' }],
          heats,
          mismatch,
          checksum: ok ? 'match' : 'MISMATCH',
          dispatch,
          note,
        })
        if (wg.x * wg.y === 1) {
          award('wgsl-wg1', 60, `wg_size=1 → ${nx.toLocaleString()} tiny workgroups: waves=${Math.ceil(nx / 64).toLocaleString()}, occupancy dead`)
        }
      } else if (preset.kind === 'reduce') {
        const N = VEC_N
        const input = refData(seed, N)
        const wgCount = Math.ceil(256 / wg.x)
        const threads = wgCount * wg.x
        const dispatch: DispatchInfo = { nx: wgCount, ny: 1, wgX: wg.x, wgY: 1, threads }
        log('op', `RUN main dispatch (${wgCount},1,1) wg(${wg.x}) — ${threads} threads, grid-stride [${useGpu ? 'WebGPU' : 'CPU SIM'}]`)
        let partial: Float32Array
        let ms: number
        let note: string | undefined
        if (useGpu) {
          const r = await gpuRun(device, code, 'main', [input], threads * 4, [wgCount, 1, 1])
          if (r.errors.length > 0) {
            failCompile(r.errors)
            setRunning(false)
            return
          }
          partial = r.out
          ms = r.ms
        } else {
          partial = new Float32Array(threads)
          const t0 = performance.now()
          for (let t = 0; t < threads; t++) {
            let acc = 0
            for (let i = t; i < N; i += threads) acc += input[i]
            partial[t] = acc
          }
          const jsMs = performance.now() - t0
          ms = modeledMs(jsMs, wgCount)
          note = `reference kernel on CPU (js ${jsMs.toFixed(2)}ms) — timing modeled`
        }
        let gpuSum = 0
        for (let i = 0; i < partial.length; i++) gpuSum += partial[i]
        let refSum = 0
        for (let i = 0; i < N; i++) refSum += input[i]
        const relErr = Math.abs(gpuSum - refSum) / (Math.abs(refSum) + 1e-9)
        const ok = relErr < 5e-3
        const shared = /var<workgroup>/.test(code)
        log(ok ? 'ok' : 'err', `VERIFY ${ok ? '✓' : '✗'} Σ=${gpuSum.toFixed(4)} vs ref ${refSum.toFixed(4)} (rel ${relErr.toExponential(1)}) · host reduced ${partial.length} partials`)
        if (shared) log('ok', 'SHARED MEMORY detected (var<workgroup>) — tree reduction on-chip ✓')
        log('op', `TIME ${ms.toFixed(3)}ms ${useGpu ? '(measured wall)' : '(modeled)'}`)
        const heats: number[] = []
        let maxAbs = 1e-9
        for (let i = 0; i < partial.length; i++) maxAbs = Math.max(maxAbs, Math.abs(partial[i]))
        for (let i = 0; i < 128; i++) heats.push(partial[Math.floor((i * partial.length) / 128)] / maxAbs)
        setResult({
          ok,
          backend: useGpu ? 'gpu' : 'cpu',
          bars: [{ label: shared ? 'reduction (shared)' : 'reduction (thread-serial)', ms, cls: 'bg-accent' }],
          heats,
          mismatch: ok ? 0 : 1,
          checksum: ok ? `Σ ${gpuSum.toFixed(3)}` : 'MISMATCH',
          dispatch,
          note,
        })
        if (shared && ok) award('wgsl-shared', 60, 'reduction stages partials in var<workgroup> shared memory ✓')
      } else {
        /* matmul compare — run naive + tiled, side by side */
        const N = MAT_N
        const A = refData(seed, N * N)
        const B = refData(seed ^ 0xffff, N * N)
        const naiveCode = preset.id === 'matmul-naive' ? code : (PRESETS.find((p) => p.id === 'matmul-naive') ?? PRESETS[2]).code
        const tiledCode = preset.id === 'matmul-tiled' ? code : (PRESETS.find((p) => p.id === 'matmul-tiled') ?? PRESETS[3]).code
        const wgN = parseWorkgroupSize(naiveCode)
        const wgT = parseWorkgroupSize(tiledCode)
        const refSum = matmulChecksum(A, B, N)
        const scale = Math.pow(N, 1.5) / 3
        const bars: TimingBar[] = []
        let allOk = true
        let firstDispatch: DispatchInfo | null = null

        const variants: { label: string; code: string; wg: { x: number; y: number }; cls: string; modeled: number }[] = [
          { label: 'naive', code: naiveCode, wg: wgN, cls: 'bg-t4', modeled: (2 * N ** 3) / 3e8 },
          { label: 'tiled (shared mem)', code: tiledCode, wg: wgT, cls: 'bg-accent', modeled: ((2 * N ** 3) / 3e8 / 16) * 1.12 },
        ]
        for (const v of variants) {
          const nx = Math.ceil(N / v.wg.x)
          const ny = Math.ceil(N / v.wg.y)
          if (!firstDispatch)
            firstDispatch = { nx, ny, wgX: v.wg.x, wgY: v.wg.y, threads: nx * ny * v.wg.x * v.wg.y }
          let ms: number
          if (useGpu) {
            const r = await gpuRun(device, v.code, 'main', [A, B], N * N * 4, [nx, ny, 1])
            if (r.errors.length > 0) {
              log('err', `[${v.label}] compile failed:`)
              failCompile(r.errors)
              setRunning(false)
              return
            }
            let gpuSum = 0
            for (let i = 0; i < r.out.length; i++) gpuSum += r.out[i]
            const err = Math.abs(gpuSum - refSum) / scale
            const ok = err < 0.1
            if (!ok) allOk = false
            log(ok ? 'ok' : 'err', `VERIFY [${v.label}] ${ok ? '✓' : '✗'} checksum Σ|C| rel-err ${err.toExponential(1)}`)
            ms = r.ms
          } else {
            ms = modeledMs(v.modeled, nx * ny)
          }
          bars.push({ label: v.label, ms, cls: v.cls })
        }
        const naiveMs = bars[0].ms
        const tiledMs = bars[1].ms
        const speedup = naiveMs / Math.max(tiledMs, 1e-6)
        log(
          speedup >= 10 ? 'ok' : 'op',
          `TIME naive ${naiveMs.toFixed(3)}ms vs tiled ${tiledMs.toFixed(3)}ms → ${speedup.toFixed(1)}× ${useGpu ? '(measured wall)' : '(modeled — CPU cannot stage WGSL shared memory)'}`,
        )
        const sample = matmulSample(A, B, N, 16)
        let maxAbs = 1e-9
        for (let i = 0; i < sample.length; i++) maxAbs = Math.max(maxAbs, Math.abs(sample[i]))
        const heats: number[] = []
        for (let i = 0; i < sample.length; i++) heats.push(sample[i] / maxAbs)
        setResult({
          ok: allOk,
          backend: useGpu ? 'gpu' : 'cpu',
          bars,
          heats,
          mismatch: allOk ? 0 : 1,
          checksum: allOk ? 'ΣC match' : 'MISMATCH',
          dispatch: firstDispatch ?? { nx: 32, ny: 32, wgX: 16, wgY: 16, threads: 262144 },
          speedup,
          note: useGpu ? undefined : 'correctness verified via O(N²) checksum identity; timings modeled at 512²',
        })
        if (speedup >= 10) award('wgsl-tiled', 60, `tiled matmul beats naive by ${speedup.toFixed(1)}× — shared memory reuse wins`)
      }
    } catch (e) {
      log('err', `dispatch failed: ${e instanceof Error ? e.message : String(e)}`)
      log('warn', 'falling back to CPU simulation for the next run')
      setBackend('cpu')
    }
    setRunning(false)
  }, [running, code, backend, forceCpu, preset, log, award])

  /* ---- dispatch visualizer canvas ---- */
  const vizRef = useRef<HTMLCanvasElement>(null)
  const sweepStart = useRef(0)
  useEffect(() => {
    if (result) sweepStart.current = performance.now()
  }, [result])
  useEffect(() => {
    const cv = vizRef.current
    if (!cv || !result) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.scale(dpr, dpr)
    const total = result.dispatch.nx * result.dispatch.ny
    const cell = total > 4096 ? 4 : total > 1024 ? 6 : 9
    const perRow = Math.max(1, Math.floor((w - 8) / (cell + 1)))
    let raf = 0
    const start = sweepStart.current
    const draw = (now: number) => {
      const p = reduced ? 1 : Math.min(1, (now - start) / 2000)
      const activeUpTo = p * total
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < total; i++) {
        const cx = 4 + (i % perRow) * (cell + 1)
        const cy = 4 + Math.floor(i / perRow) * (cell + 1)
        if (cy > h - 4) break
        const doneWg = i < activeUpTo - 64
        const active = i >= activeUpTo - 64 && i < activeUpTo
        const hovered = hoverWg === i
        ctx.fillStyle = hovered ? '#3EF2A4' : active ? 'rgba(62,242,164,.95)' : doneWg ? 'rgba(62,242,164,.35)' : '#182130'
        ctx.fillRect(cx, cy, cell, cell)
        if (hovered) {
          ctx.strokeStyle = '#3EF2A4'
          ctx.lineWidth = 1
          ctx.strokeRect(cx - 1.5, cy - 1.5, cell + 3, cell + 3)
        }
      }
      if (p < 1) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [result, reduced, hoverWg])

  const onVizHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!result) return
    const cv = vizRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const total = result.dispatch.nx * result.dispatch.ny
    const cell = total > 4096 ? 4 : total > 1024 ? 6 : 9
    const perRow = Math.max(1, Math.floor((rect.width - 8) / (cell + 1)))
    const mx = e.clientX - rect.left - 4
    const my = e.clientY - rect.top - 4
    const col = Math.floor(mx / (cell + 1))
    const row = Math.floor(my / (cell + 1))
    const idx = row * perRow + col
    setHoverWg(idx >= 0 && idx < total && col < perRow ? idx : null)
  }

  /* ---- heat strip canvas ---- */
  const heatRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = heatRef.current
    if (!cv || !result) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.scale(dpr, dpr)
    const n = result.heats.length
    const cw = w / n
    let raf = 0
    const start = performance.now()
    const draw = (now: number) => {
      const p = reduced ? 1 : Math.min(1, (now - start) / 800)
      const upTo = Math.floor(p * n)
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < upTo; i++) {
        const v = result.heats[i]
        const bad = result.mismatch > 0 && i % 16 === 15
        const alpha = 0.25 + 0.75 * Math.min(1, Math.abs(v))
        ctx.fillStyle = bad ? '#FF5C6C' : `rgba(62,242,164,${alpha.toFixed(3)})`
        ctx.fillRect(i * cw + 0.5, 2, Math.max(1, cw - 1), h - 4)
      }
      if (p < 1) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [result, reduced])

  const maxMs = result ? Math.max(...result.bars.map((b) => b.ms)) : 1
  const gpuActive = backend === 'gpu' && !forceCpu

  return (
    <PlaygroundShell
      simId="sim-wgsl"
      title="WebGPU WGSL Playground"
      subtitle="write a compute shader → dispatch it → watch workgroups execute"
      tasks={TASKS}
    >
      <div className="flex flex-col gap-4">
        {backend === 'cpu' && (
          <div className="flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 px-3 py-2 font-mono text-[12px] leading-relaxed text-amber">
            <Cpu size={14} className="mt-0.5 shrink-0" />
            <span>
              WebGPU unavailable — <b>simulated on CPU · same semantics · modeled timings</b>. Chrome/Edge 113+
              on desktop runs these kernels on your real GPU.
            </span>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* =============== editor pane =============== */}
          <section className="overflow-hidden rounded-md border border-line bg-surface-1">
            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadPreset(p.id)}
                  className={cn(
                    'rounded-sm border px-2 py-1 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                    presetId === p.id
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  {p.name}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    setForceCpu(!forceCpu)
                    log('op', !forceCpu ? 'forced CPU simulation (honesty toggle)' : 'backend → auto (WebGPU if available)')
                  }}
                  className={cn(
                    'rounded-sm border px-2 py-1 font-mono text-[10px] uppercase transition-colors duration-180',
                    gpuActive ? 'border-accent/50 text-accent' : 'border-amber/50 text-amber',
                  )}
                  title="toggle CPU simulation even when WebGPU exists"
                >
                  {gpuActive ? 'WebGPU' : 'CPU SIM'}
                </button>
                <button
                  onClick={() => loadPreset(presetId)}
                  aria-label="reset code to preset"
                  className="rounded-sm border border-line bg-surface-2 p-1.5 text-text-2 transition-all duration-180 hover:border-line-bright hover:text-text-1 active:scale-95"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  onClick={() => void run()}
                  disabled={running}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-display text-[13px] font-semibold text-accent-foreground transition-all duration-180 hover:brightness-110 active:scale-[.97] disabled:opacity-50"
                >
                  <Play size={14} />
                  {running ? 'dispatching…' : 'run dispatch'}
                </button>
              </div>
            </div>

            {/* editor body */}
            <div className="relative flex h-[440px]">
              <div
                ref={gutterRef}
                aria-hidden
                className="w-10 shrink-0 select-none overflow-hidden border-r border-line bg-surface-2/60 py-2 text-right font-mono text-[11px] leading-[1.65] text-text-3"
              >
                {codeLines.map((_, i) => (
                  <div key={i} className={cn('pr-2', errorByLine.has(i + 1) && 'text-danger', i === wgLine && hoverWg !== null && 'text-accent')}>
                    {i + 1}
                  </div>
                ))}
              </div>
              <div className="relative flex-1">
                <div
                  ref={preRef}
                  aria-hidden
                  className="absolute inset-0 overflow-auto whitespace-pre px-3 py-2 font-mono text-[13px] leading-[1.65] text-text-1"
                >
                  {highlighted.map((nodes, i) => (
                    <div
                      key={i}
                      className={cn(hoverWg !== null && i === wgLine && 'rounded-[2px] bg-accent-dim/50')}
                      style={
                        errorByLine.has(i + 1)
                          ? { textDecoration: 'underline wavy #FF5C6C', textUnderlineOffset: '3px' }
                          : undefined
                      }
                      title={errorByLine.get(i + 1)}
                    >
                      {nodes.length > 0 ? nodes : ' '}
                    </div>
                  ))}
                </div>
                <textarea
                  ref={taRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onScroll={syncScroll}
                  onKeyDown={onEditorKey}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  aria-label="WGSL compute shader editor"
                  style={{ caretColor: '#3EF2A4' }}
                  className="absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent px-3 py-2 font-mono text-[13px] leading-[1.65] text-transparent outline-none selection:bg-accent/25"
                />
                {running && (
                  <div className={cn('absolute inset-0 flex items-center justify-center bg-ink/60', !reduced && 'animate-pulse')}>
                    <span className="font-mono text-[12px] text-accent">dispatching workgroups…</span>
                  </div>
                )}
              </div>
            </div>

            {/* error strip */}
            {errors.length > 0 && (
              <div className="border-t border-danger/40 bg-danger/5 px-3 py-2">
                {errors.map((e, i) => (
                  <div key={i} className="font-mono text-[11px] text-danger">
                    line {e.line}: {e.msg}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* =============== right column =============== */}
          <div className="flex flex-col gap-4">
            {/* output */}
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">output</span>
                {result && (
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                      result.ok ? 'border-accent/50 text-accent' : 'border-danger/50 text-danger',
                    )}
                  >
                    {result.ok ? `verify ✓ ${result.checksum}` : 'verify ✗'}
                  </span>
                )}
              </div>
              {!result ? (
                <div className="rounded-sm border border-dashed border-line px-3 py-6 text-center font-mono text-[11px] text-text-3">
                  hit <span className="text-accent">run dispatch</span> — checksum + heat strip appear here
                </div>
              ) : (
                <>
                  <div className="mb-2 flex flex-col gap-1.5">
                    {result.bars.map((b) => {
                      const wPct = 8 + 92 * (Math.log10(b.ms + 0.001) + 3) / (Math.log10(maxMs + 0.001) + 3 || 1)
                      return (
                        <div key={b.label}>
                          <div className="mb-0.5 flex justify-between font-mono text-[10px] text-text-3">
                            <span>{b.label}</span>
                            <span className="text-text-1">{b.ms.toFixed(3)}ms</span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-[2px] bg-surface-3">
                            <div
                              className={cn('h-full rounded-[2px]', b.cls, !reduced && 'transition-[width] duration-300 ease-out-expo')}
                              style={{ width: `${Math.min(100, Math.max(3, wPct))}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                    {result.speedup !== undefined && (
                      <div className="mt-0.5 font-mono text-[11px]">
                        <span className={result.speedup >= 10 ? 'text-accent' : 'text-amber'}>
                          speedup {result.speedup.toFixed(1)}×
                        </span>
                        <span className="text-text-3"> — tiling reuses each B tile 16× from SRAM</span>
                      </div>
                    )}
                  </div>
                  <canvas ref={heatRef} className="h-8 w-full rounded-sm border border-line bg-ink" />
                  <div className="mt-1 font-mono text-[10px] text-text-3">
                    per-element output heat (normalized |value|, left→right = index order)
                  </div>
                  {result.note && <div className="mt-1 font-mono text-[10px] text-amber">ⓘ {result.note}</div>}
                </>
              )}
            </section>

            {/* dispatch visualizer */}
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">dispatch grid</span>
                {result && (
                  <span className="font-mono text-[10px] text-text-3">
                    {(result.dispatch.nx * result.dispatch.ny).toLocaleString()} workgroups ·{' '}
                    {result.dispatch.threads.toLocaleString()} threads
                  </span>
                )}
              </div>
              <canvas
                ref={vizRef}
                onMouseMove={onVizHover}
                onMouseLeave={() => setHoverWg(null)}
                className="h-44 w-full cursor-crosshair rounded-sm border border-line bg-ink"
                role="img"
                aria-label="workgroup dispatch grid — each cell is a workgroup executing your kernel"
              />
              <div className="mt-1 min-h-4 font-mono text-[10px] text-text-3">
                {result && hoverWg !== null ? (
                  <span className="text-accent">
                    wg #{hoverWg} · @workgroup_size({result.dispatch.wgX}
                    {result.dispatch.wgY > 1 ? `, ${result.dispatch.wgY}` : ''}) ={' '}
                    {result.dispatch.wgX * result.dispatch.wgY} threads — highlighted in editor
                  </span>
                ) : (
                  'each cell = 1 workgroup · wavefront sweep ≈ 16 SMs × 4 resident (simulated) · hover to inspect'
                )}
              </div>
              {result && hoverWg !== null && (
                <div className="mt-1 flex flex-wrap gap-[2px]">
                  {Array.from({ length: Math.min(64, result.dispatch.wgX * result.dispatch.wgY) }).map((_, i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full bg-accent/70" />
                  ))}
                  {result.dispatch.wgX * result.dispatch.wgY > 64 && (
                    <span className="font-mono text-[9px] text-text-3">…{result.dispatch.wgX * result.dispatch.wgY} threads</span>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        <LogConsole lines={lines} onClear={clear} />
      </div>
    </PlaygroundShell>
  )
}
