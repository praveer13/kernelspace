import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { MotionConfigContext } from 'framer-motion'
import { effectiveOpacity, installDom, type DomKit, type Mounted, type MiniElement } from '../dom/mini-dom'

/**
 * The lazy /me sections under reduced motion (wave-3.md §12.5, task 3b-06). Me.tsx is plain `lazy`, so the page itself
 * carries no MotionScope; each section that uses framer-motion scopes itself (tests/shell/nav.test.ts holds that in the
 * source). Here the real page is mounted with tests/dom/mini-dom.ts and its lazy sections are let to load, once with
 * motion allowed and once under a `prefers-reduced-motion: reduce` matchMedia, and the first frame is read: the
 * entrance's offset and fade, which is what a person sensitive to motion would otherwise see. What a browser alone can
 * answer (the frames after) stays with the a11y harness.
 */
let dom: DomKit
let Me: React.ComponentType
let motionState: { prefersReducedMotion: { current: boolean | null }; hasReducedMotionListener: { current: boolean } }
const saved = { prefers: null as boolean | null, listening: false }

/**
 * The OS setting as the page sees it. framer-motion asks `matchMedia` once per process and keeps the answer, and its
 * module may have loaded (in another test file, before any DOM existed) without ever asking, so the stub is paired with
 * setting framer's own answer: what `matchMedia('(prefers-reduced-motion)')` would have told it.
 */
function reduceMotion(on: boolean) {
  const media = (q: string) => ({ matches: on && /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  dom.window.matchMedia = media
  ;(globalThis as Record<string, unknown>).matchMedia = media
  motionState.hasReducedMotionListener.current = true
  motionState.prefersReducedMotion.current = on
}

beforeAll(async () => {
  dom = await installDom()
  motionState = (await import('motion-dom')) as unknown as typeof motionState
  saved.prefers = motionState.prefersReducedMotion.current
  saved.listening = motionState.hasReducedMotionListener.current
  Me = (await import('../../src/pages/Me')).default
})
afterAll(async () => {
  motionState.prefersReducedMotion.current = saved.prefers
  motionState.hasReducedMotionListener.current = saved.listening
  await dom.uninstall()
})

/** Mount /me and let both lazy sections load: the journey (its ring panel) and data ownership (its heading). */
async function mountMe(): Promise<Mounted> {
  const page = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/me'] }, createElement(Me)))
  await dom.until(() => page.container.querySelector('[data-ring-panel]') !== null && (page.container.textContent ?? '').includes('data ownership'))
  return page
}

/** Everything an entrance leaves on its first frame: a fade (inline opacity below 1) or an offset (an inline transform). */
function entering(page: Mounted): MiniElement[] {
  return page.container.querySelectorAll('*').filter((el) => {
    const o = el.style.opacity
    const t = el.style.transform as string
    return (o !== '' && Number(o) < 1) || (t !== '' && t !== 'none')
  })
}

describe('the lazy /me sections and motion', () => {
  test('control: with motion allowed the journey starts mid-entrance, so the test below is not passing on a page with no motion', async () => {
    reduceMotion(false)
    const page = await mountMe()
    const moving = entering(page)
    expect(moving.length).toBeGreaterThan(10)
    // the ring panel is fading in (it may be a frame or two along); the KPI cards wait to be seen, 24 px down
    const panel = page.container.querySelector('[data-ring-panel]')!
    expect(effectiveOpacity(panel)).toBeLessThan(1)
    expect(moving.some((el) => /translateY\(24px\)/.test(el.style.transform as string))).toBe(true)
    await page.unmount()
  })

  test('under reduced motion the sections arrive as they are: nothing is faded, scaled or offset on the first frame', async () => {
    reduceMotion(true)
    const page = await mountMe()
    expect(entering(page).map((el) => `${el.tagName.toLowerCase()} ${el.style.opacity} ${el.style.transform}`)).toEqual([])
    const panel = page.container.querySelector('[data-ring-panel]')!
    expect(effectiveOpacity(panel)).toBe(1)
    // the section's content is there: the ring panel's headline and the checklist heading, and data ownership's rows
    expect(panel.textContent).toContain('highest ring earned')
    const text = page.container.textContent ?? ''
    for (const part of ['What each ring needs', 'memory map', 'privilege escalations', 'Export progress', 'Reset everything']) expect(text).toContain(part)
    await page.unmount()
  })

  test('the memory map bars start at their value under reduced motion, never at zero width', async () => {
    reduceMotion(true)
    const page = await mountMe()
    const bars = page.container.querySelectorAll('a[href^="/tracks/"] .h-full')
    expect(bars.length).toBeGreaterThan(5)
    for (const bar of bars) expect(bar.style.width).toMatch(/^\d+(\.\d+)?%$/)
    await page.unmount()
    reduceMotion(false)
    const moving = await mountMe()
    for (const bar of moving.container.querySelectorAll('a[href^="/tracks/"] .h-full')) expect(bar.style.width).toMatch(/^0(px|%)?$/)
    await moving.unmount()
  })
})

describe('MotionScope itself', () => {
  /**
   * The tests above read the first frame, and Journey's own `useReducedMotion()` branches (`initial={reduced ? false : ...}`)
   * switch the entrances off whether or not a MotionScope wraps it, so they pass without one. What only the scope gives is
   * the `MotionConfig` that turns `reducedMotion` to "user" for every motion element below it, the elements with no branch of
   * their own (a heatmap cell's `whileHover={{ scale: 1.15 }}`) and any added later. So this reads that: the nearest
   * MotionConfigContext provider above a motion element of the journey, from the React tree behind the DOM node. (A hover
   * gives the same answer in a browser, but it runs on motion-dom's frame loop, which binds the clock of whichever test
   * file imported it first, so it cannot be told from here.)
   */
  const FIBER = '__reactFiber$'
  type Fiber = { type?: unknown; return?: Fiber | null; memoizedProps?: { value?: unknown } }
  function motionConfigAbove(el: MiniElement): { reducedMotion?: string } | null {
    const key = Object.keys(el).find((k) => k.startsWith(FIBER))
    let fiber = key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null
    for (; fiber; fiber = fiber.return ?? null) {
      const t = fiber.type as { _context?: unknown } | undefined
      if (t === MotionConfigContext || t?._context === MotionConfigContext) return (fiber.memoizedProps?.value ?? null) as { reducedMotion?: string } | null
    }
    return null
  }

  test('a motion element of the journey sits under a MotionConfig with reducedMotion "user"', async () => {
    reduceMotion(true)
    const page = await mountMe()
    // the heatmap cell has no reduced-motion branch of its own for its hover, the ring panel is the journey's first motion element
    const cell = page.container.querySelector('[title$="activities"], [title$="activity"]')!
    for (const el of [cell, page.container.querySelector('[data-ring-panel]')!]) {
      const config = motionConfigAbove(el)
      expect(config, 'no MotionConfig above the element: the journey is not inside MotionScope').not.toBeNull()
      expect(config!.reducedMotion).toBe('user')
    }
    await page.unmount()
  })

  test('control: the probe sees nothing above a motion element that has no MotionScope', async () => {
    const { motion } = await import('framer-motion')
    const page = await dom.mount(createElement(motion.div, { 'data-bare': true }))
    expect(motionConfigAbove(page.container.querySelector('[data-bare]')!)).toBeNull()
    await page.unmount()
  })
})
