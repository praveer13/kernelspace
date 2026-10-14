/**
 * The Fleet's upload flow (docs/specs/wave-2.md §10.2, task 2b-12): a drop is admitted, graded on fresh seeds, then
 * installed through the slots store; the page says "checking on fresh seeds…" while it works and one plain message when
 * it refuses; "use reference" uninstalls one slot; and "reset with reference drivers" (offered after a module stops
 * responding) runs the panels on the reference for this visit without touching what is saved (F7).
 *
 * The flow is driven through its store (`createUploadStore`) with the admission check, the fresh-seed run and the install
 * as dependencies, and after every step the page's slot bar is rendered and read, so each assertion is on what the
 * learner would see. The install is the real one, on the memory ledger of tests/ledger.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToReadableStream, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { FORGE_LABS } from '../../src/data/labs'
import { ENGINE_SLOTS, slotForLab } from '../../src/lib/engine/catalog'
import { readSlots } from '../../src/lib/engine/slots'
import { REFUSALS } from '../../src/lib/engine/store'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { sha256Hex } from '../../src/lib/ledger/stable'
import Fleet from '../../src/pages/Fleet'
import SlotBar from '../../src/pages/fleet/SlotBar'
import { createSlotsStore, EMPTY_SLOTS, SLOT_LABEL, type LabKind, type SlotsStore } from '../../src/pages/fleet/slots'
import { createUploadStore, panelSlots, parkedCount, realUploadDeps, type DroppedFile, type UploadDeps, type UploadStore } from '../../src/pages/fleet/upload'
import { makeProfile, startTab, tick } from '../ledger/env'

/* ----------------------------------- fixtures ----------------------------------- */

const wasm = (...n: number[]) => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...n]).buffer as ArrayBuffer
const file = (name: string, bytes: ArrayBuffer): DroppedFile => ({ name, arrayBuffer: async () => bytes })

const row = (id: string, status: CheckResult['status'] = 'pass', seeded = false): CheckResult => ({ id, label: id, status, msg: '', ...(seeded ? { seed: 7, fresh: true } : {}) })

/** A graded run of the lab: every required check green on fresh seeds, unless `over` says otherwise. */
function reportFor(labId: string, over: Partial<LabRunReport> = {}): LabRunReport {
  const meta = FORGE_LABS.find((l) => l.id === labId)!
  const slot = slotForLab(labId)
  return {
    lab: labId,
    reference: false,
    abi: 2,
    version: slot ? ENGINE_SLOTS[slot].minVersion : 2,
    checks: meta.checks.map((c, i) => (c.optional ? row(c.id, 'fail') : row(c.id, 'pass', i % 2 === 0))),
    seeds: 'fresh',
    ms: 10,
    ...over,
  }
}

const gate = () => {
  let open!: () => void
  const opened = new Promise<void>((r) => (open = r))
  return { opened, open }
}

interface Rig {
  profile: ReturnType<typeof makeProfile>
  tab: ReturnType<typeof startTab>
  slots: SlotsStore
  upload: UploadStore
  calls: { validate: [ArrayBuffer, string][]; run: ArrayBuffer[] }
  /** the slot bar the page would draw now */
  bar(): string
}

/**
 * A page's worth of state: a slots store on a memory ledger tab, and an upload store whose install is that store's.
 * `deps` overrides the admission check and the run; both default to a pass.
 */
function rig(profile = makeProfile(), deps: Partial<Pick<UploadDeps, 'validate' | 'run'>> = {}): Rig {
  const tab = startTab(profile)
  const slots = createSlotsStore(tab.progress)
  const calls: Rig['calls'] = { validate: [], run: [] }
  const upload = createUploadStore({
    validate:
      deps.validate ??
      (async (bytes, lab) => {
        calls.validate.push([bytes, lab])
        return { ok: true }
      }),
    run:
      deps.run ??
      (async (bytes) => {
        calls.run.push(bytes)
        return reportFor(calls.validate.at(-1)![1])
      }),
    install: (m) => slots.getState().install(m),
  })
  const bar = () => {
    const u = upload.getState()
    const s = slots.getState()
    const shown = panelSlots(s.slots, u.off)
    return renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(SlotBar, {
          slots: shown,
          checking: u.checking,
          error: u.error,
          parked: parkedCount(s.slots, s.installed, u.off),
          onPick: () => {},
          onUseReference: () => {},
          onUseMine: () => {},
        }),
      ),
    )
  }
  return { profile, tab, slots, upload, calls, bar }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
