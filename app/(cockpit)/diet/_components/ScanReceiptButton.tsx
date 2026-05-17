'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReceiptCategory } from '@/lib/diet/types'

interface ScannedItem {
  item: string
  price: number
  qty: number
  unit: string
  category: ReceiptCategory
  calories_per_serving: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

interface ScanResult {
  store: string
  date: string | null
  items: ScannedItem[]
}

type ItemState = ScannedItem & { selected: boolean; adding: boolean; added: boolean }

export function ScanReceiptButton() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ store: string; date: string | null; items: ItemState[] } | null>(null)
  const [addingAll, setAddingAll] = useState(false)

  async function handleFile(file: File) {
    setScanning(true)
    setError(null)
    setResult(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/diet/receipts/scan', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Scan failed (HTTP ${res.status})`)
        return
      }
      const data: ScanResult = await res.json()
      setResult({
        store: data.store,
        date: data.date,
        items: data.items.map((i) => ({ ...i, selected: true, adding: false, added: false })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setScanning(false)
    }
  }

  async function addItem(idx: number) {
    if (!result) return
    const item = result.items[idx]
    if (!item || item.added || item.adding) return
    setResult((prev) => {
      if (!prev) return prev
      const items = [...prev.items]
      items[idx] = { ...items[idx], adding: true }
      return { ...prev, items }
    })
    try {
      const res = await fetch('/api/diet/receipts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purchased_on: result.date ?? new Date().toISOString().slice(0, 10),
          store: result.store,
          item: item.item,
          price: item.price,
          category: item.category,
          qty: item.qty,
          unit: item.unit,
          calories: item.calories_per_serving,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean }
      setResult((prev) => {
        if (!prev) return prev
        const items = [...prev.items]
        items[idx] = { ...items[idx], adding: false, added: res.ok && !!body.ok }
        return { ...prev, items }
      })
      if (res.ok && body.ok) router.refresh()
    } catch {
      setResult((prev) => {
        if (!prev) return prev
        const items = [...prev.items]
        items[idx] = { ...items[idx], adding: false }
        return { ...prev, items }
      })
    }
  }

  async function addAll() {
    if (!result) return
    setAddingAll(true)
    const pending = result.items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.selected && !item.added)
    for (const { idx } of pending) {
      await addItem(idx)
    }
    setAddingAll(false)
  }

  const selectedCount = result ? result.items.filter((i) => i.selected && !i.added).length : 0
  const allAdded = result ? result.items.every((i) => i.added) : false

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={scanning}
          onClick={() => fileRef.current?.click()}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-wider text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-gold)] hover:text-[var(--color-accent-gold)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {scanning ? 'Scanning…' : 'Scan Receipt with AI'}
        </button>
        {error && (
          <span className="font-[var(--font-ui)] text-[length:var(--text-nano)] text-red-400">{error}</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {result && result.items.length > 0 && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold text-[var(--color-text-primary)]">
              {result.store}{result.date ? ` · ${result.date}` : ''} — {result.items.length} items
            </span>
            {!allAdded && (
              <button
                type="button"
                disabled={addingAll || selectedCount === 0}
                onClick={addAll}
                className="rounded border border-[var(--color-accent-gold)] px-3 py-1 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold text-[var(--color-accent-gold)] transition-colors hover:bg-[var(--color-accent-gold)] hover:text-[var(--color-base)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {addingAll ? 'Adding…' : `Add ${selectedCount} Selected`}
              </button>
            )}
            {allAdded && (
              <span className="font-[var(--font-ui)] text-[length:var(--text-nano)] text-emerald-400">
                All added
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['', 'Item', 'Price', 'Qty', 'Category', 'Cal', 'Pro', 'Carb', 'Fat', ''].map((h) => (
                    <th
                      key={h}
                      className="pb-1 pr-3 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.items.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-[var(--color-border)] border-opacity-40 ${item.added ? 'opacity-40' : ''}`}
                  >
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        disabled={item.added}
                        onChange={(e) => {
                          setResult((prev) => {
                            if (!prev) return prev
                            const items = [...prev.items]
                            items[idx] = { ...items[idx], selected: e.target.checked }
                            return { ...prev, items }
                          })
                        }}
                        className="accent-[var(--color-accent-gold)]"
                      />
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-primary)]">
                      {item.item}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-secondary)]">
                      {item.price < 0 ? `-$${Math.abs(item.price).toFixed(2)}` : `$${item.price.toFixed(2)}`}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-muted)]">
                      {item.qty} {item.unit}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
                      {item.category}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-muted)]">
                      {item.calories_per_serving ?? '—'}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-muted)]">
                      {item.protein_g != null ? `${item.protein_g}g` : '—'}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-muted)]">
                      {item.carbs_g != null ? `${item.carbs_g}g` : '—'}
                    </td>
                    <td className="py-1 pr-3 font-[var(--font-mono)] text-[length:var(--text-nano)] tabular-nums text-[var(--color-text-muted)]">
                      {item.fat_g != null ? `${item.fat_g}g` : '—'}
                    </td>
                    <td className="py-1">
                      {item.added ? (
                        <span className="font-[var(--font-ui)] text-[length:var(--text-nano)] text-emerald-400">Added</span>
                      ) : (
                        <button
                          type="button"
                          disabled={item.adding}
                          onClick={() => addItem(idx)}
                          className="font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-accent-gold)] hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {item.adding ? '…' : 'Add'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && result.items.length === 0 && (
        <p className="font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
          No items could be extracted from the receipt.
        </p>
      )}
    </div>
  )
}
