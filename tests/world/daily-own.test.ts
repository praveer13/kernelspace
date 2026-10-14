/**
 * The Daily on your engine (docs/specs/wave-2.md §9.7, task 2b-21): the session opens on the scheduler, block manager,
 * intake queue and prefix router installed in your engine, the debrief says which boxes were yours, the share string
 * adds "on my engine", and the one `incident` event per date names the modules that ran. A reference Daily, a box
 * whose bytes are not on this device and the fallback after a module fails all play the reference drivers.
 *
 * The module is a hand-assembled scheduler that admits nothing (no private solution is committed): it is yours, it
 * really runs in every worker, and it makes the incident burn differently from the reference, for the expert too.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createFleetHost } from '../../src/lib/fleet-host'
import { openIncidentSession, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { ENGINE_SLOT_ORDER } from '../../src/lib/engine/catalog'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { IncidentResult } from '../../src/lib/ledger/types'
import { createSlotsStore } from '../../src/pages/fleet/slots'
import {
  DAILY_BOXES,
  boxHashes,
  boxLines,
  dailyBoxes,
  dailyIncident,
  dailyNumber,
  dailyPlayed,
  dailyRef,
  dailySlotBytes,
  engineLine,
  engineNote,
  installedBoxCount,
  ownBoxes,
  recordDaily,
  shareString,
  type InstalledBoxes,
} from '../../src/lib/world/daily'
import { replayIncident } from '../../src/lib/world/incident-sim'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { makeProfile, startTab, tick } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const SLOW = 90_000

/* ------------------- a tiny hand-assembled scheduler module ------------------- */

const uleb = (n: number): number[] => {
  const out: number[] = []
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n !== 0) byte |= 0x80
    out.push(byte)
  } while (n !== 0)
  return out
}

const sleb64 = (value: bigint): number[] => {
  const out: number[] = []
  for (;;) {
    const byte = Number(value & 0x7fn)
    value >>= 7n
    if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body]
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()]
const str = (s: string): number[] => [...uleb(s.length), ...new TextEncoder().encode(s)]
const packed = (ptr: number, len: number): number[] => [0x42, ...sleb64((BigInt(ptr) << 32n) | BigInt(len))]

const INIT_OK_AT = 1024
const ADMIT_NOTHING_AT = 1040
const REPORT_AT = 2048
const ADMIT_NOTHING = 'admit\npreempt'

/** A zero-import lab module whose ks_invoke answers "ok" to init and an empty admit/preempt to everything else: a scheduler that never admits. */
function admitNothingModule(): ArrayBuffer {
  const report = JSON.stringify({ lab: 'batching-scheduler', version: 3, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
  const ksAlloc = [0x00, 0x41, ...sleb64(4096n), 0x0b]
  const ksFree = [0x00, 0x0b]
  const ksRun = [0x00, ...packed(REPORT_AT, report.length), 0x0b]
  const ksInvoke = [
    0x00,
    0x20, 0x00, 0x2d, 0x00, 0x00, // local.get 0; i32.load8_u
    0x41, ...sleb64(105n), 0x46, // i32.const 'i'; i32.eq
    0x04, 0x7e, // if (result i64)
    ...packed(INIT_OK_AT, 2),
    0x05, // else
    ...packed(ADMIT_NOTHING_AT, ADMIT_NOTHING.length),
    0x0b,
    0x0b,
  ]
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f], [0x60, 0x02, 0x7f, 0x7f, 0x00], [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e]])),
    ...section(3, vec([[0], [1], [2], [2]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(7, vec([[...str('memory'), 0x02, 0x00], [...str('ks_alloc'), 0x00, 0], [...str('ks_free'), 0x00, 1], [...str('ks_run'), 0x00, 2], [...str('ks_invoke'), 0x00, 3]])),
    ...section(10, vec([[...uleb(ksAlloc.length), ...ksAlloc], [...uleb(ksFree.length), ...ksFree], [...uleb(ksRun.length), ...ksRun], [...uleb(ksInvoke.length), ...ksInvoke]])),
    ...section(
      11,
      vec(
        [
          [INIT_OK_AT, 'ok'],
          [ADMIT_NOTHING_AT, ADMIT_NOTHING],
          [REPORT_AT, report],
        ].map(([at, text]) => [0x00, 0x41, ...sleb64(BigInt(at as number)), 0x0b, ...str(text as string)]),
      ),
    ),
  ]
  return new Uint8Array(bytes).buffer
}

/** The real host behind a fake worker: what fleet.worker.ts does, minus the thread. */
class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  private terminated = false
  private readonly host = createFleetHost()
  constructor() {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }
  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }
  postMessage(msg: FleetRequest) {
    if (this.terminated) return
    setTimeout(() => void this.host.handle(msg, (reply) => this.deliver(reply)), 0)
  }
  terminate() {
    this.terminated = true
  }
}

