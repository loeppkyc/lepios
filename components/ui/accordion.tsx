'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// Lightweight Accordion — no Radix dependency, matches shadcn/ui API surface.
// Single-item expand/collapse. For the synthesis page's debate cards.

interface AccordionContextValue {
  openItems: Set<string>
  toggle: (value: string) => void
  type: 'single' | 'multiple'
}

const AccordionContext = React.createContext<AccordionContextValue>({
  openItems: new Set(),
  toggle: () => {},
  type: 'multiple',
})

function Accordion({
  type = 'multiple',
  defaultValue,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  type?: 'single' | 'multiple'
  defaultValue?: string
}) {
  const [openItems, setOpenItems] = React.useState<Set<string>>(() => {
    if (defaultValue) return new Set([defaultValue])
    return new Set()
  })

  function toggle(value: string) {
    setOpenItems((prev) => {
      const next = new Set(prev)
      if (next.has(value)) {
        next.delete(value)
      } else {
        if (type === 'single') next.clear()
        next.add(value)
      }
      return next
    })
  }

  return (
    <AccordionContext.Provider value={{ openItems, toggle, type }}>
      <div data-slot="accordion" className={cn('divide-y divide-border', className)} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  )
}

interface AccordionItemContextValue {
  value: string
  isOpen: boolean
}

const AccordionItemContext = React.createContext<AccordionItemContextValue>({
  value: '',
  isOpen: false,
})

function AccordionItem({
  value,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { value: string }) {
  const { openItems } = React.useContext(AccordionContext)
  const isOpen = openItems.has(value)

  return (
    <AccordionItemContext.Provider value={{ value, isOpen }}>
      <div
        data-slot="accordion-item"
        data-state={isOpen ? 'open' : 'closed'}
        className={cn('border-b border-border last:border-b-0', className)}
        {...props}
      >
        {children}
      </div>
    </AccordionItemContext.Provider>
  )
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<'button'>) {
  const { value, isOpen } = React.useContext(AccordionItemContext)
  const { toggle } = React.useContext(AccordionContext)

  return (
    <button
      type="button"
      data-slot="accordion-trigger"
      data-state={isOpen ? 'open' : 'closed'}
      aria-expanded={isOpen}
      onClick={() => toggle(value)}
      className={cn(
        'flex w-full items-center justify-between py-2 text-left text-sm font-medium transition-all',
        'text-[var(--color-text-primary)] hover:text-[var(--color-text-muted)]',
        className
      )}
      {...props}
    >
      {children}
      <span
        className={cn(
          'ml-2 shrink-0 text-xs text-[var(--color-text-disabled)] transition-transform duration-200',
          isOpen ? 'rotate-180' : 'rotate-0'
        )}
        aria-hidden
      >
        ▾
      </span>
    </button>
  )
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { isOpen } = React.useContext(AccordionItemContext)

  if (!isOpen) return null

  return (
    <div
      data-slot="accordion-content"
      data-state="open"
      className={cn('pb-3 text-sm text-[var(--color-text-muted)]', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
