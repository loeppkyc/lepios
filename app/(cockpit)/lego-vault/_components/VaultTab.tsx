'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { grossRoi } from '@/lib/lego/retirement'

export interface VaultRow {
  id: string
  set_number: string
  name: string
  asin: string
  theme: string
  paid_cad: number | null
  target_sell_cad: number | null
  current_amazon_cad: number | null
  status: string
  location: string
  qty: number
  alert_sent: boolean
  last_price_check: string | null
  notes: string
  date_added: string
}

const STATUS_LABELS: Record<string, string> = {
  in_vault_sealed: 'Sealed',
  in_vault_opened: 'Opened',
  long_term_hold: 'Long-Term Hold',
  ready_to_ship: 'Ready to Ship',
  shipped_to_fba: 'Shipped to FBA',
  live_on_amazon: 'Listed',
  sold: 'Sold',
  personal_collection: 'Personal Collection',
}

function fmt(n: number | null, prefix = '$'): string {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function roiLabel(paid: number | null, current: number | null): string {
  if (paid == null || current == null || paid === 0) return '—'
  const r = grossRoi(paid, current)
  return `${r >= 0 ? '+' : ''}${r.toFixed(1)}%`
}

function roiClass(paid: number | null, current: number | null): string {
  if (paid == null || current == null || paid === 0) return 'text-[var(--color-text-muted)]'
  const r = grossRoi(paid, current)
  if (r > 0) return 'text-[var(--color-positive)]'
  if (r < 0) return 'text-[var(--color-critical)]'
  return 'text-[var(--color-text-secondary)]'
}

export function VaultTab() {
  const [rows, setRows] = useState<VaultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('active')

  async function load() {
    setLoading(true)
    setError(null)
    const db = createClient()
    const { data, error: err } = await db
      .from('lego_vault')
      .select('*')
      .order('date_added', { ascending: false })
    if (err) {
      setError(err.message)
    } else {
      setRows((data ?? []) as VaultRow[])
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load()
  }, [])

  const filtered = rows.filter((r) => {
    if (filter === 'active') {
      return ['in_vault_sealed', 'in_vault_opened', 'long_term_hold', 'ready_to_ship'].includes(
        r.status
      )
    }
    if (filter === 'sold') return r.status === 'sold'
    return true
  })

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        {(['active', 'all', 'sold'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
              filter === f
                ? 'bg-[var(--color-pillar-money)] text-[var(--color-base)]'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {f === 'active' ? 'Active' : f === 'sold' ? 'Sold' : 'All'}
          </button>
        ))}
        {!loading && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {filtered.length} set{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading vault...</p>}
      {error && <p className="text-sm text-[var(--color-critical)]">Error: {error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            No sets in vault yet. Add your first set using the &quot;Add Set&quot; tab.
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {[
                    'Set #',
                    'Name',
                    'Theme',
                    'Status',
                    'Qty',
                    'Paid (CAD)',
                    'Current (CAD)',
                    'Gross ROI',
                    'Target (CAD)',
                    'Alert',
                    'Last Check',
                    'Location',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-[var(--color-text-primary)]">
                      {row.set_number}
                    </td>
                    <td className="max-w-[180px] overflow-hidden px-3 py-2 text-xs text-ellipsis whitespace-nowrap text-[var(--color-text-primary)]">
                      {row.name || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      {row.theme || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      {STATUS_LABELS[row.status] ?? row.status}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      {row.qty}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      {fmt(row.paid_cad)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      {fmt(row.current_amazon_cad)}
                    </td>
                    <td
                      className={`px-3 py-2 font-mono text-xs font-semibold ${roiClass(row.paid_cad, row.current_amazon_cad)}`}
                    >
                      {roiLabel(row.paid_cad, row.current_amazon_cad)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      {fmt(row.target_sell_cad)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.alert_sent ? (
                        <span className="font-semibold text-[var(--color-positive)]">Sent</span>
                      ) : (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                      {row.last_price_check
                        ? new Date(row.last_price_check).toLocaleDateString('en-CA')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                      {row.location || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
