import { useMemo } from 'react'

/** One series as a polyline. `role="img"` with `label`; `describedBy` is the id of the grid's SimMirror table. */
export function Sparkline({ values, color, label, describedBy }: { values: number[]; color: string; label: string; describedBy?: string }) {
  const d = useMemo(() => {
    if (values.length < 2) return ''
    const max = Math.max(...values, 1e-9)
    const min = Math.min(...values)
    return values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${34 - ((v - min) / Math.max(1e-9, max - min)) * 30}`)
      .join(' ')
  }, [values])
  if (!d) return <div className="h-9" role="img" aria-label={label} aria-describedby={describedBy} />
  return (
    <svg viewBox="0 0 100 36" className="mt-1 h-9 w-full" preserveAspectRatio="none" role="img" aria-label={label} aria-describedby={describedBy}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}
