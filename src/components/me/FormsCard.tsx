/**
 * /me, the track forms' mount (wave-3.md §2.3, §12.6). A lazy stub: 3b-06b mounts it after the competence statements
 * so the order of the page is settled, and 3b-19 fills it (forms A, B and C per track, opt-in, measurement only). It
 * renders an empty, hidden marker until then, so no learner sees a card that does nothing.
 */
export default function FormsCard() {
  return <div hidden data-forms-card />
}
