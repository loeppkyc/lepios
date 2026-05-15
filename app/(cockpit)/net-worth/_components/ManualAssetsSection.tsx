'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ManualAsset } from '@/app/api/net-worth/manual-assets/route'

const CLASS_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  real_estate: 'Real Estate',
  cash: 'Cash',
  investment: 'Investment',
  other: 'Other',
}

function fmt(n: number) {
  return n.toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

interface EditState {
  id: string
  valueStr: string
  notes: string
  saving: boolean
  err: string | null
}

interface ManualAssetsSectionProps {
  onTotalChange?: (total: number) => void
}

export function ManualAssetsSection({ onTotalChange }: ManualAssetsSectionProps) {
  const [assets, setAssets] = useState<ManualAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch('/api/net-worth/manual-assets')
      const j = (await r.json()) as { assets?: ManualAsset[]; error?: string }
      if (j.error) throw new Error(j.error)
      setAssets(j.assets ?? [])
      const total = (j.assets ?? []).reduce((s, a) => s + a.value_cad, 0)
      onTotalChange?.(total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [onTotalChange])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(a: ManualAsset) {
    setEdit({ id: a.id, valueStr: String(a.value_cad), notes: a.notes ?? '', saving: false, err: null })
  }

  function cancelEdit() {
    setEdit(null)
  }

  async function saveEdit() {
    if (!edit) return
    const val = parseFloat(edit.valueStr)
    if (!Number.isFinite(val)) {
      setEdit((e) => e && { ...e, err: 'Invalid number' })
      return
    }
    setEdit((e) => e && { ...e, saving: true, err: null })
    try {
      const r = await fetch('/api/net-worth/manual-assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: edit.id, value_cad: val, notes: edit.notes || null }),
      })
      const j = (await r.json()) as { asset?: ManualAsset; error?: string }
      if (j.error) throw new Error(j.error)
      setEdit(null)
      await load()
    } catch (e) {
      setEdit((prev) => prev && { ...prev, saving: false, err: e instanceof Error ? e.message : String(e) })
    }
  }

  const total = assets.reduce((s, a) => s + a.value_cad, 0)

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-disabled)]">
          Manual Assets
        </h2>
        <span className="font-mono text-sm font-bold text-[var(--color-accent-gold)] tabular-nums">
          {fmt(total)}
        </span>
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-disabled)]">Loading…</p>
      )}
      {err && !loading && (
        <p className="text-sm text-red-400">{err}</p>
      )}

      {!loading && !err && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[var(--color-surface-2)] border-b border-[var(--color-border)]">
                <th className="text-left text-xs font-bold uppercase tracking-widest text-[var(--color-text-disabled)] px-4 py-2">
                  Asset
                </th>
                <th className="text-left text-xs font-bold uppercase tracking-widest text-[var(--color-text-disabled)] px-4 py-2">
                  Class
                </th>
                <th className="text-right text-xs font-bold uppercase tracking-widest text-[var(--color-text-disabled)] px-4 py-2">
                  Value
                </th>
                <th className="text-right text-xs font-bold uppercase tracking-widest text-[var(--color-text-disabled)] px-4 py-2">
                  Updated
                </th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const isEditing = edit?.id === a.id
                return (
                  <tr key={a.id} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="px-4 py-2 text-sm text-[var(--color-text-secondary)]">
                      {a.label}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {CLASS_LABELS[a.asset_class] ?? a.asset_class}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm tabular-nums text-[var(--color-text-primary)]">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={edit.valueStr}
                          onChange={(e) => setEdit((prev) => prev && { ...prev, valueStr: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveEdit()
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          disabled={edit.saving}
                          autoFocus
                          className="w-32 text-right font-mono text-sm bg-[var(--color-surface-2)] border border-[var(--color-accent-gold)] rounded-[var(--radius-sm)] text-[var(--color-text-primary)] px-2 py-1 outline-none"
                        />
                      ) : (
                        fmt(a.value_cad)
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-[var(--color-text-disabled)] whitespace-nowrap">
                      {a.updated_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {isEditing ? (
                        <span className="inline-flex gap-1.5">
                          <button
                            onClick={cancelEdit}
                            disabled={edit.saving}
                            className="text-xs px-2.5 py-1 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text-muted)] bg-transparent cursor-pointer disabled:cursor-wait"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => void saveEdit()}
                            disabled={edit.saving}
                            className="text-xs font-bold px-2.5 py-1 bg-[var(--color-accent-gold)] text-black rounded-[var(--radius-sm)] border-none cursor-pointer disabled:cursor-wait disabled:opacity-60"
                          >
                            {edit.saving ? 'Saving…' : 'Save'}
                          </button>
                          {edit.err && (
                            <span className="text-xs text-red-400 self-center" title={edit.err}>
                              ⚠
                            </span>
                          )}
                        </span>
                      ) : (
                        <button
                          onClick={() => startEdit(a)}
                          className="text-xs px-2.5 py-1 border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--color-text-disabled)] bg-transparent cursor-pointer"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {assets.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-4 text-sm text-center text-[var(--color-text-disabled)]"
                  >
                    No manual assets. They&apos;ll appear after migration 0205 is applied.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
