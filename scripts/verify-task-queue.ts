/**
 * verify-task-queue.ts — schema verification for migration 0015_add_task_queue.sql.
 *
 * Run from project root:
 *   npx tsx --tsconfig tsconfig.json scripts/verify-task-queue.ts
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.local.
 * Inserts and immediately deletes test rows — safe to run against production.
 *
 * Indexes and RLS policies are not queryable via the service client (PostgREST
 * does not expose pg_catalog). Steps 5–6 document the manual verification queries.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local before any imports that read env vars
const envPath = resolve(process.cwd(), '.env.local')
const envLines = readFileSync(envPath, 'utf-8').split('\n')
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  const val = trimmed.slice(eqIdx + 1)
  if (key && !(key in process.env)) process.env[key] = val
}

import { createServiceClient } from '../lib/supabase/service'

let allPassed = true

function pass(label: string) { console.log(`  ✓  ${label}`) }
function fail(label: string, detail?: string) {
  console.error(`  ✗  ${label}`)
  if (detail) console.error(`       → ${detail}`)
  allPassed = false
}
function info(msg: string) { console.log(`  ·  ${msg}`) }

async function main() {
  const db = createServiceClient()

  console.log('='.repeat(60))
  console.log('task_queue — schema verification (0015_add_task_queue.sql)')
  console.log('='.repeat(60) + '\n')

  // ── 1. Table exists ──────────────────────────────────────────────────────

  console.log('[ 1 ] Table existence')

  const { data: tableRows, error: tableErr } = await db
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_name', 'task_queue')

  if (tableErr || !tableRows?.length) {
    fail('public.task_queue exists', tableErr?.message ?? 'not found — migration not applied?')
    console.log('\n✗  Cannot continue — table missing.\n')
    process.exit(1)
  }
  pass('public.task_queue exists')

  // ── 2. Column types and nullability ──────────────────────────────────────

  console.log('\n[ 2 ] Column types and nullability')

  type ColExpect = { type: string; nullable: 'YES' | 'NO' }
  const EXPECTED: Record<string, ColExpect> = {
    id:                 { type: 'uuid',                     nullable: 'NO'  },
    task:               { type: 'text',                     nullable: 'NO'  },
    description:        { type: 'text',                     nullable: 'YES' },
    priority:           { type: 'smallint',                 nullable: 'NO'  },
    status:             { type: 'text',                     nullable: 'NO'  },
    source:             { type: 'text',                     nullable: 'NO'  },
    metadata:           { type: 'jsonb',                    nullable: 'NO'  },
    result:             { type: 'jsonb',                    nullable: 'YES' },
    retry_count:        { type: 'smallint',                 nullable: 'NO'  },
    max_retries:        { type: 'smallint',                 nullable: 'NO'  },
    created_at:         { type: 'timestamp with time zone', nullable: 'NO'  },
    claimed_at:         { type: 'timestamp with time zone', nullable: 'YES' },
    claimed_by:         { type: 'text',                     nullable: 'YES' },
    last_heartbeat_at:  { type: 'timestamp with time zone', nullable: 'YES' },
    completed_at:       { type: 'timestamp with time zone', nullable: 'YES' },
    error_message:      { type: 'text',                     nullable: 'YES' },
  }

  const { data: colRows, error: colErr } = await db
    .from('information_schema.columns')
    .select('column_name, data_type, is_nullable')
    .eq('table_schema', 'public')
    .eq('table_name', 'task_queue')

  if (colErr || !colRows) {
    fail('Column query succeeded', colErr?.message)
  } else {
    type ColRow = { column_name: string; data_type: string; is_nullable: string }
    const colMap = Object.fromEntries((colRows as ColRow[]).map((c) => [c.column_name, c]))

    for (const [name, expect] of Object.entries(EXPECTED)) {
      const actual = colMap[name] as ColRow | undefined
      if (!actual)                              { fail(`${name} — column exists`);                                              continue }
      if (actual.data_type   !== expect.type)   { fail(`${name} — type`,      `expected ${expect.type}, got ${actual.data_type}`);   continue }
      if (actual.is_nullable !== expect.nullable) { fail(`${name} — nullable`, `expected ${expect.nullable}, got ${actual.is_nullable}`); continue }
      pass(`${name}: ${expect.type}, nullable=${expect.nullable}`)
    }

    const extra = (colRows as ColRow[])
      .filter((c) => !(c.column_name in EXPECTED))
      .map((c) => c.column_name)
    if (extra.length) info(`unexpected extra columns (not an error): ${extra.join(', ')}`)
  }

  // ── 3. Default values ────────────────────────────────────────────────────

  console.log('\n[ 3 ] Default values (insert minimal row, check RETURNING)')

  const tag = `verify-task-queue-${Date.now()}`
  let insertedId: string | null = null

  try {
    const { data: row, error: insertErr } = await db
      .from('task_queue')
      .insert({ task: tag })
      .select()
      .single()

    if (insertErr || !row) {
      fail('Minimal insert (task only) succeeds', insertErr?.message)
    } else {
      insertedId = row.id
      row.status === 'queued'        ? pass("status defaults to 'queued'")          : fail("status default",       `got ${row.status}`)
      row.priority === 5             ? pass('priority defaults to 5')                : fail('priority default',     `got ${row.priority}`)
      row.source === 'manual'        ? pass("source defaults to 'manual'")           : fail("source default",       `got ${row.source}`)
      row.retry_count === 0          ? pass('retry_count defaults to 0')             : fail('retry_count default',  `got ${row.retry_count}`)
      row.max_retries === 2          ? pass('max_retries defaults to 2')             : fail('max_retries default',  `got ${row.max_retries}`)
      JSON.stringify(row.metadata) === '{}' ? pass("metadata defaults to '{}'")     : fail("metadata default",     `got ${JSON.stringify(row.metadata)}`)
      row.claimed_at === null        ? pass('claimed_at IS NULL by default')         : fail('claimed_at default',   `got ${row.claimed_at}`)
      row.claimed_by === null        ? pass('claimed_by IS NULL by default')         : fail('claimed_by default',   `got ${row.claimed_by}`)
      row.last_heartbeat_at === null ? pass('last_heartbeat_at IS NULL by default')  : fail('last_heartbeat_at default', `got ${row.last_heartbeat_at}`)
    }
  } finally {
    if (insertedId) {
      const { error: delErr } = await db.from('task_queue').delete().eq('id', insertedId)
      delErr
        ? (fail('test row cleanup', `orphaned row ${insertedId} — delete failed: ${delErr.message}`))
        : info(`test row ${insertedId} cleaned up`)
    }
  }

  // ── 4. Check constraints ─────────────────────────────────────────────────

  console.log('\n[ 4 ] Check constraints')

  // Status: invalid value rejected
  const { error: badStatus } = await db
    .from('task_queue')
    .insert({ task: 'constraint-test', status: 'invalid' })
  badStatus
    ? pass("status CHECK rejects 'invalid'")
    : fail("status CHECK rejects 'invalid'", 'insert succeeded — constraint missing or wrong')

  // Source: invalid value rejected
  const { error: badSource } = await db
    .from('task_queue')
    .insert({ task: 'constraint-test', source: 'github-issue' })
  badSource
    ? pass("source CHECK rejects 'github-issue'")
    : fail("source CHECK rejects 'github-issue'", 'insert succeeded — constraint missing or wrong')

  // Status: all valid values accepted
  for (const s of ['queued', 'claimed', 'running', 'completed', 'failed', 'cancelled'] as const) {
    const { data: r, error: e } = await db
      .from('task_queue')
      .insert({ task: `status-test-${s}`, status: s })
      .select('id')
      .single()
    if (e || !r) { fail(`status '${s}' accepted`, e?.message); continue }
    pass(`status '${s}' accepted`)
    await db.from('task_queue').delete().eq('id', r.id)
  }

  // Source: all valid values accepted
  for (const src of ['manual', 'handoff-file', 'colin-telegram', 'cron'] as const) {
    const { data: r, error: e } = await db
      .from('task_queue')
      .insert({ task: `source-test-${src}`, source: src })
      .select('id')
      .single()
    if (e || !r) { fail(`source '${src}' accepted`, e?.message); continue }
    pass(`source '${src}' accepted`)
    await db.from('task_queue').delete().eq('id', r.id)
  }

  // ── 5. Indexes — manual verification ────────────────────────────────────

  console.log('\n[ 5 ] Indexes — manual verification required')
  info('pg_catalog.pg_indexes is not accessible via PostgREST service client.')
  info('Verify in Supabase Studio → SQL Editor:')
  info("  SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'task_queue';")
  info('Expected: task_queue_pickup_idx, task_queue_stale_idx, task_queue_source_idx')

  // ── 6. RLS — manual verification ────────────────────────────────────────

  console.log('\n[ 6 ] RLS — manual verification required')
  info('Verify in Supabase Studio → Authentication → Policies → task_queue:')
  info("  Policy: task_queue_authenticated — FOR ALL, TO authenticated")
  info('Indirect test: anon requests should return empty (RLS blocks anon by default).')

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60))
  console.log(allPassed ? '✓  ALL AUTOMATED CHECKS PASSED' : '✗  SOME CHECKS FAILED')
  if (allPassed) console.log('   Complete manual steps 5–6 before marking migration verified.')
  console.log('='.repeat(60))
  process.exit(allPassed ? 0 : 1)
}

main().catch((e) => {
  console.error('Script error:', e)
  process.exit(1)
})
