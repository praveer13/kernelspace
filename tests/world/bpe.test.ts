/**
 * world/bpe.ts against the lab's harness (docs/specs/wave-2.md §13.3).
 *
 * The fixtures below were printed by the real harness (labs/bpe-tokenizer/src/lib.rs: `train_bpe`, `probe`) running a
 * plain reference tokenizer, so a drift in the trainer, the encoder, the seeded text or the xorshift stream here shows
 * as a changed token count. The corpus and the `contract` ids are also read out of lib.rs itself.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  CONTRACT_TEXT,
  CORPUS,
  HARNESS_MERGES,
  HarnessRng,
  bytesOf,
  decode,
  encode,
  encodeSteps,
  encodeWith,
  harnessMerges,
  probe,
  probeLine,
  ratio2,
  seededText,
  trainBpe,
  type Merge,
} from '../../src/lib/world/bpe'

const LIB_RS = readFileSync(new URL('../../labs/bpe-tokenizer/src/lib.rs', import.meta.url), 'utf8')

/** The first 48 rules `train_bpe(CORPUS, 48)` returns: the table `probe` and `contract` use. */
const TABLE_48: Merge[] = [
  [32, 116, 256], [104, 101, 257], [257, 32, 258], [256, 258, 259], [101, 110, 260], [115, 32, 261], [256, 111, 262], [107, 260, 263],
  [262, 263, 264], [46, 259, 265], [99, 257, 266], [100, 101, 267], [115, 116, 268], [108, 111, 269], [32, 107, 270], [101, 114, 271],
  [101, 115, 272], [32, 118, 273], [97, 108, 274], [97, 109, 275], [97, 110, 276], [97, 116, 277], [98, 277, 278], [99, 111, 279],
  [100, 117, 280], [100, 273, 281], [101, 121, 282], [101, 275, 283], [111, 112, 284], [114, 283, 285], [115, 259, 286], [115, 266, 287],
  [117, 272, 288], [260, 100, 289], [261, 276, 290], [264, 265, 291], [267, 279, 292], [268, 285, 293], [269, 284, 294], [270, 282, 295],
  [274, 288, 296], [280, 108, 297], [281, 296, 298], [287, 297, 299], [290, 298, 300], [292, 267, 301], [295, 300, 302], [32, 294, 303],
]

/** `probe <seed>` over the 48-merge table: seeds 0 to 23, both check default seeds (0x0B9E, 0xC0DE), u32::MAX and the Weyl step. */
const PROBES: [number, string][] = [
  [0, 'bytes=267 tokens=187 merged=31 distinct=65 ratio=1.43 roundtrip=true'],
  [1, 'bytes=184 tokens=97 merged=34 distinct=58 ratio=1.90 roundtrip=true'],
  [2, 'bytes=209 tokens=137 merged=26 distinct=54 ratio=1.53 roundtrip=true'],
  [3, 'bytes=183 tokens=134 merged=24 distinct=55 ratio=1.37 roundtrip=true'],
  [4, 'bytes=244 tokens=124 merged=35 distinct=59 ratio=1.97 roundtrip=true'],
  [5, 'bytes=171 tokens=113 merged=25 distinct=57 ratio=1.51 roundtrip=true'],
  [6, 'bytes=219 tokens=144 merged=33 distinct=59 ratio=1.52 roundtrip=true'],
  [7, 'bytes=207 tokens=131 merged=35 distinct=53 ratio=1.58 roundtrip=true'],
  [8, 'bytes=250 tokens=166 merged=34 distinct=65 ratio=1.51 roundtrip=true'],
  [9, 'bytes=158 tokens=91 merged=25 distinct=56 ratio=1.74 roundtrip=true'],
  [10, 'bytes=143 tokens=91 merged=25 distinct=43 ratio=1.57 roundtrip=true'],
  [11, 'bytes=172 tokens=126 merged=22 distinct=72 ratio=1.37 roundtrip=true'],
  [12, 'bytes=167 tokens=110 merged=19 distinct=59 ratio=1.52 roundtrip=true'],
  [13, 'bytes=154 tokens=85 merged=25 distinct=43 ratio=1.81 roundtrip=true'],
  [14, 'bytes=204 tokens=137 merged=30 distinct=67 ratio=1.49 roundtrip=true'],
  [15, 'bytes=173 tokens=110 merged=30 distinct=54 ratio=1.57 roundtrip=true'],
  [16, 'bytes=253 tokens=169 merged=32 distinct=70 ratio=1.50 roundtrip=true'],
  [17, 'bytes=173 tokens=119 merged=23 distinct=54 ratio=1.45 roundtrip=true'],
  [18, 'bytes=206 tokens=114 merged=37 distinct=61 ratio=1.81 roundtrip=true'],
  [19, 'bytes=183 tokens=124 merged=25 distinct=48 ratio=1.48 roundtrip=true'],
  [20, 'bytes=235 tokens=163 merged=30 distinct=63 ratio=1.44 roundtrip=true'],
  [21, 'bytes=208 tokens=115 merged=33 distinct=59 ratio=1.81 roundtrip=true'],
  [22, 'bytes=190 tokens=110 merged=32 distinct=57 ratio=1.73 roundtrip=true'],
  [23, 'bytes=197 tokens=115 merged=32 distinct=41 ratio=1.71 roundtrip=true'],
  [0x0b9e, 'bytes=252 tokens=160 merged=34 distinct=62 ratio=1.57 roundtrip=true'],
  [0xc0de, 'bytes=191 tokens=125 merged=23 distinct=57 ratio=1.53 roundtrip=true'],
  [0xffffffff, 'bytes=142 tokens=90 merged=21 distinct=43 ratio=1.58 roundtrip=true'],
  [0x9e3779b9, 'bytes=159 tokens=105 merged=18 distinct=50 ratio=1.51 roundtrip=true'],
]

