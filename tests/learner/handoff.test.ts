import { describe, expect, test } from 'bun:test'
import { buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import { SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { derive } from '../../src/lib/ledger/fold'
import { mergeEvents } from '../../src/lib/ledger/merge'
import {
  deltaFile,
  deltaFileName,
  handoffLabel,
  handoffSince,
  parseHandoffMarker,
  pendingHandoff,
} from '../../src/lib/learner/handoff'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { syntheticYear } from '../ledger/gen'
import { Journal } from './ledger-gen'

const AT = '2026-10-05T10:00:00.000Z'
const events = (ats: string[], dev = 'dev-1'): LedgerEvent[] => {
  const j = new Journal()
  for (const at of ats) {
    const e = j.add('visit', 'lesson:t0.l1', at.slice(0, 10))
    ;(e as { at: string; dev: string }).at = at
    ;(e as { dev: string }).dev = dev
  }
  return j.events
}

describe('the handoff marker (working record handoff:last)', () => {
  test('reads {at, events} and refuses anything else', () => {
    expect(parseHandoffMarker({ at: AT, events: 12 })).toEqual({ at: AT, events: 12 })
    expect(parseHandoffMarker({ at: AT })).toEqual({ at: AT, events: 0 })
    expect(parseHandoffMarker({ at: AT, events: -3 })).toEqual({ at: AT, events: 0 })
    expect(parseHandoffMarker({ at: AT, events: 7.9 })).toEqual({ at: AT, events: 7 })
    for (const bad of [null, undefined, 'x', 3, [], { at: 5 }, { at: '2026-10-05' }, { at: 'x'.repeat(24) }, {}]) expect(parseHandoffMarker(bad)).toBeNull()
  })

  test('the first delta asks for everything, later ones for what came since', () => {
    expect(handoffSince(null)).toBeUndefined()
    expect(handoffSince({ at: AT, events: 3 })).toBe(AT)
  })

  test('the file is kernelspace-delta-<date>.json', () => {
    expect(deltaFileName('2026-10-05T23:59:59.000Z')).toBe('kernelspace-delta-2026-10-05.json')
  })
})

describe('events not yet handed off', () => {
  const evs = events(['2026-10-01T09:00:00.000Z', '2026-10-03T09:00:00.000Z', '2026-10-05T09:00:00.000Z', '2026-10-06T09:00:00.000Z'])

  test('with neither a handoff nor an export, every event is waiting', () => {
    expect(pendingHandoff(evs)).toBe(4)
    expect(pendingHandoff([])).toBe(0)
  })

  test('the newer of the last handoff and the last export is the line', () => {
    expect(pendingHandoff(evs, { last: { at: '2026-10-03T09:00:00.000Z', events: 2 } })).toBe(2)
    expect(pendingHandoff(evs, { lastExportAt: '2026-10-05T09:00:00.000Z' })).toBe(1)
    expect(pendingHandoff(evs, { last: { at: '2026-10-05T09:00:00.000Z', events: 2 }, lastExportAt: '2026-10-01T00:00:00.000Z' })).toBe(1)
    expect(pendingHandoff(evs, { last: { at: '2026-10-01T00:00:00.000Z', events: 2 }, lastExportAt: '2026-10-06T09:00:00.000Z' })).toBe(0)
  })

  test('counts this device\'s events only when asked, and each id once', () => {
    const mixed = [...events(['2026-10-06T09:00:00.000Z'], 'dev-1'), ...events(['2026-10-06T10:00:00.000Z'], 'dev-2').map((e) => ({ ...e, id: 'other' }))]
    expect(pendingHandoff(mixed)).toBe(2)
    expect(pendingHandoff(mixed, { device: 'dev-1' })).toBe(1)
    expect(pendingHandoff([...mixed, ...mixed])).toBe(2)
  })

  test('the label', () => {
    expect(handoffLabel(12)).toBe('12 events not yet handed off')
    expect(handoffLabel(1)).toBe('1 event not yet handed off')
    expect(handoffLabel(0)).toBeNull()
    expect(handoffLabel(-2)).toBeNull()
  })
})

describe('a delta is an export v3 the other device merges', () => {
  const all = syntheticYear(5, 'light').events
  const sorted = [...all].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
  const since = sorted[Math.floor(sorted.length / 2)].at
  const build = (sinceAt?: string) =>
    buildExportV3({ events: all, working: [], device: 'dev-a', exportedAt: '2026-10-05T12:00:00.000Z', sinceAt })

  test('deltaFile packages the engine\'s delta with the marker to write afterwards', () => {
    const file = build(since)
    const d = deltaFile(file)
    expect(d.name).toBe('kernelspace-delta-2026-10-05.json')
    expect(d.marker).toEqual({ at: '2026-10-05T12:00:00.000Z', events: file.events.length })
    expect(d.text).toBe(serializeExport(file)) // the same deterministic bytes as a backup
    expect(parseHandoffMarker(d.marker)).toEqual(d.marker)
  })

  test('the file imports, and the old half plus the delta is the whole ledger', () => {
    const delta = deltaFile(build(since))
    const parsed = parseImport(delta.text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.version).toBe(3)
    expect(parsed.file.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.file.events.every((e) => e.at >= since)).toBe(true)
    const before = all.filter((e) => e.at < since)
    const merged = mergeEvents(before, parsed.file.events)
    expect(merged.map((e) => e.id).sort()).toEqual(all.map((e) => e.id).sort())
    expect(derive(merged)).toEqual(derive(all))
    // a delta is not a backup: no components, no extras
    expect(parsed.file.components).toEqual([])
    expect(parsed.file.extras).toEqual({ capstoneDrafts: {} })
  })

  test('events written after the handoff are what is pending next', () => {
    const file = build(since)
    const marker = deltaFile(file).marker
    expect(pendingHandoff(all, { last: marker })).toBe(all.filter((e) => e.at > marker.at).length)
    const later = events(['2026-10-06T08:00:00.000Z', '2026-10-06T09:00:00.000Z'])
    expect(pendingHandoff([...all, ...later], { last: marker })).toBe(2 + all.filter((e) => e.at > marker.at).length)
  })

  test('the first delta (no marker) is the whole ledger', () => {
    expect(build(handoffSince(null)).events.length).toBe(all.length)
  })
})
