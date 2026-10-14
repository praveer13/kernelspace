import Progress from '@/pages/Progress'

/**
 * /me — the Mirror's route (wave-3.md §2.2). Until 3b-06 rebuilds the page, /me renders today's Progress page,
 * and App.tsx routes it through `lazyMotion` as Progress was. 3b-06 replaces this body and moves /me to plain `lazy`.
 */
export default function Me() {
  return <Progress />
}
