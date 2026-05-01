import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import {
  findPreviewDeployment,
  runSmokeCheck,
  detectMigrations,
  mergeToMain,
  deleteBranch,
  sendPromotionNotification,
  fetchMigrationSQL,
  sendMigrationGateMessage,
  insertSmokePendingEvent,
  fetchMainCommits,
  fetchPRBody,
} from '@/lib/harness/deploy-gate'
import { runRouteHealthSmoke } from '@/lib/harness/smoke-tests/route-health'
import { runCronRegistrationSmoke } from '@/lib/harness/smoke-tests/cron-registration'
import { runOllamaHealthSmoke } from '@/lib/harness/smoke-tests/ollama-health'
import { parseBumpDirectives, applyBumps } from '@/lib/harness/component-bump'

export const dynamic = 'force-dynamic'

const MAX_PER_TICK = 5
const TIMEOUT_MS = 10 * 60 * 1000
const PROCESSING_WINDOW_MS = 2 * 60 * 1000
const NOT_FOUND_GRACE_MS = 2 * 60 * 1000
const TRIGGER_LOOKBACK_MS = 2 * 60 * 60 * 1000 // only look at last 2h of triggers
const TERMINAL_LOOKBACK_MS = 4 * 60 * 60 * 1000 // terminal outcomes from last 4h
const SMOKE_LOOKBACK_MS = 2 * 60 * 60 * 1000

type Meta = Record<string, unknown>

type TriggerRow = {
  id: string
  meta: { commit_sha: string; task_id?: string; branch?: string }
  occurred_at: string
}

async function writeGateEvent(params: {
  task_type: string
  status: 'success' | 'error' | 'warning'
  output_summary: string
  meta: Meta
}): Promise<void> {
  const db = createServiceClient()
  await db.from('agent_events').insert({
    id: crypto.randomUUID(),
    domain: 'orchestrator',
    action: 'deploy_gate_runner',
    actor: 'deploy_gate',
    status: params.status,
    task_type: params.task_type,
    output_summary: params.output_summary,
    meta: params.meta,
    tags: ['deploy_gate', 'harness', 'chunk_b'],
  })
}

async function runSchemaCheck(
  commit_sha: string,
  branch: string,
  results: string[]
): Promise<{
  outcome: 'schema-clean' | 'schema-migrations' | 'schema-error'
  migration_files: string[]
}> {
  let schema: { has_migrations: boolean; migration_files: string[]; error?: string }
  try {
    schema = await detectMigrations(commit_sha, branch)
  } catch {
    schema = { has_migrations: false, migration_files: [], error: 'api_error' }
  }

  const schemaStatus: 'success' | 'warning' | 'error' = schema.error
    ? 'error'
    : schema.has_migrations
      ? 'warning'
      : 'success'

  try {
    await writeGateEvent({
      task_type: 'deploy_gate_schema_check',
      status: schemaStatus,
      output_summary: schema.error
        ? `schema check error: ${schema.error}`
        : schema.has_migrations
          ? `migration detected: ${schema.migration_files.join(', ')}`
          : 'no migrations',
      meta: {
        commit_sha,
        ...(schema.error
          ? { error: schema.error }
          : { has_migrations: schema.has_migrations, migration_files: schema.migration_files }),
      },
    })
  } catch {
    // swallow
  }

  const outcome: 'schema-clean' | 'schema-migrations' | 'schema-error' =
    schemaStatus === 'error'
      ? 'schema-error'
      : schemaStatus === 'warning'
        ? 'schema-migrations'
        : 'schema-clean'
  results.push(`${commit_sha}:${outcome}`)
  return { outcome, migration_files: schema.migration_files }
}

