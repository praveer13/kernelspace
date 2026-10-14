/**
 * The telemetry grid and its mirror (docs/specs/wave-2.md §12, the seventh mirror): every sparkline is
 * role="img" with a label that names the series and describes it by the grid's SimMirror table, and the
 * table holds the sampled series. Rendered to strings; the keyboard path and axe run in a browser (the 2b-09 report).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sparkline } from '../../src/components/telemetry/Sparkline'
import { TelemetryGrid } from '../../src/components/telemetry/TelemetryGrid'
import { fmt, MIRROR_MAX_ROWS, SERIES, sampleIndexes, sparklineLabel, telemetryMirror } from '../../src/components/telemetry/series'
import type { TickSample } from '../../src/lib/fleet-model'

function run(n: number): TickSample[] {
  return Array.from({ length: n }, (_, i) => ({
    tick: i * 5,
    waiting: i,
    running: 4,
    completed: i * 2,
    sloMet: i,
    shed: i % 3,
    autoPreempts: 0,
    capMisses: 0,
    freeBlocks: 100 - i,
    ttftP95: 120 + i * 10,
    tpotP95: 30,
    queueP95: i * 1500,
  }))
}

const html = (series: TickSample[]) => renderToStaticMarkup(createElement(TelemetryGrid, { series }))

describe('sampleIndexes', () => {
  test('a short run is shown whole; a long run is spread evenly with first and last kept', () => {
    expect(sampleIndexes(0)).toEqual([])
    expect(sampleIndexes(5)).toEqual([0, 1, 2, 3, 4])
    const idx = sampleIndexes(240)
    expect(idx.length).toBe(MIRROR_MAX_ROWS)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(239)
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true)
  })
})

describe('telemetryMirror', () => {
  test('one column per plotted series after the tick, one row per sampled tick', () => {
    const series = run(100)
    const t = telemetryMirror(series)
    expect(t.columns).toEqual(['tick', ...SERIES.map((s) => s.label)])
    expect(t.rows.length).toBe(MIRROR_MAX_ROWS)
    expect(t.rows[0][0]).toBe(0)
    expect(t.rows[t.rows.length - 1][0]).toBe(99 * 5)
    expect(t.rows.every((r) => r.length === t.columns.length)).toBe(true)
    expect(t.caption).toContain(`${MIRROR_MAX_ROWS} of 100`)
  })
  test('cells use the same formatting as the "final:" line', () => {
    const t = telemetryMirror(run(3))
    const queue = SERIES.findIndex((s) => s.key === 'queueP95') + 1
    expect(t.rows[2][queue]).toBe(fmt(3000))
    expect(t.rows[2][queue]).toBe('3.0k')
  })
  test('an empty run has an honest caption and no rows', () => {
    const t = telemetryMirror([])
    expect(t.rows).toEqual([])
    expect(t.caption).toContain('no samples')
  })
})

describe('Sparkline', () => {
  test('is role=img with its label and points at the mirror', () => {
    const out = renderToStaticMarkup(createElement(Sparkline, { values: [1, 2, 3], color: '#fff', label: 'queue delay', describedBy: 'm1' }))
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="queue delay"')
    expect(out).toContain('aria-describedby="m1"')
    expect(out).toContain('<polyline')
  })
  test('too few samples still render a labelled image, not a bare box', () => {
    const out = renderToStaticMarkup(createElement(Sparkline, { values: [], color: '#fff', label: 'empty' }))
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="empty"')
  })
  test('the label carries the range and the final value', () => {
    expect(sparklineLabel('shed', [0, 4, 2])).toBe('shed sparkline, 3 samples, min 0, max 4, final 2')
    expect(sparklineLabel('shed', [])).toBe('shed: no samples')
  })
})

describe('TelemetryGrid', () => {
  test('six sparklines, each role=img with a distinct label, all described by one SimMirror table', () => {
    const out = html(run(60))
    const imgs = out.match(/<svg[^>]*role="img"[^>]*>/g) ?? []
    expect(imgs.length).toBe(SERIES.length)
    const labels = imgs.map((s) => /aria-label="([^"]+)"/.exec(s)?.[1])
    expect(labels.every((l) => l && l.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(SERIES.length)
    for (const s of SERIES) expect(labels.some((l) => l?.startsWith(s.label))).toBe(true)
    const ids = imgs.map((s) => /aria-describedby="([^"]+)"/.exec(s)?.[1])
    expect(new Set(ids).size).toBe(1)
    const id = ids[0]!
    expect(out).toContain(`id="${id}"`)
    expect(out).toContain('data-sim-mirror')
    expect(out).toContain(`aria-controls="${id}"`)
    expect(out).toContain('<table')
    expect(out).toContain('Show data table')
  })
  test('keeps the look: the card grid, the label line and the final line', () => {
    const out = html(run(60))
    expect(out).toContain('grid gap-3 sm:grid-cols-2')
    expect(out).toContain('final: ')
    expect(out).toContain('viewBox="0 0 100 36"')
    expect(out).toContain('preserveAspectRatio="none"')
    expect(out).toContain('stroke-width="1.5"')
  })
  test('two grids on one page do not share a mirror id', () => {
    const both = renderToStaticMarkup(createElement('div', null, createElement(TelemetryGrid, { series: run(10) }), createElement(TelemetryGrid, { series: run(10) })))
    const ids = [...both.matchAll(/data-sim-mirror/g)].length
    expect(ids).toBe(2)
    const described = new Set([...both.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]))
    expect(described.size).toBe(2)
  })
  test('an empty run renders six labelled placeholders and an empty table', () => {
    const out = html([])
    expect((out.match(/role="img"/g) ?? []).length).toBe(SERIES.length)
    expect(out).toContain('no samples')
  })
})
