/**
 * The Fleet exercise seam (docs/specs/wave-3.md §2.3, §5.3; task 3a-03): ExerciseView narrows a block on `fleet`,
 * mounts the lazy FleetExercise for it (3b-20's panel, keyed by the block's index), draws nothing for an id no exercise
 * registers, and still draws a sim block as before; FLEET_EXERCISES lists `knee` and `pd-split` since 3b-03. Mounted in
 * a small DOM (tests/dom/mini-dom.ts); the panel's own behaviour is tests/fleet-ex/panel.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import FleetExercise, { type FleetExerciseProps } from '../../src/components/fleet-ex/FleetExercise'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { FleetExerciseBlock, SimExerciseBlock } from '../../src/data/lessons/types'
import { FLEET_EXERCISES } from '../../src/lib/world/fleet-ex'
import { ExerciseView } from '../../src/pages/lesson/exercise'
import { installDom, type DomKit } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const fleet: FleetExerciseBlock = { type: 'exercise', fleet: 'knee', title: 'Find the knee' }
const sim = ALL_LESSONS.flatMap((l) => l.blocks).find((b): b is SimExerciseBlock => b.type === 'exercise' && 'tasks' in b && b.taskIds === undefined)!

const view = (block: FleetExerciseBlock | SimExerciseBlock) =>
  createElement(MemoryRouter, null, createElement(ExerciseView, { block, trackColor: '#22D3EE', lessonId: 't7.l2', blockIndex: 3 }))

describe('ExerciseView on a fleet block', () => {
  test('mounts the exercise panel for the block, keyed by its index, and not the sim card', async () => {
    const m = await dom.mount(view(fleet))
    await dom.until(() => m.container.querySelector('[data-block="fleet-exercise"]') !== null)
    const panel = m.container.querySelector('[data-block="fleet-exercise"]')!
    expect(panel.getAttribute('data-exercise')).toBe('knee')
    expect(panel.getAttribute('data-lesson')).toBe('t7.l2')
    expect(panel.getAttribute('data-block-index')).toBe('3')
    expect(m.container.textContent).toContain(fleet.title)
    expect(m.container.textContent).not.toContain('Guided tasks')
    await m.unmount()
  })

  test('an id no exercise registers draws nothing', async () => {
    const m = await dom.mount(view({ ...fleet, fleet: 'no-such-exercise' }))
    await dom.act(() => new Promise((r) => setTimeout(r, 30)))
    expect(m.container.innerHTML).toBe('')
    await m.unmount()
  })

  test('the panel takes the final props', () => {
    const props: FleetExerciseProps = { block: fleet, lessonId: 't7.l2', index: 3 }
    const html = renderToStaticMarkup(createElement(FleetExercise, props))
    expect(html).toContain('data-exercise="knee"')
    expect(html).toContain('data-block-index="3"')
  })

  test('a sim block beside it still draws its card with its guided tasks', async () => {
    const m = await dom.mount(view(sim))
    const text = m.container.textContent
    expect(text).toContain(sim.title)
    expect(text).toContain('Guided tasks')
    expect(text).toContain('Open the simulator')
    await m.unmount()
  })
})

describe('FLEET_EXERCISES', () => {
  test('lists the load knee and the P:D split (3b-03)', () => {
    expect(Object.keys(FLEET_EXERCISES)).toEqual(['knee', 'pd-split'])
  })
})