/** The text between `needle` and the closing quote of the Rust string, with `\`-newline continuations joined as rustc joins them. */
function rustString(after: string): string {
  const start = LIB_RS.indexOf(after)
  const open = LIB_RS.indexOf('"', start)
  const close = LIB_RS.indexOf('";', open)
  return LIB_RS.slice(open + 1, close).replace(/\\\n\s*/g, '')
}

describe('the corpus and the trainer', () => {
  test('CORPUS is the harness corpus, byte for byte', () => {
    expect(CORPUS).toBe(rustString('pub const CORPUS'))
  })

  test('the 48-merge table is the one the harness trains', () => {
    expect(HARNESS_MERGES).toBe(48)
    expect(trainBpe(CORPUS, 48)).toEqual(TABLE_48)
    expect(harnessMerges()).toEqual(TABLE_48)
  })

  test('a longer table starts with the shorter one (training is incremental) and ids count up from 256', () => {
    const long = trainBpe(CORPUS, 96)
    expect(long).toHaveLength(96)
    expect(long.slice(0, 48)).toEqual(TABLE_48)
    long.forEach((m, i) => expect(m[2]).toBe(256 + i))
  })

  test('training stops when no pair is left', () => {
    expect(trainBpe('', 10)).toEqual([])
    expect(trainBpe('a', 10)).toEqual([])
    // "aaaa": (a,a) twice, merged to [256,256], then (256,256) once, then a single id
    expect(trainBpe('aaaa', 10)).toEqual([
      [97, 97, 256],
      [256, 256, 257],
    ])
  })

  test('ties between equally frequent pairs go to the smaller pair', () => {
    // "abab" has (a,b) twice and (b,a) once; "abcd" has three pairs once each: the smallest, (a,b), goes first
    expect(trainBpe('abcd', 1)).toEqual([[97, 98, 256]])
    expect(trainBpe('dcba', 1)).toEqual([[98, 97, 256]])
  })
})

describe('encode', () => {
  test('with no merges, a byte is an id', () => {
    expect(encode('hello', [])).toEqual([...'hello'].map((c) => c.charCodeAt(0)))
    expect(encode('', TABLE_48)).toEqual([])
    expect(encode('é', [])).toEqual([0xc3, 0xa9])
  })

  test('the lowest rank wins, not the leftmost pair (check merge_priority)', () => {
    const table: Merge[] = [
      [98, 99, 256],
      [97, 98, 257],
    ]
    expect(encode('abc', table)).toEqual([97, 256])
  })

  test('a run of one byte merges from the left without overlap (check leftmost_nonoverlap)', () => {
    const table: Merge[] = [[97, 97, 256]]
    expect(encode('aaaa', table)).toEqual([256, 256])
    expect(encode('aaa', table)).toEqual([256, 97])
    expect(encode('aa', table)).toEqual([256])
    expect(encode('aaaaa', table)).toEqual([256, 256, 97])
  })

  test('a merge makes new pairs that later rules use: one pass is not enough (check contract)', () => {
    const table: Merge[] = [
      [97, 98, 256],
      [256, 99, 257],
    ]
    expect(encode('abc', table)).toEqual([257])
    expect(encode('abcabc', table)).toEqual([257, 257])
  })

  test('the contract sentence encodes to the ids lib.rs expects, 34 tokens', () => {
    const block = /const EXPECTED_IDS: &\[u32\] = &\[([^\]]*)\]/.exec(LIB_RS)
    expect(block).not.toBeNull()
    const expected = (block as RegExpExecArray)[1].split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number)
    expect(expected).toHaveLength(34)
    expect(CONTRACT_TEXT).toBe(rustString('const TEXT: &str'))
    expect(encode(CONTRACT_TEXT, TABLE_48)).toEqual(expected)
    expect(bytesOf(CONTRACT_TEXT)).toHaveLength(73)
  })

  test('encodeSteps replays the passes: each strictly shorter, the last is the encoding, ranks are in the table', () => {
    const { start, steps, ids } = encodeSteps(CONTRACT_TEXT, TABLE_48)
    expect(start).toEqual(bytesOf(CONTRACT_TEXT))
    expect(steps.length).toBeGreaterThan(0)
    let prev = start.length
    for (const s of steps) {
      expect(s.ids.length).toBeLessThan(prev)
      expect(s.replaced).toBe(prev - s.ids.length)
      expect(TABLE_48[s.rank]).toBe(s.merge)
      prev = s.ids.length
    }
    expect(steps[steps.length - 1].ids).toEqual(ids)
    expect(encodeSteps('hello', []).steps).toEqual([])
  })

  test('an applied rank never decreases below the ranks already applied to unchanged pairs: ranks come out in non-decreasing order for this text', () => {
    // merging a pair only creates pairs whose rules are later in the table (a rule can only name earlier ids), so ranks rise
    const { steps } = encodeSteps(CONTRACT_TEXT, TABLE_48)
    for (let i = 1; i < steps.length; i++) expect(steps[i].rank).toBeGreaterThan(steps[i - 1].rank)
  })

  test('encodeWith(n) is the encoding under the first n rules, and more rules never make more tokens', () => {
    const table = trainBpe(CORPUS, 96)
    expect(encodeWith(CONTRACT_TEXT, table, 48)).toEqual(encode(CONTRACT_TEXT, TABLE_48))
    expect(encodeWith(CONTRACT_TEXT, table, 0)).toEqual(bytesOf(CONTRACT_TEXT))
    let prev = Infinity
    for (let n = 0; n <= 96; n += 6) {
      const len = encodeWith(CONTRACT_TEXT, table, n).length
      expect(len).toBeLessThanOrEqual(prev)
      prev = len
    }
  })
})

