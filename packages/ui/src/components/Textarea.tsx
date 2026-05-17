import * as React from 'react'
import { cn } from '../utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full rounded-md border border-[var(--p-border)] bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-[var(--p-text-4)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--p-accent)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
