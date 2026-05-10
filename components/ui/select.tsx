'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface SelectContextValue {
  value: string
  onValueChange: (v: string) => void
  open: boolean
  setOpen: (o: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const SelectContext = React.createContext<SelectContextValue>({
  value: '',
  onValueChange: () => {},
  open: false,
  setOpen: () => {},
  triggerRef: { current: null },
})

function Select({
  value,
  defaultValue,
  onValueChange,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (v: string) => void
  children: React.ReactNode
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? '')
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const active = value ?? internal

  function handleValueChange(v: string) {
    setInternal(v)
    onValueChange?.(v)
    setOpen(false)
  }

  React.useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (triggerRef.current && !triggerRef.current.closest('[data-slot="select"]')?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <SelectContext.Provider value={{ value: active, onValueChange: handleValueChange, open, setOpen, triggerRef }}>
      <div data-slot="select" className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<'button'>) {
  const { open, setOpen, triggerRef } = React.useContext(SelectContext)

  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-expanded={open}
      data-slot="select-trigger"
      onClick={() => setOpen(!open)}
      className={cn(
        'border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/50 flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      <svg className="ml-2 size-4 shrink-0 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value } = React.useContext(SelectContext)
  return <span>{value || placeholder || ''}</span>
}

function SelectContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { open } = React.useContext(SelectContext)
  if (!open) return null

  return (
    <div
      data-slot="select-content"
      className={cn(
        'border-border bg-popover text-popover-foreground absolute z-50 mt-1 max-h-60 min-w-full overflow-auto rounded-md border shadow-md',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function SelectItem({ value, className, children, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const { value: active, onValueChange } = React.useContext(SelectContext)

  return (
    <div
      role="option"
      aria-selected={active === value}
      data-slot="select-item"
      onClick={() => onValueChange(value)}
      className={cn(
        'hover:bg-accent hover:text-accent-foreground relative flex cursor-pointer items-center px-3 py-1.5 text-sm outline-none',
        active === value && 'bg-accent text-accent-foreground font-medium',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