describe('decode', () => {
  test('merge ids expand to bytes through their children, however deep', () => {
    const text = 'the user waits for the first token'
    expect(decode(encode(text, TABLE_48), TABLE_48)).toBe(text)
    expect(decode([303], TABLE_48)).toBe(' ' + decode([294], TABLE_48))
  })

  test('an unknown id becomes one U+FFFD and the rest still decodes (check robust_decode)', () => {
    const table: Merge[] = [[97, 98, 256]]
    expect(decode([], table)).toBe('')
    expect(decode([9999], table)).toBe('�')
    expect(decode([256, 9999, 97], table)).toBe('ab�a')
    expect(decode([-1, 300], table)).toBe('��')
  })

  test('byte-perfect over multi-byte UTF-8 under any table (check roundtrip)', () => {
    const text = 'emoji: 🦀🚀 cjk: 推し活 accents: naïve café — “quotes”\ninside'
    for (const n of [0, 16, 48]) {
      const table = trainBpe(CORPUS, n)
      expect(decode(encode(text, table), table)).toBe(text)
    }
  })
})

describe('the harness stream and `probe <seed>`', () => {
  test('HarnessRng is deterministic per seed and unrelated across neighbouring seeds', () => {
    const a = new HarnessRng(41)
    const b = new HarnessRng(41)
    const c = new HarnessRng(42)
    const xs = [a.next(), a.next(), a.next()]
    expect([b.next(), b.next(), b.next()]).toEqual(xs)
    expect(c.next()).not.toBe(xs[0])
    // xorshift64* output is 64 bits wide
    expect(xs.every((x) => x >= 0n && x < 1n << 64n)).toBe(true)
  })

  test('seededText builds text from corpus words, unseen chunks and Unicode scalars', () => {
    const text = seededText(new HarnessRng(7), 30)
    expect(text.length).toBeGreaterThan(30)
    expect(seededText(new HarnessRng(7), 30)).toBe(text)
    expect(decode(encode(text, TABLE_48), TABLE_48)).toBe(text)
  })

  test('the harness printed these probe lines for the 48-merge table: bytes, tokens, merged, distinct, ratio', () => {
    for (const [seed, line] of PROBES) expect([seed, probeLine(seed)]).toEqual([seed, line])
  })

  test('ratios print as Rust does: the exact double rounded, a true tie going to the even digit', () => {
    expect(ratio2(252, 160)).toBe('1.57') // 1.575 is a hair under in binary
    expect(ratio2(9, 8)).toBe('1.12') // 1.125 is exact: the even digit
    expect(ratio2(11, 8)).toBe('1.38')
    expect(ratio2(13, 8)).toBe('1.62')
    expect(ratio2(15, 8)).toBe('1.88')
    expect(ratio2(2, 1)).toBe('2.00')
    expect(ratio2(5, 0)).toBe('0.00')
  })

  test('probe returns the numbers the line prints', () => {
    const p = probe(1)
    expect(p.bytes).toBe(184)
    expect(p.tokens).toBe(97)
    expect(p.merged).toBe(34)
    expect(p.distinct).toBe(58)
    expect(p.ratio).toBeCloseTo(1.9, 1)
    expect(p.roundtrip).toBe(true)
    expect(bytesOf(p.text)).toHaveLength(p.bytes)
  })
})
