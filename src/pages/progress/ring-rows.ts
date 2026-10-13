import type { Part, Rings } from '@/lib/economy'
import type { AmberRing } from '@/lib/learner/ring-recall'

/** One line of a ring's checklist: what is done of what, and where to go to do more. */
export interface RingRow {
  key: string
  label: string
  count: string
  done: boolean
  to: string
  action: string
}

export interface RingSection {
  ring: AmberRing
  earned: boolean
  rows: RingRow[]
}

const forge = (p: Part, all: readonly string[]): string => `/forge/${p.missing[0] ?? all[0]}`

/** The checklist link of a lesson line: the first lesson still open, else the curriculum. */
const lessonTo = (p: Part): string => (p.missing[0] ? `/lesson/${p.missing[0]}` : '/curriculum')

function partRow(key: string, label: string, p: Part, to: string, next: string): RingRow {
  const done = p.missing.length === 0
  return { key, label, count: `${p.done}/${p.total}`, done, to, action: done ? 'open' : next }
}

/**
 * Every ring's checklist, with the page each line points to. RING 2's three lines are unchanged from Wave 1;
 * RING 1, RING 0 and ROOT follow wave-2.md §6.4. `coldKnown` is whether the ledger's cold checks have been read:
 * until then ROOT's last line says so instead of showing a count of zero.
 */
export function ringSections(rings: Rings, coldKnown: boolean): RingSection[] {
  const { ring2, ring1, ring0, root } = rings
  const r2Drills = ring2.rDrills
  const rDrillsDone = r2Drills.done === r2Drills.total
  const cold = root.cold
  return [
    {
      ring: 'RING 2',
      earned: ring2.earned,
      rows: [
        {
          key: 'r-drills',
          label: 'R drills',
          count: `${r2Drills.done}/${r2Drills.total}`,
          done: rDrillsDone,
          to: r2Drills.missing[0] ? `/forge/${r2Drills.missing[0]}` : '/forge',
          action: rDrillsDone ? 'open' : 'next drill',
        },
        {
          key: 'lab01',
          label: 'Lab 01',
          count: `${ring2.lab01.checks.done}/${ring2.lab01.checks.total} checks`,
          done: ring2.lab01.done,
          to: '/forge/rust-allocator',
          action: ring2.lab01.done ? 'open' : 'continue',
        },
        {
          key: 'tickets',
          label: 'Tickets',
          count: `${ring2.tickets.done}/${ring2.tickets.total}`,
          done: ring2.tickets.done === ring2.tickets.total,
          to: ring2.tickets.missing[0] ? `/lesson/${ring2.tickets.missing[0]}` : '/curriculum',
          action: ring2.tickets.done === ring2.tickets.total ? 'open' : 'next ticket',
        },
      ],
    },
    {
      ring: 'RING 1',
      earned: ring1.earned,
      rows: [
        partRow('r-drills', 'R drills 6–10', ring1.rDrills, forge(ring1.rDrills, ['rust-zero-r6']), 'next drill'),
        partRow('labs', 'Labs 04–05', ring1.labs, forge(ring1.labs, ['mpmc-queue']), 'next lab'),
        partRow('tickets', 'Tickets T3–T4', ring1.tickets, lessonTo(ring1.tickets), 'next ticket'),
      ],
    },
    {
      ring: 'RING 0',
      earned: ring0.earned,
      rows: [
        partRow('labs', 'Labs 02, 03, 06, 07', ring0.labs, forge(ring0.labs, ['kv-block-manager']), 'next lab'),
        partRow('tickets', 'Tickets T5', ring0.tickets, lessonTo(ring0.tickets), 'next ticket'),
      ],
    },
    {
      ring: 'ROOT',
      earned: root.earned,
      rows: [
        {
          key: 'lab08',
          label: 'Lab 08',
          count: `${root.lab08.checks.done}/${root.lab08.checks.total} checks`,
          done: root.lab08.done,
          to: '/forge/xgrammar-lite',
          action: root.lab08.done ? 'open' : 'continue',
        },
        partRow('fleet-runs', 'Fleet Week I–II with your modules', root.fleetRuns, '/week', 'next act'),
        partRow('acts', 'Fleet Week acts passed', root.acts, '/week', 'next act'),
        {
          key: 'daily',
          label: 'Daily incidents',
          count: `${Math.min(root.daily.done, root.daily.total)}/${root.daily.total}`,
          done: root.daily.done >= root.daily.total,
          to: '/daily',
          action: root.daily.done >= root.daily.total ? 'open' : 'daily incident',
        },
        partRow('tickets', 'Tickets T6–T7', root.tickets, lessonTo(root.tickets), 'next ticket'),
        {
          key: 'cold',
          label: '30-day cold checks',
          count: coldKnown
            ? `${cold.correct}/${cold.n} right, need ${cold.needN} at ${Math.round(cold.needRate * 100)} %`
            : 'counting',
          done: cold.met,
          to: '/today',
          action: cold.met ? 'open' : 'open Today',
        },
      ],
    },
  ]
}
