/**
 * Your engine's components store and persistent Fleet slots (wave-2.md §10.1-10.2, task 2b-04): the catalog,
 * the install gate (fake run reports, no wasm), and the slots store on the memory-store profile of tests/ledger,
 * where a reload is a second tab on the same profile.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FORGE_LABS } from '../../src/data/labs'
import { ENGINE_SLOT_ORDER, ENGINE_SLOTS, slotForLab } from '../../src/lib/engine/catalog'
import { loadInstalled, readSlots, sameSlots } from '../../src/lib/engine/slots'
import { checkInstall, installModule, REFUSALS, requiredChecksOf } from '../../src/lib/engine/store'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { ENGINE_SLOTS as LEDGER_SLOTS } from '../../src/lib/ledger/constants'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { EngineSlots } from '../../src/lib/ledger/types'
import { createSlotsStore } from '../../src/pages/fleet/slots'
import { makeProfile, startTab, tick } from '../ledger/env'

/* ------------------------------ fake reports ------------------------------ */

const row = (id: string, status: CheckResult['status'] = 'pass', seeded = false): CheckResult => ({
  id,
  label: id,
  status,
  msg: '',
  ...(seeded ? { seed: 7, fresh: true } : {}),
})

/** A green run of `lab`'s required checks (plus its advanced ones, failing: they never gate). */
function reportFor(lab: string, over: Partial<LabRunReport> = {}): LabRunReport {
  const meta = FORGE_LABS.find((l) => l.id === lab)!
  return {
    lab,
    reference: false,
    abi: 2,
    version: ENGINE_SLOTS[slotForLab(lab)!].minVersion,
    checks: meta.checks.map((c, i) => (c.optional ? row(c.id, 'fail') : row(c.id, 'pass', i % 2 === 0))),
    seeds: 'fresh',
    ms: 10,
    ...over,
  }
}

const withCheck = (r: LabRunReport, id: string, patch: Partial<CheckResult>): LabRunReport => ({
  ...r,
  checks: r.checks.map((c) => (c.id === id ? { ...c, ...patch } : c)),
})

/* -------------------------------- catalog --------------------------------- */

