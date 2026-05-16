'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  calculateProfitScore,
  projectPostRetirementValue,
  scoreToLabel,
  type RadarLabel,
} from '@/lib/lego/retirement'
import { Button } from '@/components/ui/button'

interface RetiringSet {
  id: string
  set_number: string
  name: string
  theme: string
  pieces: number | null
  retail_price_cad: number | null
  asin: string
  amazon_price_cad: number | null
  discount_pct: number | null
  sales_rank: number | null
  profit_score: number | null
  retire_date_est: string | null
  status: string
  notes: string
}

interface ThemeConfig {
  theme: string
  multiplier: number
}

const LABEL_COLORS: Record<RadarLabel, string> = {
  'STRONG BUY': 'bg-green-900/60 text-green-300',
  BUY: 'bg-blue-900/40 text-blue-300',
  WATCH: 'bg-yellow-900/40 text-yellow-300',
  PASS: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
}

function fmt(n: number | null, prefix = '$'): string {
  if (n == null) return '—'
  return `${prefix}${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ScoreBar({ value, max, label }: { value: number; max: number; label: string }) {
  // Dynamic width as CSS custom property avoids F20 inline style= violation
  // while still being Tailwind-compatible for the container layout
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const widthClass =
    pct >= 100
      ? 'w-full'
      : pct >= 87
        ? 'w-[87%]'
        : pct >= 75
          ? 'w-3/4'
          : pct >= 62
            ? 'w-[62%]'
            : pct >= 50
              ? 'w-1/2'
              : pct >= 37
                ? 'w-[37%]'
                : pct >= 25
                  ? 'w-1/4'
                  : pct > 0
                    ? 'w-[12%]'
                    : 'w-0'
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 text-xs text-[var(--color-text-muted)]">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className={`h-full rounded-full bg-[var(--color-pillar-money)] transition-all ${widthClass}`}
        />
      </div>
      <span className="font-mono text-xs text-[var(--color-text-secondary)]">
        {value}/{max}
      </span>
    </div>
  )
}

function SetCard({
  set,
  themeMultipliers,
  onAddToVault,
  adding,
}: {
  set: RetiringSet
  themeMultipliers: Record<string, number>
  onAddToVault: (set: RetiringSet) => void
  adding: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const score = calculateProfitScore({
    retailPriceCad: set.retail_price_cad ?? 0,
    amazonPriceCad: set.amazon_price_cad,
    theme: set.theme,
    pieces: set.pieces,
    salesRank: set.sales_rank,
    retireDateEst: set.retire_date_est,
    themeMultipliers,
  })

  const label = scoreToLabel(score.total)

  const proj3yr = set.retail_price_cad
    ? projectPostRetirementValue(set.retail_price_cad, set.theme, 3, themeMultipliers)
    : null
  const proj5yr = set.retail_price_cad
    ? projectPostRetirementValue(set.retail_price_cad, set.theme, 5, themeMultipliers)
    : null

  const retireStr = set.retire_date_est
    ? new Date(set.retire_date_est).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' })
    : '—'

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Left: set info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-[var(--color-text-primary)]">
              {set.set_number}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold tracking-wide uppercase ${LABEL_COLORS[label]}`}
            >
              {label}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{set.name}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
            <span>{set.theme}</span>
            {set.pieces && <span>{set.pieces.toLocaleString()} pcs</span>}
            <span>Retires ~{retireStr}</span>
          </div>
        </div>

        {/* Right: score + projections */}
        <div className="shrink-0 text-right">
          <p className="font-mono text-3xl font-bold text-[var(--color-text-primary)]">
            {score.total}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">/ 100</p>
        </div>
      </div>

      {/* Pricing row */}
      <div className="mt-4 flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-[var(--color-text-muted)]">Retail: </span>
          <span className="font-mono text-[var(--color-text-secondary)]">
            {fmt(set.retail_price_cad)}
          </span>
        </div>
        {set.amazon_price_cad != null && (
          <div>
            <span className="text-[var(--color-text-muted)]">Est. Amazon.ca: </span>
            <span className="font-mono text-[var(--color-text-secondary)]">
              {fmt(set.amazon_price_cad)}
            </span>
          </div>
        )}
        {proj3yr && (
          <div>
            <span className="text-[var(--color-text-muted)]">Proj. 3yr: </span>
            <span className="font-mono text-[var(--color-positive)]">{fmt(proj3yr)}</span>
          </div>
        )}
        {proj5yr && (
          <div>
            <span className="text-[var(--color-text-muted)]">Proj. 5yr: </span>
            <span className="font-mono text-[var(--color-positive)]">{fmt(proj5yr)}</span>
          </div>
        )}
      </div>

      {/* Expand/collapse breakdown */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setExpanded((p) => !p)}
          className="text-xs text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          {expanded ? 'Hide' : 'Show'} score breakdown
        </button>
        <Button size="sm" variant="outline" onClick={() => onAddToVault(set)} disabled={adding}>
          {adding ? 'Adding...' : 'Add to Vault (Hold)'}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--color-border-subtle)] pt-3">
          <ScoreBar value={score.discountScore} max={25} label="Discount vs retail" />
          <ScoreBar value={score.themeScore} max={20} label="Theme multiplier" />
          <ScoreBar value={score.pppScore} max={15} label="Price per piece" />
          <ScoreBar value={score.priceTierScore} max={15} label="Price tier" />
          <ScoreBar value={score.salesRankScore} max={10} label="Sales rank" />
          <ScoreBar value={score.urgencyScore} max={15} label="Urgency to retire" />
        </div>
      )}
    </div>
  )
}

