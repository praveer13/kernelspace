/**
 * The warm packet behind "ask claude / ask chatgpt / copy packet" (task CF8): a packet built when the pointer or focus
 * reaches the buttons was reused for 20 s whatever changed, so a press right after a rerun copied the old check
 * messages. The buttons are mounted in a small DOM (tests/dom/mini-dom.ts); the packet is built by the real
 * `AskPacketView` from lab run reports, so what is asserted is the text that reaches the clipboard.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import AskButtons from '../../src/components/mentor/AskButtons'
import { AskPacketView } from '../../src/components/forge/AskPacket'
import { FORGE_LABS } from '../../src/data/labs'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import type { Packet } from '../../src/lib/mentor/packet'
import { useProgress } from '../../src/lib/progress'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
const CHECK = lab.checks.find((c) => c.optional)!.id

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

/** Stubs for what leaves the page: the clipboard and the new tab, with a log in the order the calls were made. */
function leaving() {
  const log: string[] = []
  const copied: string[] = []
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        log.push('copy')
        copied.push(text)
        return Promise.resolve()
      },
    },
  })
  dom.window.open = (url: string) => {
    log.push(`open ${url.slice(0, 20)}`)
    return { opener: null }
  }
  const acks: unknown[] = []
  const original = useProgress.getState().recordHelp
  useProgress.setState({ recordHelp: ((ref: string, data: unknown) => void acks.push({ ref, data })) as never })
  return { log, copied, acks, restore: () => useProgress.setState({ recordHelp: original }) }
}

const sleep = (ms: number) => dom.act(() => new Promise((r) => setTimeout(r, ms)))
const button = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.includes(text))!
/** Click, read the log in the same turn (what was called before anything could be awaited), then let the press finish. */
async function clickAndLog(el: MiniElement, log: readonly string[] = []): Promise<string[]> {
  let seen: string[] = []
  await dom.act(async () => {
    el.click()
    seen = log.map((l) => l.split(' ')[0])
    await new Promise((r) => setTimeout(r, 20))
  })
  return seen
}

/* ---------------------------------- a rerun between warm-up and press ---------------------------------- */

describe('a press after a rerun copies the new check messages', () => {
  const row = (msg: string): CheckResult => ({ id: CHECK, label: `label of ${CHECK}`, status: 'fail', msg, ms: 1 }) as CheckResult
  const run = (msg: string): LabRunReport => ({ lab: lab.id, reference: false, abi: 2, version: 1, checks: [row(msg)], seeds: 'fresh', ms: 1 }) as LabRunReport
  const view = (msg: string) => createElement(AskPacketView, { lab, reports: [run(msg)], ladderIds: [], acks: {}, expSeed: undefined })

  test('the packet warmed on the first run is not what a press right after the second run copies', async () => {
    const out = leaving()
    const page = await dom.mount(view('OLD-MESSAGE the first run said this'))
    const copy = button(page.container, 'copy packet')
    await dom.act(() => copy.focus())
    await sleep(30)

    await page.render(view('NEW-MESSAGE the rerun said this'))
    await clickAndLog(copy)
    await dom.until(() => out.copied.length === 1)

    expect(out.copied[0]).toContain('NEW-MESSAGE')
    expect(out.copied[0]).not.toContain('OLD-MESSAGE')
    expect(out.acks).toHaveLength(1)
    await page.unmount()
    out.restore()
  })

  test('given time to rebuild, the new packet is ready and the tab opens in the click itself', async () => {
    const out = leaving()
    const page = await dom.mount(view('OLD-MESSAGE the first run said this'))
    const claude = button(page.container, 'ask claude')
    await dom.act(() => claude.focus())
    await sleep(30)
    await page.render(view('NEW-MESSAGE the rerun said this'))
    await sleep(30)

    // no await between the click and the check: the copy and the tab are already made, in that order
    const inClick = await clickAndLog(claude, out.log)
    expect(inClick).toEqual(['copy', 'open'])
    await dom.until(() => out.acks.length === 1)
    expect(out.copied[0]).toContain('NEW-MESSAGE')
    expect(out.copied[0]).not.toContain('OLD-MESSAGE')
    await page.unmount()
    out.restore()
  })

  test('with nothing changed, the warm packet is still used: the tab opens in the click', async () => {
    const out = leaving()
    const page = await dom.mount(view('SAME-MESSAGE'))
    const claude = button(page.container, 'ask claude')
    await dom.act(() => claude.focus())
    await sleep(30)
    expect(await clickAndLog(claude, out.log)).toEqual(['copy', 'open'])
    await dom.until(() => out.acks.length === 1)
    await page.unmount()
    out.restore()
  })
})

/* ---------------------------------- the other inputs ---------------------------------- */

describe('every input of the packet keys the warm one', () => {
  const packetOf = (text: string): Packet => ({ text, chars: text.length })
  const buttons = (props: { build: () => Promise<Packet>; packetRef?: string; label?: string; arm?: 'ladder' | 'packet' }) =>
    createElement(AskButtons, { packetRef: (props.packetRef ?? 'packet:lesson/t5.l4') as never, label: props.label ?? 'lesson t5.l4', build: props.build, copyPacket: true, ...(props.arm ? { arm: props.arm } : {}) })

  /** Warm with `first`, change to `second`, press "copy packet", and say what was copied and what the ack recorded. */
  async function pressAfter(first: Parameters<typeof buttons>[0], second: Parameters<typeof buttons>[0], between?: () => Promise<void>) {
    const out = leaving()
    const page = await dom.mount(buttons(first))
    const copy = button(page.container, 'copy packet')
    await dom.act(() => copy.focus())
    await sleep(10)
    await page.render(buttons(second))
    await between?.()
    await clickAndLog(copy)
    await dom.until(() => out.acks.length === 1)
    await page.unmount()
    out.restore()
    return { copied: out.copied[0], ack: out.acks[0] as { ref: string; data: { arm?: string } } }
  }

  test('a new build function (the page re-read its reports or lesson)', async () => {
    const r = await pressAfter({ build: async () => packetOf('first') }, { build: async () => packetOf('second') })
    expect(r.copied).toBe('second')
  })

  test('a different lesson or lab, so a different ack', async () => {
    const r = await pressAfter({ build: async () => packetOf('lesson one'), packetRef: 'packet:lesson/t5.l4' }, { build: async () => packetOf('lesson two'), packetRef: 'packet:lesson/t5.l5', label: 'lesson t5.l5' })
    expect(r.copied).toBe('lesson two')
    expect(r.ack.ref).toBe('packet:lesson/t5.l5')
  })

  test('a different arm of the help experiment is the arm the ack records', async () => {
    const build = async () => packetOf('same text')
    const r = await pressAfter({ build, arm: 'ladder' }, { build, arm: 'packet' })
    expect(r.ack.data.arm).toBe('packet')
  })

  test('a ledger event between warm-up and press (the notes the packet reads)', async () => {
    let notes = 'note before'
    // one stable build function: only the ledger changes, as when the learner answers an item
    const build = async () => packetOf(notes)
    const r = await pressAfter({ build }, { build }, async () => {
      notes = 'note after'
      await dom.act(() => useProgress.setState((s) => ({ aggregate: { ...s.aggregate } })))
    })
    expect(r.copied).toBe('note after')
  })
})
