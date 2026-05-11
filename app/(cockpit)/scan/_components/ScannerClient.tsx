'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import { BsrSparkline } from '@/components/cockpit/BsrSparkline'
import type { VelocityBadge } from '@/lib/keepa/product'
import type { BsrPoint } from '@/lib/keepa/history'
import type { BookTier } from '@/lib/pallets/tier-classifier'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'
import type { ConditionCode } from '@/lib/amazon/listings'

interface KeepaData {
  bsr: number | null
  avgRank90d: number | null
  rankDrops30: number | null
  monthlySold: number | null
  velocityBadge: VelocityBadge
}

interface EbayData {
  medianCad: number
  lowCad: number
  highCad: number
  count: number
  profit: number | null
  fallbackUsed: boolean
}

interface EbaySoldData {
  avgSoldCad: number
  lowSoldCad: number
  highSoldCad: number
  soldCount: number
  fallbackUsed: boolean
}

interface ScanResult {
  scanResultId: string | null
  isbn: string
  asin: string
  title: string
  author: string | null
  imageUrl: string
  bsr: number | null
  bsrCategory: string
  bsrSource: 'sp-api' | 'keepa' | null
  buyBoxPrice: number
  fbaFees: number
  costPaid: number
  profit: number
  roi: number
  decision: 'buy' | 'skip'
  tier: BookTier
  floorPriceCad: number | null
  keepa: KeepaData | null
  ebay: EbayData | null
  ebaySold: EbaySoldData | null
}

const TIER_STYLES: Record<BookTier, { label: string; bg: string; color: string }> = {
  COLLECTIBLE: { label: 'COLLECTIBLE', bg: 'var(--color-accent-gold)', color: 'var(--color-base)' },
  HIGH_DEMAND: { label: 'HIGH DEMAND', bg: 'var(--color-positive)', color: 'var(--color-base)' },
  STANDARD: { label: 'STANDARD', bg: 'var(--color-surface-2)', color: 'var(--color-text-muted)' },
}

interface HitListOption {
  id: string
  name: string
}

const cell = {
  background: 'var(--color-surface-2)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
} as const

const cellLabel = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--text-nano)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-text-disabled)',
  marginBottom: 4,
}

const cellValue = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-body)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums' as const,
}

const VELOCITY_STYLES: Record<VelocityBadge, { bg: string; color: string }> = {
  Hot: { bg: 'var(--color-positive)', color: 'var(--color-base)' },
  Warm: { bg: 'var(--color-accent-gold)', color: 'var(--color-base)' },
  Slow: { bg: 'var(--color-surface-2)', color: 'var(--color-text-muted)' },
  Unknown: { bg: 'var(--color-overlay)', color: 'var(--color-text-disabled)' },
}

function VelocityPill({ badge }: { badge: VelocityBadge }) {
  const { bg, color } = VELOCITY_STYLES[badge]
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 700,
        letterSpacing: '0.08em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: bg,
        color,
      }}
    >
      {badge.toUpperCase()}
    </span>
  )
}