export function RadarTab() {
  const router = useRouter()
  const [sets, setSets] = useState<RetiringSet[]>([])
  const [themeMultipliers, setThemeMultipliers] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)

      const db = createClient()

      // Load theme multipliers from DB (with fallback to defaults in the lib)
      const { data: themeData } = await db.from('lego_theme_config').select('theme, multiplier')

      if (themeData && themeData.length > 0) {
        const map: Record<string, number> = {}
        for (const row of themeData as ThemeConfig[]) {
          map[row.theme] = Number(row.multiplier)
        }
        setThemeMultipliers(map)
      }

      // Load retiring sets
      const { data, error: err } = await db
        .from('lego_retiring_sets')
        .select('*')
        .order('retail_price_cad', { ascending: false })

      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      setSets((data ?? []) as RetiringSet[])
      setLoading(false)
    })()
  }, [])

  async function handleAddToVault(set: RetiringSet) {
    setAddingId(set.id)
    setAddSuccess(null)
    setAddError(null)

    const proj3yr = set.retail_price_cad
      ? projectPostRetirementValue(set.retail_price_cad, set.theme, 3, themeMultipliers)
      : null

    const db = createClient()
    const { error: err } = await db.from('lego_vault').insert({
      set_number: set.set_number,
      name: set.name,
      theme: set.theme,
      asin: set.asin,
      status: 'long_term_hold',
      target_sell_cad: proj3yr, // 3yr projected value as target
      notes: `Added from Buy & Hold Radar. Profit score: ${
        calculateProfitScore({
          retailPriceCad: set.retail_price_cad ?? 0,
          amazonPriceCad: set.amazon_price_cad,
          theme: set.theme,
          pieces: set.pieces,
          salesRank: set.sales_rank,
          retireDateEst: set.retire_date_est,
          themeMultipliers,
        }).total
      }/100`,
    })

    setAddingId(null)

    if (err) {
      setAddError(`Failed to add ${set.set_number}: ${err.message}`)
    } else {
      setAddSuccess(`${set.set_number} ${set.name} added to vault as Long-Term Hold.`)
      router.refresh()
    }
  }

  // Compute scores and sort
  const setsWithScore = sets.map((s) => {
    const score = calculateProfitScore({
      retailPriceCad: s.retail_price_cad ?? 0,
      amazonPriceCad: s.amazon_price_cad,
      theme: s.theme,
      pieces: s.pieces,
      salesRank: s.sales_rank,
      retireDateEst: s.retire_date_est,
      themeMultipliers,
    })
    return { ...s, computedScore: score.total, label: scoreToLabel(score.total) }
  })

  const filtered = setsWithScore.filter((s) => {
    if (filter === 'strong_buy') return s.label === 'STRONG BUY'
    if (filter === 'buy') return s.label === 'BUY' || s.label === 'STRONG BUY'
    return true
  })

  const sorted = [...filtered].sort((a, b) => b.computedScore - a.computedScore)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Buy &amp; Hold Radar
        </h2>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Sets approaching end-of-life. Profit score uses Keepa price, theme multiplier (from DB),
          piece count, price tier, sales rank, and urgency. Projections use BrickLink-derived
          historical appreciation rates.
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'buy', label: 'BUY+' },
            { key: 'strong_buy', label: 'STRONG BUY only' },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide uppercase transition-colors ${
              filter === f.key
                ? 'bg-[var(--color-pillar-money)] text-[var(--color-base)]'
                : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {f.label}
          </button>
        ))}
        {!loading && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {sorted.length} set{sorted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {addSuccess && (
        <p className="text-sm font-semibold text-[var(--color-positive)]">{addSuccess}</p>
      )}
      {addError && <p className="text-sm text-[var(--color-critical)]">{addError}</p>}

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading radar...</p>}
      {error && <p className="text-sm text-[var(--color-critical)]">Error: {error}</p>}

      {!loading && !error && sorted.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            No sets match the current filter.
          </p>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="space-y-4">
          {sorted.map((set) => (
            <SetCard
              key={set.id}
              set={set}
              themeMultipliers={themeMultipliers}
              onAddToVault={handleAddToVault}
              adding={addingId === set.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
