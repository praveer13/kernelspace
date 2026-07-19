import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Record<Variant, string> = {
  // design.md §9.4 — accent bg, #06251A text, r-md, SG 600 15px, press scale .97
  primary:
    'bg-accent text-accent-foreground font-display font-semibold text-[15px] hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(62,242,164,.25)]',
  secondary:
    'border border-line bg-surface-2 text-text-1 font-medium text-[15px] hover:border-line-bright',
  ghost: 'text-text-2 font-medium text-[15px] hover:text-accent',
  destructive:
    'border border-danger/60 text-danger font-medium text-[15px] hover:bg-danger/10',
}

const BASE =
  'relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-md px-5 py-3 transition-all duration-150 ease-snap active:scale-[.97] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

interface CommonProps {
  variant?: Variant
  icon?: LucideIcon
  className?: string
  children?: React.ReactNode
}

/** Primary hover gets a 300ms grad-brand sweep (design.md §6). */
function Sweep() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -translate-x-full bg-grad-brand opacity-90 transition-transform duration-300 ease-out-expo group-hover/ks:translate-x-0"
    />
  )
}

export const Button = forwardRef<
  HTMLButtonElement,
  CommonProps & ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ variant = 'primary', icon: Icon, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(BASE, 'group/ks', VARIANTS[variant], className)}
      {...props}
    >
      {variant === 'primary' && <Sweep />}
      {Icon && <Icon size={16} strokeWidth={1.75} className="relative" />}
      <span className="relative">{children}</span>
    </button>
  )
})

export function LinkButton({
  variant = 'primary',
  icon: Icon,
  className,
  children,
  to,
}: CommonProps & { to: string }) {
  return (
    <Link to={to} className={cn(BASE, 'group/ks', VARIANTS[variant], className)}>
      {variant === 'primary' && <Sweep />}
      {Icon && <Icon size={16} strokeWidth={1.75} className="relative" />}
      <span className="relative">{children}</span>
    </Link>
  )
}
