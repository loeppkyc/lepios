'use client'

import { useEffect, useState, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PolymarketPrediction } from '@/lib/polymarket/types'

const CONFIDENCES = ['high', 'medium', 'low'] as const

function ConfidenceBadge({ c }: { c: string | null }) {
  if (!c) return null
  const cls =
    c === 'high'
      ? 'bg-green-900/50 text-green-300'
      : c === 'medium'
        ? 'bg-yellow-900/50 text-yellow-300'
        : 'bg-gray-800 text-gray-400'
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{c.toUpperCase()}</span>
}

function LogForm({ onAdd }: { onAdd: () => void }) {
  const [form, setForm] = useState({
    trade_date: new Date().toISOString().slice(0, 10),
    market: '',
    pick: '',
    buy_price: '',
    confidence: '' as (typeof CONFIDENCES)[number] | '',
    potential_return: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.market || !form.pick) {
      setErr('Market and pick are required.')
      return
    }
    setSaving(true)
    setErr('')
    const res = await fetch('/api/polymarket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trade_date: form.trade_date,
        market: form.market,
        pick: form.pick,
        buy_price: form.buy_price ? parseFloat(form.buy_price) : null,
        confidence: form.confidence || null,
        potential_return: form.potential_return ? parseFloat(form.potential_return) : null,
        notes: form.notes || null,
      }),
    })
    if (!res.ok) {
      const d = await res.json()
      setErr(d.error ?? 'Failed to log prediction.')
    } else {
      setForm({
        trade_date: new Date().toISOString().slice(0, 10),
        market: '',
        pick: '',
        buy_price: '',
        confidence: '',
        potential_return: '',
        notes: '',
      })
      onAdd()
    }
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={form.trade_date} onChange={(e) => set('trade_date', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Confidence</Label>
          <Select
            value={form.confidence}
            onValueChange={(v) => set('confidence', v as (typeof CONFIDENCES)[number])}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {CONFIDENCES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Market</Label>
          <Input
            value={form.market}
            onChange={(e) => set('market', e.target.value)}
            placeholder="Will BTC exceed $100k by June 2026?"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Pick (side + price)</Label>
          <Input
            value={form.pick}
            onChange={(e) => set('pick', e.target.value)}
            placeholder="YES @ 0.32"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Buy Price (0–1)</Label>
          <Input
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={form.buy_price}
            onChange={(e) => set('buy_price', e.target.value)}
            placeholder="0.32"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Potential Return (0–1)</Label>
          <Input
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={form.potential_return}
            onChange={(e) => set('potential_return', e.target.value)}
            placeholder="2.13"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Notes — optional</Label>
          <Input
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Rationale or context"
          />
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? 'Logging…' : 'Log Prediction'}
      </Button>
    </form>
  )
}

function ResolveForm({
  prediction,
  onResolved,
}: {
  prediction: PolymarketPrediction
  onResolved: () => void
}) {
  const [outcome, setOutcome] = useState('')
  const [pnl, setPnl] = useState('')
  const [saving, setSaving] = useState(false)

  async function resolve() {
    setSaving(true)
    await fetch('/api/polymarket', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: prediction.id,
        resolved: true,
        outcome: outcome || null,
        pnl: pnl ? parseFloat(pnl) : null,
      }),
    })
    setSaving(false)
    onResolved()
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        placeholder="Outcome (WIN/LOSS/…)"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        className="h-7 w-28 text-xs"
      />
      <Input
        type="number"
        step="0.01"
        placeholder="P/L $"
        value={pnl}
        onChange={(e) => setPnl(e.target.value)}
        className="h-7 w-20 text-xs"
      />
      <Button size="sm" variant="outline" disabled={saving} onClick={resolve} className="h-7 text-xs">
        {saving ? '…' : 'Mark Resolved'}
      </Button>
    </div>
  )
}