async function runMigrationGate(
  commit_sha: string,
  branch: string,
  taskId: string,
  migration_files: string[],
  results: string[]
): Promise<void> {
  let sqlResult: Awaited<ReturnType<typeof fetchMigrationSQL>>
  try {
    sqlResult = await fetchMigrationSQL(commit_sha, migration_files)
  } catch {
    sqlResult = { files: [], total_size_bytes: 0, error: 'exception' }
  }

  if (sqlResult.error) {
    try {
      await writeGateEvent({
        task_type: 'deploy_gate_failed',
        status: 'error',
        output_summary: `gate failed: migration_fetch error for commit ${commit_sha.slice(0, 8)}`,
        meta: {
          commit_sha,
          branch,
          task_id: taskId,
          reason: 'migration_fetch',
          error: sqlResult.error,
        },
      })
    } catch {
      // swallow
    }
    results.push(`${commit_sha}:migration-fetch-failed`)
    return
  }

  let msgResult: Awaited<ReturnType<typeof sendMigrationGateMessage>>
  try {
    msgResult = await sendMigrationGateMessage({
      task_id: taskId,
      branch,
      commit_sha,
      migration_files_with_sql: sqlResult.files,
    })
  } catch {
    msgResult = { ok: false, error: 'exception' }
  }

  if (!msgResult.ok) {
    try {
      await writeGateEvent({
        task_type: 'deploy_gate_failed',
        status: 'error',
        output_summary: `gate failed: migration message send failed for commit ${commit_sha.slice(0, 8)}`,
        meta: {
          commit_sha,
          branch,
          task_id: taskId,
          reason: 'migration_send',
          error: msgResult.error,
        },
      })
    } catch {
      // swallow
    }
    results.push(`${commit_sha}:migration-send-failed`)
    return
  }

  try {
    await writeGateEvent({
      task_type: 'deploy_gate_migration_review_sent',
      status: 'success',
      output_summary: `migration review sent for task ${taskId}`,
      meta: {
        commit_sha,
        branch,
        task_id: taskId,
        migration_files,
        message_id: msgResult.message_id,
        truncated: msgResult.truncated ?? false,
        sent_at: new Date().toISOString(),
      },
    })
  } catch {
    // swallow
  }

  results.push(`${commit_sha}:migration-review-sent`)
}

async function runAutoPromote(
  commit_sha: string,
  branch: string,
  taskId: string,
  results: string[]
): Promise<void> {
  const autoPromote = process.env.DEPLOY_GATE_AUTO_PROMOTE !== '0'
  if (!autoPromote) {
    results.push(`${commit_sha}:promotion-skipped`)
    return
  }

  let mergeResult: { ok: boolean; merge_sha?: string; error?: string }
  try {
    mergeResult = await mergeToMain(branch, taskId, commit_sha)
  } catch {
    mergeResult = { ok: false, error: 'exception' }
  }

  if (mergeResult.ok) {
    try {
      await writeGateEvent({
        task_type: 'deploy_gate_promoted',
        status: 'success',
        output_summary: `promoted commit ${commit_sha} to production via merge`,
        meta: {
          commit_sha,
          branch,
          task_id: taskId,
          ...(mergeResult.merge_sha ? { merge_sha: mergeResult.merge_sha } : {}),
        },
      })
    } catch {
      // swallow
    }
    results.push(`${commit_sha}:promoted`)

    // Send Telegram notification with rollback button — awaited, failure is logged only
    if (mergeResult.merge_sha) {
      try {
        const notif = await sendPromotionNotification({
          task_id: taskId,
          branch,
          merge_sha: mergeResult.merge_sha,
          commit_sha,
        })
        if (notif.ok && notif.message_id != null) {
          await writeGateEvent({
            task_type: 'deploy_gate_notification_sent',
            status: 'success',
            output_summary: `promotion notification sent for task ${taskId}`,
            meta: {
              commit_sha,
              branch,
              task_id: taskId,
              merge_sha: mergeResult.merge_sha,
              message_id: notif.message_id,
            },
          })
        } else if (!notif.ok) {
          console.error(`sendPromotionNotification failed: ${notif.error}`)
        }
      } catch (err) {
        console.error(
          `sendPromotionNotification threw: ${err instanceof Error ? err.message : err}`
        )
      }
    }

    try {
      await deleteBranch(branch)
    } catch {
      // swallow — branch cleanup must not block the promoted result
    }

    if (mergeResult.merge_sha) {
      await insertSmokePendingEvent({ merge_sha: mergeResult.merge_sha, commit_sha, branch })
    }
  } else {
    try {
      await writeGateEvent({
        task_type: 'deploy_gate_failed',
        status: 'error',
        output_summary: `gate failed: merge failed for commit ${commit_sha} — ${mergeResult.error}`,
        meta: { commit_sha, branch, reason: 'merge_failed', error: mergeResult.error },
      })
    } catch {
      // swallow
    }
    results.push(`${commit_sha}:merge-failed`)
  }
}

const BUMP_DEDUP_MS = 7 * 24 * 60 * 60 * 1000

