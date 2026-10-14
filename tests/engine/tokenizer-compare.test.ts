/**
 * The token-count check and the tokenizer comparison (docs/specs/wave-2.md §10.5, task 2b-20): `makeWasmTokenCounter`
 * counts the corpus through the bridge's `count <hex>` verb, the fleet host serves it in a token session, and
 * TokenizerCompare shows your counts beside the Qwen3 claims and records the gap explanation as
 * `item item:engine.bpe-gap`.
 *
 * No wasm built from a private solution is ever committed, so the tokenizer here is a JS stand-in that answers
 * `count <hex>` the way the lab's bridge does (the fakeLab pattern of tests/forge/fixtures.ts).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToReadableStream, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import TokenizerCompare, {
  compareRows,
  countProblem,
  formatRatio,
  GAP_IDEAS,
  GAP_ITEM,
  GAP_ITEM_ID,
  gapResponse,
  QWEN3_VOCAB_CLAIM,
  qwen3CountClaim,
} from '../../src/components/engine/TokenizerCompare'
import { getClaim } from '../../src/data/claims'
import { TOKEN_CORPUS } from '../../src/data/engine/token-corpus'
import { REFUSALS } from '../../src/lib/engine/store'
import { createFleetHost } from '../../src/lib/fleet-host'
import { openTokenSession, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { revFor } from '../../src/lib/items/play'
import { LabAbiError, LabTrapError } from '../../src/lib/wasm-lab'
import Fleet from '../../src/pages/Fleet'
import { makeWasmTokenCounter, REBUILD_MESSAGE, type Mod } from '../../src/pages/fleet/drivers'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { makeProfile, startTab, tick } from '../ledger/env'

/* ----------------------------- a tokenizer stand-in ----------------------------- */

interface FakeTokenizer extends Mod {
  /** The commands the module was sent, in order. */
  cmds: string[]
  /** The texts those commands decoded to. */
  texts: string[]
}

const bytesOfHex = (hex: string): Uint8Array => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)))

/**
 * A module that answers `count <hex>` with the number of UTF-8 bytes of the text, which is what a byte-level BPE
 * with no merges learned would give. `answer` overrides replies, for stale, unfinished or broken modules.
 */
