import { useRef } from 'react'
import { useInView } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ProgressRingProps {
  /** 0..100 */
  value: number
  size?: 28 | 64 | 120 | number
  /** Arc color — usually a track color */
  color?: string
  /** Show center mono % label */
  showLabel?: boolean
  className?: string
  strokeWidth?: number
}

/**
 * SVG donut progress ring (design.md §9.7).
 * Track-color arc on surface-3 track, rounded caps, center mono %.
 * Animates stroke-dashoffset 800ms ease-out-expo when scrolled into view
 * or when the value changes.
 */
export default function ProgressRing({
  value,
  size = 64,
  color = '#3EF2A4',
  showLabel = true,
  className,
  strokeWidth,
}: ProgressRingProps) {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  // Stays 0 until scrolled into view; the CSS transition animates the jump to `value`.
  const display = inView ? value : 0

  const sw = strokeWidth ?? Math.max(2.5, size / 12)
  const r = (size - sw) / 2
  const c = 2 * Math.PI * r

  const clamped = Math.min(100, Math.max(0, display))
  const offset = c - (clamped / 100) * c

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
      role="img"
      aria-label={`Progress: ${Math.round(value)}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#182130"
        strokeWidth={sw}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(.16,1,.3,1)' }}
      />
      {showLabel && size >= 56 && (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="#E8EEF6"
          fontSize={size >= 120 ? 22 : 14}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontWeight={500}
        >
          {Math.round(value)}%
        </text>
      )}
    </svg>
  )
}
