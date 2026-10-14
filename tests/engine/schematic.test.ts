/**
 * Your engine's UI (docs/specs/wave-2.md §10.4, task 2b-12): the schematic's eight boxes and their DOM mirror,
 * the install button's gate on ForgeLab, and the schematic reading what the persistent slot store holds.
 * Components render to strings inside a MemoryRouter; the store runs on the memory-store profile of tests/ledger.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import EngineSchematic, { BESIDE, BOX_H, BOX_W, PIPELINE, SCHEMATIC_H, SCHEMATIC_W, installDay, ownCount, schematicBoxes } from '../../src/components/engine/EngineSchematic'
import InstallButton from '../../src/components/engine/InstallButton'
import { FORGE_LABS } from '../../src/data/labs'
import { ENGINE_SLOT_ORDER, ENGINE_SLOTS, slotForLab } from '../../src/lib/engine/catalog'
import { REFUSALS } from '../../src/lib/engine/store'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { EngineSlots } from '../../src/lib/ledger/types'
import { createSlotsStore } from '../../src/pages/fleet/slots'
import { makeProfile, startTab, tick } from '../ledger/env'

const html = (el: ReturnType<typeof createElement>) => renderToString(createElement(MemoryRouter, null, el))
const SHA_A = 'a1b2c3d4'.repeat(8)
const SHA_B = '0f9e8d7c'.repeat(8)
const entry = (sha256: string, labId: string, at: string) => ({ sha256, labId, version: 3, at })
/** An instant at this local clock time, so the expected day holds in every time zone the suite runs in. */
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe('schematic boxes (§10.4)', () => {
  test('eight boxes in pipeline order, the request path first and the other three beside it', () => {
    const boxes = schematicBoxes({})
    expect(boxes.map((b) => b.slot)).toEqual([...ENGINE_SLOT_ORDER])
    expect(boxes).toHaveLength(8)
    expect(PIPELINE).toEqual(['tokenizer', 'prefix-router', 'intake', 'scheduler', 'block-manager'])
    expect(BESIDE).toEqual(['executor', 'grammar', 'allocator'])
    // the request path runs down one column, each box below the last
    const column = boxes.slice(0, 5)
    expect(new Set(column.map((b) => b.x)).size).toBe(1)
    for (let i = 1; i < column.length; i++) expect(column[i].y).toBeGreaterThan(column[i - 1].y + BOX_H)
    // the others sit in a second column, clear of the first
    const side = boxes.slice(5)
    expect(new Set(side.map((b) => b.x)).size).toBe(1)
    expect(side[0].x).toBeGreaterThanOrEqual(column[0].x + BOX_W)
  })

  test('boxes never overlap and stay inside the viewBox', () => {
    const boxes = schematicBoxes({})
    for (const a of boxes) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.y).toBeGreaterThanOrEqual(0)
      expect(a.x + BOX_W).toBeLessThanOrEqual(SCHEMATIC_W)
      expect(a.y + BOX_H).toBeLessThanOrEqual(SCHEMATIC_H)
      for (const b of boxes) {
        if (a === b) continue
        const apart = a.x + BOX_W <= b.x || b.x + BOX_W <= a.x || a.y + BOX_H <= b.y || b.y + BOX_H <= a.y
        expect(apart, `${a.slot} vs ${b.slot}`).toBe(true)
      }
    }
  })

  test('with nothing installed every box is the reference, with its lab and no sha or date', () => {
    const boxes = schematicBoxes({})
    expect(ownCount(boxes)).toBe(0)
    for (const b of boxes) {
      expect(b).toMatchObject({ mine: false, shortSha: null, installedOn: null, lab: ENGINE_SLOTS[b.slot].lab, labNo: ENGINE_SLOTS[b.slot].labNo })
      expect(b.href).toBe(`/forge/${ENGINE_SLOTS[b.slot].lab}`)
      expect(FORGE_LABS.some((l) => l.id === b.lab)).toBe(true)
    }
  })

  test('the install day is the learner’s local calendar day, so a late-evening install is not tomorrow', () => {
    expect(installDay(local(2026, 10, 5, 23, 59))).toBe('2026-10-05')
    expect(installDay(local(2026, 10, 6, 0, 1))).toBe('2026-10-06')
    expect(installDay('not a date at all')).toBe('not a date')
  })

  test('an installed slot is yours, with the first seven digits of its sha and the install day', () => {
    const slots: EngineSlots = {
      scheduler: entry(SHA_A, 'batching-scheduler', local(2026, 10, 5, 23, 30)),
      allocator: entry(SHA_B, 'rust-allocator', local(2026, 11, 1, 0, 15)),
    }
    const boxes = schematicBoxes(slots)
    expect(ownCount(boxes)).toBe(2)
    const by = Object.fromEntries(boxes.map((b) => [b.slot, b]))
    expect(by.scheduler).toMatchObject({ mine: true, shortSha: 'a1b2c3d', installedOn: '2026-10-05' })
    expect(by.allocator).toMatchObject({ mine: true, shortSha: '0f9e8d7', installedOn: '2026-11-01' })
    expect(by.intake.mine).toBe(false)
  })
})

