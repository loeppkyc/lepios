'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

interface PriceCheckResult {
  asin: string
  set_number: string
  name: string
  price: number | null
  alert_triggered: boolean
  error: string | null
}

interface CheckResponse {
  ok: boolean
  error?: string
  tokensUsed?: number
  tokensLeft?: number
  setsChecked?: number
  alertsFired?: number
  results?: PriceCheckResult[]
}

export function PriceCheckTab() {
  const [asinCount, setAsinCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [resetMsg, setResetMsg] = useState<string | null>(null)

  async function loadAsinCount() {
    setLoading(true)
    const db = createClient()
    const { data, error } = await db.from('lego_vault').select('asin')
    if (!error && data) {
      const valid = data.filter((r: { asin: string }) => r.asin && r.asin.length === 10)
      setAsinCount(valid.length)
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAsinCount()
  }, [])

  async function handleCheckAll() {
    setChecking(true)
    setResult(null)
    setResetMsg(null)

    try {
      const res = await fetch('/api/lego/price-check', { method: 'POST' })
      const data = (await res.json()) as CheckResponse
      setResult(data)
      // Refresh ASIN count after check
      await loadAsinCount()
    } catch (err) {
      setResult({ ok: false, error: String(err) })
    } finally {
      setChecking(false)
    }
  }

  async function handleResetAlerts() {
    setResetting(true)
    setResetMsg(null)
    setResult(null)

    const db = createClient()
    const { error } = await db
      .from('lego_vault')
      .update({ alert_sent: false })
      .neq('id', '00000000-0000-0000-0000-000000000000') // update all rows

    if (error) {
      setResetMsg(`Error resetting alerts: ${error.message}`)
    } else {
      setResetMsg('All alerts reset. Next price check will re-evaluate all sets.')
    }
    setResetting(false)
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Summary panel */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Vault ASIN Status
        </h2>
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-2xl font-bold text-[var(--color-text-primary)]">
              {asinCount ?? 0}
              <span className="ml-2 text-sm font-normal text-[var(--color-text-secondary)]">
                sets with valid ASINs (10 chars)
              </span>
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Sets without a valid 10-character ASIN are skipped during price check.
            </p>
          </div>
        )}
      </div>

      {/* Token guard + action */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Check Amazon.ca Prices
        </h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Calls Keepa (domain=6 — Amazon.ca) for each set with a valid ASIN. Token balance is
          checked first — blocked if fewer than 50 tokens remain. Any set where estimated Amazon.ca
          price meets or exceeds your target sell price will trigger a Telegram alert (once per set
          until reset).
        </p>

        <div className="flex gap-3">
          <Button onClick={handleCheckAll} disabled={checking || asinCount === 0}>
            {checking ? 'Checking prices...' : 'Check All Prices'}
          </Button>
          <Button variant="outline" onClick={handleResetAlerts} disabled={resetting}>
            {resetting ? 'Resetting...' : 'Reset Alerts'}
          </Button>
        </div>

        {asinCount === 0 && !loading && (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            No sets have valid 10-character ASINs yet. Add ASINs via the Add Set tab.
          </p>
        )}
      </div>

      {/* Reset confirmation */}
      {resetMsg && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-sm text-[var(--color-positive)]">{resetMsg}</p>
        </div>
      )}

      {/* Result panel */}
      {result && (
        <div
          className={`rounded-lg border p-6 ${result.ok ? 'border-[var(--color-border)] bg-[var(--color-surface)]' : 'border-[var(--color-critical)] bg-[var(--color-surface)]'}`}
        >
          {!result.ok ? (
            <div>
              <p className="text-sm font-semibold text-[var(--color-critical)]">
                Price check failed
              </p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{result.error}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                Price Check Results
              </h3>

              {/* Summary stats */}
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-[var(--color-text-muted)]">Sets checked</p>
                  <p className="font-mono text-lg font-bold text-[var(--color-text-primary)]">
                    {result.setsChecked ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)]">Alerts fired</p>
                  <p
                    className={`font-mono text-lg font-bold ${(result.alertsFired ?? 0) > 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-text-primary)]'}`}
                  >
                    {result.alertsFired ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)]">Tokens used</p>
                  <p className="font-mono text-lg font-bold text-[var(--color-text-primary)]">
                    {result.tokensUsed ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-text-muted)]">Tokens left</p>
                  <p
                    className={`font-mono text-lg font-bold ${(result.tokensLeft ?? 999) < 100 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-primary)]'}`}
                  >
                    {result.tokensLeft ?? '—'}
                  </p>
                </div>
              </div>

              {/* Per-set results */}
              {(result.results ?? []).length > 0 && (
                <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        {['Set #', 'Name', 'ASIN', 'Estimated Price (CAD)', 'Alert'].map((h) => (
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
                      {(result.results ?? []).map((r) => (
                        <tr key={r.asin} className="border-b border-[var(--color-border-subtle)]">
                          <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]">
                            {r.set_number}
                          </td>
                          <td className="max-w-[160px] overflow-hidden px-3 py-2 text-xs text-ellipsis whitespace-nowrap text-[var(--color-text-secondary)]">
                            {r.name}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                            {r.asin}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.error ? (
                              <span className="text-[var(--color-critical)]">Error: {r.error}</span>
                            ) : r.price == null ? (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            ) : (
                              <span className="text-[var(--color-text-primary)]">
                                ${r.price.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {r.alert_triggered ? (
                              <span className="font-semibold text-[var(--color-positive)]">
                                Sent
                              </span>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
