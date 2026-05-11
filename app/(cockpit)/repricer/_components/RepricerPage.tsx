'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RepricerRule, RepricerLogEntry } from '@/lib/reselling/types'

function RuleBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${enabled ? 'bg-green-900/40 text-green-300' : 'bg-[var(--color-cockpit-surface)] text-[var(--color-text-secondary)]'}`}
    >
      {enabled ? 'Active' : 'Paused'}
    </span>
  )
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: RepricerRule
  onToggle: (id: string, enabled: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)

  return (
    <div className="border-border rounded-lg border bg-[var(--color-cockpit-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-[var(--color-text-primary)]">{rule.asin}</span>
            <RuleBadge enabled={rule.enabled} />
            <span className="rounded bg-[var(--color-cockpit-bg)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
              {rule.rule_type}
            </span>
          </div>
          {rule.title && (
            <p className="mt-0.5 truncate text-sm text-[var(--color-text-secondary)]">
              {rule.title}
            </p>
          )}
          <div className="mt-1 flex gap-4 text-xs text-[var(--color-text-secondary)]">
            <span>Floor ${rule.min_price.toFixed(2)}</span>
            <span>Ceiling ${rule.max_price.toFixed(2)}</span>
            {rule.target_margin != null && <span>Target {rule.target_margin}% margin</span>}
          </div>
          {rule.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{rule.notes}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              await onToggle(rule.id, !rule.enabled)
              setSaving(false)
            }}
          >
            {rule.enabled ? 'Pause' : 'Enable'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-400 hover:text-red-300"
            disabled={saving}
            onClick={async () => {
              if (!confirm(`Delete rule for ${rule.asin}?`)) return
              setSaving(true)
              await onDelete(rule.id)
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function AddRuleForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({
    asin: '',
    title: '',
    rule_type: 'margin' as 'margin' | 'fixed' | 'competitive',
    min_price: '',
    max_price: '',
    target_margin: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.asin || !form.min_price || !form.max_price) {
      setError('ASIN, floor price, and ceiling price are required.')
      return
    }
    setSaving(true)
    const res = await fetch('/api/repricer/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asin: form.asin,
        title: form.title || undefined,
        rule_type: form.rule_type,
        min_price: parseFloat(form.min_price),
        max_price: parseFloat(form.max_price),
        target_margin: form.target_margin ? parseFloat(form.target_margin) : undefined,
        notes: form.notes || undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json()
      setError(j.error ?? 'Failed to save rule')
      return
    }
    setForm({
      asin: '',
      title: '',
      rule_type: 'margin',
      min_price: '',
      max_price: '',
      target_margin: '',
      notes: '',
    })
    onAdded()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border space-y-4 rounded-lg border bg-[var(--color-cockpit-surface)] p-4"
    >
      <h3 className="font-medium text-[var(--color-text-primary)]">Add Repricing Rule</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>ASIN</Label>
          <Input
            placeholder="B0XXXXXXXX"
            value={form.asin}
            onChange={(e) => setForm({ ...form, asin: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label>Product title (optional)</Label>
          <Input
            placeholder="Short description"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Rule type</Label>
          <Select
            value={form.rule_type}
            onValueChange={(v) => setForm({ ...form, rule_type: v as RepricerRule['rule_type'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="margin">Margin target</SelectItem>
              <SelectItem value="fixed">Fixed price</SelectItem>
              <SelectItem value="competitive">Competitive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Floor price ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="19.99"
            value={form.min_price}
            onChange={(e) => setForm({ ...form, min_price: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label>Ceiling price ($)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="34.99"
            value={form.max_price}
            onChange={(e) => setForm({ ...form, max_price: e.target.value })}
          />
        </div>
        {form.rule_type === 'margin' && (
          <div className="space-y-1">
            <Label>Target margin (%)</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              placeholder="15"
              value={form.target_margin}
              onChange={(e) => setForm({ ...form, target_margin: e.target.value })}
            />
          </div>
        )}
        <div className="space-y-1 sm:col-span-3">
          <Label>Notes (optional)</Label>
          <Input
            placeholder="e.g. holiday season bump"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Add Rule'}
      </Button>
    </form>
  )
}

export function RepricerPage() {
  const [rules, setRules] = useState<RepricerRule[]>([])
  const [log, setLog] = useState<RepricerLogEntry[]>([])
  const [loadingRules, setLoadingRules] = useState(true)
  const [loadingLog, setLoadingLog] = useState(false)

  async function fetchRules() {
    setLoadingRules(true)
    const res = await fetch('/api/repricer/rules')
    const j = await res.json()
    setRules(j.rules ?? [])
    setLoadingRules(false)
  }

  async function fetchLog() {
    setLoadingLog(true)
    const res = await fetch('/api/repricer/log')
    const j = await res.json()
    setLog(j.log ?? [])
    setLoadingLog(false)
  }

  useEffect(() => {
    fetch('/api/repricer/rules')
      .then((r) => r.json())
      .then((j) => {
        setRules(j.rules ?? [])
        setLoadingRules(false)
      })
      .catch(() => setLoadingRules(false))
  }, [])

  async function toggleRule(id: string, enabled: boolean) {
    await fetch(`/api/repricer/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    await fetchRules()
  }

  async function deleteRule(id: string) {
    await fetch(`/api/repricer/rules/${id}`, { method: 'DELETE' })
    await fetchRules()
  }

  const active = rules.filter((r) => r.enabled)
  const paused = rules.filter((r) => !r.enabled)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Repricer</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          FBA price rule management — ported from 65_Repricer.py
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active rules', value: active.length },
          { label: 'Paused rules', value: paused.length },
          { label: 'Total rules', value: rules.length },
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

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="add">Add Rule</TabsTrigger>
          <TabsTrigger value="log" onClick={fetchLog}>
            Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-3 pt-4">
          {loadingRules && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {!loadingRules && rules.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No rules yet. Use the Add Rule tab to get started.
            </p>
          )}
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} onToggle={toggleRule} onDelete={deleteRule} />
          ))}
        </TabsContent>

        <TabsContent value="add" className="pt-4">
          <AddRuleForm onAdded={fetchRules} />
        </TabsContent>

        <TabsContent value="log" className="pt-4">
          {loadingLog && <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>}
          {!loadingLog && log.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No repricing events logged yet.
            </p>
          )}
          <div className="space-y-2">
            {log.map((entry) => (
              <div
                key={entry.id}
                className="border-border flex items-center justify-between rounded border bg-[var(--color-cockpit-surface)] px-4 py-2 text-sm"
              >
                <span className="font-mono text-[var(--color-text-primary)]">{entry.asin}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {entry.old_price != null ? `$${entry.old_price.toFixed(2)} → ` : ''}$
                  {entry.new_price.toFixed(2)}
                </span>
                <span className="text-[var(--color-text-secondary)]">{entry.reason ?? '—'}</span>
                {entry.dry_run && <span className="text-xs text-yellow-400">dry-run</span>}
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {new Date(entry.logged_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