const SCHED = admitNothingModule()
const SCHED_SHA = await sha256Hex(SCHED)
const OTHER_SHA = 'b'.repeat(64)

const installed = (over: InstalledBoxes = {}): InstalledBoxes => ({
  scheduler: { sha256: SCHED_SHA, labId: 'batching-scheduler', bytes: SCHED },
  ...over,
})

/* ------------------------------------------------------------------ */
/* The four boxes                                                       */
/* ------------------------------------------------------------------ */

describe('which boxes are yours', () => {
  test('the Daily runs on the scheduler, block manager, intake queue and prefix router, in that order', () => {
    expect(DAILY_BOXES).toEqual(['scheduler', 'block-manager', 'intake', 'prefix-router'])
    for (const slot of DAILY_BOXES) expect(ENGINE_SLOT_ORDER).toContain(slot)
    expect(dailyBoxes({}).map((b) => b.slot)).toEqual([...DAILY_BOXES])
  })

  test('nothing installed: every box is the reference', () => {
    const boxes = dailyBoxes({})
    expect(ownBoxes(boxes)).toEqual([])
    expect(boxHashes(boxes)).toEqual([])
    expect(boxLines(boxes)).toEqual(['scheduler: reference', 'block manager: reference', 'intake queue: reference', 'prefix router: reference'])
    expect(dailySlotBytes({})).toEqual({ sched: null, mgr: null, queue: null, router: null })
  })

  test('an installed module is yours, with its lab and hash, and its bytes reach its own slot', () => {
    const mgr = new Uint8Array([9]).buffer
    const inst = installed({ 'block-manager': { sha256: OTHER_SHA, labId: 'kv-block-manager', bytes: mgr } })
    const boxes = dailyBoxes(inst)
    expect(ownBoxes(boxes).map((b) => b.slot)).toEqual(['scheduler', 'block-manager'])
    expect(boxHashes(boxes)).toEqual([SCHED_SHA, OTHER_SHA])
    expect(boxLines(boxes)).toEqual([
      `scheduler: yours (batching-scheduler, ${SCHED_SHA.slice(0, 8)})`,
      `block manager: yours (kv-block-manager, ${OTHER_SHA.slice(0, 8)})`,
      'intake queue: reference',
      'prefix router: reference',
    ])
    expect(dailySlotBytes(inst)).toEqual({ sched: SCHED, mgr, queue: null, router: null })
    const router = new Uint8Array([7]).buffer
    expect(dailySlotBytes(installed({ 'prefix-router': { sha256: OTHER_SHA, labId: 'radix-cache', bytes: router } })).router).toBe(router)
  })

  test('slots that are not part of the Daily (tokenizer, executor, grammar, allocator) are ignored', () => {
    const extra: InstalledBoxes = { tokenizer: { sha256: OTHER_SHA, labId: 'bpe-tokenizer', bytes: SCHED }, allocator: { sha256: OTHER_SHA, labId: 'rust-allocator', bytes: SCHED } }
    expect(ownBoxes(dailyBoxes(extra))).toEqual([])
    expect(dailySlotBytes(extra)).toEqual({ sched: null, mgr: null, queue: null, router: null })
    expect(installedBoxCount({ tokenizer: 1, executor: 1, scheduler: 1 })).toBe(1)
  })

  test('a module whose bytes are not on this device is not run, and the debrief says so', () => {
    const boxes = dailyBoxes({ scheduler: { sha256: SCHED_SHA, labId: 'batching-scheduler', bytes: null } })
    expect(ownBoxes(boxes)).toEqual([])
    expect(boxes[0]).toMatchObject({ own: false, missing: true })
    expect(boxLines(boxes)[0]).toBe("scheduler: reference (your installed module's bytes are not on this device)")
    expect(dailySlotBytes({ scheduler: { sha256: SCHED_SHA, labId: 'batching-scheduler', bytes: null } }).sched).toBeNull()
  })

  test('the reference engine is a choice: nothing is yours and no bytes are sent', () => {
    const inst = installed()
    expect(ownBoxes(dailyBoxes(inst, true))).toEqual([])
    expect(boxHashes(dailyBoxes(inst, true))).toEqual([])
    expect(dailySlotBytes(inst, true)).toEqual({ sched: null, mgr: null, queue: null, router: null })
  })

  test('the Today card counts installed boxes of the four', () => {
    expect(installedBoxCount({})).toBe(0)
    expect(installedBoxCount({ scheduler: 1, 'block-manager': 1 })).toBe(2)
    expect(engineLine(2)).toBe('your engine: 2 of 4 boxes')
    expect(engineLine(0)).toBe('your engine: 0 of 4 boxes')
  })
})

