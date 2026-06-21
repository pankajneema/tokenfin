import { cn } from '@/lib/utils'

interface CardProps {
  children:   React.ReactNode
  className?: string
  padding?:   'none' | 'sm' | 'md' | 'lg'
}

const paddings = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' }

export function Card({ children, className, padding = 'md' }: CardProps) {
  return (
    <div className={cn('card', paddings[padding], className)}>
      {children}
    </div>
  )
}

interface CardHeaderProps {
  title:      string
  subtitle?:  string
  action?:    React.ReactNode
  className?: string
}

export function CardHeader({ title, subtitle, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between mb-4', className)}>
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{title}</h2>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--fg-muted)' }}>{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0 ml-4">{action}</div>}
    </div>
  )
}
