/**
 * getHarnessRollup — slice 1's single wired tool.
 *
 * Returns the current weighted harness completion percentage.
 * Read-only; no approval gate needed (needsApproval defaults false).
 *
 * Spec: docs/harness/CHAT_UI_SPEC.md §M2.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { computeHarnessRollup } from '@/lib/harness/rollup'

const TierEnum = z.enum(['T1', 'T2', 'T3', 'T4', 'all']).optional().default('all')

type HarnessRollupInput = { tier?: 'T1' | 'T2' | 'T3' | 'T4' | 'all' }
type HarnessRollupOutput = {
  rollupPct: number
  componentCount: number
  computedAt: string
  byTier: Record<string, number>
}

export const harnessRollupTool: ChatTool<HarnessRollupInput, HarnessRollupOutput> = {
  name: 'getHarnessRollup',
  description:
    'Returns the current weighted harness completion percentage. ' +
    'Optionally filtered by tier (T1–T4). byTier is reserved for future tier-column support.',
  parameters: z.object({ tier: TierEnum }),
  capability: 'tool.chat_ui.read.harness_rollup',
  execute: async ({ tier }) => {
    const r = await computeHarnessRollup(
      tier === 'all' || tier === undefined ? undefined : { tier },
    )
    if (!r) {
      return {
        rollupPct: 0,
        componentCount: 0,
        computedAt: new Date().toISOString(),
        byTier: {},
      }
    }
    return {
      rollupPct: r.rollup_pct,
      componentCount: r.components.length,
      computedAt: r.computed_at,
      byTier: {},
    }
  },
}
