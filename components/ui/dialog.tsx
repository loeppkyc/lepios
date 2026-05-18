'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true">
      {children}
    </div>
  )
}

function DialogTrigger({
  onClick,
  children,
  asChild,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(
      children as React.ReactElement<{ onClick?: React.MouseEventHandler }>,
      { onClick }
    )
  }
  return (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DialogClose({ children, onClick, ...props }: React.ComponentProps<'button'>) {
  return (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}

function DialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('fixed inset-0 z-50 bg-black/80', className)} {...props} />
}

function DialogContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <DialogOverlay />
      <div
        className={cn(
          'bg-background relative z-50 w-full max-w-lg rounded-lg border p-6 shadow-lg',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-lg leading-none font-semibold', className)} {...props} />
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
}
