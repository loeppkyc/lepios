#!/usr/bin/env tsx
/**
 * Track build_metrics from the CLI.
 *
 * Hits localhost:3000 by default. Override with --base-url or env METRICS_BASE_URL.
 * Sends Bearer CRON_SECRET if present in env.
 *
 * Examples:
 *   npx tsx scripts/track.ts start gmail-invoice-classifier-port \
 *     --week 1 --day-label Mon --estimate 0.5 --type port \
 *     --source claude_chat --desc "Port Gmail invoice classifier"
 *
 *   npx tsx scripts/track.ts finish gmail-invoice-classifier-port \
 *     --active 90 --windows 2 --clears 0 --rejections 0 --first-try true \
 *     --notes "shipped clean"
 */

import { config } from 'dotenv'
import path from 'path'

config({ path: path.resolve(process.cwd(), '.env.local') })
config({ path: path.resolve(process.cwd(), '.env') })

const args = process.argv.slice(2)
const cmd = args[0]
const taskId = args[1]

function flag(name: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}`)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined
}

const baseUrl = flag('base-url') ?? process.env.METRICS_BASE_URL ?? 'http://localhost:3000'
const cronSecret = process.env.CRON_SECRET

function usage(msg?: string): never {
  if (msg) console.error(msg)
  console.error(
    `Usage:\n` +
      `  track start  <task_id> --week <n> --day-label <text> [--estimate <days>] [--type <port|new_build|migration|fix>] [--source <claude_chat|self|revised>] [--desc "..."]\n` +
      `  track finish <task_id> [--active <minutes>] [--windows <n>] [--clears <n>] [--rejections <n>] [--first-try <true|false>] [--notes "..."]`
  )
  process.exit(1)
}

if (!cmd || !['start', 'finish'].includes(cmd)) usage('first arg must be start|finish')
if (!taskId) usage('task_id required')

async function call(routePath: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`

  const res = await fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, json)
    process.exit(1)
  }
  console.log(JSON.stringify(json, null, 2))
}

async function main() {
  if (cmd === 'start') {
    const week = flag('week')
    const dayLabel = flag('day-label')
    if (!week || !dayLabel) usage('--week and --day-label required for start')

    await call('/api/metrics/start', {
      task_id: taskId,
      week: parseInt(week!, 10),
      day_label: dayLabel,
      description: flag('desc'),
      estimate_claude_days: flag('estimate') ? parseFloat(flag('estimate')!) : undefined,
      estimate_source: flag('source'),
      task_type: flag('type'),
    })
  } else {
    const firstTry = flag('first-try')
    if (firstTry !== undefined && !['true', 'false'].includes(firstTry)) {
      usage('--first-try must be true or false')
    }

    await call('/api/metrics/finish', {
      task_id: taskId,
      active_minutes: flag('active') ? parseInt(flag('active')!, 10) : undefined,
      parallel_windows: flag('windows') ? parseInt(flag('windows')!, 10) : undefined,
      clear_resets: flag('clears') ? parseInt(flag('clears')!, 10) : undefined,
      reviewer_rejections: flag('rejections') ? parseInt(flag('rejections')!, 10) : undefined,
      first_try_pass: firstTry !== undefined ? firstTry === 'true' : undefined,
      notes: flag('notes'),
    })
  }
}

main().catch((err) => {
  console.error('track failed:', err)
  process.exit(1)
})