async function runBumpSweep(): Promise<{ checked: number; applied: number }> {
  const commits = await fetchMainCommits(20)
  if (commits.length === 0) return { checked: 0, applied: 0 }

  const db = createServiceClient()

  const { data: processedRows } = await db
    .from('agent_events')
    .select('meta')
    .eq('action', 'harness_bump_processed')
    .gte('occurred_at', new Date(Date.now() - BUMP_DEDUP_MS).toISOString())

  const processedShas = new Set(
    (processedRows ?? [])
      .map((r) => ((r.meta as Record<string, unknown>)?.sha as string) ?? '')
      .filter(Boolean)
  )

  let applied = 0

  for (const commit of commits) {
    if (processedShas.has(commit.sha)) continue

    // Directives from commit message (title only on squash-merge)
    const directives = parseBumpDirectives(commit.message)
    const seen = new Set(directives.map((d) => d.id))

    // For squash-merge commits, the PR description body is dropped from the commit
    // message. Detect the PR number from the title suffix "(#N)" and fetch the body.
    const prMatch = /\(#(\d+)\)\s*$/.exec(commit.message.split('\n')[0])
    if (prMatch) {
      const prNumber = parseInt(prMatch[1], 10)
      const prBody = await fetchPRBody(prNumber)
      if (prBody) {
        for (const d of parseBumpDirectives(prBody)) {
          if (!seen.has(d.id)) {
            directives.push(d)
            seen.add(d.id)
          }
        }
      }
    }

    if (directives.length > 0) {
      const results = await applyBumps(directives, commit.sha)
      applied += results.filter((r) => r.success).length
    }

    try {
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'harness_bump_processed',
        actor: 'deploy-gate',
        status: 'success',
        meta: { sha: commit.sha, directives_found: directives.length },
      })
    } catch {
      // Non-fatal
    }
  }

  return { checked: commits.length, applied }
}

async function runProductionSmokes(): Promise<{ processed: number; results: string[] }> {
  const db = createServiceClient()
  const now = Date.now()

  const { data: pendingRows, error } = await db
    .from('agent_events')
    .select('id, meta, occurred_at')
    .eq('action', 'production_smoke_pending')
    .gte('occurred_at', new Date(now - SMOKE_LOOKBACK_MS).toISOString())
    .order('occurred_at', { ascending: true })
    .limit(10)

  if (error || !pendingRows || pendingRows.length === 0) {
    return { processed: 0, results: [] }
  }

  const { data: completeRows } = await db
    .from('agent_events')
    .select('meta')
    .eq('action', 'production_smoke_complete')
    .gte('occurred_at', new Date(now - SMOKE_LOOKBACK_MS).toISOString())

  const completedMergeShas = new Set(
    (completeRows ?? []).map((r) => (r.meta as Meta)?.merge_sha as string).filter(Boolean)
  )

  const pending = (pendingRows as Array<{ id: string; meta: Meta; occurred_at: string }>).filter(
    (r) => {
      const mergeSha = r.meta?.merge_sha as string
      return mergeSha && !completedMergeShas.has(mergeSha)
    }
  )

  if (pending.length === 0) {
    return { processed: 0, results: [] }
  }

  const baseUrl = process.env.LEPIOS_BASE_URL ?? 'https://lepios-one.vercel.app'
  const results: string[] = []

  for (const row of pending) {
    const mergeSha = row.meta.merge_sha as string
    const commitSha = (row.meta.commit_sha as string) ?? 'unknown'

    const [routeHealthResult, cronResult, ollamaResult] = await Promise.all([
      runRouteHealthSmoke(baseUrl, commitSha),
      runCronRegistrationSmoke(baseUrl),
      runOllamaHealthSmoke(), // non-critical — does not block deploy
    ])
    const allPassed = routeHealthResult.passed && cronResult.passed

    try {
      await db.from('agent_events').insert({
        domain: 'orchestrator',
        action: 'production_smoke_complete',
        actor: 'deploy-gate',
        status: allPassed ? 'success' : 'error',
        meta: {
          merge_sha: mergeSha,
          commit_sha: commitSha,
          l2_passed: routeHealthResult.passed,
          l3_results: [
            {
              module: 'route-health',
              passed: routeHealthResult.passed,
              failed_routes: routeHealthResult.failed_routes,
            },
            {
              module: 'cron-registration',
              passed: cronResult.passed,
              reason: cronResult.reason,
            },
            {
              module: 'ollama-health',
              passed: ollamaResult.passed,
              detail: ollamaResult.detail,
              latency_ms: ollamaResult.latency_ms,
            },
          ],
          total_ms: routeHealthResult.total_ms,
          base_url: baseUrl,
        },
      })
    } catch {
      // Non-fatal
    }

    results.push(`${mergeSha.slice(0, 8)}:${allPassed ? 'smoke-passed' : 'smoke-failed'}`)
  }

  return { processed: pending.length, results }
}

