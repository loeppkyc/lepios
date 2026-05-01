/**
 * Seed build_metrics with follow-up tasks surfaced during the financial-events build.
 *
 * Prerequisites:
 *   - PR #38 (migrations 0052+0053) must have merged — it creates the build_metrics table.
 *
 * Usage (from lepios/ dir):
 *   npx tsx scripts/seed-build-metrics-financial-events.ts
 *   (loads .env.production.local automatically via dotenv)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.production.local'), override: true })

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const ROWS = [
  {
    task_id: 'fix-pre-0050-rls-audit',
    week: 0,
    day_label: 'backlog',
    description:
      'audit pre-0050 migrations for authenticated-RLS pattern and standardize to service-role-only. ' +
      'Migrations 0034-0040 and 0036 use authenticated RLS; post-0050 pattern is no-policy service-role. ' +
      'Flag: do not alter live policies without reviewing dependent queries.',
    task_type: 'fix',
    estimate_claude_days: 0.5,
    estimate_source: 'self',
  },
  {
    task_id: 'fix-0042-migration-collision',
    week: 0,
    day_label: 'backlog',
    description:
      'Resolve 0042 filename collision: two migrations share prefix 0042 ' +
      '(0042_langfuse_schema.sql and 0042_orb_chat_schema.sql). ' +
      'Determine which ran first, rename the second to the next available number, ' +
      'and update any references. Breaks reproducibility on fresh clones.',
    task_type: 'fix',
    estimate_claude_days: 0.5,
    estimate_source: 'self',
  },
]

async function main() {
  // Guard: confirm build_metrics exists before attempting any insert.
  // The table is created by migrations 0052+0053 (PR #38). If it is absent,
  // the insert would fail with a cryptic Supabase error — better to be explicit.
  const { error: tableCheckError } = await supabase
    .from('build_metrics')
    .select('task_id')
    .limit(1)

  if (tableCheckError) {
    console.error(
      'ERROR: build_metrics not present — PR #38 (migrations 0052+0053) must merge first'
    )
    console.error('Supabase error:', tableCheckError.message)
    process.exit(1)
  }

  const { data, error } = await supabase
    .from('build_metrics')
    .upsert(ROWS, { onConflict: 'task_id', ignoreDuplicates: true })
    .select('task_id')

  if (error) {
    console.error('ERROR: upsert failed:', error.message)
    process.exit(1)
  }

  const inserted = data ?? []
  if (inserted.length === 0) {
    console.log('All rows already present — nothing inserted (ON CONFLICT DO NOTHING).')
  } else {
    console.log(`Inserted ${inserted.length} row(s):`)
    for (const row of inserted) {
      console.log(`  + ${row.task_id}`)
    }
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