describe('ENGINE_SLOTS catalog (§10.1)', () => {
  test('one entry per ledger slot, in pipeline order, each naming a Forge lab with the right number', () => {
    expect([...ENGINE_SLOT_ORDER].sort()).toEqual([...LEDGER_SLOTS].sort())
    expect(Object.keys(ENGINE_SLOTS).sort()).toEqual([...LEDGER_SLOTS].sort())
    expect(ENGINE_SLOT_ORDER.slice(0, 5)).toEqual(['tokenizer', 'prefix-router', 'intake', 'scheduler', 'block-manager'])
    const labs = new Set<string>()
    for (const slot of ENGINE_SLOT_ORDER) {
      const spec = ENGINE_SLOTS[slot]
      expect(spec.slot).toBe(slot)
      const lab = FORGE_LABS.find((l) => l.id === spec.lab)
      expect(lab, spec.lab).toBeDefined()
      expect(lab!.index).toBe(spec.labNo)
      expect(requiredChecksOf(spec.lab).length).toBeGreaterThan(0)
      expect(slotForLab(spec.lab)).toBe(slot)
      labs.add(spec.lab)
    }
    expect(labs.size).toBe(8)
    expect(slotForLab('rust-zero-r1')).toBeUndefined()
  })

  test('only the two labs that gain verbs require version 3; the rest require what their crate has, never more', () => {
    expect(ENGINE_SLOTS.tokenizer).toMatchObject({ lab: 'bpe-tokenizer', labNo: 3, minVersion: 3 })
    expect(ENGINE_SLOTS['prefix-router']).toMatchObject({ lab: 'radix-cache', labNo: 7, minVersion: 3 })
    for (const slot of ENGINE_SLOT_ORDER) {
      const src = readFileSync(`labs/${ENGINE_SLOTS[slot].lab}/src/lib.rs`, 'utf8')
      const crate = Number(/pub static LAB: Lab = Lab \{ id: LAB_ID, version: (\d+)/.exec(src)?.[1])
      expect(ENGINE_SLOTS[slot].minVersion, slot).toBeLessThanOrEqual(crate)
    }
  })

  test('wiring: the Wave 2 wiring of §10.1', () => {
    const wiring = Object.fromEntries(ENGINE_SLOT_ORDER.map((s) => [s, ENGINE_SLOTS[s].wiring]))
    expect(wiring).toEqual({
      tokenizer: 'token-count',
      'prefix-router': 'prefix-router',
      intake: 'intake',
      scheduler: 'scheduler',
      'block-manager': 'block-manager',
      executor: 'schematic',
      grammar: 'schematic',
      allocator: 'schematic',
    })
  })
})

/* ------------------------------- the install gate ------------------------------- */

describe('checkInstall (§10.2)', () => {
  test('every slot accepts a fresh-seed run with all its required checks green, advanced checks aside', () => {
    for (const slot of ENGINE_SLOT_ORDER) expect(checkInstall(slot, reportFor(ENGINE_SLOTS[slot].lab)), slot).toEqual({ ok: true })
  })

  test('the messages are the spec’s, word for word', () => {
    expect(REFUSALS['abi-1']).toBe('built from the v1 template: rebuild from the new zip')
    expect(REFUSALS['stale-version']).toBe('this module predates the router verbs: download the zip again and rebuild')
    expect(REFUSALS.reference).toBe('reference modules earn no credit and cannot be installed')
    expect(REFUSALS['not-fresh-green']).toBe('pass every check on fresh seeds first')
  })

  test('ABI 1 is refused', () => {
    const v = checkInstall('block-manager', reportFor('kv-block-manager', { abi: 1 }))
    expect(v).toMatchObject({ ok: false, code: 'abi-1', message: REFUSALS['abi-1'] })
  })

  test('a lab version below the catalog minimum is refused, naming both versions; the minimum itself is not', () => {
    const stale = checkInstall('prefix-router', reportFor('radix-cache', { version: 2 }))
    expect(stale).toMatchObject({ ok: false, code: 'stale-version', message: REFUSALS['stale-version'] })
    expect((stale as { detail?: string }).detail).toContain('version 3')
    expect((stale as { detail?: string }).detail).toContain('version 2')
    expect(checkInstall('tokenizer', reportFor('bpe-tokenizer', { version: 2 }))).toMatchObject({ ok: false, code: 'stale-version' })
    expect(checkInstall('tokenizer', reportFor('bpe-tokenizer', { version: 3 })).ok).toBe(true)
    expect(checkInstall('tokenizer', reportFor('bpe-tokenizer', { version: 4 })).ok).toBe(true)
    expect(checkInstall('scheduler', reportFor('batching-scheduler', { version: 2 }))).toMatchObject({ code: 'stale-version' })
  })

  test('a @reference build is refused first, whatever else is wrong with it', () => {
    for (const over of [{}, { abi: 1 as const }, { version: 1 }, { seeds: 'default' as const }]) {
      expect(checkInstall('allocator', reportFor('rust-allocator', { reference: true, ...over }))).toMatchObject({ ok: false, code: 'reference', message: REFUSALS.reference })
    }
  })

  test('a run that is not on fresh seeds, or has a required check red, is refused', () => {
    const base = reportFor('kv-block-manager')
    const refused = { ok: false, code: 'not-fresh-green', message: REFUSALS['not-fresh-green'] }
    expect(checkInstall('block-manager', { ...base, seeds: 'default' })).toMatchObject(refused)
    for (const status of ['fail', 'trap', 'timeout'] as const) expect(checkInstall('block-manager', withCheck(base, 'cow', { status }))).toMatchObject(refused)
    // a required check missing from the report is not a pass
    expect(checkInstall('block-manager', { ...base, checks: base.checks.filter((c) => c.id !== 'gauntlet') })).toMatchObject(refused)
    // a seeded check that ran on a seed the learner could know does not count as unseen
    expect(checkInstall('block-manager', withCheck(base, 'paging', { seed: 5, fresh: false }))).toMatchObject(refused)
  })

  test('an earlier run does not stand in: the run in hand must pass everything', () => {
    // creditFor would say `unseen` for `required` checks passed earlier; the install gate takes no history
    const r = withCheck(reportFor('mpmc-queue'), requiredChecksOf('mpmc-queue')[0], { status: 'fail' })
    expect(checkInstall('intake', r)).toMatchObject({ ok: false, code: 'not-fresh-green' })
  })

  test('a module for another slot’s lab is refused with the lab it wants', () => {
    const v = checkInstall('scheduler', reportFor('kv-block-manager'))
    expect(v).toMatchObject({ ok: false, code: 'wrong-lab' })
    expect((v as { message: string }).message).toContain('batching-scheduler')
    expect((v as { message: string }).message).toContain('kv-block-manager')
  })

  test('required ids can be passed in, e.g. a lab whose check list the report names itself', () => {
    const r = reportFor('rust-allocator')
    expect(checkInstall('allocator', r, ['align']).ok).toBe(true)
    expect(checkInstall('allocator', r, ['align', 'not-a-check'])).toMatchObject({ code: 'not-fresh-green' })
    expect(checkInstall('allocator', r, [])).toMatchObject({ code: 'not-fresh-green' })
  })
})

describe('installModule', () => {
  test('a refusal never reaches the ledger; an accepted run installs the bytes under the report’s lab and version', async () => {
    const calls: unknown[] = []
    const ledger = {
      installComponent: async (c: unknown) => {
        calls.push(c)
        return { sha256: 'ab'.repeat(32) }
      },
    }
    const bytes = new Uint8Array([0, 97, 115, 109])
    const refused = await installModule(ledger, { slot: 'tokenizer', report: reportFor('bpe-tokenizer', { version: 2 }), bytes })
    expect(refused).toMatchObject({ ok: false, code: 'stale-version' })
    expect(calls).toEqual([])
    const done = await installModule(ledger, { slot: 'tokenizer', report: reportFor('bpe-tokenizer', { version: 3 }), bytes, name: 'bpe.wasm' })
    expect(done).toEqual({ ok: true, sha256: 'ab'.repeat(32) })
    expect(calls).toEqual([{ slot: 'tokenizer', labId: 'bpe-tokenizer', version: 3, abi: 2, bytes, name: 'bpe.wasm' }])
  })
})

/* ------------------------------- reading the record ------------------------------- */

describe('readSlots and loadInstalled', () => {
  const entry = (n: string, over: Record<string, unknown> = {}) => ({ sha256: n.repeat(64), labId: 'kv-block-manager', version: 3, at: '2026-10-05T09:00:00.000Z', ...over })

  test('readSlots keeps well-formed entries and drops anything the codec would reject', () => {
    const value = {
      scheduler: entry('a'),
      'block-manager': entry('b', { version: 0 }),
      intake: entry('c', { sha256: 'xyz' }),
      allocator: entry('d', { labId: '' }),
      nowhere: entry('e'),
      grammar: 'oops',
    }
    expect(Object.keys(readSlots(value as never))).toEqual(['scheduler'])
    for (const v of [undefined, null, [], 'x', 7]) expect(readSlots(v as never)).toEqual({})
  })

  test('sameSlots compares hash, lab, version and instant per slot', () => {
    const a = readSlots({ scheduler: entry('a') })
    expect(sameSlots(a, readSlots({ scheduler: entry('a') }))).toBe(true)
    expect(sameSlots(a, readSlots({ scheduler: entry('b') }))).toBe(false)
    expect(sameSlots(a, readSlots({ scheduler: entry('a', { at: '2026-10-06T09:00:00.000Z' }) }))).toBe(false)
    expect(sameSlots(a, {})).toBe(false)
    expect(sameSlots({}, {})).toBe(true)
  })

  test('with nothing installed no source is called; missing bytes read as null; the cache serves repeats', async () => {
    let reads = 0
    const src = {
      readBytes: async (sha: string) => {
        reads++
        return sha.startsWith('a') ? new Uint8Array([1]).buffer : null
      },
      readMeta: async () => [{ sha256: 'a'.repeat(64), labId: 'x', name: 'mine.wasm', size: 1, addedAt: 't' }],
    }
    expect(await loadInstalled({}, src)).toEqual({})
    expect(reads).toBe(0)
    const cache = new Map<string, ArrayBuffer>()
    const slots = readSlots({ scheduler: entry('a'), intake: entry('b') })
    const got = await loadInstalled(slots, { ...src, cache })
    expect(got.scheduler).toMatchObject({ slot: 'scheduler', name: 'mine.wasm' })
    expect(new Uint8Array(got.scheduler!.bytes!)).toEqual(new Uint8Array([1]))
    expect(got.intake).toMatchObject({ slot: 'intake', bytes: null })
    expect(got.intake!.name).toBeUndefined()
    const before = reads
    await loadInstalled(slots, { ...src, cache })
    expect(reads).toBe(before + 1) // only the hash with no bytes is asked for again
  })
})

/* ------------------------------ persistent slots ------------------------------ */

const wasm = (...n: number[]) => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...n])
const settle = async (store: ReturnType<typeof createSlotsStore>) => {
  await store.getState().refresh()
  await tick(5)
}

