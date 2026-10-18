import { SHIFT_LENGTH } from '@/lib/world/shift'

/**
 * What /daily needs for the On-Call pilot's shift (docs/specs/wave-3.md §16.6, 3s-08), in one module the page loads with
 * `import()` only when the URL asks for a shift (`wants-shift`). An ordinary /daily visit never downloads it: the shift
 * logic (`world/shift`), the note card and the shift's markup were about 3.9 KB gzip on every visit before TF3
 * (3s-08 m2, 3s-09 m1).
 */
export { SHIFT_LENGTH, recordShift, shiftIncidents } from '@/lib/world/shift'
export { CarriedNote, ShiftDebrief, ShiftHead, ShiftIntro } from './ShiftParts'

/** What the live region says when the shift moves from incident `step + 1` to the next (0-based `step`). */
export const nextAnnouncement = (step: number): string =>
  `Incident ${step + 2} of ${SHIFT_LENGTH}. The handoff note from incident ${step + 1} is above the alert once it opens.`
