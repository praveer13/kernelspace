/**
 * Byte-level BPE, in the browser (docs/specs/wave-2.md §13.3): the reference of lab 03's Run and Modify steps.
 *
 * It trains and encodes exactly as the lab's harness does (labs/bpe-tokenizer/src/lib.rs): the same `CORPUS`, the same
 * trainer (pair counts, ties broken by the smaller pair), the same encoder (lowest rank anywhere in the sequence,
 * every occurrence replaced left to right without overlap, repeated until no pair has a rule) and the same decoder
 * (merge ids expand to their children, an unknown id becomes U+FFFD). It also ports the harness's seeded text and its
 * `probe <seed>` summary line, so tests/world/bpe.test.ts can hold it to the 48-merge table's token counts.
 *
 * Pure and deterministic: no DOM, no clock, no storage. Ids are plain numbers; ids 0 to 255 are the bytes themselves,
 * and the merge at rank `r` of a table trained from id 256 makes id `256 + r`.
 */

/** `[left, right, merged id]`; the index in the table is the rank (earlier = higher priority). */
export type Merge = readonly [number, number, number]

/** The harness's training corpus (`CORPUS` in lib.rs). */
export const CORPUS =
  'the scheduler schedules the batch. the batcher batches tokens. tokens in, tokens out. the cache caches blocks of keys and values. keys and values, keys and values. decode decodes the decode loop. the loop loops until the end token. the end token ends the stream. the stream streams tokens to the user. the user waits for the first token. the first token is the slowest token. the scheduler knows why.'

/** The merge count of the harness's `contract` check and `probe`. */
export const HARNESS_MERGES = 48

/** The sentence `contract` checks bit for bit (`TEXT` in lib.rs). */
export const CONTRACT_TEXT = 'the user waits for the first token while the scheduler batches the stream'

const encoder = new TextEncoder()

/** The UTF-8 bytes of a string, as ids. */
export const bytesOf = (text: string): number[] => Array.from(encoder.encode(text))

/** Replaces every adjacent `pair` with `id`, left to right, never reusing a byte: `aaa` with (a, a) is `[aa, a]`. */
function replacePair(ids: readonly number[], left: number, right: number, id: number): number[] {
  const out: number[] = []
  let i = 0
  while (i < ids.length) {
    if (i + 1 < ids.length && ids[i] === left && ids[i + 1] === right) {
      out.push(id)
      i += 2
    } else {
      out.push(ids[i])
      i += 1
    }
  }
  return out
}

/**
 * The harness's trainer (`train_bpe`): at each step the most frequent adjacent pair becomes the next merge, ties
 * broken by the smaller pair (left id, then right id). Stops early when no pair is left.
 */