const status = (html: string) => decode(/<div role="status"[^>]*>([\s\S]*?)<\/div>/.exec(html)![1]!)
/** The slot button's opening tag, to read its disabled state. */
const buttonOf = (html: string, kind: LabKind) => new RegExp(`<button[^>]*data-slot-button="${kind}"[^>]*>`).exec(html)![0]

async function settle(r: Rig) {
  await tick(5)
  await r.slots.getState().refresh()
  await tick(5)
}

/* ---------------------------------- at rest ---------------------------------- */

describe('the slot bar at rest', () => {
  test('three upload buttons say "reference", none offers "use reference", and the status line is empty', () => {
    const r = rig()
    const html = r.bar()
    for (const kind of ['sched', 'mgr', 'queue'] as const) {
      expect(text(html)).toContain(`${SLOT_LABEL[kind]}: reference`)
      expect(buttonOf(html, kind)).not.toContain('disabled')
    }
    expect(html).not.toContain('use reference')
    expect(html).not.toContain('data-parked')
    expect(status(html)).toBe('')
  })
})

/* ---------------------------------- a drop that installs ---------------------------------- */

describe('a drop is admitted, graded on fresh seeds and installed', () => {
  test('the page says it is checking, makes the other drops wait, then shows the module as yours', async () => {
    const hold = gate()
    const r = rig(makeProfile(), {
      validate: async (bytes, lab) => {
        r.calls.validate.push([bytes, lab])
        await hold.opened
        return { ok: true }
      },
      run: async (bytes) => {
        r.calls.run.push(bytes)
        return reportFor('kv-block-manager')
      },
    })
    const bytes = wasm(1)
    const dropped = r.upload.getState().pick('mgr', file('mgr.wasm', bytes))
    await tick(2)

    // while it is checking: the button says so, every button is disabled, and a second drop is ignored
    let html = r.bar()
    expect(text(html)).toContain(`${SLOT_LABEL.mgr}: checking on fresh seeds…`)
    for (const kind of ['sched', 'mgr', 'queue'] as const) expect(buttonOf(html, kind)).toContain('disabled')
    await r.upload.getState().pick('queue', file('q.wasm', wasm(2)))
    expect(r.calls.validate).toHaveLength(1)

    hold.open()
    await dropped
    await settle(r)
    html = r.bar()
    expect(r.upload.getState().checking).toBeNull()
    expect(text(html)).not.toContain('checking')
    expect(text(html)).toContain(`${SLOT_LABEL.mgr}: yours ✓`)
    expect(text(html)).toContain(`${SLOT_LABEL.sched}: reference`)
    expect(html).toContain(`aria-label="Use the reference ${SLOT_LABEL.mgr} instead of yours"`)
    expect(status(html)).toBe('')

    // the admission check named the slot's lab, the run got the dropped bytes, and the module is stored under its own hash
    expect(r.calls.validate[0]![1]).toBe('kv-block-manager')
    expect(new Uint8Array(r.calls.run[0]!)).toEqual(new Uint8Array(bytes))
    const sha = await sha256Hex(new Uint8Array(bytes))
    expect(readSlots(r.tab.progress.getState().working['engine:slots'])['block-manager']).toMatchObject({ sha256: sha, labId: 'kv-block-manager' })
    expect(new Uint8Array((await (await r.tab.progress.controls.engine()).componentBytes(sha))!)).toEqual(new Uint8Array(bytes))
    expect(r.slots.getState().slots.mgr?.fileName).toBe('mgr.wasm')
  })

  test('the run that earns the install is on fresh seeds, and an install that comes back from the gate with default seeds is refused', async () => {
    // the app's dependencies grade with seeds: 'fresh'
    const asked: unknown[] = []
    const deps = realUploadDeps(async () => ({ ok: true, sha256: 'x' }), (async (_bytes: ArrayBuffer, opts?: unknown) => (asked.push(opts), reportFor('mpmc-queue'))) as never)
    await deps.run(wasm(3))
    expect(asked).toEqual([{ seeds: 'fresh' }])

    // and the gate checks the report it is handed: a green run on the crate's own seeds installs nothing
    const r = rig(makeProfile(), { run: async () => reportFor('mpmc-queue', { seeds: 'default' }) })
    await r.upload.getState().pick('queue', file('q.wasm', wasm(3)))
    await settle(r)
    expect(status(r.bar())).toBe(`${SLOT_LABEL.queue}: ${REFUSALS['not-fresh-green']}`)
    expect(r.tab.progress.getState().working['engine:slots']).toBeUndefined()
  })
})

/* ---------------------------------- a drop that is refused ---------------------------------- */