describe('what the debrief says about the engine', () => {
  test('a reference run says how to run on yours', () => {
    expect(engineNote(dailyBoxes({}))).toMatch(/^This Daily ran on the reference engine\. Install a scheduler, block manager, intake queue or prefix router/)
  })

  test('a run with boxes of yours names them and says the expert played the same boxes', () => {
    const one = engineNote(dailyBoxes(installed()))
    expect(one).toContain('Your scheduler ran this incident.')
    expect(one).toContain('The expert played it on the same boxes, so a slower module costs both of you the same.')
    expect(one).not.toContain('prefix router')
    const three = engineNote(
      dailyBoxes(installed({ 'block-manager': { sha256: OTHER_SHA, labId: 'kv-block-manager', bytes: SCHED }, intake: { sha256: OTHER_SHA, labId: 'mpmc-queue', bytes: SCHED } })),
    )
    expect(three).toContain('Your scheduler, block manager and intake queue ran this incident.')
  })

  test('a prefix router of yours is said to be loaded and checked, not to have routed (incident clusters route by shortest queue)', () => {
    const note = engineNote(dailyBoxes(installed({ 'prefix-router': { sha256: OTHER_SHA, labId: 'radix-cache', bytes: SCHED } })))
    expect(note).toContain('Your scheduler and prefix router ran this incident.')
    expect(note).toContain('loaded and checked on every worker')
    expect(note).toContain('route by shortest queue')
  })
})

describe('the share string', () => {
  test("adds 'on my engine' when a box of yours ran, and carries no hash or lab name", () => {
    expect(shareString(47, 3, 5.4)).toBe('KS-Daily #47 · 3 probes · burn 18%')
    expect(shareString(47, 3, 5.4, false)).toBe('KS-Daily #47 · 3 probes · burn 18%')
    expect(shareString(47, 3, 5.4, true)).toBe('KS-Daily #47 · 3 probes · burn 18% · on my engine')
    expect(shareString(1, 1, 0, true)).toBe('KS-Daily #1 · 1 probe · burn 0% · on my engine')
    expect(shareString(47, 3, 5.4, true)).not.toMatch(/[0-9a-f]{8}|wasm|batching/)
  })
})

/* ------------------------------------------------------------------ */
/* Your installed modules, as the page reads them                       */
/* ------------------------------------------------------------------ */

