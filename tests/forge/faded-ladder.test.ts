/**
 * A faded bundle's ladder (wave-3.md D13 and D26, task 3a-05b's minor): `fade: 'r2'` bundles author R0 to R2 and the
 * packet follows. The ladder renders no gate, no title and no "available now" call for a rung the check's ladder lacks,
 * and no bottom-out; labs 01 to 03 (whole ladders) render as before. The fixture is lab 01's bundle with R3 and R4 removed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { AskPacketView } from '../../src/components/forge/AskPacket'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import lab01 from '../../src/data/forge/rust-allocator'
import { FORGE_LABS } from '../../src/data/labs'
import type { ForgeBundle } from '../../src/data/forge/types'
import { hintRef } from '../../src/lib/forge/ladder'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { installDom, type DomKit } from '../dom/mini-dom'

const ISO = '2026-10-04T09:00:00.000Z'
const lab = FORGE_LABS.find((l) => l.id === lab01.labId)!

const faded: ForgeBundle = {
  ...lab01,
  fade: 'r2',
  ladder: lab01.ladder.map(({ checkId, r0, r1, r2 }) => ({ checkId, r0, r1, r2 })),
}

const row = (id: string, status: CheckResult['status'] = 'fail'): CheckResult => ({ id, label: id, status, msg: `${id} says no` })
const run = (checks: CheckResult[]): LabRunReport => ({ lab: lab01.labId, reference: false, abi: 2, version: 2, checks, seeds: 'fresh', ms: 5 })
const acksTo = (check: string, rungs: readonly ('R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'bottom')[]) =>
  Object.fromEntries(rungs.map((r) => [hintRef(check, r, lab01.labId), ISO]))

const html = (bundle: ForgeBundle, reports: LabRunReport[], acks: Record<string, string>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports, acks, onAck: () => {}, now: () => 0 })))

describe('a faded bundle (fade r2)', () => {
  test('the fixture has no R3 or R4 and the whole lab 01 ladder does', () => {
    for (const l of faded.ladder) {
      expect('r3' in l).toBe(false)
      expect('r4' in l).toBe(false)
    }
    for (const l of lab01.ladder) {
      expect(typeof l.r3).toBe('string')
      expect(typeof l.r4).toBe('string')
    }
  })

  test('with R0 only open it offers R1 and R2 and says nothing of R3, R4 or the bottom-out', () => {
    const out = html(faded, [run([row('align')])], acksTo('align', ['R0']))
    expect(out).toContain('R0 · say it first')
    expect(out).toContain('R1 · the concept')
    expect(out).toContain('R2 · where to look')
    expect(out).toContain('Open R1')
    expect(out).toContain('Open R2')
    for (const gone of ['R3', 'R4', 'Open R3', 'Open R4', 'Open R4 first.', 'Show the walkthrough', 'Bottom-out', 'Pseudo-code']) expect(out).not.toContain(gone)
  })

  test('with R0 to R2 open it ends at R2: the R2 text, no gate after it, the ask-a-human link still there', () => {
    const out = html(faded, [run([row('align')])], acksTo('align', ['R0', 'R1', 'R2']))
    const l = lab01.ladder.find((x) => x.checkId === 'align')!
    expect(out).toContain(l.r2.text)
    expect(out).not.toMatch(/Open R\d/)
    expect(out).not.toContain('R3')
    expect(out).not.toContain('R4')
    expect(out).not.toContain('data-walkthrough')
    expect(out).not.toContain('Show the walkthrough')
    expect(out).toContain('data-ask-human')
  })

  test('the packet follows R2: it is offered after R2 and not before', () => {
    const packet = (acks: Record<string, string>) =>
      renderToStaticMarkup(
        createElement(AskPacketView, { lab, reports: [run([row('align')])], ladderIds: faded.ladder.map((x) => x.checkId), acks, expSeed: undefined }),
      )
    expect(packet(acksTo('align', ['R0', 'R1']))).toContain('The packet opens after R2 of the hints for this check.')
    const after = packet(acksTo('align', ['R0', 'R1', 'R2']))
    expect(after).not.toContain('The packet opens after R2')
    expect(after).toContain('packet:lab/')
  })

  test('a whole ladder (labs 01 to 03) still gates R3, R4 and the walkthrough', () => {
    const out = html(lab01, [run([row('align')])], acksTo('align', ['R0']))
    for (const kept of ['Open R3', 'Open R4', 'Show the walkthrough', 'Open R4 first.']) expect(out).toContain(kept)
  })
})

describe('the screen-reader line of a mounted ladder', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(async () => {
    await dom.uninstall()
  })

  // R0 to R2 are open; one more red run arrives. On a whole ladder R3 is now available; on a faded one nothing is.
  const announced = async (bundle: ForgeBundle): Promise<string> => {
    const acks = acksTo('align', ['R0', 'R1', 'R2'])
    const view = (n: number) =>
      createElement(
        MemoryRouter,
        null,
        createElement(HintLadderView, { bundle, reports: Array.from({ length: n }, () => run([row('align')])), acks, onAck: () => {}, now: () => 0 }),
      )
    const page = await dom.mount(view(3))
    await page.render(view(4))
    const text = page.container.querySelector('[role="status"]')?.textContent ?? 'no status line'
    await page.unmount()
    return text
  }

  test('a whole ladder announces R3 once a red run follows R2', async () => {
    expect(await announced(lab01)).toBe('Available now: align R3')
  })

  test('a faded ladder never announces a rung it lacks', async () => {
    expect(await announced(faded)).toBe('')
  })
})