export function trainBpe(corpus: string = CORPUS, numMerges: number = HARNESS_MERGES): Merge[] {
  let ids = bytesOf(corpus)
  const merges: Merge[] = []
  for (let i = 0; i < numMerges; i++) {
    const counts = new Map<number, number>()
    // pairs are keyed (left * 2^20 + right): ids stay far below 2^20 here
    for (let j = 0; j + 1 < ids.length; j++) {
      const key = ids[j] * 1048576 + ids[j + 1]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let bestKey = -1
    let bestCount = 0
    for (const [key, count] of counts) {
      if (count > bestCount || (count === bestCount && key < bestKey)) {
        bestKey = key
        bestCount = count
      }
    }
    if (bestKey < 0) break
    const left = Math.floor(bestKey / 1048576)
    const right = bestKey % 1048576
    const id = 256 + i
    merges.push([left, right, id])
    ids = replacePair(ids, left, right, id)
  }
  return merges
}

/** One merge applied during an encode: what the Run step steps through. */
export interface EncodeStep {
  /** The rank that applied (an index into the table). */
  rank: number
  merge: Merge
  /** How many places the pair was replaced in this pass. */
  replaced: number
  /** The ids after this pass. */
  ids: readonly number[]
}

/** The table's rank of each adjacent pair; the first rule wins if a pair repeats. */
function ranksOf(merges: readonly Merge[]): Map<number, number> {
  const ranks = new Map<number, number>()
  merges.forEach(([l, r], rank) => {
    const key = l * 1048576 + r
    if (!ranks.has(key)) ranks.set(key, rank)
  })
  return ranks
}

/**
 * Encodes `text` and returns every pass: the lowest-rank pair present anywhere in the sequence, all occurrences
 * replaced left to right without overlap, until no adjacent pair has a rule. `steps` is empty for an empty table.
 */
export function encodeSteps(text: string, merges: readonly Merge[]): { start: readonly number[]; steps: EncodeStep[]; ids: number[] } {
  const ranks = ranksOf(merges)
  const start = bytesOf(text)
  let ids = start
  const steps: EncodeStep[] = []
  for (;;) {
    let best = -1
    for (let i = 0; i + 1 < ids.length; i++) {
      const rank = ranks.get(ids[i] * 1048576 + ids[i + 1])
      if (rank !== undefined && (best < 0 || rank < best)) best = rank
    }
    if (best < 0) break
    const merge = merges[best]
    const next = replacePair(ids, merge[0], merge[1], merge[2])
    steps.push({ rank: best, merge, replaced: ids.length - next.length, ids: next })
    ids = next
  }
  return { start, steps, ids: [...ids] }
}

/** The ids of `text` under the table (the harness's `Tokenizer::encode`). */
export const encode = (text: string, merges: readonly Merge[]): number[] => encodeSteps(text, merges).ids

/** The ids after the first `count` merges of the table apply, in rank order (the Run step's frames). Equals `encode` with that many rules. */
export function encodeWith(text: string, merges: readonly Merge[], count: number): number[] {
  return encode(text, merges.slice(0, Math.max(0, count)))
}

const replacement = [0xef, 0xbf, 0xbd]

/**
 * The harness's `Tokenizer::decode`: merge ids expand to their children until only bytes are left, an id that is
 * neither a byte nor in the table becomes U+FFFD, and what is left of the bytes is read as lossy UTF-8.
 */
export function decode(ids: readonly number[], merges: readonly Merge[]): string {
  const children = new Map<number, readonly [number, number]>()
  for (const [l, r, id] of merges) children.set(id, [l, r])
  const bytes: number[] = []
  for (const id of ids) {
    const stack = [id]
    while (stack.length > 0) {
      const t = stack.pop() as number
      if (t >= 0 && t < 256) {
        bytes.push(t)
        continue
      }
      const kids = children.get(t)
      if (kids !== undefined) stack.push(kids[1], kids[0])
      else bytes.push(...replacement)
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/* ------------------------------------------------------------------ */
/* The harness's seeded text and its `probe <seed>` line                */
/* ------------------------------------------------------------------ */

const MASK64 = 0xffffffffffffffffn

/** kslab's `Rng`: xorshift64* seeded through splitmix64, the same stream as the Rust harness. */
export class HarnessRng {
  private s: bigint
  constructor(seed: number) {
    let z = (BigInt(seed >>> 0) + 0x9e3779b97f4a7c15n) & MASK64
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
    z ^= z >> 31n
    this.s = z === 0n ? 0x2545f4914f6cdd1dn : z
  }
  /** The next 64 random bits. */
  next(): bigint {
    let x = this.s
    x ^= x >> 12n
    x ^= (x << 25n) & MASK64
    x ^= x >> 27n
    this.s = x
    return (x * 0x2545f4914f6cdd1dn) & MASK64
  }
  /** 0..n (n at least 1) */
  below(n: number): number {
    return Number(this.next() % BigInt(Math.max(1, n)))
  }
  /** lo..=hi */
  range(lo: number, hi: number): number {
    return lo + this.below(hi - lo + 1)
  }
}

const WORDS = ['the', 'scheduler', 'batch', 'tokens', 'keys', 'values', 'decode', 'loop', 'stream', 'user', 'first', 'token', 'cache', 'blocks']
const CHUNKS = ['🦀', '推し活', 'naïve', 'café', '—', '“quoted”', '\n', '日本語', 'ß']
const BLOCKS: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa1, 0xff],
  [0x400, 0x4ff],
  [0x4e00, 0x9fff],
  [0x1f300, 0x1f64f],
]

/** The harness's `seeded_text`: corpus words, chunks it never saw and single scalars from a few Unicode blocks. */
export function seededText(rng: HarnessRng, pieces: number): string {
  let s = ''
  for (let i = 0; i < pieces; i++) {
    const pick = rng.below(10)
    if (pick <= 5) s += WORDS[rng.below(WORDS.length)]
    else if (pick <= 7) s += CHUNKS[rng.below(CHUNKS.length)]
    else {
      const [lo, hi] = BLOCKS[rng.below(BLOCKS.length)]
      s += String.fromCodePoint(rng.range(lo, hi))
    }
    if (rng.below(4) !== 0) s += ' '
  }
  return s
}

/** What `probe <seed>` measures about one seeded text under the 48-merge table. */
export interface Probe {
  text: string
  /** UTF-8 bytes of the text. */
  bytes: number
  tokens: number
  /** Ids that are merges (256 and up). */
  merged: number
  distinct: number
  /** bytes per token, two decimals as the harness prints it. */
  ratio: number
  roundtrip: boolean
}

let harnessTable: Merge[] | undefined
/** The 48-merge table `probe` and `contract` use, trained once. */
export function harnessMerges(): readonly Merge[] {
  harnessTable ??= trainBpe(CORPUS, HARNESS_MERGES)
  return harnessTable
}

/** The harness's `probe(seed)` over the 48-merge table. */
export function probe(seed: number, merges: readonly Merge[] = harnessMerges()): Probe {
  const rng = new HarnessRng(seed)
  const pieces = 24 + rng.below(25)
  const text = seededText(rng, pieces)
  const ids = encode(text, merges)
  const bytes = encoder.encode(text).length
  return {
    text,
    bytes,
    tokens: ids.length,
    merged: ids.filter((i) => i >= 256).length,
    distinct: new Set(ids).size,
    ratio: ids.length === 0 ? 0 : bytes / ids.length,
    roundtrip: decode(ids, merges) === text,
  }
}

/**
 * `bytes / tokens` to two decimals as Rust's `{:.2}` prints it. Both round the double's exact value, so they agree
 * except where that value is a true tie, which for two decimals means an odd multiple of 1/8 (1.125): Rust takes the
 * even digit (1.12), `toFixed` the larger (1.13).
 */
export function ratio2(bytes: number, tokens: number): string {
  if (tokens === 0) return '0.00'
  const eighths = (bytes * 8) / tokens
  if (Number.isInteger(eighths) && eighths % 2 === 1) {
    const q = Math.floor((bytes * 100) / tokens)
    const even = q % 2 === 0 ? q : q + 1
    return `${Math.floor(even / 100)}.${String(even % 100).padStart(2, '0')}`
  }
  return (bytes / tokens).toFixed(2)
}

/** The line the harness's `probe <seed>` prints, character for character. */
export function probeLine(seed: number, merges: readonly Merge[] = harnessMerges()): string {
  const p = probe(seed, merges)
  return `bytes=${p.bytes} tokens=${p.tokens} merged=${p.merged} distinct=${p.distinct} ratio=${ratio2(p.bytes, p.tokens)} roundtrip=${p.roundtrip}`
}