describe('the page reads what the slots store holds', () => {
  test('a module installed through the ledger is yours in the next Daily, bytes and all', async () => {
    const tab = startTab(makeProfile())
    const store = createSlotsStore(tab.progress)
    await tick(5)
    expect(store.getState().ready).toBe(true)
    expect(ownBoxes(dailyBoxes(store.getState().installed))).toEqual([])

    await tab.progress.getState().installComponent({ slot: 'scheduler', labId: 'batching-scheduler', version: 3, bytes: SCHED, name: 'sched.wasm' })
    await store.getState().refresh()
    const boxes = dailyBoxes(store.getState().installed)
    expect(boxes[0]).toMatchObject({ slot: 'scheduler', own: true, labId: 'batching-scheduler', sha256: SCHED_SHA })
    expect(boxHashes(boxes)).toEqual([SCHED_SHA])
    expect(new Uint8Array(dailySlotBytes(store.getState().installed).sched!)).toEqual(new Uint8Array(SCHED))

    // a session upload on the Fleet page (never persisted) is not an installed module: the Daily does not run it
    store.getState().setSlot('mgr', { bytes: SCHED, fileName: 'm.wasm', lab: 'kv-block-manager' })
    expect(dailyBoxes(store.getState().installed)[1]!.own).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The Daily, played on your engine                                     */
/* ------------------------------------------------------------------ */

describe('the Daily runs on your installed modules and the expert plays the same boxes', () => {
  const date = '2026-10-23' // the pinned e2e date: pool-shrink
  const spec = dailyIncident(date)
  const log = [
    { kind: 'hypothesis', fault: 'pool-shrink' },
    { kind: 'probe', probe: 'kv' },
    { kind: 'fix', fix: 'restore-pool' },
  ] as const

  async function play(slots: ReturnType<typeof dailySlotBytes>) {
    const session = await openIncidentSession({ mode: 'incident', spec, slots }, { spawn: () => new FakeWorker() })
    await session.hypothesis('pool-shrink')
    await session.probe('kv')
    await session.fix('restore-pool')
    const done = await session.finish()
    session.close()
    return done
  }

  test('the burn is what the reference scores with the reference drivers, and not with your scheduler; the expert follows the engine', async () => {
    const reference = await play(dailySlotBytes(installed(), true))
    expect(reference.burn).toBe(replayIncident(spec, [...log]).burn)
    const mine = await play(dailySlotBytes(installed()))
    expect(mine.burn).not.toBe(reference.burn)
    expect(mine.expertBurn).not.toBe(reference.expertBurn)
    // the same engine on both sides (W11): the expert is the expert of THIS engine
    expect(mine.expertBurn).toBeGreaterThanOrEqual(0)
  }, SLOW)

  test('the one event names the hashes of the modules that ran; a replay writes nothing more', async () => {
    const done = await play(dailySlotBytes(installed()))
    const boxes = dailyBoxes(installed())
    const tab = startTab(makeProfile())
    const written: IncidentResult[] = []
    const store = {
      getState() {
        const s = tab.progress.getState()
        return {
          aggregate: s.aggregate,
          recordIncident(r: IncidentResult) {
            written.push(r)
            s.recordIncident(r)
          },
        }
      },
    }
    expect(recordDaily(store, date, spec, done, boxHashes(boxes))).toBe(true)
    expect(written).toHaveLength(1)
    expect(written[0]!.ref).toBe(dailyRef(date))
    expect(written[0]!.data.components).toEqual([SCHED_SHA])
    expect(written[0]!.data.src).toBe('daily')
    // a replay as practice (on any engine) is not recorded
    expect(dailyPlayed(tab.progress, date)).toBe(true)
    expect(recordDaily(store, date, spec, done, [])).toBe(false)
    expect(written).toHaveLength(1)
    expect(tab.progress.getState().aggregate.incidents[dailyRef(date)]?.n).toBe(1)
    expect(shareString(dailyNumber(date), done.probes.length, done.burn, ownBoxes(boxes).length > 0)).toMatch(/^KS-Daily #11 · 1 probe · burn \d+% · on my engine$/)
  }, SLOW)

  test('a first attempt on the reference engine records no components', async () => {
    const done = await play(dailySlotBytes(installed(), true))
    const tab = startTab(makeProfile())
    const written: IncidentResult[] = []
    const store = {
      getState: () => ({
        aggregate: tab.progress.getState().aggregate,
        recordIncident: (r: IncidentResult) => {
          written.push(r)
          tab.progress.getState().recordIncident(r)
        },
      }),
    }
    expect(recordDaily(store, date, spec, done, boxHashes(dailyBoxes(installed(), true)))).toBe(true)
    expect(written[0]!.data.components).toEqual([])
  }, SLOW)
})

/* ------------------------------------------------------------------ */
/* The pages wire it                                                    */
/* ------------------------------------------------------------------ */

describe('/daily wires your engine', () => {
  const page = read('src/pages/Daily.tsx')

  test('the incident opens on the installed modules once they are read, and the boxes are fixed at open', () => {
    expect(page).toContain('if (!ready) return')
    expect(page).toContain('dailySlotBytes(mine, reference)')
    expect(page).toContain('useSlots.getState().installed')
    expect(page).not.toContain('NO_SLOTS')
  })

  test('the record, the share string and the debrief all use the boxes of this attempt', () => {
    expect(page).toContain('boxHashes(boxes)')
    expect(page).toContain('shareString(number, result.probes.length, result.burn, onMyEngine)')
    expect(page).toContain('boxes={boxes}')
  })

  test('a failing module has a way out: the same Daily on the reference engine, and a replay on either', () => {
    expect(page).toContain('Play on the reference engine')
    expect(page).toContain('Replay on the reference engine')
    expect(page).toContain('Replay on your engine')
  })

  test('the Today card says "your engine: N of 4 boxes" from the working record, not the engine store', () => {
    const card = read('src/components/daily/DailyCard.tsx')
    expect(card).toContain("readSlots(s.working['engine:slots'])")
    expect(card).toContain('engineLine(boxes)')
    expect(card).not.toMatch(/pages\/fleet\/slots/)
  })

  test('Act IV drills still play on reference components and the debrief says nothing of an engine', () => {
    const week = read('src/pages/FleetWeek.tsx')
    expect(week).toContain('const NO_SLOTS')
    expect(week).not.toMatch(/<Debrief[^>]*boxes=/)
  })
})