export function ScannerClient() {
  const searchParams = useSearchParams()
  const palletId = searchParams.get('pallet_id')

  const [isbn, setIsbn] = useState('')
  const [costPaid, setCostPaid] = useState('0.25')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devMode] = useDevMode()

  const [sparkOpen, setSparkOpen] = useState(false)
  const [sparkLoading, setSparkLoading] = useState(false)
  const [sparkPoints, setSparkPoints] = useState<BsrPoint[] | null>(null)

  // Routing state
  const [routeState, setRouteState] = useState<'idle' | 'routing' | 'done'>('idle')
  const [routeDecision, setRouteDecision] = useState<'go' | 'bbv' | 'donate' | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)

  // Save-to-list state
  const [saveState, setSaveState] = useState<'idle' | 'open' | 'saving' | 'saved' | 'new-list'>(
    'idle'
  )
  const [lists, setLists] = useState<HitListOption[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  const [savedToName, setSavedToName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')

  // List on Amazon state
  type ListState = 'idle' | 'open' | 'submitting' | 'done' | 'error'
  const [listState, setListState] = useState<ListState>('idle')
  const [listCondition, setListCondition] = useState<ConditionCode>('like_new')
  const [listPrice, setListPrice] = useState('')
  const [listNote, setListNote] = useState('Like New Condition. 100% Satisfaction Guaranteed.')
  const [listedSku, setListedSku] = useState<string | null>(null)
  const [listedListingId, setListedListingId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  // Add to Batch state
  type BatchAddState = 'idle' | 'open' | 'saving' | 'saved'
  const [batchAddState, setBatchAddState] = useState<BatchAddState>('idle')
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([])
  const [batchesLoaded, setBatchesLoaded] = useState(false)
  const [savedToBatch, setSavedToBatch] = useState<string | null>(null)
  const [batchAddError, setBatchAddError] = useState<string | null>(null)

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn: isbn.trim(),
          cost_paid: parseFloat(costPaid),
          ...(palletId ? { pallet_id: palletId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Scan failed')
      else {
        setResult(data as ScanResult)
        // Reset sparkline + save + routing + listing state on each new scan
        setSparkOpen(false)
        setSparkLoading(false)
        setSparkPoints(null)
        setSaveState('idle')
        setSavedToName(null)
        setSaveError(null)
        setNewListName('')
        setRouteState('idle')
        setRouteDecision(null)
        setRouteError(null)
        setListState('idle')
        setListCondition('like_new')
        setListPrice((data as ScanResult).buyBoxPrice?.toFixed(2) ?? '')
        setListNote('Like New Condition. 100% Satisfaction Guaranteed.')
        setListedSku(null)
        setListedListingId(null)
        setListError(null)
        setBatchAddState('idle')
        setSavedToBatch(null)
        setBatchAddError(null)
      }
    } catch {
      setError('Network error — check connection')
    } finally {
      setLoading(false)
    }
  }

  async function handleBsrTap(asin: string) {
    if (sparkOpen) {
      setSparkOpen(false)
      return
    }
    if (sparkPoints !== null) {
      setSparkOpen(true)
      return
    }
    setSparkLoading(true)
    try {
      const res = await fetch(`/api/bsr-history?asin=${encodeURIComponent(asin)}`)
      if (res.ok) {
        const data = await res.json()
        setSparkPoints((data.points as BsrPoint[]) ?? [])
        setSparkOpen(true)
      }
    } catch {
      // Error state: BSR text stays, no sparkline shown
    } finally {
      setSparkLoading(false)
    }
  }

  async function handleRoute(decision: 'go' | 'bbv' | 'donate') {
    if (!result?.scanResultId || routeState !== 'idle') return
    setRouteState('routing')
    setRouteError(null)
    try {
      const res = await fetch(`/api/scan/${result.scanResultId}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routing_decision: decision }),
      })
      if (!res.ok) {
        const d = await res.json()
        setRouteError(d.error ?? 'Routing failed')
        setRouteState('idle')
      } else {
        setRouteDecision(decision)
        setRouteState('done')
      }
    } catch {
      setRouteError('Network error')
      setRouteState('idle')
    }
  }

  async function handleOpenSave() {
    setSaveState('open')
    setSaveError(null)
    if (!listsLoaded) {
      try {
        const res = await fetch('/api/hit-lists')
        if (res.ok) {
          const data = await res.json()
          setLists(data as HitListOption[])
          setListsLoaded(true)
        }
      } catch {
        setSaveError('Failed to load lists')
      }
    }
  }

  async function handleSaveToList(listId: string, listName: string) {
    if (!result) return
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await fetch(`/api/hit-lists/${listId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbns: [result.isbn] }),
      })
      if (!res.ok) {
        const d = await res.json()
        setSaveError(d.error ?? 'Save failed')
        setSaveState('open')
      } else {
        setSavedToName(listName)
        setSaveState('saved')
      }
    } catch {
      setSaveError('Network error')
      setSaveState('open')
    }
  }

  async function handleCreateAndSave() {
    if (!result || !newListName.trim()) return
    setSaveState('saving')
    setSaveError(null)
    try {
      const createRes = await fetch('/api/hit-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName.trim() }),
      })
      if (!createRes.ok) {
        const d = await createRes.json()
        setSaveError(d.error ?? 'Failed to create list')
        setSaveState('new-list')
        return
      }
      const newList = await createRes.json()
      // Invalidate cached lists so next open re-fetches
      setListsLoaded(false)
      await handleSaveToList(newList.id, newListName.trim())
    } catch {
      setSaveError('Network error')
      setSaveState('new-list')
    }
  }

  async function handleListNow() {
    if (!result?.scanResultId || listState !== 'open') return
    const priceVal = parseFloat(listPrice)
    if (isNaN(priceVal) || priceVal <= 0) {
      setListError('Enter a valid price')
      return
    }
    setListState('submitting')
    setListError(null)
    try {
      const res = await fetch(`/api/scan/${result.scanResultId}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condition_code: listCondition,
          list_price_cad: priceVal,
          condition_note: listNote,
        }),
      })
      const data = await res.json()
      if (res.status === 201 || res.status === 200) {
        setListedSku(data.sku ?? null)
        setListedListingId(data.listingId ?? null)
        setListState('done')
      } else {
        const msg =
          data.error ??
          (data.sp_api_issues && data.sp_api_issues.length > 0
            ? JSON.stringify(data.sp_api_issues[0])
            : 'Listing failed')
        setListError(msg)
        setListState('error')
      }
    } catch {
      setListError('Network error')
      setListState('error')
    }
  }

  async function handleOpenBatch() {
    setBatchAddState('open')
    setBatchAddError(null)
    if (!batchesLoaded) {
      try {
        const res = await fetch('/api/batches')
        if (res.ok) {
          const data = await res.json()
          setBatches(data as { id: string; name: string }[])
          setBatchesLoaded(true)
        }
      } catch {
        setBatchAddError('Failed to load batches')
      }
    }
  }

  async function handleAddToBatch(batchId: string, batchName: string) {
    if (!result) return
    setBatchAddState('saving')
    setBatchAddError(null)
    try {
      const res = await fetch(`/api/batches/${batchId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scan_result_id: result.scanResultId ?? undefined,
          amazon_listing_id: listedListingId ?? undefined,
          sku: listedSku ?? undefined,
          asin: result.asin,
          isbn: result.isbn,
          title: result.title || undefined,
          condition_code: listCondition,
          list_price_cad: parseFloat(listPrice) || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setBatchAddError(d.error ?? 'Failed to add to batch')
        setBatchAddState('open')
      } else {
        setSavedToBatch(batchName)
        setBatchAddState('saved')
      }
    } catch {
      setBatchAddError('Network error')
      setBatchAddState('open')
    }
  }

  const isBuy = result?.decision === 'buy'
  const profitColor = result
    ? result.profit >= 3
      ? 'var(--color-positive)'
      : 'var(--color-critical)'
    : 'var(--color-text-primary)'
  const roiColor = result
    ? result.roi >= 50
      ? 'var(--color-positive)'
      : 'var(--color-critical)'
    : 'var(--color-text-primary)'

  const velocityBadge: VelocityBadge = result?.keepa?.velocityBadge ?? 'Unknown'

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          PageProfit Scanner
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}
        >
          Amazon CA · 3-way routing
        </p>
      </div>

      {palletId && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-accent-gold)',
            background: 'var(--color-overlay)',
            border: '1px solid var(--color-accent-gold)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
          }}
        >
          Scanning against pallet — scans will be linked automatically.{' '}
          <a
            href="/pallets"
            style={{ color: 'inherit', textDecoration: 'underline', fontWeight: 600 }}
          >
            ← Back to pallets
          </a>
        </div>
      )}

      <form onSubmit={handleScan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CockpitInput
          label="ISBN"
          value={isbn}
          onChange={(e) => setIsbn(e.target.value)}
          placeholder="9780307888037"
          inputMode="numeric"
          required
          autoFocus
        />
        <CockpitInput
          label="Cost Paid (CAD)"
          type="number"
          value={costPaid}
          onChange={(e) => setCostPaid(e.target.value)}
          step="0.01"
          min="0.01"
          max="999.99"
          required
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            fontWeight: 600,
            padding: '10px 24px',
            background: loading ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
            color: loading ? 'var(--color-text-disabled)' : 'var(--color-base)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background var(--transition-fast)',
          }}
        >
          {loading ? 'Scanning…' : 'Scan'}
        </button>
      </form>

      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-body)',
            color: 'var(--color-critical)',
            background: 'var(--color-critical-dim)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: `1px solid ${isBuy ? 'var(--color-positive)' : 'var(--color-border-accent)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Header row — cover + title + decision badge */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            {result.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.imageUrl}
                alt={result.title}
                width={52}
                height={72}
                style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-body)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.3,
                  marginBottom: 4,
                }}
              >
                {result.title || 'Unknown Title'}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {result.author && (
                  <span style={{ color: 'var(--color-text-primary)' }}>{result.author}</span>
                )}
                <span>{result.asin}</span>
                {result.bsr && result.bsr > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => handleBsrTap(result.asin)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBsrTap(result.asin)}
                    style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                  >
                    · BSR {result.bsr.toLocaleString()}
                    {sparkLoading && ' …'}
                  </span>
                )}
                <VelocityPill badge={velocityBadge} />
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: TIER_STYLES[result.tier].bg,
                  color: TIER_STYLES[result.tier].color,
                }}
              >
                {TIER_STYLES[result.tier].label}
              </span>
              {result.floorPriceCad !== null && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  floor ${result.floorPriceCad.toFixed(2)}
                </span>
              )}
            </div>
          </div>

          {/* BSR sparkline — on-demand, tap-to-load */}
          {sparkOpen && sparkPoints && sparkPoints.length > 0 && (
            <div style={{ paddingLeft: 64 }}>
              <BsrSparkline points={sparkPoints} />
            </div>
          )}

          {/* Price breakdown — 3 cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {(
              [
                {
                  label: 'Buy Box',
                  value: `$${result.buyBoxPrice.toFixed(2)}`,
                  color: 'var(--color-text-primary)',
                },
                {
                  label: 'FBA Fees',
                  value: `-$${result.fbaFees.toFixed(2)}`,
                  color: 'var(--color-critical)',
                },
                {
                  label: 'Cost',
                  value: `-$${result.costPaid.toFixed(2)}`,
                  color: 'var(--color-text-muted)',
                },
              ] as const
            ).map(({ label, value, color }) => (
              <div key={label} style={cell}>
                <div style={cellLabel}>{label}</div>
                <div style={{ ...cellValue, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Profit + ROI — 2 larger cells */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={cell}>
              <div style={cellLabel}>Profit</div>
              <div
                style={{ ...cellValue, fontSize: '1.25rem', fontWeight: 700, color: profitColor }}
              >
                ${result.profit.toFixed(2)}
              </div>
            </div>
            <div style={cell}>
              <div style={cellLabel}>ROI</div>
              <div style={{ ...cellValue, fontSize: '1.25rem', fontWeight: 700, color: roiColor }}>
                {result.roi.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Keepa velocity detail row */}
          {result.keepa && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-text-muted)',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              {result.keepa.rankDrops30 !== null && (
                <span>Rank drops 30d: {result.keepa.rankDrops30}</span>
              )}
              {result.keepa.monthlySold !== null && result.keepa.monthlySold >= 0 && (
                <span>Est. sold/mo: {result.keepa.monthlySold}</span>
              )}
              {result.keepa.avgRank90d !== null && (
                <span>Avg BSR 90d: {result.keepa.avgRank90d.toLocaleString()}</span>
              )}
            </div>
          )}

          {/* eBay active listing comps row */}
          <div style={cell}>
            <div style={cellLabel}>eBay CA (active)</div>
            {result.ebay ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ ...cellValue, color: 'var(--color-text-primary)' }}>
                  {result.ebay.count} listed · median ${result.ebay.medianCad.toFixed(2)}
                </span>
                {result.ebay.profit !== null && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-small)',
                      color:
                        result.ebay.profit >= 3
                          ? 'var(--color-positive)'
                          : 'var(--color-text-muted)',
                    }}
                  >
                    est. profit ${result.ebay.profit.toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                No eBay data
              </span>
            )}
          </div>

          {/* eBay sold comps row */}
          <div style={cell}>
            <div style={cellLabel}>eBay CA (sold 30d)</div>
            {result.ebaySold && result.ebaySold.soldCount > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ ...cellValue, color: 'var(--color-text-primary)' }}>
                  {result.ebaySold.soldCount} sold · avg ${result.ebaySold.avgSoldCad.toFixed(2)}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  ${result.ebaySold.lowSoldCad.toFixed(2)} – $
                  {result.ebaySold.highSoldCad.toFixed(2)}
                </span>
              </div>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-disabled)',
                }}
              >
                No sold data
              </span>
            )}
          </div>

          {/* 3-way routing panel */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
            {routeState === 'done' && routeDecision ? (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-positive)',
                }}
              >
                {routeDecision === 'go' && '✓ Routed to Amazon'}
                {routeDecision === 'bbv' && '✓ Staged for BBV'}
                {routeDecision === 'donate' && '✓ Marked for donation'}
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-disabled)',
                    marginBottom: 10,
                  }}
                >
                  Route this book
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleRoute('go')}
                    disabled={routeState === 'routing'}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      fontWeight: 700,
                      padding: '8px 16px',
                      background:
                        routeState === 'routing'
                          ? 'var(--color-surface-2)'
                          : 'var(--color-positive)',
                      color:
                        routeState === 'routing'
                          ? 'var(--color-text-disabled)'
                          : 'var(--color-base)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      cursor: routeState === 'routing' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    GO — Amazon
                  </button>
                  <button
                    onClick={() => handleRoute('bbv')}
                    disabled={routeState === 'routing'}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      fontWeight: 700,
                      padding: '8px 16px',
                      background:
                        routeState === 'routing'
                          ? 'var(--color-surface-2)'
                          : 'var(--color-accent-gold)',
                      color:
                        routeState === 'routing'
                          ? 'var(--color-text-disabled)'
                          : 'var(--color-base)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      cursor: routeState === 'routing' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    BBV
                  </button>
                  <button
                    onClick={() => handleRoute('donate')}
                    disabled={routeState === 'routing'}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      fontWeight: 600,
                      padding: '8px 16px',
                      background: 'none',
                      color:
                        routeState === 'routing'
                          ? 'var(--color-text-disabled)'
                          : 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: routeState === 'routing' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Donate
                  </button>
                </div>
                {routeError && (
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-critical)',
                      marginTop: 6,
                    }}
                  >
                    {routeError}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Save-to-list panel — shown below result card after successful scan */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {saveState === 'idle' && (
            <button
              onClick={handleOpenSave}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                padding: '8px 16px',
                background: 'var(--color-surface-2)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              Save to list
            </button>
          )}

          {(saveState === 'open' || saveState === 'saving') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                disabled={saveState === 'saving'}
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value
                  if (val === '__new__') {
                    setSaveState('new-list')
                  } else if (val) {
                    const list = lists.find((l) => l.id === val)
                    if (list) handleSaveToList(list.id, list.name)
                  }
                }}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 10px',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                <option value="" disabled>
                  {saveState === 'saving' ? 'Saving…' : '— pick a list —'}
                </option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                <option value="__new__">— New list… —</option>
              </select>
              <button
                onClick={() => setSaveState('idle')}
                disabled={saveState === 'saving'}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 12px',
                  background: 'none',
                  color: 'var(--color-text-disabled)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {saveState === 'new-list' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                autoFocus
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateAndSave()}
                placeholder="New list name"
                maxLength={80}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 10px',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  width: 200,
                }}
              />
              <button
                onClick={handleCreateAndSave}
                disabled={!newListName.trim()}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 600,
                  padding: '7px 14px',
                  background: newListName.trim()
                    ? 'var(--color-accent-gold)'
                    : 'var(--color-surface-2)',
                  color: newListName.trim() ? 'var(--color-base)' : 'var(--color-text-disabled)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: newListName.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Create &amp; save
              </button>
              <button
                onClick={() => setSaveState('open')}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 12px',
                  background: 'none',
                  color: 'var(--color-text-disabled)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
            </div>
          )}

          {saveState === 'saved' && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-positive)',
              }}
            >
              Saved to &ldquo;{savedToName}&rdquo;
            </div>
          )}

          {saveError && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-critical)',
              }}
            >
              {saveError}
            </div>
          )}
        </div>
      )}

      {/* List on Amazon panel — shown after save-to-list, before debug */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {listState === 'idle' && (
            <button
              onClick={() => setListState('open')}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                padding: '8px 16px',
                background: 'var(--color-surface-2)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                alignSelf: 'flex-start',
                width: '100%',
              }}
            >
              List on Amazon
            </button>
          )}

          {(listState === 'open' || listState === 'submitting' || listState === 'error') && (
            <div
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--color-text-disabled)',
                }}
              >
                List on Amazon CA (FBA)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    color: 'var(--color-text-disabled)',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  Condition
                </label>
                <select
                  value={listCondition}
                  disabled={listState === 'submitting'}
                  onChange={(e) => setListCondition(e.target.value as ConditionCode)}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    padding: '7px 10px',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="like_new">Like New</option>
                  <option value="very_good">Very Good</option>
                  <option value="used_good">Good</option>
                  <option value="acceptable">Acceptable</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    color: 'var(--color-text-disabled)',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  List Price (CAD)
                </label>
                <input
                  type="number"
                  value={listPrice}
                  disabled={listState === 'submitting'}
                  onChange={(e) => setListPrice(e.target.value)}
                  step="0.01"
                  min="0.01"
                  max="9999.99"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    padding: '7px 10px',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    color: 'var(--color-text-disabled)',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  Condition Note
                </label>
                <textarea
                  value={listNote}
                  disabled={listState === 'submitting'}
                  onChange={(e) => setListNote(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    padding: '7px 10px',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    resize: 'vertical' as const,
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleListNow}
                  disabled={listState === 'submitting'}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    fontWeight: 700,
                    padding: '8px 18px',
                    background:
                      listState === 'submitting'
                        ? 'var(--color-surface-2)'
                        : 'var(--color-accent-gold)',
                    color:
                      listState === 'submitting'
                        ? 'var(--color-text-disabled)'
                        : 'var(--color-base)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: listState === 'submitting' ? 'not-allowed' : 'pointer',
                  }}
                >
                  {listState === 'submitting' ? 'Listing…' : 'List Now'}
                </button>
                <button
                  onClick={() => {
                    setListState('idle')
                    setListError(null)
                  }}
                  disabled={listState === 'submitting'}
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    padding: '8px 14px',
                    background: 'none',
                    color: 'var(--color-text-disabled)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    cursor: listState === 'submitting' ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              {listState === 'error' && listError && (
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-critical)',
                  }}
                >
                  {listError}
                </div>
              )}
            </div>
          )}

          {listState === 'done' && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-positive)',
              }}
            >
              Listed as {listedSku} on Amazon CA
            </div>
          )}
        </div>
      )}

      {/* Add to Batch panel — shown only after listing is done */}
      {result && listState === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {batchAddState === 'idle' && (
            <button
              onClick={handleOpenBatch}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                padding: '8px 16px',
                background: 'var(--color-surface-2)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              Add to Batch
            </button>
          )}

          {(batchAddState === 'open' || batchAddState === 'saving') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select
                disabled={batchAddState === 'saving'}
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value
                  if (val) {
                    const batch = batches.find((b) => b.id === val)
                    if (batch) handleAddToBatch(batch.id, batch.name)
                  }
                }}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 10px',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                <option value="" disabled>
                  {batchAddState === 'saving'
                    ? 'Adding…'
                    : batches.length === 0
                      ? '— no open batches —'
                      : '— pick a batch —'}
                </option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setBatchAddState('idle')}
                disabled={batchAddState === 'saving'}
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  padding: '7px 12px',
                  background: 'none',
                  color: 'var(--color-text-disabled)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {batchAddState === 'saved' && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-positive)',
              }}
            >
              Added to &ldquo;{savedToBatch}&rdquo;
            </div>
          )}

          {batchAddError && (
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                color: 'var(--color-critical)',
              }}
            >
              {batchAddError}
            </div>
          )}
        </div>
      )}

      {devMode && result !== null && (
        <DebugSection heading="Debug — Scanner Result">
          <pre
            style={{
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-nano)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </DebugSection>
      )}
    </div>
  )
}
