/**
 * The play registry (docs/specs/wave-2.md §2.3): the one place a play id turns into a component. `/play/:playId`
 * and the lesson's play block both resolve through it, so a play is added here and nowhere else.
 *
 * Three outcomes, so content can be placed before the play ships:
 * - registered: a lazy component, loaded when its block or page mounts;
 * - pending (`PENDING_PLAYS`): promised by a later task. The block renders nothing, so content can place it
 *   before the play ships. 2b-11 registered 'scheduler', 3b-01 'tiling-cube' and 3b-02 'eplb', so the list is empty now;
 * - unknown: a typo or a stale id. The block and the page say so with an error card.
 *
 * An id registered is removed from PENDING_PLAYS; tests/plays/registry.test.ts fails while an id is in both, so
 * the list cannot go stale.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** What every play component takes: inline in a lesson, or on its own page. */
export interface PlayComponentProps {
  mode: 'embed' | 'page'
}

export interface PlayEntry {
  Component: LazyExoticComponent<ComponentType<PlayComponentProps>>
  /** One or two sentences under the page heading on `/play/<id>`. */
  intro: string
}

export const PLAY_REGISTRY: Readonly<Record<string, PlayEntry>> = {
  'block-placement': {
    Component: lazy(() => import('@/components/play/block-placement/Play')),
    intro: 'Place memory blocks by hand against a hidden reference policy, then compose a policy of your own.',
  },
  scheduler: {
    Component: lazy(() => import('@/components/play/scheduler/Play')),
    intro: 'Schedule a minute of real serving traffic by hand against a hidden reference scheduler, then compose a policy of your own.',
  },
  'tiling-cube': {
    Component: lazy(() => import('@/components/play/tiling-cube/Play')),
    intro: 'Predict the arithmetic intensity of a matmul tile, then step its size, depth, raster order and precision through three linked faces and a table: six levels, from counting the cube to FlashAttention.',
  },
  eplb: {
    Component: lazy(() => import('@/components/play/eplb/Play')),
    intro: 'Predict how badly round-robin placement skews a mixture-of-experts layer, then replicate the hot experts and place every copy on a GPU by hand against a hidden reference, DeepSeek EPLB.',
  },
}

/** Play ids that a later task registers (spec §2.3). Their blocks render nothing until then. */
export const PENDING_PLAYS: readonly string[] = []

export type PlayResolution =
  | { kind: 'play'; id: string; entry: PlayEntry }
  | { kind: 'pending'; id: string }
  | { kind: 'unknown'; id: string }

/** Own-property lookups only: an id like "constructor" is unknown, not a function from the prototype. */
export function resolvePlay(id: string): PlayResolution {
  if (Object.hasOwn(PLAY_REGISTRY, id)) return { kind: 'play', id, entry: PLAY_REGISTRY[id] }
  if (PENDING_PLAYS.includes(id)) return { kind: 'pending', id }
  return { kind: 'unknown', id }
}
