/**
 * What pressing "ask claude", "ask chatgpt" or "copy packet" does, apart from the buttons (docs/specs/wave-2.md §14.2):
 * copy the packet, open the agent, and say what happened. Plain functions over injected browser calls, so a test drives
 * them with a stubbed `window.open` and clipboard.
 *
 * The order is the point. Safari (and iOS) allow `window.open` only inside the user's gesture, and the same for the
 * clipboard, so neither may wait behind a fetch. When the packet was built ahead of the press (`ready`), the clipboard
 * write starts and the tab opens in the same synchronous turn as the click. When it was not, the build is awaited first
 * and the tab may be blocked; that is reported, never papered over:
 *  - the tab is opened without the `noopener` feature, because `window.open(url, '_blank', 'noopener')` returns null
 *    even when it worked, which would make a blocked tab and an open one look the same. `opener` is cleared by hand;
 *  - a blocked tab is reported as `blocked`, and the page shows the link inline instead of saying "paste it into the
 *    new tab";
 *  - the ack records what really happened (`ackVia`), not which button was pressed.
 */

import type { Packet } from '@/lib/mentor/packet'

export type Via = 'claude' | 'chatgpt' | 'copy'

/** The slice of the window `window.open` returns that the flow touches. */
export interface TabLike {
  opener: unknown
}

export interface AskDeps {
  via: Via
  /** The agent's link with its short instruction; unused for `copy`. */
  url: string
  /** The packet, when it was built before the press. */
  ready?: Packet
  /** Builds the packet now. */
  build(): Promise<Packet>
  /** `navigator.clipboard.writeText`. */
  writeText(text: string): Promise<void>
  /** `window.open(url, '_blank')`: null where the browser blocked the tab. */
  open(url: string): TabLike | null
}

export type AskResult =
  /** `copy`: the packet is on the clipboard. */
  | { status: 'copied'; packet: Packet }
  /** The packet is on the clipboard and the agent's tab is open. */
  | { status: 'opened'; packet: Packet }
  /** The packet is on the clipboard, but the browser did not open the tab: show the link. */
  | { status: 'blocked'; packet: Packet }
  /** The clipboard refused: show the packet to copy by hand (`opened` says whether a tab opened anyway). */
  | { status: 'manual'; packet: Packet; opened: boolean }
  /** The packet could not be built. */
  | { status: 'failed' }

/** Runs the clipboard write and says whether it worked: a missing clipboard throws before it returns a promise. */
const settle = async (write: () => Promise<void>): Promise<boolean> => {
  try {
    await write()
    return true
  } catch {
    return false
  }
}

function openTab(deps: AskDeps): TabLike | null {
  if (deps.via === 'copy') return null
  let tab: TabLike | null = null
  try {
    tab = deps.open(deps.url)
  } catch {
    tab = null
  }
  if (tab !== null) {
    try {
      tab.opener = null
    } catch {
      /* a tab that will not take it is still open */
    }
  }
  return tab
}

export async function askFlow(deps: AskDeps): Promise<AskResult> {
  if (deps.ready !== undefined) {
    // Inside the gesture: the clipboard write starts, then the tab opens, before anything is awaited.
    const packet = deps.ready
    const copying = settle(() => deps.writeText(packet.text))
    const tab = openTab(deps)
    const copied = await copying
    if (!copied) return { status: 'manual', packet, opened: tab !== null }
    if (deps.via === 'copy') return { status: 'copied', packet }
    return tab !== null ? { status: 'opened', packet } : { status: 'blocked', packet }
  }

  let packet: Packet
  try {
    packet = await deps.build()
  } catch {
    return { status: 'failed' }
  }
  const copied = await settle(() => deps.writeText(packet.text))
  if (!copied) return { status: 'manual', packet, opened: false }
  if (deps.via === 'copy') return { status: 'copied', packet }
  return openTab(deps) !== null ? { status: 'opened', packet } : { status: 'blocked', packet }
}

/**
 * The `via` an ack records: the agent only when its tab really opened with the packet copied. A blocked tab, a packet
 * copied by hand and a plain "copy packet" are all `copy`: the packet left the page by the clipboard, not by an agent.
 */
export function ackVia(result: Exclude<AskResult, { status: 'failed' }>, pressed: Via): Via {
  return result.status === 'opened' ? pressed : 'copy'
}

/** The sentence for the live region. */
export function askLine(result: AskResult): string {
  if (result.status === 'failed') return 'The packet could not be built. Try again.'
  if (result.status === 'manual') return 'The clipboard was not available. The packet is in a box to copy by hand.'
  const copied = `Packet copied, ${result.packet.chars.toLocaleString('en-US')} characters.`
  if (result.status === 'copied') return copied
  if (result.status === 'opened') return `${copied} Paste it into the new tab.`
  return `${copied} Your browser did not open the new tab: use the link below, then paste.`
}
