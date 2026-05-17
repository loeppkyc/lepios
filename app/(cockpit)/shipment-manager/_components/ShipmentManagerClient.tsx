'use client'

import { useEffect, useState } from 'react'
import { LabelPrintView } from './LabelPrintView'

// ── Inline types ──────────────────────────────────────────────────────────────

interface FbaBatch {
  id: string
  name: string
  status: string
  source: string | null
  created_at: string
  shipment_plan_id: string | null
  shipment_status: string
  item_count: number
}

interface CreatePlanResult {
  shipmentId: string
  destinationFulfillmentCenterId: string
  labelPrepType: string
  itemCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    open: 'var(--color-text-muted)',
    planned: 'var(--color-positive)',
    shipped: 'var(--color-text-disabled)',
    closed: 'var(--color-text-disabled)',
  }
  return (
    <span
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-nano)',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: colorMap[status] ?? 'var(--color-text-muted)',
        border: `1px solid ${colorMap[status] ?? 'var(--color-border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '2px 6px',
      }}
    >
      {status}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShipmentManagerClient() {
  const [batches, setBatches] = useState<FbaBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-batch creating state
  const [creating, setCreating] = useState<Record<string, boolean>>({})
  const [createResults, setCreateResults] = useState<Record<string, CreatePlanResult | null>>({})
  const [createErrors, setCreateErrors] = useState<Record<string, string | null>>({})

  async function loadBatches() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/batches')
      if (!res.ok) throw new Error('Failed to load batches')
      const data = (await res.json()) as FbaBatch[]
      setBatches(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBatches()
  }, [])

  async function handleCreatePlan(batchId: string) {
    setCreating((prev) => ({ ...prev, [batchId]: true }))
    setCreateErrors((prev) => ({ ...prev, [batchId]: null }))
    try {
      const res = await fetch('/api/shipment-manager/create-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      })
      const data = (await res.json()) as CreatePlanResult & { error?: string }
      if (!res.ok) {
        setCreateErrors((prev) => ({ ...prev, [batchId]: data.error ?? `HTTP ${res.status}` }))
        return
      }
      setCreateResults((prev) => ({ ...prev, [batchId]: data }))
      // Refresh batch list so shipment_status updates
      void loadBatches()
    } catch (err) {
      setCreateErrors((prev) => ({
        ...prev,
        [batchId]: err instanceof Error ? err.message : 'Network error',
      }))
    } finally {
      setCreating((prev) => ({ ...prev, [batchId]: false }))
    }
  }

  // Filter: show open batches (shipment_status = 'open' or 'planned')
  const activeBatches = batches.filter(
    (b) => (b.shipment_status ?? 'open') !== 'shipped' && b.status !== 'closed'
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="label-caps" style={{ color: 'var(--color-pillar-money)' }}>
          FBA Batches
        </span>
        <button
          onClick={() => void loadBatches()}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Loading batches…
        </div>
      )}

      {error && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && activeBatches.length === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            padding: '20px 0',
          }}
        >
          No open batches. Create a batch in the FBA Batch Manager first.
        </div>
      )}

      {activeBatches.map((batch) => {
        const isPlanned = (batch.shipment_status ?? 'open') === 'planned'
        const planResult = createResults[batch.id]
        const planError = createErrors[batch.id]
        const isCreating = creating[batch.id] ?? false

        return (
          <div
            key={batch.id}
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Batch header row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-small)',
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {batch.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  {batch.item_count} item{batch.item_count !== 1 ? 's' : ''} · Created{' '}
                  {formatDate(batch.created_at)}
                  {batch.source ? ` · ${batch.source}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <StatusBadge status={batch.shipment_status ?? 'open'} />
                {!isPlanned && (
                  <button
                    onClick={() => void handleCreatePlan(batch.id)}
                    disabled={isCreating}
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      padding: '5px 12px',
                      backgroundColor: isCreating
                        ? 'var(--color-surface-2)'
                        : 'var(--color-accent-gold)',
                      color: isCreating ? 'var(--color-text-disabled)' : 'var(--color-base)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: isCreating ? 'not-allowed' : 'pointer',
                      transition: 'opacity var(--transition-fast)',
                    }}
                  >
                    {isCreating ? 'Creating…' : 'Create Shipment Plan'}
                  </button>
                )}
              </div>
            </div>

            {/* Plan created: show ShipmentId */}
            {(isPlanned || planResult) && (
              <div
                style={{
                  backgroundColor: 'var(--color-surface-2)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    color: 'var(--color-positive)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Shipment Plan Created
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-small)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {planResult?.shipmentId ?? batch.shipment_plan_id}
                </span>
                {planResult?.destinationFulfillmentCenterId && (
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-nano)',
                      color: 'var(--color-text-disabled)',
                    }}
                  >
                    FC: {planResult.destinationFulfillmentCenterId} · Label:{' '}
                    {planResult.labelPrepType}
                  </span>
                )}
              </div>
            )}

            {/* Label print view for planned batches */}
            {isPlanned && (
              <LabelPrintView batchId={batch.id} shipmentPlanId={batch.shipment_plan_id} />
            )}

            {/* Error state */}
            {planError && (
              <div
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-critical)',
                  padding: '6px 10px',
                  border: '1px solid var(--color-critical)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {planError}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
