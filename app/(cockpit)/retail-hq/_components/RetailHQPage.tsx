'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { lookupBrandRisk, riskBadgeClass, BRAND_DB } from '@/lib/reselling/brand-risk'
import type { BrandRiskEntry } from '@/lib/reselling/types'
import { ArbEngineTab } from './ArbEngineTab'

interface FlippDealItem {
  name: string
  description: string
  price: number | string
  prePrice: string
  store: string
  brand: string
  validFrom: string
  validTo: string
  imageUrl: string
  category: string
  savings: string
}

function FlippDealRow({ item }: { item: FlippDealItem }) {
  const priceStr = typeof item.price === 'number' ? `$${item.price.toFixed(2)}` : String(item.price)
  return (
    <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-text-primary)]">{item.name}</p>
          <div className="mt-0.5 flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
            {item.store && <span>{item.store}</span>}
            {item.brand && <span>{item.brand}</span>}
            {item.category && <span>{item.category}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="font-medium text-[var(--color-text-primary)]">{priceStr}</span>
            {item.prePrice && (
              <span className="text-sm text-[var(--color-text-secondary)] line-through">{item.prePrice}</span>
            )}
            {item.savings && (
              <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-xs font-medium text-green-300">
                {item.savings}
              </span>
            )}
          </div>
          {item.description && item.description !== item.name && (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{item.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--color-text-secondary)]">
          {item.validFrom && <span>From {item.validFrom}</span>}
          {item.validTo && <span>To {item.validTo}</span>}
        </div>
      </div>
    </div>
  )
}

function BrandRiskTab() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<BrandRiskEntry | null | undefined>(undefined)

  function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setResult(lookupBrandRisk(query.trim()))
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleLookup} className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label>Brand name</Label>
          <Input
            placeholder="e.g. Nike, Dyson, Lego"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit">Check Risk</Button>
        </div>
      </form>

      {result === undefined && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Enter a brand name to check its IP/C&D risk level.
        </p>
      )}
      {result === null && (
        <p className="text-sm text-yellow-400">
          Brand not found in database — assume unknown risk, proceed with caution.
        </p>
      )}
      {result != null && (
        <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--color-text-primary)]">{result.brand}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${riskBadgeClass(result.risk_level)}`}
            >
              {result.label} (L{result.risk_level})
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">{result.category}</span>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{result.notes}</p>
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
          High-risk brands ({BRAND_DB.filter((b) => b.risk_level >= 4).length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {BRAND_DB.filter((b) => b.risk_level >= 4).map((b) => (
            <span
              key={b.brand}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium ${riskBadgeClass(b.risk_level)}`}
              onClick={() => {
                setQuery(b.brand)
                setResult(b)
              }}
            >
              {b.brand} L{b.risk_level}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// Simple ROI calculator (port of Arbitrage ROI calculator section)
function CalculatorTab() {
  const [form, setForm] = useState({
    retail: '',
    amazon: '',
    fba_fee: '3.50',
    referral: '15',
    cashback: '5',
  })
  const [result, setResult] = useState<{ profit: number; roi: number; netCost: number } | null>(
    null
  )

  function calc(e: React.FormEvent) {
    e.preventDefault()
    const retail = parseFloat(form.retail)
    const amazon = parseFloat(form.amazon)
    const fbaFee = parseFloat(form.fba_fee)
    const referral = parseFloat(form.referral) / 100
    const cashback = parseFloat(form.cashback) / 100
    if (isNaN(retail) || isNaN(amazon)) return
    const netCost = retail * (1 - cashback)
    const referralFee = amazon * referral
    const profit = amazon - netCost - fbaFee - referralFee
    const roi = (profit / netCost) * 100
    setResult({ profit, roi, netCost })
  }

  return (
    <div className="max-w-sm space-y-4">
      <form onSubmit={calc} className="space-y-3">
        {[
          { key: 'retail', label: 'Retail buy price ($)' },
          { key: 'amazon', label: 'Amazon sell price ($)' },
          { key: 'fba_fee', label: 'FBA fee ($)' },
          { key: 'referral', label: 'Referral fee (%)' },
          { key: 'cashback', label: 'Cashback (%)' },
        ].map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label>{label}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <Button type="submit" className="w-full">
          Calculate
        </Button>
      </form>

      {result && (
        <div className="border-border space-y-2 rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
          <div className="flex justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Net cost (after cashback)</span>
            <span className="text-[var(--color-text-primary)]">${result.netCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--color-text-secondary)]">Profit</span>
            <span className={result.profit >= 0 ? 'text-green-400' : 'text-red-400'}>
              ${result.profit.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-[var(--color-text-secondary)]">ROI</span>
            <span
              className={
                result.roi >= 15
                  ? 'text-green-400'
                  : result.roi >= 0
                    ? 'text-yellow-400'
                    : 'text-red-400'
              }
            >
              {result.roi.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function RetailHQPage() {
  const [items, setItems] = useState<FlippDealItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dealQuery, setDealQuery] = useState('sale')

  useEffect(() => {
    async function fetchDeals() {
      setLoading(true)
      try {
        const res = await fetch(`/api/retail/deals?q=${encodeURIComponent(dealQuery)}&limit=50`)
        const j = (await res.json()) as { items?: FlippDealItem[] }
        setItems(j.items ?? [])
      } finally {
        setLoading(false)
      }
    }
    fetchDeals()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDealSearch(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    fetch(`/api/retail/deals?q=${encodeURIComponent(dealQuery)}&limit=50`)
      .then((r) => r.json())
      .then((j: { items?: FlippDealItem[] }) => { setItems(j.items ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Retail HQ</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Canadian retail arbitrage intelligence — ported from 75_Retail_HQ.py
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Flipp deals', value: items.length },
          { label: 'Stores', value: new Set(items.map((i) => i.store).filter(Boolean)).size },
          { label: 'With savings', value: items.filter((i) => i.savings).length },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4"
          >
            <p className="text-xs text-[var(--color-text-secondary)]">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="deals">
        <TabsList>
          <TabsTrigger value="deals">Deals ({items.length})</TabsTrigger>
          <TabsTrigger value="arb-engine">Arb Engine</TabsTrigger>
          <TabsTrigger value="brand-risk">Brand Risk</TabsTrigger>
          <TabsTrigger value="calculator">ROI Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="deals" className="space-y-3 pt-4">
          <form onSubmit={handleDealSearch} className="flex gap-2">
            <Input
              placeholder="Search Flipp (sale, LEGO, tool…)"
              value={dealQuery}
              onChange={(e) => setDealQuery(e.target.value)}
              className="h-8 max-w-xs text-sm"
            />
            <Button type="submit" size="sm" disabled={loading}>Search</Button>
          </form>
          {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No Flipp deals found for this query.
            </p>
          )}
          {items.map((item, i) => (
            <FlippDealRow key={i} item={item} />
          ))}
        </TabsContent>

        <TabsContent value="arb-engine" className="pt-4">
          <ArbEngineTab flippDeals={items} />
        </TabsContent>

        <TabsContent value="brand-risk" className="pt-4">
          <BrandRiskTab />
        </TabsContent>

        <TabsContent value="calculator" className="pt-4">
          <CalculatorTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
