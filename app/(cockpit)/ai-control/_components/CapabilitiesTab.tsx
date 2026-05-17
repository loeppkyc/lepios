'use client'

import type { Capability } from './AIControlShell'

const ENFORCEMENT_COLORS: Record<string, string> = {
  log_only: 'text-[var(--color-text-muted)] bg-[var(--color-surface)]',
  allow: 'text-emerald-400 bg-emerald-400/10',
  block: 'text-red-400 bg-red-400/10',
  require_approval: 'text-yellow-400 bg-yellow-400/10',
}

function enforcementStyle(e: string | null) {
  if (!e) return 'text-[var(--color-text-muted)]'
  return ENFORCEMENT_COLORS[e] ?? 'text-[var(--color-text-muted)]'
}

export function CapabilitiesTab({ capabilities }: { capabilities: Capability[] }) {
  if (!capabilities.length) {
    return (
      <p className="font-[var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-muted)]">
        No capabilities found in registry.
      </p>
    )
  }

  const byDomain = capabilities.reduce<Record<string, Capability[]>>((acc, c) => {
    const d = c.domain ?? 'other'
    ;(acc[d] ??= []).push(c)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(byDomain).map(([domain, caps]) => (
        <div key={domain}>
          <h3 className="mb-2 font-[var(--font-ui)] text-[length:var(--text-small)] font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            {domain}
          </h3>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['Capability', 'Description', 'Enforcement', 'Destructive'].map((h) => (
                  <th
                    key={h}
                    className="pb-2 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {caps.map((c) => (
                <tr
                  key={c.capability}
                  className="border-b border-[var(--color-border)] border-opacity-40 hover:bg-[var(--color-surface)]"
                >
                  <td className="py-1 pr-4 font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-primary)] whitespace-nowrap">
                    {c.capability}
                  </td>
                  <td className="py-1 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-secondary)] max-w-[300px]">
                    {c.description ?? '—'}
                  </td>
                  <td className="py-1 pr-4">
                    <span
                      className={`rounded px-1.5 py-0.5 font-[var(--font-ui)] text-[length:var(--text-nano)] font-medium ${enforcementStyle(c.default_enforcement)}`}
                    >
                      {c.default_enforcement ?? '—'}
                    </span>
                  </td>
                  <td className="py-1 font-[var(--font-ui)] text-[length:var(--text-nano)]">
                    {c.destructive === true ? (
                      <span className="text-red-400">⚠ yes</span>
                    ) : c.destructive === false ? (
                      <span className="text-[var(--color-text-muted)]">no</span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
