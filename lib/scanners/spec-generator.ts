import type { ModuleCandidate } from './streamlit-module-scanner'
import type { Category } from './streamlit-categories'

export interface TaskSpec {
  module_filename: string
  title: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  estimated_weight: 'small' | 'medium' | 'large'
  prereqs: string[]
  audit_hints: string[]
}

const PRIORITY_MAP: Record<Category, TaskSpec['priority']> = {
  amazon: 'critical',
  finance: 'critical',
  inventory: 'high',
  automation: 'medium',
  betting_trading: 'medium',
  health: 'low',
  life: 'low',
  misc: 'low',
}

// Known LepiOS coverage by Streamlit filename keyword → file paths that already exist
const LEPIOS_COVERAGE: Array<{ filenamePattern: RegExp; hints: string[] }> = [
  {
    filenamePattern: /Amazon_Orders/i,
    hints: ['lib/amazon/orders.ts', 'lib/amazon/orders-sync.ts', 'app/(cockpit)/amazon/page.tsx'],
  },
  {
    filenamePattern: /Marketplace_Hub|Repricer|64_|65_/i,
    hints: ['lib/amazon/orders.ts', 'app/(cockpit)/amazon/page.tsx'],
  },
  {
    filenamePattern: /Keepa/i,
    hints: ['lib/amazon/orders.ts'],
  },
  {
    filenamePattern: /Receipts/i,
    hints: ['app/(cockpit)/business-review/page.tsx'],
  },
  {
    filenamePattern: /Monthly_PL|Life_PL|Category_PL/i,
    hints: ['app/(cockpit)/business-review/page.tsx'],
  },
  {
    filenamePattern: /Bookkeeping/i,
    hints: ['app/(cockpit)/business-review/page.tsx', 'lib/amazon/settlements-sync.ts'],
  },
  {
    filenamePattern: /Notifications/i,
    hints: ['lib/harness/notifications.ts (if exists)', 'app/api/harness/notifications-drain/route.ts'],
  },
  {
    filenamePattern: /Command_Centre/i,
    hints: ['app/(cockpit)/status/page.tsx'],
  },
  {
    filenamePattern: /Tax_Return|Tax_Centre/i,
    hints: ['lib/amazon/settlements-sync.ts (net_payout for revenue reconciliation)'],
  },
]

function derivePrereqs(candidate: ModuleCandidate): string[] {
  const prereqs: string[] = []
  if (candidate.external_apis.includes('sp_api')) {
    prereqs.push('harness:amazon_orders_sync')
  }
  if (candidate.external_apis.includes('sheets')) {
    prereqs.push('lib/google/sheets-client (if not yet ported)')
  }
  if (candidate.external_apis.includes('keepa')) {
    prereqs.push('lib/keepa/client (if not yet ported)')
  }
  if (candidate.dependencies.includes('amazon')) {
    prereqs.push('harness:amazon_orders_sync')
  }
  return prereqs
}

function deriveAuditHints(candidate: ModuleCandidate): string[] {
  const hints: string[] = []
  for (const rule of LEPIOS_COVERAGE) {
    if (rule.filenamePattern.test(candidate.filename)) {
      hints.push(...rule.hints)
    }
  }
  return [...new Set(hints)]
}

function describeModule(candidate: ModuleCandidate): string {
  const parts = [
    `${candidate.line_count} lines, ${candidate.complexity} complexity.`,
  ]
  if (candidate.external_apis.length > 0) {
    parts.push(`External APIs: ${candidate.external_apis.join(', ')}.`)
  }
  if (candidate.tab_count > 0) {
    parts.push(`UI: ${candidate.tab_count} tab group(s).`)
  }
  if (candidate.dependencies.length > 0) {
    parts.push(`Imports from: ${candidate.dependencies.join(', ')}.`)
  }
  return parts.join(' ')
}

export function generateTaskSpec(candidate: ModuleCandidate): TaskSpec {
  return {
    module_filename: candidate.filename,
    title: `rebuild streamlit module: ${candidate.title}`,
    description: describeModule(candidate),
    priority: PRIORITY_MAP[candidate.category as Category] ?? 'low',
    estimated_weight: candidate.complexity,
    prereqs: derivePrereqs(candidate),
    audit_hints: deriveAuditHints(candidate),
  }
}

export function generateTaskSpecs(candidates: ModuleCandidate[]): TaskSpec[] {
  return candidates.map(generateTaskSpec)
}