describe('useSlots on the memory store', () => {
  test('a fresh profile has empty slots and never boots the engine', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    await tick(5)
    expect(store.getState()).toMatchObject({ ready: true, installed: {}, slots: { sched: null, mgr: null, queue: null } })
    expect(tab.loads()).toBe(0)
  })

  test('install stores the bytes by hash through installComponent and writes engine:slots', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    const bytes = wasm(1)
    const out = await store.getState().install({ slot: 'block-manager', report: reportFor('kv-block-manager'), bytes, name: 'mgr.wasm' })
    const sha256 = await sha256Hex(bytes)
    expect(out).toEqual({ ok: true, sha256 })

    const slots = tab.progress.getState().working['engine:slots'] as unknown as EngineSlots
    expect(slots['block-manager']).toEqual({ sha256, labId: 'kv-block-manager', version: 3, at: p.clock.nowIso() })
    const client = await tab.engine()
    expect(await client.components()).toEqual([{ sha256, labId: 'kv-block-manager', name: 'mgr.wasm', size: bytes.length, addedAt: p.clock.nowIso(), abi: 2 }])
    expect(new Uint8Array((await client.componentBytes(sha256))!)).toEqual(bytes)

    const s = store.getState()
    expect(s.installed['block-manager']).toMatchObject({ sha256, name: 'mgr.wasm', labId: 'kv-block-manager' })
    expect(s.slots.mgr).toMatchObject({ fileName: 'mgr.wasm', lab: 'kv-block-manager' })
    expect(new Uint8Array(s.slots.mgr!.bytes)).toEqual(bytes)
    expect(s.slots.sched).toBeNull()
  })

  test('modules survive a reload: a new tab on the same profile reads the slots and the bytes back', async () => {
    const p = makeProfile()
    const first = startTab(p)
    const store = createSlotsStore(first.progress)
    const sched = wasm(2)
    const radix = wasm(3)
    await store.getState().install({ slot: 'scheduler', report: reportFor('batching-scheduler'), bytes: sched, name: 'sched.wasm' })
    p.clock.advance(1) // the working record resolves ties by instant: the frozen test clock needs a tick between writes
    await store.getState().install({ slot: 'prefix-router', report: reportFor('radix-cache'), bytes: radix })
    await first.progress.controls.flush()

    // reload: a new façade hydrates `engine:slots` from the snapshot, and the bytes come from the components store
    const second = startTab(p)
    const again = createSlotsStore(second.progress)
    expect(again.getState().slots.sched).toBeNull() // bytes not read yet
    await settle(again)
    const s = again.getState()
    expect(s.ready).toBe(true)
    expect(Object.keys(s.installed).sort()).toEqual(['prefix-router', 'scheduler'])
    expect(new Uint8Array(s.slots.sched!.bytes)).toEqual(sched)
    expect(s.slots.sched).toMatchObject({ fileName: 'sched.wasm', lab: 'batching-scheduler' })
    expect(new Uint8Array(s.installed['prefix-router']!.bytes!)).toEqual(radix)
    expect(s.installed['prefix-router']!.name).toBeUndefined()
    expect(s.slots.queue).toBeNull()
  })

  test('a reload with no snapshot reads the slots from the engine once it boots', async () => {
    const p = makeProfile()
    const first = startTab(p)
    await createSlotsStore(first.progress).getState().install({ slot: 'intake', report: reportFor('mpmc-queue'), bytes: wasm(4) })
    await first.progress.controls.flush()
    p.storage.data.clear() // snapshot gone; the device id is not needed by the memory store
    const second = startTab(p)
    const again = createSlotsStore(second.progress)
    expect(again.getState().installed).toEqual({})
    await second.progress.controls.engine() // the façade's own boot, which the app schedules at idle
    await tick(5)
    expect(new Uint8Array(again.getState().slots.queue!.bytes)).toEqual(wasm(4))
  })

  test('a refused install writes nothing: no component, no slot record', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    const bad = [
      reportFor('kv-block-manager', { abi: 1 }),
      reportFor('kv-block-manager', { reference: true }),
      reportFor('kv-block-manager', { seeds: 'default' }),
      withCheck(reportFor('kv-block-manager'), 'cow', { status: 'fail' }),
      reportFor('kv-block-manager', { version: 1 }),
    ]
    const codes: string[] = []
    for (const report of bad) {
      const out = await store.getState().install({ slot: 'block-manager', report, bytes: wasm(5) })
      expect(out.ok).toBe(false)
      if (!out.ok) codes.push(out.code)
    }
    expect(codes).toEqual(['abi-1', 'reference', 'not-fresh-green', 'not-fresh-green', 'stale-version'])
    expect(tab.progress.getState().working['engine:slots']).toBeUndefined()
    expect(tab.loads()).toBe(0)
    expect(store.getState().installed).toEqual({})
  })

  test('installing the same bytes twice is one component; a new module replaces the slot and keeps the old bytes', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    const report = reportFor('batching-scheduler')
    await store.getState().install({ slot: 'scheduler', report, bytes: wasm(6) })
    await store.getState().install({ slot: 'scheduler', report, bytes: wasm(6) })
    expect(await (await tab.engine()).components()).toHaveLength(1)
    const old = store.getState().installed.scheduler!.sha256
    await store.getState().install({ slot: 'scheduler', report, bytes: wasm(7) })
    const now = store.getState().installed.scheduler!
    expect(now.sha256).not.toBe(old)
    expect(new Uint8Array(now.bytes!)).toEqual(wasm(7))
    expect(await (await tab.engine()).components()).toHaveLength(2)
  })

  test('remove empties the slot and keeps the bytes; it survives a reload as empty', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    await store.getState().install({ slot: 'intake', report: reportFor('mpmc-queue'), bytes: wasm(8) })
    const sha = store.getState().installed.intake!.sha256
    store.getState().remove('intake')
    await settle(store)
    expect(store.getState().installed).toEqual({})
    expect(store.getState().slots.queue).toBeNull()
    expect(new Uint8Array((await (await tab.engine()).componentBytes(sha))!)).toEqual(wasm(8))
    await tab.progress.controls.flush()
    const again = createSlotsStore(startTab(p).progress)
    await settle(again)
    expect(again.getState().installed).toEqual({})
  })

  test('setSlot is a session upload over the installed module, never saved; null clears it and uninstalls the slot', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    await store.getState().install({ slot: 'scheduler', report: reportFor('batching-scheduler'), bytes: wasm(9) })
    const upload = { bytes: wasm(10).buffer as ArrayBuffer, fileName: 'try.wasm', lab: 'batching-scheduler' }
    store.getState().setSlot('sched', upload)
    expect(store.getState().slots.sched).toBe(upload)
    expect(store.getState().installed.scheduler!.name).toBeUndefined() // the installed module is untouched
    expect(Object.keys(tab.progress.getState().working['engine:slots'] as object)).toEqual(['scheduler'])
    await tab.progress.controls.flush()
    const reloaded = createSlotsStore(startTab(p).progress)
    await settle(reloaded)
    expect(new Uint8Array(reloaded.getState().slots.sched!.bytes)).toEqual(wasm(9)) // the upload was not saved

    store.getState().setSlot('sched', null)
    await settle(store)
    expect(store.getState().slots.sched).toBeNull()
    expect(store.getState().installed).toEqual({})
    expect(tab.progress.getState().working['engine:slots']).toEqual({})
  })

  test('a session upload to a slot with nothing installed writes nothing', async () => {
    const tab = startTab(makeProfile())
    const store = createSlotsStore(tab.progress)
    store.getState().setSlot('queue', { bytes: wasm(11).buffer as ArrayBuffer, fileName: 'q.wasm', lab: 'mpmc-queue' })
    store.getState().setSlot('queue', null)
    await tick(5)
    expect(tab.progress.getState().working['engine:slots']).toBeUndefined()
    expect(tab.loads()).toBe(0)
  })

  test('slots with no bytes on this device (an import without them) are installed but not driven', async () => {
    const sha256 = 'cd'.repeat(32)
    const at = '2026-10-05T09:00:00.000Z'
    const p = makeProfile({
      seed: {
        components: [{ sha256, labId: 'kv-block-manager', size: 9, addedAt: at, name: 'gone.wasm' }],
        working: [{ key: 'engine:slots', value: { 'block-manager': { sha256, labId: 'kv-block-manager', version: 3, at } }, at, dev: 'd' }],
      },
    })
    const tab = startTab(p)
    const store = createSlotsStore(tab.progress)
    await tab.progress.controls.engine() // the façade's own boot, which the app schedules at idle
    await settle(store)
    expect(store.getState().installed['block-manager']).toMatchObject({ sha256, name: 'gone.wasm', bytes: null })
    expect(store.getState().slots.mgr).toBeNull()
  })

  test('another tab’s install reaches this tab’s store without a reload', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    const storeB = createSlotsStore(b.progress)
    await b.progress.controls.engine()
    const storeA = createSlotsStore(a.progress)
    await storeA.getState().install({ slot: 'block-manager', report: reportFor('kv-block-manager'), bytes: wasm(12) })
    await a.progress.controls.flush()
    await tick(20)
    expect(new Uint8Array(storeB.getState().slots.mgr!.bytes)).toEqual(wasm(12))
  })
})