function fakeTokenizer(answer?: (cmd: string) => string | undefined): FakeTokenizer {
  const cmds: string[] = []
  const texts: string[] = []
  return {
    cmds,
    texts,
    hasInvoke: true,
    runChecks: () => {
      throw new Error('the stand-in has no self-checks')
    },
    dispose() {},
    invoke(cmd) {
      cmds.push(cmd)
      const custom = answer?.(cmd)
      if (custom !== undefined) return custom
      const [verb, hex = ''] = cmd.split(' ')
      if (verb !== 'count') return `err unknown command ${JSON.stringify(cmd)}`
      const bytes = bytesOfHex(hex)
      texts.push(new TextDecoder().decode(bytes))
      return String(bytes.length)
    },
  }
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length

/* ------------------------------ makeWasmTokenCounter ------------------------------ */

describe('makeWasmTokenCounter counts the corpus through count <hex>', () => {
  test('each corpus text reaches the module intact, as hex of its UTF-8 bytes, and its reply is the count', () => {
    const mod = fakeTokenizer()
    const count = makeWasmTokenCounter(mod)
    const counts = TOKEN_CORPUS.map((t) => count(t.text))
    // Chinese, emoji (a joined one included) and newlines survive the hex round trip
    expect(mod.texts).toEqual(TOKEN_CORPUS.map((t) => t.text))
    expect(counts).toEqual(TOKEN_CORPUS.map((t) => utf8Length(t.text)))
    for (const cmd of mod.cmds) expect(cmd).toMatch(/^count [0-9a-f]+$/)
    expect(mod.cmds[0]).toBe(`count ${Buffer.from(TOKEN_CORPUS[0].text).toString('hex')}`)
  })

  test('the empty text is "count" alone', () => {
    const mod = fakeTokenizer((cmd) => (cmd === 'count' ? '0' : undefined))
    expect(makeWasmTokenCounter(mod)('')).toBe(0)
    expect(mod.cmds).toEqual(['count'])
  })

  test('a module built from an older zip is told to rebuild, in the words of the install gate', () => {
    expect(REBUILD_MESSAGE).toBe(REFUSALS['stale-version'])
    const old = fakeTokenizer((cmd) => `err unknown command ${JSON.stringify(cmd)} (try: probe <seed>)`)
    let thrown: unknown
    try {
      makeWasmTokenCounter(old)('hi')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(LabAbiError)
    expect((thrown as Error).message).toBe(REFUSALS['stale-version'])
    expect(countProblem(thrown)).toBe(REFUSALS['stale-version'])
  })

  test('an unfinished tokenizer is "not implemented yet", and a broken reply fails closed', () => {
    const unfinished = fakeTokenizer(() => {
      throw new LabTrapError()
    })
    let trap: unknown
    try {
      makeWasmTokenCounter(unfinished)('hi')
    } catch (e) {
      trap = e
    }
    expect(trap).toBeInstanceOf(LabTrapError)
    expect(countProblem(trap)).toStartWith('not implemented yet')

    expect(() => makeWasmTokenCounter(fakeTokenizer(() => 'lots'))('hi')).toThrow('not a count')
    expect(() => makeWasmTokenCounter(fakeTokenizer(() => 'err the hex is not valid UTF-8'))('hi')).toThrow('token count: err the hex is not valid UTF-8')
    expect(() => makeWasmTokenCounter({ ...fakeTokenizer(), hasInvoke: false })).toThrow('no ks_invoke bridge')
  })
})

/* ---------------------------------- the fleet host ---------------------------------- */

/** The real host behind a fake worker: what fleet.worker.ts does, minus the thread. */
class HostWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  readonly received: FleetRequest[] = []
  private readonly host: ReturnType<typeof createFleetHost>

  constructor(make: () => Mod) {
    this.host = createFleetHost({ instantiate: async () => make() })
    queueMicrotask(() => this.onmessage?.({ data: { type: 'boot' } }))
  }

  postMessage(msg: FleetRequest) {
    this.received.push(msg)
    void this.host.handle(msg, (reply: FleetReply) => this.onmessage?.({ data: reply }))
  }

  terminate() {}
}

describe('a token session counts in the fleet worker', () => {
  test('open and count return your counts for the corpus, in order', async () => {
    const mod = fakeTokenizer()
    const worker = new HostWorker(() => mod)
    const session = await openTokenSession({ mode: 'tokens', slots: { tokenizer: new ArrayBuffer(8) } }, { spawn: () => worker })
    const counts = await session.count(TOKEN_CORPUS.map((t) => t.text))
    expect(counts).toEqual(TOKEN_CORPUS.map((t) => utf8Length(t.text)))
    session.close()
    expect(worker.received.map((m) => m.cmd)).toEqual(['open', 'count'])
  })

  test('a stale tokenizer rejects the count with the rebuild message, a todo!() with a trap', async () => {
    const stale = new HostWorker(() => fakeTokenizer((cmd) => `err unknown command ${JSON.stringify(cmd)}`))
    const a = await openTokenSession({ mode: 'tokens', slots: { tokenizer: new ArrayBuffer(8) } }, { spawn: () => stale })
    await expect(a.count(['hi'])).rejects.toThrow(REFUSALS['stale-version'])
    a.close()

    const todo = new HostWorker(() =>
      fakeTokenizer(() => {
        throw new LabTrapError()
      }),
    )
    const b = await openTokenSession({ mode: 'tokens', slots: { tokenizer: new ArrayBuffer(8) } }, { spawn: () => todo })
    const err = await b.count(['hi']).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(LabTrapError)
    expect(countProblem(err)).toStartWith('not implemented yet')
    b.close()
  })

  test('count without an open session is refused, not hung', async () => {
    const host = createFleetHost({ instantiate: async () => fakeTokenizer() })
    const replies: FleetReply[] = []
    await host.handle({ id: 1, cmd: 'count', texts: ['x'] }, (r) => replies.push(r))
    expect(replies).toEqual([{ type: 'failed', id: 1, kind: 'error', message: 'no token-count session is open' }])
  })
})

/* ---------------------------------- the comparison ---------------------------------- */

describe('compareRows sets your counts beside the Qwen3 claims', () => {
  test('one row per corpus text, Qwen3 side from the pinned claims, yours unknown until counted', () => {
    const rows = compareRows()
    expect(rows.map((r) => r.id)).toEqual(TOKEN_CORPUS.map((t) => t.id))
    for (const r of rows) {
      expect(r.qwen).toBe(getClaim(qwen3CountClaim(r.id)).value as number)
      expect(r.yours).toBeNull()
      expect(r.ratio).toBeNull()
    }
  })

  test('the ratio is yours over Qwen3\'s, and characters are code points while bytes are UTF-8', () => {
    const counts = TOKEN_CORPUS.map((t) => utf8Length(t.text))
    const rows = compareRows(counts)
    for (const r of rows) expect(r.ratio).toBeCloseTo(r.yours! / r.qwen, 10)
    const chinese = rows.find((r) => r.id === 'chinese')!
    expect(chinese.chars).toBe([...TOKEN_CORPUS.find((t) => t.id === 'chinese')!.text].length)
    expect(chinese.bytes).toBe(chinese.chars * 3)
    // a no-merge tokenizer needs several times Qwen3's tokens on every text but the plain ASCII ones
    expect(rows.find((r) => r.id === 'chinese')!.ratio!).toBeGreaterThan(3)
  })

  test('ratios read to one decimal below ten and whole above', () => {
    expect(formatRatio(1)).toBe('1.0x')
    expect(formatRatio(2.449)).toBe('2.4x')
    expect(formatRatio(9.96)).toBe('10.0x')
    expect(formatRatio(12.4)).toBe('12x')
  })

  test('the vocabulary size it quotes is the pinned claim', () => {
    expect(getClaim(QWEN3_VOCAB_CLAIM).pin?.repo).toBe('Qwen/Qwen3-0.6B')
    for (const t of TOKEN_CORPUS) expect(getClaim(qwen3CountClaim(t.id)).pin).toEqual(getClaim(QWEN3_VOCAB_CLAIM).pin)
  })
})

describe('TokenizerCompare renders', () => {
  const html = (props: Parameters<typeof TokenizerCompare>[0]) => renderToString(createElement(MemoryRouter, null, createElement(TokenizerCompare, props)))

  test('with no tokenizer installed: Qwen3\'s side alone, a pointer to lab 03 and no gap question yet', () => {
    const out = html({})
    for (const t of TOKEN_CORPUS) expect(out).toContain(t.label)
    for (const t of TOKEN_CORPUS) expect(out).toContain(`>${getClaim(qwen3CountClaim(t.id)).value}<`)
    expect(out).toContain('href="/forge/bpe-tokenizer"')
    expect(out).toContain('Install a tokenizer from')
    expect(out).not.toContain('Why the gap?')
    expect(out.match(/data-yours="[a-z]+">–</g)).toHaveLength(TOKEN_CORPUS.length)
  })

  test('with counts: your numbers, the ratios, the vocabulary and the gap question', () => {
    const counts = TOKEN_CORPUS.map((t) => utf8Length(t.text))
    const out = html({ counts })
    for (const [i, t] of TOKEN_CORPUS.entries()) expect(out).toContain(`data-yours="${t.id}">${counts[i]}<`)
    expect(out).toContain('151,669')
    expect(out).toContain('Why the gap?')
    expect(out).toContain(GAP_ITEM.prompt.replace(/'/g, '&#x27;'))
    expect(out).not.toContain('Install a tokenizer from')
    // the table is labelled for screen readers
    expect(out).toContain('<caption class="sr-only">')
    expect(out).toContain('scope="col"')
  })
})

describe('where the comparison is mounted', () => {
  test('/fleet renders TokenizerCompare once, below the engine schematic', async () => {
    // renderToReadableStream waits for the lazy chunks; the markup then holds the resolved comparison after the schematic's figure
    const stream = await renderToReadableStream(createElement(MemoryRouter, null, createElement(Fleet)))
    await stream.allReady
    const out = await new Response(stream).text()
    const heading = out.indexOf('your tokenizer vs Qwen3')
    expect(heading).toBeGreaterThan(-1)
    expect(out.lastIndexOf('your tokenizer vs Qwen3')).toBe(heading)
    expect(out.indexOf('<figure')).toBeGreaterThan(-1)
    expect(out.indexOf('<figure')).toBeLessThan(heading)
    // with no tokenizer installed the mounted comparison is Qwen3's side and the pointer to lab 03
    expect(out).toContain('href="/forge/bpe-tokenizer"')
  })
})

/* ------------------------------- the gap explanation ------------------------------- */

describe('the gap explanation is a self-checked constructed response with three ideas (§10.5)', () => {
  test('the ideas are the three of the spec, and the model answer fits sixty words', () => {
    expect(GAP_IDEAS).toHaveLength(3)
    expect(GAP_IDEAS[0]).toMatch(/pre-tokenizer regex/)
    expect(GAP_IDEAS[1]).toMatch(/151k vocabulary entries against your 48 merges/)
    expect(GAP_IDEAS[2]).toMatch(/training corpus/)
    expect(GAP_ITEM.ideas).toBe(GAP_IDEAS)
    expect(GAP_ITEM.model.split(/\s+/).length).toBeLessThanOrEqual(60)
    // the vocabulary figure the second idea quotes is the claim's, rounded
    expect(Math.floor((getClaim(QWEN3_VOCAB_CLAIM).value as number) / 1000)).toBe(151)
  })

  test('two of three ticked passes, one does not, and only the ticks are recorded', () => {
    const pass = gapResponse([true, false, true], 'my private words')
    expect(pass).toMatchObject({ kind: 'item', ref: `item:${GAP_ITEM_ID}`, score: 1, ok: true, data: { src: 'practice', ideas: [0, 2] } })
    expect(JSON.stringify(pass)).not.toContain('my private words')
    const miss = gapResponse([false, true, false])
    expect(miss).toMatchObject({ score: 0, ok: false, data: { ideas: [1] } })
    expect(gapResponse([true, true, true]).data).toEqual({ src: 'practice', ideas: [0, 1, 2] })
    expect(pass.rev).toBe(miss.rev)
    expect(pass.rev).toMatch(/^[0-9a-z]+$/)
  })

  test('the ref is item:engine.bpe-gap and the ledger accepts and keeps the event', async () => {
    expect(GAP_ITEM_ID).toBe('engine.bpe-gap')
    const profile = makeProfile()
    const tab = startTab(profile)
    tab.progress.getState().recordItems([gapResponse([true, true, false], 'text stays here')])
    await tick(20)
    const events = await (await tab.engine()).events({ kinds: ['item'], refPrefix: 'item:engine.' })
    expect(events).toHaveLength(1)
    const e = events[0]
    if (e.kind !== 'item') throw new Error('expected an item event')
    expect(e.ref).toBe('item:engine.bpe-gap')
    expect(e.data).toMatchObject({ src: 'practice', ideas: [0, 1] })
    expect(e.ok).toBe(true)
    expect(e.rev).toBe(gapResponse([true, true, true]).rev)
    expect(JSON.stringify(e)).not.toContain('text stays here')
  })

  test('the rev is the constructed-response fingerprint, so changed ideas read as a new item', () => {
    expect(gapResponse([true, true, true]).rev).toBe(revFor({ source: 'cr', lessonId: 'engine', index: 0, cr: GAP_ITEM }))
    expect(revFor({ source: 'cr', lessonId: 'engine', index: 0, cr: { ...GAP_ITEM, ideas: [GAP_IDEAS[0], GAP_IDEAS[1], 'something else'] } })).not.toBe(gapResponse([true, true, true]).rev)
  })
})