describe('a refused drop leaves one plain message and installs nothing', () => {
  async function refused(r: Rig, kind: LabKind = 'sched') {
    await r.upload.getState().pick(kind, file('x.wasm', wasm(5)))
    await settle(r)
    return r.bar()
  }

  test('a module for another lab is told so, and is never graded', async () => {
    let graded = 0
    const r = rig(makeProfile(), {
      validate: async () => ({ ok: false, title: 'wrong lab module', detail: 'this slot wants batching-scheduler, got "mpmc-queue".' }),
      run: async () => (graded++, reportFor('batching-scheduler')),
    })
    const html = await refused(r)
    expect(status(html)).toBe(`${SLOT_LABEL.sched}: wrong lab module — this slot wants batching-scheduler, got "mpmc-queue".`)
    expect(graded).toBe(0)
    expect(r.upload.getState().checking).toBeNull()
    expect(text(html)).toContain(`${SLOT_LABEL.sched}: reference`)
    expect(r.tab.progress.getState().working['engine:slots']).toBeUndefined()
  })

  test('a run that throws shows its message and frees the buttons', async () => {
    const r = rig(makeProfile(), {
      run: async () => {
        throw new Error('the lab worker did not answer within 2 s')
      },
    })
    const html = await refused(r)
    expect(status(html)).toBe(`${SLOT_LABEL.sched}: the lab worker did not answer within 2 s`)
    for (const kind of ['sched', 'mgr', 'queue'] as const) expect(buttonOf(html, kind)).not.toContain('disabled')
    expect(r.upload.getState().checking).toBeNull()
  })

  test('a reference build, an ABI 1 module and a stale lab version are refused with the §10.2 words', async () => {
    const reference = rig(makeProfile(), { run: async () => reportFor('batching-scheduler', { reference: true }) })
    expect(status(await refused(reference))).toBe(`${SLOT_LABEL.sched}: ${REFUSALS.reference}`)

    const abi1 = rig(makeProfile(), { run: async () => reportFor('batching-scheduler', { abi: 1 }) })
    expect(status(await refused(abi1))).toBe(`${SLOT_LABEL.sched}: ${REFUSALS['abi-1']}`)

    const stale = rig(makeProfile(), { run: async () => reportFor('batching-scheduler', { version: 2 }) })
    const html = await refused(stale)
    expect(status(html)).toContain(`${SLOT_LABEL.sched}: ${REFUSALS['stale-version']} — `)
    expect(status(html)).toContain('must be at lab version')
    for (const r of [reference, abi1, stale]) expect(r.tab.progress.getState().working['engine:slots']).toBeUndefined()
  })

  test('a required check still red installs nothing, and the next good drop clears the message', async () => {
    let red = true
    const r = rig(makeProfile(), {
      run: async () => {
        const report = reportFor('mpmc-queue')
        return red ? { ...report, checks: report.checks.map((c, i) => (i === 0 ? { ...c, status: 'fail' as const } : c)) } : report
      },
    })
    expect(status(await refused(r, 'queue'))).toContain(REFUSALS['not-fresh-green'])
    red = false
    await r.upload.getState().pick('queue', file('q.wasm', wasm(6)))
    await settle(r)
    const html = r.bar()
    expect(status(html)).toBe('')
    expect(text(html)).toContain(`${SLOT_LABEL.queue}: yours ✓`)
  })
})

/* ---------------------------------- use reference, and the reset ---------------------------------- */