describe('EngineSchematic render', () => {
  const slots: EngineSlots = {
    tokenizer: entry(SHA_A, 'bpe-tokenizer', local(2026, 10, 5, 9)),
    'block-manager': entry(SHA_B, 'kv-block-manager', local(2026, 10, 6, 9)),
  }
  const out = html(createElement(EngineSchematic, { installed: slots }))

  test('one SVG box per slot, mint for yours and grey for the reference, in order', () => {
    const boxes = [...out.matchAll(/<g [^>]*data-slot="([a-z-]+)"[^>]*data-mine="(yes|no)"/g)]
    expect(boxes.map((m) => m[1])).toEqual([...ENGINE_SLOT_ORDER])
    expect(boxes.map((m) => m[2])).toEqual(['yes', 'no', 'no', 'no', 'yes', 'no', 'no', 'no'])
    expect(out.match(/fill-accent-dim stroke-accent/g)).toHaveLength(2)
    expect(out.match(/fill-surface-2 stroke-line-bright/g)).toHaveLength(6)
  })

  test('the SVG says "yours" or "reference" in text and shows lab, short sha and date', () => {
    const svg = /<svg[\s\S]*<\/svg>/.exec(out)![0]
    expect(svg).toContain('lab 03 bpe-tokenizer')
    expect(svg).toContain('a1b2c3d · 2026-10-05')
    expect(svg).toContain('0f9e8d7 · 2026-10-06')
    expect(svg.match(/>yours</g)).toHaveLength(2)
    expect(svg.match(/>reference</g)).toHaveLength(6)
    for (const slot of ENGINE_SLOT_ORDER) expect(svg).toContain(`lab ${String(ENGINE_SLOTS[slot].labNo).padStart(2, '0')} ${ENGINE_SLOTS[slot].lab}`)
  })

  test('the DOM list mirrors every box, links each to its lab, and is what the SVG is described by', () => {
    const svg = /<svg [^>]*>/.exec(out)![0]
    expect(svg).toContain('role="img"')
    expect(svg).toContain('2 of 8 slots hold your own modules')
    const listId = /aria-describedby="([^"]+)"/.exec(svg)![1]
    const list = new RegExp(`<ol id="${listId.replace(/[:]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</ol>`).exec(out)
    expect(list, 'the list the SVG points at').not.toBeNull()
    const items = [...list![1].matchAll(/<li [^>]*data-slot="([a-z-]+)"[^>]*>([\s\S]*?)<\/li>/g)]
    expect(items.map((m) => m[1])).toEqual([...ENGINE_SLOT_ORDER])
    for (const [, slot, body] of items) {
      expect(body, slot).toContain(`href="/forge/${ENGINE_SLOTS[slot as keyof typeof ENGINE_SLOTS].lab}"`)
      expect(body, slot).toContain(ENGINE_SLOTS[slot as keyof typeof ENGINE_SLOTS].lab)
    }
    const text = (slot: string) => items.find((m) => m[1] === slot)![2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
    expect(text('tokenizer')).toContain('yours · sha a1b2c3d · installed 2026-10-05')
    expect(text('block-manager')).toContain('yours · sha 0f9e8d7 · installed 2026-10-06')
    expect(text('scheduler')).toContain('reference')
  })

  test('only the list is in the tab order: nothing focusable sits inside the SVG', () => {
    const svg = /<svg[\s\S]*<\/svg>/.exec(out)![0]
    expect(svg).not.toMatch(/<(a|button|input)[ >]|tabindex/)
    expect(out.match(/<a /g)).toHaveLength(8) // the eight links of the list
  })

  test('an empty engine reads "0 of 8" and shows no mint', () => {
    const empty = html(createElement(EngineSchematic, { installed: {} }))
    expect(empty).toContain('0 of 8 slots hold your own modules')
    expect(empty).not.toContain('stroke-accent')
    expect(empty).not.toContain('yours')
  })
})

/* ------------------------------- InstallButton ------------------------------- */

const row = (id: string, status: CheckResult['status'] = 'pass', seeded = false): CheckResult => ({ id, label: id, status, msg: '', ...(seeded ? { seed: 7, fresh: true } : {}) })

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

const button = (labId: string, report: LabRunReport, credit: 'unseen' | 'lab-green' | null = 'unseen') =>
  html(createElement(InstallButton, { lab: FORGE_LABS.find((l) => l.id === labId)!, report, credit, bytes: new Uint8Array([0, 97, 115, 109]).buffer as ArrayBuffer }))

