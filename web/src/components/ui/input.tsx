import { cn } from '@/lib/utils'
import { useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:   string
  error?:   string
  hint?:    string
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const autoId  = useId()
  const inputId = id ?? (label ? `${label.toLowerCase().replace(/\s+/g, '-')}-${autoId}` : autoId)
  const msgId   = `${inputId}-msg`
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="label mb-1 block">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? msgId : undefined}
        className={cn(
          'input w-full',
          error && 'border-[var(--red)] focus:ring-[var(--red)]/30',
          className
        )}
        {...props}
      />
      {error && <p id={msgId} role="alert" className="mt-1 text-xs text-[var(--red)]">{error}</p>}
      {!error && hint && <p id={msgId} className="mt-1 text-xs text-[var(--fg-tertiary)]">{hint}</p>}
    </div>
  )
}
