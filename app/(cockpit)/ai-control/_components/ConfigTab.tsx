'use client'

import type { ConfigEntry } from './AIControlShell'

export function ConfigTab({ entries }: { entries: ConfigEntry[] }) {
  if (!entries.length) {
    return (
      <p className="font-[var(--font-ui)] text-[length:var(--text-small)] text-[var(--color-text-muted)]">
        No harness_config entries found.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {['Key', 'Value'].map((h) => (
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
          {entries.map((e) => (
            <tr
              key={e.key}
              className="border-b border-[var(--color-border)] border-opacity-40 hover:bg-[var(--color-surface)]"
            >
              <td className="py-2 pr-8 font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-primary)] whitespace-nowrap">
                {e.key}
              </td>
              <td className={`py-2 font-[var(--font-mono)] text-[length:var(--text-nano)] ${e.value === '[redacted]' ? 'text-[var(--color-text-muted)] italic' : 'text-[var(--color-text-secondary)]'}`}>
                {e.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
        Sensitive values (matching SECRET/TOKEN/KEY/PASSWORD/AUTH/CREDENTIAL) are masked.
      </p>
    </div>
  )
}