describe('InstallButton (§10.2)', () => {
  test('a fresh-seed pass of every required check offers the button, advanced checks aside', () => {
    for (const slot of ENGINE_SLOT_ORDER) {
      const out = button(ENGINE_SLOTS[slot].lab, reportFor(ENGINE_SLOTS[slot].lab))
      expect(out, slot).toContain('install in your engine')
      expect(out, slot).toContain(ENGINE_SLOTS[slot].label)
    }
  })

  test('a green run on the crate’s default seeds offers no button and says to pass on fresh seeds', () => {
    const out = button('kv-block-manager', reportFor('kv-block-manager', { seeds: 'default' }), 'lab-green')
    expect(out).not.toContain('install in your engine')
    expect(out).toContain(REFUSALS['not-fresh-green'])
  })

  test('a run with one seeded check on a seed the learner could know offers no button', () => {
    const base = reportFor('kv-block-manager')
    const seeded = base.checks.find((c) => c.seed !== undefined)!
    const report = { ...base, checks: base.checks.map((c) => (c === seeded ? { ...c, fresh: false } : c)) }
    expect(button('kv-block-manager', report)).not.toContain('install in your engine')
  })

  test('a reference build, an ABI 1 module and a stale lab version are refused with the §10.2 words', () => {
    const ref = button('kv-block-manager', reportFor('kv-block-manager', { reference: true }), null)
    expect(ref).not.toContain('install in your engine')
    expect(ref).toContain(REFUSALS.reference)
    expect(button('batching-scheduler', reportFor('batching-scheduler', { abi: 1 }), 'lab-green')).toContain(REFUSALS['abi-1'])
    const stale = button('radix-cache', reportFor('radix-cache', { version: 2 }))
    expect(stale).not.toContain('install in your engine')
    expect(stale).toContain(REFUSALS['stale-version'])
  })

  test('credit null refuses even when the report does not say reference', () => {
    const out = button('mpmc-queue', reportFor('mpmc-queue'), null)
    expect(out).not.toContain('install in your engine')
    expect(out).toContain(REFUSALS.reference)
  })

  test('a run with a required check still red shows nothing: the lab page already says what to fix', () => {
    const base = reportFor('kv-block-manager')
    const required = base.checks.find((c) => c.status === 'pass')!
    const red = { ...base, checks: base.checks.map((c) => (c === required ? { ...c, status: 'fail' as const } : c)) }
    expect(button('kv-block-manager', red)).toBe('')
  })

  test('a lab that is not part of your engine shows nothing', () => {
    const lab = FORGE_LABS.find((l) => slotForLab(l.id) === undefined)
    expect(lab, 'a Rust Zero lab').toBeDefined()
    expect(button(lab!.id, reportFor(lab!.id))).toBe('')
  })
})

/* --------------------------- the schematic and the store --------------------------- */

const wasm = (...n: number[]) => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, ...n])

describe('the schematic reads the persistent slot store', () => {
  test('an install turns its box mint with the module’s own sha, and a reload shows it again', async () => {
    const p = makeProfile()
    const first = startTab(p)
    const store = createSlotsStore(first.progress)
    const bytes = wasm(1)
    const out = await store.getState().install({ slot: 'scheduler', report: reportFor('batching-scheduler'), bytes })
    expect(out.ok).toBe(true)
    const sha = await sha256Hex(bytes)
    let boxes = schematicBoxes(store.getState().installed)
    expect(boxes.find((b) => b.slot === 'scheduler')).toMatchObject({ mine: true, shortSha: sha.slice(0, 7), installedOn: installDay(p.clock.nowIso()) })
    expect(ownCount(boxes)).toBe(1)

    await first.progress.controls.flush()
    const again = createSlotsStore(startTab(p).progress)
    await again.getState().refresh()
    await tick(5)
    boxes = schematicBoxes(again.getState().installed)
    expect(boxes.find((b) => b.slot === 'scheduler')).toMatchObject({ mine: true, shortSha: sha.slice(0, 7) })
    expect(ownCount(boxes)).toBe(1)
    expect(html(createElement(EngineSchematic, { installed: again.getState().installed }))).toContain(`${sha.slice(0, 7)} · `)
  })

  test('removing the module turns its box back to the reference', async () => {
    const tab = startTab(makeProfile())
    const store = createSlotsStore(tab.progress)
    await store.getState().install({ slot: 'intake', report: reportFor('mpmc-queue'), bytes: wasm(2) })
    expect(ownCount(schematicBoxes(store.getState().installed))).toBe(1)
    store.getState().remove('intake')
    await store.getState().refresh()
    await tick(5)
    expect(ownCount(schematicBoxes(store.getState().installed))).toBe(0)
  })
})
