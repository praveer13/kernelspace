import type { ReactNode } from 'react'
import { MotionConfig } from 'framer-motion'

/**
 * Wraps a lazy page that imports framer-motion so its animations honour the OS reduced-motion
 * setting (PLAN-100X §7.3). The entry chunk must never import this file: App.tsx loads it through
 * `lazyMotion`, next to the page chunk that already pulls framer-motion in.
 */
export function MotionScope({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
