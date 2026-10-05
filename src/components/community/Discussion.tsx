/**
 * giscus discussion, click to load (Wave 1, docs/specs/wave-1.md §14.3). Nothing is requested from giscus.app
 * or GitHub until the learner clicks, or has chosen "always load on this device" (`ks:giscus`).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/Button'
import {
  GISCUS_SRC,
  giscusAttributes,
  readAlwaysLoad,
  writeAlwaysLoad,
  type DiscussionKind,
} from '@/data/community'

export interface DiscussionProps {
  /** Becomes the giscus term `<kind>:<id>`; lessons map to one category, labs to another. */
  kind: DiscussionKind
  id: string
}

function Thread({ kind, id }: DiscussionProps) {
  const attrs = giscusAttributes(kind, id)
  const [always, setAlways] = useState(readAlwaysLoad)
  // A saved preference is the earlier consent; otherwise the click is.
  const [loaded, setLoaded] = useState(always)
  const host = useRef<HTMLDivElement>(null)
  const checkId = useId()
  const visible = attrs !== null

  useEffect(() => {
    const el = host.current
    const a = giscusAttributes(kind, id)
    if (!loaded || !el || !a) return
    const script = document.createElement('script')
    script.src = GISCUS_SRC
    for (const [k, v] of Object.entries(a)) script.setAttribute(k, v)
    script.crossOrigin = 'anonymous'
    script.async = true
    el.appendChild(script)
    return () => {
      el.replaceChildren()
    }
  }, [loaded, visible, kind, id])

  if (!visible) return null

  return (
    <section aria-label="Discussion" className="mt-10 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {!loaded && (
          <Button variant="secondary" icon={MessageSquare} onClick={() => setLoaded(true)}>
            Load the discussion (GitHub via giscus, a third party)
          </Button>
        )}
        <label htmlFor={checkId} className="flex items-center gap-2 text-sm text-text-2">
          <input
            id={checkId}
            type="checkbox"
            checked={always}
            onChange={(e) => {
              setAlways(e.target.checked)
              writeAlwaysLoad(e.target.checked)
            }}
          />
          Always load on this device
        </label>
      </div>
      {loaded && <div ref={host} data-discussion={`${kind}:${id}`} className="mt-4" />}
    </section>
  )
}

export default function Discussion(props: DiscussionProps) {
  // A new thread starts unloaded: a click on one lesson is not consent for the next.
  return <Thread key={`${props.kind}:${props.id}`} {...props} />
}
