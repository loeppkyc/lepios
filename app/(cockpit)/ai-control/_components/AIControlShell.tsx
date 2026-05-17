'use client'

import { useState } from 'react'
import { AuditTrailTab } from './AuditTrailTab'
import { ConfigTab } from './ConfigTab'
import { WindowsTab } from './WindowsTab'
import { CapabilitiesTab } from './CapabilitiesTab'

const TABS = [
  { id: 'audit', label: 'Audit Trail' },
  { id: 'config', label: 'Config' },
  { id: 'windows', label: 'Windows' },
  { id: 'capabilities', label: 'Capabilities' },
] as const

type TabId = (typeof TABS)[number]['id']

export interface AuditEvent {
  id: string
  occurred_at: string
  domain: string | null
  action: string | null
  actor: string | null
  status: string | null
  input_summary: string | null
  output_summary: string | null
  error_message: string | null
  duration_ms: number | null
  tokens_used: number | null
  model: string | null
  cost_usd: number | null
}

export interface ConfigEntry {
  key: string
  value: string
}

export interface SessionBeacon {
  branch: string | null
  pid: number | null
  hostname: string | null
  started_at: string | null
  last_heartbeat: string | null
  tool_count: number | null
  last_tool: string | null
}

export interface Capability {
  capability: string
  domain: string | null
  description: string | null
  default_enforcement: string | null
  destructive: boolean | null
  created_at: string | null
}

interface Props {
  auditEvents: AuditEvent[]
  config: ConfigEntry[]
  sessions: SessionBeacon[]
  capabilities: Capability[]
}

export function AIControlShell({ auditEvents, config, sessions, capabilities }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('audit')

  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        className="flex flex-wrap border-b border-[var(--color-border)]"
      >
        {TABS.map((t) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(t.id)}
              className={[
                'border-b-2 px-4 py-2 font-[var(--font-ui)] text-[length:var(--text-small)] font-medium tracking-wider transition-colors',
                active
                  ? 'border-[var(--color-accent-gold)] text-[var(--color-accent-gold)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div>
        {activeTab === 'audit' && <AuditTrailTab events={auditEvents} />}
        {activeTab === 'config' && <ConfigTab entries={config} />}
        {activeTab === 'windows' && <WindowsTab sessions={sessions} />}
        {activeTab === 'capabilities' && <CapabilitiesTab capabilities={capabilities} />}
      </div>
    </div>
  )
}
