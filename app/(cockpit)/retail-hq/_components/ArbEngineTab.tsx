'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface FlippDealItem {
  name: string
  price: number | string
}

interface ArbInputRow {
  name: string
  retail_price: string
  upc: string
}

interface ArbResult {
  name: string
  retail_price: number
  upc?: string
  status: 'buy' | 'skip' | 'no_match' | 'no_new_listing'
  asin?: string
  title?: string
  imageUrl?: string
  buy_box_new?: number
  fba_fees?: number
  profit?: number
  roi_pct?: number
  score?: number
  bsr?: number
  keepa?: { rankDrops30: number; monthlySold: number; velocityBadge: string } | null
}

interface ArbScanResponse {
  results: ArbResult[]
  scanned_at: string
  duration_ms: number
}

const EMPTY_ROW: ArbInputRow = { name: '', retail_price: '', upc: '' }

function statusBadge(status: ArbResult['status']) {
  if (status === 'buy') return <Badge className="bg-green-700 text-white">BUY</Badge>
  if (status === 'skip') return <Badge className="bg-red-800 text-white">SKIP</Badge>
  if (status === 'no_new_listing')
    return <Badge className="bg-yellow-700 text-white">NO NEW LISTING</Badge>
  return <Badge className="bg-zinc-700 text-white">NO MATCH</Badge>
}

function velocityBadge(badge?: string) {
  if (!badge) return null
  const cls =
    badge === 'Hot'
      ? 'bg-orange-700 text-white'
      : badge === 'Warm'
        ? 'bg-yellow-700 text-white'
        : 'bg-zinc-600 text-white'
  return <Badge className={cls}>{badge}</Badge>
}

export function ArbEngineTab({ flippDeals }: { flippDeals: FlippDealItem[] }) {
  const [rows, setRows] = useState<ArbInputRow[]>([{ ...EMPTY_ROW }])
  const [results, setResults] = useState<ArbResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)

  function updateRow(i: number, field: keyof ArbInputRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }])
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
  }

  function importFromDeals() {
    const imported = flippDeals
      .filter((d) => d.name)
      .slice(0, 20)
      .map((d) => ({
        name: d.name,
        retail_price: typeof d.price === 'number' ? String(d.price) : '',
        upc: '',
      }))
    if (imported.length > 0) setRows(imported)
  }

  async function runScan(e: React.FormEvent) {
    e.preventDefault()
    const valid = rows.filter((r) => r.name.trim() && r.retail_price.trim())
    if (valid.length === 0) return
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch('/api/retail/arb-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: valid.map((r) => ({
            name: r.name.trim(),
            retail_price: parseFloat(r.retail_price),
            ...(r.upc.trim() ? { upc: r.upc.trim() } : {}),
          })),
        }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as ArbScanResponse
      setResults(data.results)
      setDurationMs(data.duration_ms)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={runScan} className="space-y-4">
        {/* Input table */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product name</TableHead>
                <TableHead className="w-32">Retail price ($)</TableHead>
                <TableHead className="w-36">UPC (optional)</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      placeholder="e.g. LEGO Technic 42162"
                      value={row.name}
                      onChange={(e) => updateRow(i, 'name', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="29.99"
                      value={row.retail_price}
                      onChange={(e) => updateRow(i, 'retail_price', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      placeholder="0123456789012"
                      value={row.upc}
                      onChange={(e) => updateRow(i, 'upc', e.target.value)}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-xs text-[var(--color-text-secondary)] hover:text-red-400"
                      >
                        ✕
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 20}>
            + Add row
          </Button>
          {flippDeals.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={importFromDeals}>
              Import from Deals ({Math.min(flippDeals.length, 20)})
            </Button>
          )}
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? 'Scanning…' : 'Run Arb Scan'}
          </Button>
        </div>
      </form>

      {error && (
        <p className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
            <span>{results.length} items scanned</span>
            <span>{results.filter((r) => r.status === 'buy').length} BUY signals</span>
            {durationMs != null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Decision</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead className="text-right">Buy box</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">ROI</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead>Velocity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        {r.asin ? (
                          <a
                            href={`https://www.amazon.ca/dp/${r.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-[var(--color-text-primary)] hover:underline"
                          >
                            {r.title || r.name}
                          </a>
                        ) : (
                          <span className="text-sm text-[var(--color-text-primary)]">{r.name}</span>
                        )}
                        {r.asin && (
                          <p className="text-xs text-[var(--color-text-secondary)]">{r.asin}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">${r.retail_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {r.buy_box_new != null ? `$${r.buy_box_new.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.fba_fees != null ? `$${r.fba_fees.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.profit != null ? (
                        <span className={r.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
                          ${r.profit.toFixed(2)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.roi_pct != null ? (
                        <span
                          className={
                            r.roi_pct >= 15
                              ? 'text-green-400'
                              : r.roi_pct >= 0
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }
                        >
                          {r.roi_pct.toFixed(1)}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.score != null ? r.score.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell>{velocityBadge(r.keepa?.velocityBadge)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