async function runGateRunner(): Promise<object> {
  const [smokeOutcome, bumpOutcome] = await Promise.all([runProductionSmokes(), runBumpSweep()])

  const db = createServiceClient()
  const now = Date.now()

  // Query pending trigger events — only status='success' (tests_passed=true rows)
  const { data: triggers, error: triggerErr } = await db
    .from('agent_events')
    .select('id, meta, occurred_at')
    .eq('task_type', 'deploy_gate_triggered')
    .eq('status', 'success')
    .gte('occurred_at', new Date(now - TRIGGER_LOOKBACK_MS).toISOString())
    .order('occurred_at', { ascending: true })
    .limit(50)

  if (triggerErr) throw triggerErr
  if (!triggers || triggers.length === 0) {
    return {
      ok: true,
      processed: smokeOutcome.processed,
      results: smokeOutcome.results,
      reason: 'no-pending-triggers',
      bumps: bumpOutcome,
    }
  }

  // Query terminal outcome rows — any commit_sha that already reached an end state
  const { data: terminalRows } = await db
    .from('agent_events')
    .select('id, meta')
    .in('task_type', [
      'deploy_gate_schema_check',
      'deploy_gate_failed',
      'deploy_gate_migration_review_sent',
      'deploy_gate_promoted',
      'deploy_gate_migration_aborted',
    ])
    .gte('occurred_at', new Date(now - TERMINAL_LOOKBACK_MS).toISOString())

  const terminalShas = new Set(
    (terminalRows ?? []).map((r) => (r.meta as Meta)?.commit_sha as string).filter(Boolean)
  )

  // Query recent processing markers — skip commit_shas being handled by another tick
  const { data: processingRows } = await db
    .from('agent_events')
    .select('meta')
    .eq('task_type', 'deploy_gate_processing')
    .gte('occurred_at', new Date(now - PROCESSING_WINDOW_MS).toISOString())

  const processingShas = new Set(
    (processingRows ?? []).map((r) => (r.meta as Meta)?.commit_sha as string).filter(Boolean)
  )

  // Query smoke-passed rows — triggers where smoke succeeded but schema_check not yet written
  const { data: smokePassedRows } = await db
    .from('agent_events')
    .select('meta')
    .eq('task_type', 'deploy_gate_smoke_preview')
    .eq('status', 'success')
    .gte('occurred_at', new Date(now - TERMINAL_LOOKBACK_MS).toISOString())

  const smokePassedShas = new Set(
    (smokePassedRows ?? []).map((r) => (r.meta as Meta)?.commit_sha as string).filter(Boolean)
  )

  const pending = (triggers as TriggerRow[]).filter(({ meta }) => {
    const sha = meta?.commit_sha
    return sha && !terminalShas.has(sha) && !processingShas.has(sha)
  })

  if (pending.length === 0) {
    return {
      ok: true,
      processed: smokeOutcome.processed,
      results: smokeOutcome.results,
      reason: 'all-in-progress-or-terminal',
      bumps: bumpOutcome,
    }
  }

  const toProcess = pending.slice(0, MAX_PER_TICK)
  const results: string[] = []

  for (const trigger of toProcess) {
    const { commit_sha } = trigger.meta
    const elapsedMs = now - new Date(trigger.occurred_at).getTime()

    try {
      await writeGateEvent({
        task_type: 'deploy_gate_processing',
        status: 'success',
        output_summary: `polling preview for commit ${commit_sha}`,
        meta: { commit_sha, trigger_event_id: trigger.id },
      })
    } catch {
      results.push(`${commit_sha}:processing-write-failed`)
      continue
    }

    // Smoke already passed in a prior tick — skip straight to schema check
    if (smokePassedShas.has(commit_sha)) {
      const schemaResult = await runSchemaCheck(commit_sha, trigger.meta.branch ?? '', results)
      if (schemaResult.outcome === 'schema-clean') {
        await runAutoPromote(
          commit_sha,
          trigger.meta.branch ?? '',
          trigger.meta.task_id ?? commit_sha,
          results
        )
      } else if (schemaResult.outcome === 'schema-migrations') {
        await runMigrationGate(
          commit_sha,
          trigger.meta.branch ?? '',
          trigger.meta.task_id ?? commit_sha,
          schemaResult.migration_files,
          results
        )
      }
      continue
    }

    if (elapsedMs > TIMEOUT_MS) {
      try {
        await writeGateEvent({
          task_type: 'deploy_gate_failed',
          status: 'error',
          output_summary: `gate failed: preview_timeout for commit ${commit_sha}`,
          meta: {
            commit_sha,
            trigger_event_id: trigger.id,
            reason: 'preview_timeout',
            elapsed_ms: elapsedMs,
          },
        })
        results.push(`${commit_sha}:timeout`)
      } catch {
        results.push(`${commit_sha}:timeout-write-failed`)
      }
      continue
    }

    let preview
    try {
      preview = await findPreviewDeployment(commit_sha)
    } catch {
      results.push(`${commit_sha}:vercel-api-error`)
      continue
    }

    if (preview.status === 'ready') {
      try {
        await writeGateEvent({
          task_type: 'deploy_gate_preview_ready',
          status: 'success',
          output_summary: `preview ready at ${preview.preview_url}`,
          meta: {
            commit_sha,
            deployment_id: preview.deployment_id,
            preview_url: preview.preview_url,
            trigger_event_id: trigger.id,
            elapsed_ms: elapsedMs,
          },
        })
        results.push(`${commit_sha}:ready`)
      } catch {
        results.push(`${commit_sha}:ready-write-failed`)
      }

      let smokePassed = false
      try {
        const smoke = await runSmokeCheck(preview.preview_url!)
        await writeGateEvent({
          task_type: 'deploy_gate_smoke_preview',
          status: smoke.status === 'pass' ? 'success' : 'error',
          output_summary:
            smoke.status === 'pass'
              ? `smoke pass on ${preview.preview_url}`
              : `smoke fail: ${smoke.status_code}`,
          meta: {
            commit_sha,
            preview_url: preview.preview_url,
            status_code: smoke.status_code,
            response_ms: smoke.response_ms,
            ...(smoke.body_excerpt ? { body_excerpt: smoke.body_excerpt } : {}),
            ...(smoke.error ? { error: smoke.error } : {}),
          },
        })
        smokePassed = smoke.status === 'pass'
      } catch {
        // swallow — preview_ready already written
      }
      if (smokePassed) {
        const schemaResult = await runSchemaCheck(commit_sha, trigger.meta.branch ?? '', results)
        if (schemaResult.outcome === 'schema-clean') {
          await runAutoPromote(
            commit_sha,
            trigger.meta.branch ?? '',
            trigger.meta.task_id ?? commit_sha,
            results
          )
        } else if (schemaResult.outcome === 'schema-migrations') {
          await runMigrationGate(
            commit_sha,
            trigger.meta.branch ?? '',
            trigger.meta.task_id ?? commit_sha,
            schemaResult.migration_files,
            results
          )
        }
      }
    } else if (preview.status === 'error') {
      try {
        await writeGateEvent({
          task_type: 'deploy_gate_failed',
          status: 'error',
          output_summary: `gate failed: preview_build_failed for commit ${commit_sha}`,
          meta: {
            commit_sha,
            deployment_id: preview.deployment_id,
            trigger_event_id: trigger.id,
            reason: 'preview_build_failed',
            elapsed_ms: elapsedMs,
          },
        })
        results.push(`${commit_sha}:build-error`)
      } catch {
        results.push(`${commit_sha}:build-error-write-failed`)
      }
    } else if (preview.status === 'not_found') {
      if (elapsedMs < NOT_FOUND_GRACE_MS) {
        results.push(`${commit_sha}:not-found-grace`)
      } else {
        try {
          await writeGateEvent({
            task_type: 'deploy_gate_failed',
            status: 'error',
            output_summary: `gate failed: preview_not_found for commit ${commit_sha}`,
            meta: {
              commit_sha,
              trigger_event_id: trigger.id,
              reason: 'preview_not_found',
              elapsed_ms: elapsedMs,
            },
          })
          results.push(`${commit_sha}:not-found-failed`)
        } catch {
          results.push(`${commit_sha}:not-found-write-failed`)
        }
      }
    } else {
      // building / queued — re-poll next tick, no write needed
      results.push(`${commit_sha}:building`)
    }
  }

  return {
    ok: true,
    processed: toProcess.length + smokeOutcome.processed,
    results: [...smokeOutcome.results, ...results],
    bumps: bumpOutcome,
  }
}

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await Promise.race([
      runGateRunner(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('deploy gate runner exceeded 55s timeout')), 55_000)
      ),
    ])
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    try {
      const db = createServiceClient()
      await db.from('agent_events').insert({
        domain: 'orchestrator',
        action: 'deploy_gate_runner',
        actor: 'deploy_gate',
        status: 'error',
        task_type: 'deploy_gate_failed',
        output_summary: `gate runner crashed: ${msg}`,
        meta: { error: msg, stage_failed_at: 'gate_runner' },
        tags: ['deploy_gate', 'harness', 'chunk_b'],
      })
    } catch {
      // swallow
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
