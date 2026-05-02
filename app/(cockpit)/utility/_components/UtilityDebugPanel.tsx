'use client'

import { useDevMode } from '@/lib/hooks/useDevMode'
import { DebugSection } from '@/components/cockpit/DebugSection'

interface UtilityDebugProps {
  bills: unknown[]
  summary: unknown
}

export function UtilityDebugPanel({ bills, summary }: UtilityDebugProps) {
  const [devMode] = useDevMode()
  if (!devMode) return null
  return (
    <div style={{ marginTop: 16 }}>
      <DebugSection heading="Debug — Utility Bills">
        <pre style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-nano)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify({ summary, billCount: bills.length, bills }, null, 2)}
        </pre>
      </DebugSection>
    </div>
  )
}
