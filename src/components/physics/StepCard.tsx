/**
 * StepCard: one engine step through the step card (docs/specs/s5.md §3.2, §8.3; S5-11), drawn as a bar per card (the
 * fixed term, the link term and the larger of memory and compute, which is what the step pays) with the terms beside
 * it, and a `SimMirror` table of the same numbers. The list under each bar is the bar's legend (a swatch in the bar's
 * colour by each term's name), and the bar's label reads its segments out. It shows a card's arithmetic, never a split
 * as fact: the caller labels a fitted card "this fit's" (S5-D5).
 *
 * `Val` is how the physics tab prints a report value: the number, formatted, inside a span whose `data-report` names
 * where it came from (`report:workedExamples.0.card.memS`), so tests/changes/physics-tab.test.ts can resolve every
 * number on the tab back to its file.
 */
import SimMirror from '@/components/sims/SimMirror'
import { fmtNum } from '@/lib/physics-format'
import type { StepCard as CardTerms } from '@/lib/world/physics/types'

interface ValProps {
  /** where the value lives, `<file>:<path>` (file: report, decisions or controls) */
  at: string
  v: number
  /** printed value = v × scale (1000 turns seconds into ms, 100 a fraction into percent) */
  scale?: number
  digits?: number
  /** appended as written, so pass ' ms' or '×' */
  unit?: string
  sign?: boolean
}

export function Val({ at, v, scale = 1, digits = 1, unit = '', sign = false }: ValProps) {
  return (
    <span data-report={at} data-scale={scale}>
      {fmtNum(v * scale, digits, sign)}
      {unit}
    </span>
  )
}

/** One card in the comparison: its label, its terms and, when they come from a report, where. */
export interface StepCardColumn {
  label: string
  card: CardTerms
  /** the card's path in its file, e.g. `report:workedExamples.0.napkin` */
  at: string
}

const TERMS = [
  { key: 'fixedS', name: 'fixed', what: 'layers × t_layer + seqs × t_seq', tone: 'bg-text-3' },
  { key: 'linkS', name: 'link', what: 'all-reduce bytes ÷ β', tone: 'bg-info' },
  { key: 'memS', name: 'memory', what: 'bytes ÷ (η_m × BW)', tone: 'bg-accent' },
  { key: 'flopS', name: 'compute', what: 'FLOPs ÷ (η_f × F)', tone: 'bg-amber' },
] as const

const ms = (s: number) => `${fmtNum(s * 1000, 3)} ms`

export default function StepCard({ id, caption, columns }: { id: string; caption: string; columns: StepCardColumn[] }) {
  const longest = Math.max(...columns.map((c) => c.card.stepS))
  return (
    <figure className="space-y-4" data-step-card>
      <figcaption className="font-mono text-[11px] text-text-3">{caption}</figcaption>
      {columns.map(({ label, card, at }) => {
        const paid = card.bound === 'mem' ? 'memS' : 'flopS'
        const bar = TERMS.filter((t) => t.key === 'fixedS' || t.key === 'linkS' || t.key === paid)
        return (
          <div key={label} className="space-y-1.5">
            <p className="font-mono text-[12px] text-text-1">
              {label}: <Val at={`${at}.stepS`} v={card.stepS} scale={1000} digits={3} unit=" ms" /> ·{' '}
              {card.bound === 'mem' ? 'memory-bound' : 'compute-bound'}
            </p>
            <div
              role="img"
              aria-label={`${label}: ${ms(card.stepS)}, ${card.bound === 'mem' ? 'memory' : 'compute'}-bound; ${bar.map((t) => `${t.name} ${ms(card[t.key])}`).join(', ')}`}
              aria-describedby={id}
              className="flex h-3 overflow-hidden rounded-sm bg-surface-2"
              style={{ width: `${(card.stepS / longest) * 100}%` }}
            >
              {bar.map((t) => (
                <span key={t.key} className={t.tone} style={{ width: `${(card[t.key] / card.stepS) * 100}%` }} />
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-text-2 sm:grid-cols-4">
              {TERMS.map((t) => (
                <div key={t.key} className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <dt className="text-text-3">
                    <span aria-hidden="true" className={`mr-1 inline-block size-2 rounded-[2px] ${t.tone}`} />
                    {t.name}
                  </dt>
                  <dd>
                    <Val at={`${at}.${t.key}`} v={card[t.key]} scale={1000} digits={3} unit=" ms" />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )
      })}
      <p className="font-mono text-[11px] text-text-3">
        step = fixed + link + max(memory, compute); {TERMS.map((t) => `${t.name} = ${t.what}`).join('; ')}.
      </p>
      <SimMirror
        id={id}
        table={{
          caption,
          columns: ['term', ...columns.map((c) => c.label)],
          rows: [
            ...TERMS.map((t) => [t.name, ...columns.map((c) => ms(c.card[t.key]))]),
            ['step', ...columns.map((c) => ms(c.card.stepS))],
            ['bound', ...columns.map((c) => (c.card.bound === 'mem' ? 'memory' : 'compute'))],
          ],
        }}
      />
    </figure>
  )
}
