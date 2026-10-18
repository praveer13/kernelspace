/**
 * world/shift-note — what the shift says about a finished incident (docs/specs/wave-3.md §16.6, task 3s-08): the handoff
 * note read before the next alert and the summary after the third. Pure functions of what the debrief already showed;
 * page-safe and deterministic, like `world/shift`. Split from it in the 3s fix round (TF3): the drills page imports
 * `world/shift` for `recordShift` alone, and a module two routes share is one chunk that both download whole, so the
 * notes' text no longer rides along with the drills.
 */

import { burnMinutes } from './daily'
import { FAULT_SHORT, FIXES, LIMIT_MINUTES, fixFor } from './incident-spec'
import { SHIFT_LENGTH, suspectHeld, type ShiftFacts, type ShiftNote } from './shift'

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The diagnosis line of the note: it blames a suspect only when one was held. */
const DIAGNOSIS: Record<ReturnType<typeof suspectHeld>, string> = {
  fault: 'Diagnosis: the suspect you held was the fault.',
  wrong: 'Diagnosis: the suspect you held was not the fault.',
  none: 'Diagnosis: no suspect was held, so none was ruled in or out.',
}

/**
 * The note the on-call hands to the next one, after incident `index` (0-based) of `total`: what it was, how it ended, what
 * was changed, and the one habit the debrief measured. It claims nothing about the next incident beyond the fact that its
 * fault is drawn independently of this one (`shiftIncidents`), so it can be read before the next alert without a hint.
 */
export function handoffNote(done: ShiftFacts, index: number, total: number = SHIFT_LENGTH): ShiftNote {
  const taken = done.probes.length
  const lines = [
    `Closed: incident ${index + 1} of ${total}, "${FAULT_SHORT[done.fault]}".`,
    done.recovered
      ? `Status: recovered ${done.end - done.alert} min after the alert, with ${burnMinutes(done.burn)} burn-minutes against the expert's ${burnMinutes(done.expertBurn)}.`
      : `Status: not recovered within the ${LIMIT_MINUTES}-minute limit, with ${burnMinutes(done.burn)} burn-minutes against the expert's ${burnMinutes(done.expertBurn)}.`,
    done.fixed
      ? `Changed: ${FIXES[fixFor(done.fault)].short}, which reverts the fault.`
      : done.fix
        ? `Changed: ${FIXES[done.fix].short}, which was not the fix for this fault. The fault was left in place.`
        : 'Changed: nothing. No fix went in.',
    DIAGNOSIS[suspectHeld(done)],
    taken === 0
      ? 'Probes: none taken.'
      : done.streetlight > 0
        ? `Probes: ${plural(taken, 'probe')}, ${done.streetlight} of them Streetlight (every suspect still standing predicted the same reading). Before the next probe, ask which suspects it would separate.`
        : `Probes: ${plural(taken, 'probe')}, none of them Streetlight.`,
    'Next: a new incident on a new fleet. Its fault is drawn independently of this one, so nothing above says what it is. Start from the alert.',
  ]
  return { heading: `Handoff note: incident ${index + 1} to ${index + 2}`, lines }
}

/** The shift in numbers, after its last incident: one line each, then the totals. */
export function shiftSummary(done: readonly ShiftFacts[]): ShiftNote {
  const lines = done.map(
    (d, i) =>
      `Incident ${i + 1}, "${FAULT_SHORT[d.fault]}": ${d.diagnosed ? 'named' : 'not named'}, ${d.recovered ? `recovered after ${d.end - d.alert} min` : 'not recovered'}, ${burnMinutes(d.burn)} burn-minutes (the expert's ${burnMinutes(d.expertBurn)}).`,
  )
  const sum = (pick: (d: ShiftFacts) => number): number => done.reduce((a, d) => a + pick(d), 0)
  lines.push(
    `Shift: ${done.filter((d) => d.diagnosed).length} of ${done.length} named, ${done.filter((d) => d.recovered).length} of ${done.length} recovered, ${burnMinutes(sum((d) => d.burn))} burn-minutes (the expert's ${burnMinutes(sum((d) => d.expertBurn))}), ${plural(sum((d) => d.streetlight), 'Streetlight probe')}.`,
  )
  return { heading: 'Shift summary', lines }
}
