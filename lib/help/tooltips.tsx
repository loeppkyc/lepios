'use client'

import { useState } from 'react'

export function PageHelp({ title, body }: { title: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-[var(--color-text-muted)] font-ui"
      >
        <span className="text-[0.6rem]">{open ? '▾' : '▸'}</span>
        About {title}
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-[var(--color-text-muted)] leading-relaxed">
          {body}
        </div>
      )}
    </div>
  )
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group cursor-help">
      <span className="text-[var(--color-text-muted)] text-xs select-none">ℹ️</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
        w-56 rounded-[var(--radius-sm)] border border-[var(--color-border)]
        bg-[var(--color-overlay)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]
        opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
        {text}
      </span>
    </span>
  )
}