export function PolymarketPage() {
  const [predictions, setPredictions] = useState<PolymarketPrediction[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/polymarket')
    const d = await res.json()
    setPredictions(d.predictions ?? [])
  }

  useEffect(() => {
    fetch('/api/polymarket')
      .then((r) => r.json())
      .then((d) => {
        setPredictions(d.predictions ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const open = useMemo(() => predictions.filter((p) => !p.resolved), [predictions])
  const resolved = useMemo(() => predictions.filter((p) => p.resolved), [predictions])

  const stats = useMemo(() => {
    const wins = resolved.filter((p) => (p.pnl ?? 0) > 0).length
    const total = resolved.length
    const totalPnl = resolved.reduce((acc, p) => acc + (p.pnl ?? 0), 0)
    return { wins, total, totalPnl, winRate: total ? (wins / total) * 100 : null }
  }, [resolved])

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Polymarket</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Prediction market log — track picks, outcomes, and P/L
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          ['Open', open.length],
          ['Resolved', resolved.length],
          ['Win Rate', stats.winRate != null ? `${stats.winRate.toFixed(0)}%` : '—'],
          ['Total P/L', `$${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`],
        ].map(([label, val]) => (
          <div key={label as string} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-3 text-center">
            <div className="text-lg font-semibold text-[var(--color-text-primary)]">{val}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="log">Log Pick</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4 space-y-3">
          {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {!loading && open.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">No open positions. Log a pick to get started.</p>
          )}
          {open.map((p) => (
            <div key={p.id} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{p.market}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <span>{p.pick}</span>
                    {p.buy_price != null && <span>@ {(p.buy_price * 100).toFixed(0)}¢</span>}
                    {p.potential_return != null && (
                      <span>→ {(p.potential_return * 100).toFixed(0)}% return</span>
                    )}
                    <ConfidenceBadge c={p.confidence} />
                  </div>
                  {p.notes && (
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{p.notes}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">{p.trade_date}</span>
              </div>
              {resolvingId === p.id ? (
                <ResolveForm
                  prediction={p}
                  onResolved={() => {
                    setResolvingId(null)
                    load()
                  }}
                />
              ) : (
                <button
                  onClick={() => setResolvingId(p.id)}
                  className="mt-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  Mark resolved →
                </button>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <LogForm onAdd={load} />
        </TabsContent>

        <TabsContent value="resolved" className="mt-4">
          {resolved.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No resolved markets yet.</p>
          ) : (
            <div className="border-border overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-cockpit-bg)] text-[var(--color-text-secondary)]">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Market</th>
                    <th className="px-4 py-2 text-left">Pick</th>
                    <th className="px-4 py-2 text-right">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((p) => (
                    <tr key={p.id} className="border-border border-t">
                      <td className="px-4 py-2 text-[var(--color-text-secondary)]">{p.trade_date}</td>
                      <td className="max-w-xs truncate px-4 py-2">{p.market}</td>
                      <td className="px-4 py-2">{p.pick}</td>
                      <td
                        className={`px-4 py-2 text-right font-medium ${(p.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {p.pnl != null ? `$${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-6">
          {resolved.length < 3 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Need at least 3 resolved markets for analytics. ({resolved.length} so far)
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ['Total Picks', stats.total],
                  ['Wins', stats.wins],
                  ['Win Rate', `${(stats.winRate ?? 0).toFixed(1)}%`],
                  ['Total P/L', `$${stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}`],
                ].map(([label, val]) => (
                  <div key={label as string} className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-3">
                    <div className="text-sm font-semibold text-[var(--color-text-primary)]">{val}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
                  </div>
                ))}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium text-[var(--color-text-secondary)]">
                  By Confidence Level
                </h3>
                <div className="space-y-1.5">
                  {CONFIDENCES.map((conf) => {
                    const confPreds = resolved.filter((p) => p.confidence === conf)
                    if (!confPreds.length) return null
                    const w = confPreds.filter((p) => (p.pnl ?? 0) > 0).length
                    const pl = confPreds.reduce((acc, p) => acc + (p.pnl ?? 0), 0)
                    return (
                      <div
                        key={conf}
                        className="flex items-center justify-between rounded-lg bg-[var(--color-cockpit-surface)] px-3 py-2 text-sm"
                      >
                        <ConfidenceBadge c={conf} />
                        <span className="text-[var(--color-text-secondary)]">
                          {w}/{confPreds.length} ({confPreds.length ? ((w / confPreds.length) * 100).toFixed(0) : 0}%)
                        </span>
                        <span className={pl >= 0 ? 'text-green-400' : 'text-red-400'}>
                          ${pl >= 0 ? '+' : ''}{pl.toFixed(2)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
