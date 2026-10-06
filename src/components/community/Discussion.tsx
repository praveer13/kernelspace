/**
 * giscus discussion, click to load (Wave 1, docs/specs/wave-1.md §14.3). Scaffold stub (B1): the props
 * are final and nothing is requested from a third party. C16 lands the button and the script.
 */

export interface DiscussionProps {
  /** Becomes the giscus term `<kind>:<id>`; lessons map to one category, labs to another. */
  kind: 'lesson' | 'lab'
  id: string
}

export default function Discussion({ kind, id }: DiscussionProps) {
  return <div hidden data-discussion={`${kind}:${id}`} />
}
