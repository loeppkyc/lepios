'use client'

import { useState } from 'react'

// ── Inline types ──────────────────────────────────────────────────────────────

interface LabelsResponse {
  shipmentId: string
  downloadUrl: string | null
  labelData: string | null
  labelFormat: string | null
  error?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LabelPrintView({
  batchId,
  shipmentPlanId,
}: {
  batchId: string
  shipmentPlanId: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LabelsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!shipmentPlanId) return null

  async function handlePrint() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(
        `/api/shipment-manager/labels?batch_id=${encodeURIComponent(batchId)}`
      )
      const data = (await res.json()) as LabelsResponse
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setResult(data)

      // Open PDF URL in new tab if available
      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => void handlePrint()}
        disabled={loading}
        style={{
          alignSelf: 'flex-start',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          padding: '5px 12px',
          backgroundColor: loading ? 'var(--color-surface-2)' : 'var(--color-surface)',
          color: loading ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Fetching Labels…' : 'Print FNSKU Labels'}
      </button>

      {error && (
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
          {error}
        </div>
      )}

      {result && !result.downloadUrl && result.labelData && (
        // Amazon returned label data as embedded content — render as download link
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-muted)',
          }}
        >
          Labels received ({result.labelFormat ?? 'PDF'}).{' '}
          <a
            href={`data:application/pdf;base64,${result.labelData}`}
            download={`labels-${result.shipmentId}.pdf`}
            style={{ color: 'var(--color-accent-gold)', textDecoration: 'none' }}
          >
            Download
          </a>
        </div>
      )}

      {result && !result.downloadUrl && !result.labelData && (
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-disabled)',
          }}
        >
          Labels requested. Amazon may take a moment to generate them — try again in 30 seconds.
        </div>
      )}
    </div>
  )
}
