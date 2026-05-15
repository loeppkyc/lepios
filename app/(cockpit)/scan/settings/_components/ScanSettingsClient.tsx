'use client'

import { useEffect, useState } from 'react'

interface SettingsState {
  min_profit_cad: number
  min_roi_pct: number
  max_bsr: number
}

const DEFAULTS: SettingsState = {
  min_profit_cad: 3.0,
  min_roi_pct: 50.0,
  max_bsr: 0,
}

export function ScanSettingsClient() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/scan/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings({
          min_profit_cad: Number(data.min_profit_cad ?? DEFAULTS.min_profit_cad),
          min_roi_pct: Number(data.min_roi_pct ?? DEFAULTS.min_roi_pct),
          max_bsr: Number(data.max_bsr ?? DEFAULTS.max_bsr),
        })
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/scan/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Save failed')
        return
      }
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2000)
    } catch {
      setError('Network error — settings not saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold text-[var(--color-text-primary)]">
        Scanner Settings
      </h1>
      <p className="mb-8 text-sm text-[var(--color-text-secondary)]">
        These thresholds control the BUY/SKIP decision.
      </p>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}

      {!loading && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="min_profit_cad"
              className="text-sm font-medium text-[var(--color-text-primary)]"
            >
              Min Profit (CAD)
            </label>
            <input
              id="min_profit_cad"
              type="number"
              step="0.50"
              min="0"
              value={settings.min_profit_cad}
              onChange={(e) =>
                setSettings((s) => ({ ...s, min_profit_cad: Number(e.target.value) }))
              }
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="min_roi_pct"
              className="text-sm font-medium text-[var(--color-text-primary)]"
            >
              Min ROI (%)
            </label>
            <input
              id="min_roi_pct"
              type="number"
              step="5"
              min="0"
              value={settings.min_roi_pct}
              onChange={(e) => setSettings((s) => ({ ...s, min_roi_pct: Number(e.target.value) }))}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="max_bsr"
              className="text-sm font-medium text-[var(--color-text-primary)]"
            >
              Max BSR (0 = no limit)
            </label>
            <input
              id="max_bsr"
              type="number"
              step="100000"
              min="0"
              value={settings.max_bsr}
              onChange={(e) => setSettings((s) => ({ ...s, max_bsr: Number(e.target.value) }))}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {savedMsg && <p className="text-sm font-medium text-green-500">Settings saved</p>}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </div>
  )
}