describe('"use reference" and "reset with reference drivers"', () => {
  /** A device with a scheduler and a prefix router installed, as after two earlier sessions. */
  async function withModules() {
    const r = rig()
    await r.upload.getState().pick('sched', file('sched.wasm', wasm(7)))
    await settle(r)
    const router = wasm(8)
    const routerOut = await r.slots.getState().install({ slot: 'prefix-router', report: reportFor('radix-cache'), bytes: router, name: 'router.wasm' })
    expect(routerOut.ok).toBe(true)
    await settle(r)
    return { r, router, schedSha: await sha256Hex(new Uint8Array(wasm(7))), routerSha: await sha256Hex(new Uint8Array(router)) }
  }

  test('the per-slot button uninstalls that slot: engine:slots loses it and the bytes stay in the store', async () => {
    const { r, schedSha } = await withModules()
    expect(r.bar()).toContain('use reference')
    r.slots.getState().setSlot('sched', null) // what the button does
    await settle(r)
    const saved = readSlots(r.tab.progress.getState().working['engine:slots'])
    expect(saved.scheduler).toBeUndefined()
    expect(saved['prefix-router']).toBeDefined()
    expect(text(r.bar())).toContain(`${SLOT_LABEL.sched}: reference`)
    expect(await (await r.tab.progress.controls.engine()).componentBytes(schedSha)).not.toBeNull()
  })

  test('a reset runs the panels on the reference and leaves engine:slots and the stored bytes exactly as they were (F7)', async () => {
    const { r, routerSha, schedSha } = await withModules()
    const before = structuredClone(r.tab.progress.getState().working['engine:slots'])
    expect(Object.keys(readSlots(before))).toEqual(['scheduler', 'prefix-router'])
    expect(r.slots.getState().slots.sched).not.toBeNull()

    r.upload.getState().resetToReference()
    await settle(r)

    // the panels run the reference drivers ...
    const { off } = r.upload.getState()
    const running = panelSlots(r.slots.getState().slots, off)
    expect(running).toEqual(EMPTY_SLOTS)
    expect(off.router).toBe(true)
    // ... and the saved record and the bytes are untouched
    expect(r.tab.progress.getState().working['engine:slots']).toEqual(before)
    const engine = await r.tab.progress.controls.engine()
    expect(await engine.componentBytes(schedSha)).not.toBeNull()
    expect(await engine.componentBytes(routerSha)).not.toBeNull()
    expect(r.slots.getState().installed.scheduler?.sha256).toBe(schedSha)
    expect(r.slots.getState().installed['prefix-router']?.sha256).toBe(routerSha)

    // the page says what happened and offers the way back, and the button no longer claims the module runs
    const html = r.bar()
    expect(text(html)).toContain(`${SLOT_LABEL.sched}: reference`)
    expect(html).toContain('data-parked')
    expect(text(html)).toContain('Your saved modules are still installed and run again next time you open the Fleet.')
    expect(html).not.toContain('use reference')
    expect(text(html)).toContain('use my saved modules')
  })

  test('the saved modules run again on the next visit, and at once through "use my saved modules"', async () => {
    const { r, schedSha } = await withModules()
    await r.tab.progress.controls.flush()
    r.upload.getState().resetToReference()

    r.upload.getState().restoreMine()
    expect(panelSlots(r.slots.getState().slots, r.upload.getState().off).sched?.fileName).toBe('sched.wasm')
    expect(r.bar()).not.toContain('data-parked')

    // a reload: a new slots store and a new upload store on the same profile start from the saved record
    const reloaded = rig(r.profile)
    await settle(reloaded)
    expect(reloaded.upload.getState().off).toEqual({ sched: false, mgr: false, queue: false, router: false })
    const sched = panelSlots(reloaded.slots.getState().slots, reloaded.upload.getState().off).sched
    expect(sched).not.toBeNull()
    expect(await sha256Hex(new Uint8Array(sched!.bytes))).toBe(schedSha)
    expect(text(reloaded.bar())).toContain(`${SLOT_LABEL.sched}: yours ✓`)
  })

  test('a module dropped after a reset runs at once; the other saved modules stay parked', async () => {
    const { r } = await withModules()
    await r.upload.getState().pick('mgr', file('mgr.wasm', wasm(9)))
    await settle(r)
    r.upload.getState().resetToReference()
    await r.upload.getState().pick('mgr', file('mgr2.wasm', wasm(10)))
    await settle(r)
    const running = panelSlots(r.slots.getState().slots, r.upload.getState().off)
    expect(running.mgr?.fileName).toBe('mgr2.wasm')
    expect(running.sched).toBeNull()
    expect(r.upload.getState().off).toEqual({ sched: true, mgr: false, queue: true, router: true })
    expect(text(r.bar())).toContain(`${SLOT_LABEL.mgr}: yours ✓`)
    expect(text(r.bar())).toContain('use my saved module')
  })
})

/* ---------------------------------- the page ---------------------------------- */

describe('the page mounts the slot bar', () => {
  test('/fleet renders the three upload buttons on the reference, with no reset note and an empty status line', async () => {
    const stream = await renderToReadableStream(createElement(MemoryRouter, null, createElement(Fleet)))
    await stream.allReady
    const out = await new Response(stream).text()
    for (const kind of ['sched', 'mgr', 'queue'] as const) {
      expect(out).toContain(`data-slot-button="${kind}"`)
      expect(text(out)).toContain(`${SLOT_LABEL[kind]}: reference`)
    }
    expect(out).not.toContain('data-parked')
    expect(out).toContain('text-danger empty:mt-0"></div>') // the slot bar's status line, empty
  })
})
