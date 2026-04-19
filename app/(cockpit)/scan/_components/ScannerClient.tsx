'use client'

import { useState } from 'react'
import { CockpitInput } from '@/components/cockpit/CockpitInput'
import { BsrSparkline } from '@/components/cockpit/BsrSparkline'
import type { VelocityBadge } from '@/lib/keepa/product'
import type { BsrPoint } from '@/lib/keepa/history'

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

interface ScanResult {
  scanResultId: string | null
  isbn: string
  asin: string
  title: string
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
  keepa: KeepaData | null
  ebay: EbayData | null
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
  const [isbn, setIsbn] = useState('')
  const [costPaid, setCostPaid] = useState('0.25')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [sparkOpen, setSparkOpen] = useState(false)
  const [sparkLoading, setSparkLoading] = useState(false)
  const [sparkPoints, setSparkPoints] = useState<BsrPoint[] | null>(null)

  // Save-to-list state
  const [saveState, setSaveState] = useState<'idle' | 'open' | 'saving' | 'saved' | 'new-list'>('idle')
  const [lists, setLists] = useState<HitListOption[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  const [savedToName, setSavedToName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setLoading(true)

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: isbn.trim(), cost_paid: parseFloat(costPaid) }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Scan failed')
      else {
        setResult(data as ScanResult)
        // Reset sparkline + save state on each new scan
        setSparkOpen(false)
        setSparkLoading(false)
        setSparkPoints(null)
        setSaveState('idle')
        setSavedToName(null)
        setSaveError(null)
        setNewListName('')
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
          Amazon CA · Chunk B
        </p>
      </div>

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
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                background: isBuy ? 'var(--color-positive)' : 'var(--color-overlay)',
                color: isBuy ? 'var(--color-base)' : 'var(--color-text-muted)',
                flexShrink: 0,
              }}
            >
              {isBuy ? 'BUY' : 'SKIP'}
            </span>
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
            <div style={cellLabel}>eBay CA (active listings)</div>
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
                  background: newListName.trim() ? 'var(--color-accent-gold)' : 'var(--color-surface-2)',
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
    </div>
  )
}
