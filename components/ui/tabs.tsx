'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface TabsContextValue {
  active: string
  setActive: (v: string) => void
}

const TabsContext = React.createContext<TabsContextValue>({ active: '', setActive: () => {} })

function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? '')
  const active = value ?? internal

  function setActive(v: string) {
    setInternal(v)
    onValueChange?.(v)
  }

  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div data-slot="tabs" className={cn('flex flex-col', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

function TabsList({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="tabs-list"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-9 items-center justify-start rounded-lg p-1 gap-1',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ value, className, children, ...props }: React.ComponentProps<'button'> & { value: string }) {
  const { active, setActive } = React.useContext(TabsContext)
  const isActive = active === value

  return (
    <button
      type="button"
      role="tab"
      data-slot="tabs-trigger"
      data-state={isActive ? 'active' : 'inactive'}
      onClick={() => setActive(value)}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-all whitespace-nowrap disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'hover:bg-background/50 hover:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function TabsContent({ value, className, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const { active } = React.useContext(TabsContext)
  if (active !== value) return null

  return (
    <div
      data-slot="tabs-content"
      data-state="active"
      className={cn('mt-2', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
