'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DropboxAuditRun, DropboxArchiverResponse } from '@/lib/dropbox-archiver/types'

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60)
}

export function DropboxArchiverPage() {
  const [latest, setLatest] = useState<DropboxAuditRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cutoffDays, setCutoffDays] = useState(90)
  const [notConfigured, setNotConfigured] = useState(false)

  useEffect(() => {
    fetch('/api/dropbox-archiver')
      .then((r) => r.json())
      .then((d: DropboxArchiverResponse) => {
        setLatest(d.latest)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function runAudit() {
    setRunning(true)
    setError(null)
    const res = await fetch('/api/dropbox-archiver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cutoff_days: cutoffDays }),
    })
    const data = await res.json()
    setRunning(false)
    if (!res.ok) {
      if (data.error?.includes('DROPBOX_ACCESS_TOKEN')) setNotConfigured(true)
      else setError(data.error ?? 'Audit failed')
    } else {
      setLatest(data as DropboxAuditRun)
    }
  }

  const staleHours = latest ? hoursAgo(latest.ran_at) : null
  const isStale = staleHours !== null && staleHours > 24

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Dropbox Archiver</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Offload old files to free up Dropbox storage — 3-stage pipeline
        </p>
      </div>

      {notConfigured && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-400">Dropbox not configured</p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Add <code className="bg-cockpit-surface rounded px-1">DROPBOX_ACCESS_TOKEN</code> to
            your Vercel env vars. Generate a long-lived token from the Dropbox App Console → your
            app → Generated access token.
          </p>
        </div>
      )}

      {/* Settings */}
      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Settings</h2>
        <div className="flex items-center gap-4">
          <label className="text-xs whitespace-nowrap text-[var(--color-text-secondary)]">
            Archive files older than
          </label>
          <input
            type="range"
            min={30}
            max={730}
            step={30}
            value={cutoffDays}
            onChange={(e) => setCutoffDays(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-20 text-right text-sm font-medium text-[var(--color-text-primary)]">
            {cutoffDays} days
          </span>
        </div>
      </section>

      {/* Stage 1: Audit */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Stage 1 — Audit
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Check Dropbox storage usage and count archiveable files.
        </p>

        {isStale && latest && (
          <p className="text-xs text-amber-400">
            Last audited {Math.round(staleHours!)} hours ago — re-run to refresh
          </p>
        )}

        {loading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
        ) : latest ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: 'Dropbox Used',
                  value: `${latest.used_gb?.toFixed(1)} GB`,
                  sub: `${latest.pct_used?.toFixed(0)}% of ${latest.quota_gb?.toFixed(0)} GB`,
                },
                { label: 'Archiveable', value: latest.archiveable_total?.toLocaleString() ?? '—' },
                { label: 'Already Local', value: latest.already_local?.toLocaleString() ?? '—' },
                {
                  label: 'Need Download',
                  value: `${latest.need_download?.toLocaleString() ?? '—'}`,
                  sub: `${latest.need_download_gb?.toFixed(2)} GB`,
                },
              ].map(({ label, value, sub }) => (
                <div key={label} className="border-border bg-cockpit-surface rounded-md border p-3">
                  <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
                  <p className="text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
                  {sub && <p className="text-xs text-[var(--color-text-secondary)]">{sub}</p>}
                </div>
              ))}
            </div>
            {latest.pct_used !== null && (
              <progress
                value={Math.min(latest.pct_used, 100)}
                max={100}
                className="h-2 w-full rounded-full"
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Run the audit to see your Dropbox usage.
          </p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button onClick={runAudit} disabled={running || notConfigured}>
          {running ? 'Running audit…' : 'Run Audit'}
        </Button>
      </section>

      {/* Stage 2 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Stage 2 — Download to Your PC
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Download archiveable files from Dropbox →{' '}
          <code className="bg-cockpit-surface rounded px-1">C:/AI_Data/exports/dropbox</code>
        </p>
        <pre className="border-border bg-cockpit-surface overflow-x-auto rounded-md border p-3 text-xs text-[var(--color-text-primary)]">
          {`cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --download --days ${cutoffDays}`}
        </pre>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Safe to re-run — skips files already downloaded.
        </p>
      </section>

      {/* Stage 3 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Stage 3 — Transfer to Hard Drive
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Copy PC files → hard drive with SHA256 verification. Replace{' '}
          <code className="bg-cockpit-surface rounded px-1">D</code> with your drive letter.
        </p>
        <pre className="border-border bg-cockpit-surface overflow-x-auto rounded-md border p-3 text-xs text-[var(--color-text-primary)]">
          {`cd "c:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)"
python tools/dropbox_archiver.py --transfer D --days ${cutoffDays}`}
        </pre>
      </section>
    </div>
  )
}
