#!/usr/bin/env node
/**
 * session-heartbeat.mjs
 *
 * Fires on every PostToolUse hook call. Upserts one row to session_beacons
 * so any window can query "who else is active right now?"
 *
 * Throttled: only writes to Supabase if > 60s since last write, so it's
 * a cheap file-stat check on most calls.
 *
 * Never throws. Always exits 0.
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir, hostname } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_DIR = join(homedir(), '.claude', 'sessions')
const THROTTLE_MS = 60_000

async function main() {
  // Load .env.local
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  // Get current branch
  let branch = 'unknown'
  try { branch = execSync('git branch --show-current', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch {}
  if (!branch) branch = 'detached'

  // Throttle: skip if we wrote < 60s ago
  mkdirSync(STATE_DIR, { recursive: true })
  const stateFile = join(STATE_DIR, `hb-${branch.replace(/[^a-z0-9-]/gi, '_')}.json`)
  if (existsSync(stateFile)) {
    try {
      const { last_written } = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (Date.now() - new Date(last_written).getTime() < THROTTLE_MS) return
    } catch {}
  }

  // Upsert to session_beacons
  const toolName = process.env.CLAUDE_TOOL_NAME ?? null
  const body = {
    branch,
    pid: process.pid,
    hostname: hostname(),
    last_heartbeat: new Date().toISOString(),
    last_tool: toolName,
  }

  try {
    const res = await fetch(`${url}/rest/v1/session_beacons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'resolution=merge-duplicates',
        'X-Upsert': 'branch',
      },
      body: JSON.stringify({
        ...body,
        tool_count: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })

    // If the row already exists, PATCH to increment tool_count + update heartbeat
    if (res.status === 409 || res.ok) {
      await fetch(`${url}/rest/v1/session_beacons?branch=eq.${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          last_heartbeat: body.last_heartbeat,
          last_tool: toolName,
          pid: body.pid,
          hostname: body.hostname,
        }),
        signal: AbortSignal.timeout(3000),
      })
    }

    writeFileSync(stateFile, JSON.stringify({ last_written: new Date().toISOString(), branch }))
  } catch {
    // Network failure, timeout — silently skip
  }
}

main().catch(() => {}).finally(() => process.exit(0))
