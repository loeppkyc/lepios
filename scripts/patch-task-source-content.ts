/**
 * patch-task-source-content.ts — one-shot backfill for cloud-coordinator-blocked tasks.
 *
 * Reads Streamlit .py source files from the local filesystem and embeds full text
 * into task_queue.metadata.source_content for the 4 overnight-failed tasks. Cloud
 * coordinators read this field at Phase 1a instead of attempting filesystem access.
 *
 * Run:  npx tsx scripts/patch-task-source-content.ts
 * Safe: idempotent — re-running overwrites source_content with the same value.
 *
 * Context: docs/follow-ups/2026-04-28-coordinator-cloud-source-access.md
 */

import { readFileSync } from 'fs'
import { resolve, join } from 'path'

// Load .env.local
try {
  const envLines = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of envLines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1)
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  /* no .env.local */
}

import { createClient } from '@supabase/supabase-js'

const STREAMLIT_PAGES = resolve(process.cwd(), '..', 'streamlit_app', 'pages')

interface FileSpec {
  path: string
  label: string
}

interface TaskPatch {
  id: string
  label: string
  files: FileSpec[]
  metadataPatch?: Record<string, unknown>
  priorityOverride?: number
}

const TASKS: TaskPatch[] = [
  {
    id: 'a88b0018-72fd-4e14-8d8f-815eb6eee2b9',
    label: '9_Profile.py',
    files: [{ path: '9_Profile.py', label: 'pages/9_Profile.py' }],
  },
  {
    id: 'ec1d00c7-d331-451e-ba4e-f43c946ed65e',
    label: '99_n8n_Webhook.py',
    files: [{ path: '99_n8n_Webhook.py', label: 'pages/99_n8n_Webhook.py' }],
  },
  {
    id: '8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47',
    label: '97_Dropbox_Archiver.py',
    files: [{ path: '97_Dropbox_Archiver.py', label: 'pages/97_Dropbox_Archiver.py' }],
  },
  {
    id: 'af44ba61-87d6-434e-801a-afef67de3f8c',
    label: '6_Tax_Centre.py (+ tax_centre/ subdir)',
    files: [
      { path: '6_Tax_Centre.py', label: 'pages/6_Tax_Centre.py' },
      { path: 'tax_centre/colin_tax.py', label: 'pages/tax_centre/colin_tax.py' },
      { path: 'tax_centre/megan_tax.py', label: 'pages/tax_centre/megan_tax.py' },
    ],
    // Correct the scanner misclassification: 147 lines (entry-point) → 7995 lines (full module)
    metadataPatch: {
      lines: 7995,
      complexity: 'large',
    },
    // Priority 4 = manual rebuild only — too complex for autonomous coordinator
    priorityOverride: 4,
  },
]

function buildSourceContent(files: FileSpec[]): string {
  const parts: string[] = []

  for (const f of files) {
    const fullPath = join(STREAMLIT_PAGES, f.path)
    const content = readFileSync(fullPath, 'utf-8')
    const lineCount = content.split('\n').length

    if (files.length > 1) {
      const bar = '='.repeat(60)
      parts.push(`# ${bar}\n# FILE: ${f.label} (${lineCount} lines)\n# ${bar}\n${content}`)
    } else {
      parts.push(content)
    }
  }

  return parts.join('\n\n')
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  }

  const db = createClient(supabaseUrl, serviceKey)
  const now = new Date().toISOString()

  console.log('='.repeat(60))
  console.log('LepiOS — patch task_queue.metadata with source_content')
  console.log('='.repeat(60))
  console.log(`Streamlit pages root: ${STREAMLIT_PAGES}\n`)

  let passed = 0
  let failed = 0

  for (const task of TASKS) {
    process.stdout.write(`Patching ${task.label}... `)

    // Read source content from local filesystem
    let sourceContent: string
    try {
      sourceContent = buildSourceContent(task.files)
    } catch (err) {
      console.error(
        `FAIL — could not read source: ${err instanceof Error ? err.message : String(err)}`
      )
      failed++
      continue
    }

    const sourceLineCount = sourceContent.split('\n').length

    // Fetch current metadata to merge into (preserve existing fields)
    const { data: current, error: fetchErr } = await db
      .from('task_queue')
      .select('metadata, priority')
      .eq('id', task.id)
      .single()

    if (fetchErr || !current) {
      console.error(`FAIL — fetch error: ${fetchErr?.message ?? 'row not found'}`)
      failed++
      continue
    }

    const existingMeta = (current as { metadata: Record<string, unknown> }).metadata ?? {}

    const mergedMeta: Record<string, unknown> = {
      ...existingMeta,
      // Corrected fields (e.g. lines/complexity for tax_centre)
      ...task.metadataPatch,
      // Source snapshot fields
      source_content: sourceContent,
      source_files: task.files.map((f) => f.label),
      source_captured_at: now,
      source_line_count: sourceLineCount,
    }

    const updatePayload: Record<string, unknown> = { metadata: mergedMeta }
    if (task.priorityOverride !== undefined) {
      updatePayload.priority = task.priorityOverride
    }

    const { error: updateErr } = await db.from('task_queue').update(updatePayload).eq('id', task.id)

    if (updateErr) {
      console.error(`FAIL — update error: ${updateErr.message}`)
      failed++
      continue
    }

    const charCount = sourceContent.length.toLocaleString()
    const priorityNote =
      task.priorityOverride !== undefined ? `, priority→${task.priorityOverride}` : ''
    console.log(`OK  (${sourceLineCount} lines, ${charCount} chars${priorityNote})`)
    passed++
  }

  // Verify: re-fetch all 4 rows and confirm source_content is present
  console.log('\n── Verification pass ───────────────────────────────────────')
  const ids = TASKS.map((t) => t.id)
  const { data: rows, error: verifyErr } = await db
    .from('task_queue')
    .select('id, task, priority, metadata')
    .in('id', ids)

  if (verifyErr || !rows) {
    console.error(`Verification fetch failed: ${verifyErr?.message ?? 'no rows'}`)
  } else {
    for (const row of rows as Array<{
      id: string
      task: string
      priority: number
      metadata: Record<string, unknown>
    }>) {
      const meta = row.metadata ?? {}
      const hasSource =
        typeof meta['source_content'] === 'string' && (meta['source_content'] as string).length > 0
      const lineCount = meta['source_line_count'] ?? '?'
      const files = (meta['source_files'] as string[] | undefined)?.length ?? 0
      const status = hasSource ? 'PASS' : 'FAIL — source_content missing'
      console.log(
        `  [${status}] ${row.task}  lines=${lineCount}  files=${files}  priority=${row.priority}`
      )
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Patched: ${passed}/${TASKS.length}  Failed: ${failed}`)
  console.log('='.repeat(60))

  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
