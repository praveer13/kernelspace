/**
 * What a press on "ask claude / ask chatgpt / copy packet" does (docs/specs/wave-2.md §14.2), with a stubbed
 * `window.open` and clipboard. The point is order and honesty: the tab is opened inside the click when the packet is
 * ready (Safari blocks `window.open` after an await), a blocked tab is reported and never claimed, and the ack records
 * what really happened.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ackVia, askFlow, askLine, type AskDeps, type AskResult, type TabLike } from '../../src/components/mentor/ask-flow'
import type { Packet } from '../../src/lib/mentor/packet'

const packet = { text: 'the packet', chars: 1234 } as Packet
const URL_ = 'https://claude.ai/new?q=paste'

function stubs(over: { open?: TabLike | null; clipboard?: 'ok' | 'refuse' | 'missing'; build?: 'ok' | 'fail' } = {}) {
  const log: string[] = []
  const tab: TabLike = { opener: 'the page' }
  const deps = (via: AskDeps['via'], ready?: Packet): AskDeps => ({
    via,
    url: URL_,
    ready,
    async build() {
      log.push('build')
      if (over.build === 'fail') throw new Error('no lesson')
      return packet
    },
    writeText(text) {
      log.push(`write ${text}`)
      if (over.clipboard === 'missing') throw new TypeError('no clipboard')
      return over.clipboard === 'refuse' ? Promise.reject(new DOMException('denied', 'NotAllowedError')) : Promise.resolve()
    },
    open(url) {
      log.push(`open ${url}`)
      return over.open === undefined ? tab : over.open
    },
  })
  return { log, tab, deps }
}

describe('with the packet built before the press', () => {
  test('the clipboard write and window.open both happen before the first await, inside the click', () => {
    const s = stubs()
    void askFlow(s.deps('claude', packet))
    // nothing has been awaited yet: both calls are already made, in this order
    expect(s.log).toEqual(['write the packet', `open ${URL_}`])
  })

  test('copied and opened: the status says to paste into the new tab, and the ack names the agent', async () => {
    const s = stubs()
    const r = await askFlow(s.deps('claude', packet))
    expect(r.status).toBe('opened')
    expect(askLine(r)).toBe('Packet copied, 1,234 characters. Paste it into the new tab.')
    expect(ackVia(r as Exclude<AskResult, { status: 'failed' }>, 'claude')).toBe('claude')
  })

  test('the opened tab’s opener is cleared (it is opened without the noopener feature so a blocked tab can be seen)', async () => {
    const s = stubs()
    await askFlow(s.deps('chatgpt', packet))
    expect(s.tab.opener).toBeNull()
  })

  test('window.open returning null (Safari, a popup blocker): blocked, not opened; the link is for the page to show', async () => {
    const s = stubs({ open: null })
    const r = await askFlow(s.deps('claude', packet))
    expect(r.status).toBe('blocked')
    expect(askLine(r)).not.toContain('Paste it into the new tab')
    expect(askLine(r)).toContain('did not open the new tab')
    expect(askLine(r)).toContain('link below')
    // the packet did get copied, and that is what the ack says
    expect(s.log).toContain('write the packet')
    expect(ackVia(r as Exclude<AskResult, { status: 'failed' }>, 'claude')).toBe('copy')
  })

  test('copy packet never opens a tab', async () => {
    const s = stubs()
    const r = await askFlow(s.deps('copy', packet))
    expect(r.status).toBe('copied')
    expect(s.log).toEqual(['write the packet'])
    expect(askLine(r)).toBe('Packet copied, 1,234 characters.')
    expect(ackVia(r as Exclude<AskResult, { status: 'failed' }>, 'copy')).toBe('copy')
  })

  test('a refused clipboard shows the packet to copy by hand, and the ack is a copy, not the agent', async () => {
    const s = stubs({ clipboard: 'refuse' })
    const r = await askFlow(s.deps('claude', packet))
    expect(r.status).toBe('manual')
    expect(askLine(r)).toContain('copy by hand')
    expect(ackVia(r as Exclude<AskResult, { status: 'failed' }>, 'claude')).toBe('copy')
  })

  test('a browser with no clipboard at all is the same as a refusal, not an exception', async () => {
    const s = stubs({ clipboard: 'missing' })
    expect((await askFlow(s.deps('chatgpt', packet))).status).toBe('manual')
  })
})

describe('with the packet built by the press', () => {
  test('it builds, then copies, then opens: the tab never opens before the packet is on the clipboard', async () => {
    const s = stubs()
    const r = await askFlow(s.deps('claude'))
    expect(s.log).toEqual(['build', 'write the packet', `open ${URL_}`])
    expect(r.status).toBe('opened')
  })

  test('a tab the browser blocks after the wait is reported as blocked', async () => {
    const s = stubs({ open: null })
    const r = await askFlow(s.deps('chatgpt'))
    expect(r.status).toBe('blocked')
    expect(askLine(r)).not.toContain('Paste it into the new tab')
  })

  test('a refused clipboard opens nothing and shows the packet', async () => {
    const s = stubs({ clipboard: 'refuse' })
    const r = await askFlow(s.deps('claude'))
    expect(r).toMatchObject({ status: 'manual', opened: false })
    expect(s.log.some((l) => l.startsWith('open'))).toBe(false)
  })

  test('a packet that cannot be built is a failure with a sentence, and nothing is copied or opened', async () => {
    const s = stubs({ build: 'fail' })
    const r = await askFlow(s.deps('claude'))
    expect(r.status).toBe('failed')
    expect(askLine(r)).toContain('could not be built')
    expect(s.log).toEqual(['build'])
  })
})

describe('AskButtons', () => {
  const src = readFileSync(join(import.meta.dir, '../../src/components/mentor/AskButtons.tsx'), 'utf8')

  test('opens the tab through askFlow inside the click handler, not after awaiting the build and the clipboard itself', () => {
    expect(src).toContain('askFlow({')
    expect(src).toContain("open: (url) => window.open(url, '_blank')")
    // the noopener feature makes window.open return null even when it worked, so a blocked tab could not be seen
    expect(src).not.toMatch(/window\.open\([^)]*noopener/)
    expect(src).not.toMatch(/await navigator\.clipboard/)
  })

  test('builds ahead of the press (pointer or focus) and records the ack from what happened', () => {
    expect(src).toContain('onPointerEnter={prepare}')
    expect(src).toContain('onFocusCapture={prepare}')
    expect(src).toContain('via: ackVia(result, via)')
  })

  test('a blocked tab becomes a link in the page, with the packet already copied', () => {
    expect(src).toContain('data-ask-blocked')
    expect(src).toContain('the packet is already copied')
  })
})
