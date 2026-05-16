'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { grossRoi } from '@/lib/lego/retirement'

interface VaultRowAnalytics {
  id: string
  set_number: string
  name: string
  theme: string
  paid_cad: number | null
  target_sell_cad: number | null
  current_amazon_cad: number | null
  status: string
  qty: number
  asin: string
}

interface FbaFeeResult {
  asin: string
  fee: number
}

function fmt(n: number, prefix = '$'): string {
  return `${prefix}${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <p className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{sub}</p>}
    </div>
  )
}

const ACTIVE_STATUSES = ['in_vault_sealed', 'in_vault_opened', 'long_term_hold', 'ready_to_ship']

export function AnalyticsTab() {
  const [rows, setRows] = useState<VaultRowAnalytics[]>([])
  const [fbaFees, setFbaFees] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)

      const db = createClient()
      const { data, error: err } = await db
        .from('lego_vault')
        .select(
          'id, set_number, name, theme, paid_cad, target_sell_cad, current_amazon_cad, status, qty, asin'
        )

      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const vaultRows = (data ?? []) as VaultRowAnalytics[]
      setRows(vaultRows)

      // Fetch FBA fee estimates for sets with current price and valid ASIN
      const toFetch = vaultRows.filter(
        (r) => r.current_amazon_cad != null && r.asin && r.asin.length === 10
      )

      if (toFetch.length > 0) {
        try {
          const res = await fetch('/api/lego/price-check?action=fees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: toFetch.map((r) => ({
                asin: r.asin,
                price: r.current_amazon_cad,
              })),
            }),
          })
          if (res.ok) {
            const feesData = (await res.json()) as { fees: FbaFeeResult[] }
            const feeMap: Record<string, number> = {}
            for (const f of feesData.fees ?? []) {
              feeMap[f.asin] = f.fee
            }
            setFbaFees(feeMap)
          }
        } catch {
          // FBA fees are best-effort — don't block analytics if this fails
        }
      }

      setLoading(false)
    })()
  }, [])

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading analytics...</p>
  }
  if (error) {
    return <p className="text-sm text-[var(--color-critical)]">Error: {error}</p>
  }

  // Compute analytics
  const activeRows = rows.filter((r) => ACTIVE_STATUSES.includes(r.status))
  const totalSets = rows.length
  const activeSets = activeRows.length

  const totalInvested = activeRows.reduce((sum, r) => sum + (r.paid_cad ?? 0) * r.qty, 0)
  const totalCurrentValue = activeRows
    .filter((r) => r.current_amazon_cad != null)
    .reduce((sum, r) => sum + (r.current_amazon_cad ?? 0) * r.qty, 0)
  const unrealizedGain = totalCurrentValue - totalInvested

  // Top performers by gross ROI
  const withRoi = activeRows
    .filter((r) => r.paid_cad != null && r.current_amazon_cad != null && r.paid_cad > 0)
    .map((r) => ({
      ...r,
      roi: grossRoi(r.paid_cad!, r.current_amazon_cad!),
      netProfit: r.current_amazon_cad! - r.paid_cad! - (fbaFees[r.asin] ?? 0),
    }))
    .sort((a, b) => b.roi - a.roi)

  // Sets by theme
  const byTheme: Record<string, { count: number; invested: number }> = {}
  for (const r of activeRows) {
    const t = r.theme || 'Unknown'
    if (!byTheme[t]) byTheme[t] = { count: 0, invested: 0 }
    byTheme[t].count += r.qty
    byTheme[t].invested += (r.paid_cad ?? 0) * r.qty
  }
  const themes = Object.entries(byTheme)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)

  return (
    <div className="space-y-8">
      {/* Summary tiles */}
      <div>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Vault Summary
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Total Sets" value={String(totalSets)} sub={`${activeSets} active`} />
          <StatTile label="Total Invested" value={fmt(totalInvested)} sub="cost basis (active)" />
          <StatTile
            label="Estimated Value"
            value={fmt(totalCurrentValue)}
            sub="Amazon.ca buy box (where checked)"
          />
          <StatTile
            label="Unrealized Gain"
            value={
              totalCurrentValue > 0
                ? `${unrealizedGain >= 0 ? '+' : ''}${fmt(unrealizedGain)}`
                : '—'
            }
            sub={
              totalCurrentValue > 0 && totalInvested > 0
                ? `${(((totalCurrentValue - totalInvested) / totalInvested) * 100).toFixed(1)}% gross`
                : undefined
            }
          />
        </div>
      </div>

      {/* Top performers */}
      {withRoi.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Top Performers by Gross ROI (Estimated)
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            &quot;Estimated&quot; — Amazon.ca buy box price from Keepa. Net profit deducts estimated
            FBA fee from <span className="font-mono">lib/amazon/fees.ts</span>. Run Price Check to
            refresh prices.
          </p>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    {[
                      'Set #',
                      'Name',
                      'Paid (CAD)',
                      'Est. Price (CAD)',
                      'Gross ROI',
                      'Est. Net Profit',
                      'FBA Fee Est.',
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
                  {withRoi.slice(0, 10).map((r) => (
                    <tr key={r.id} className="border-b border-[var(--color-border-subtle)]">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-[var(--color-text-primary)]">
                        {r.set_number}
                      </td>
                      <td className="max-w-[160px] overflow-hidden px-3 py-2 text-xs text-ellipsis whitespace-nowrap text-[var(--color-text-secondary)]">
                        {r.name || '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                        {fmt(r.paid_cad!)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                        {fmt(r.current_amazon_cad!)}
                      </td>
                      <td
                        className={`px-3 py-2 font-mono text-xs font-semibold ${r.roi >= 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-critical)]'}`}
                      >
                        {r.roi >= 0 ? '+' : ''}
                        {r.roi.toFixed(1)}%
                      </td>
                      <td
                        className={`px-3 py-2 font-mono text-xs font-semibold ${r.netProfit >= 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-critical)]'}`}
                      >
                        {r.netProfit >= 0 ? '+' : ''}
                        {fmt(r.netProfit)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                        {fbaFees[r.asin] != null ? fmt(fbaFees[r.asin]) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* By theme */}
      {themes.length > 0 && (
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Active Sets by Theme
          </h2>
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['Theme', 'Sets', 'Total Invested (CAD)'].map((h) => (
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
                {themes.map(([theme, data]) => (
                  <tr key={theme} className="border-b border-[var(--color-border-subtle)]">
                    <td className="px-3 py-2 text-xs text-[var(--color-text-primary)]">{theme}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      {data.count}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                      {data.invested > 0 ? fmt(data.invested) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            No sets in vault yet. Add sets via the &quot;Add Set&quot; tab.
          </p>
        </div>
      )}
    </div>
  )
}
