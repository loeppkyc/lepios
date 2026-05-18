#!/usr/bin/env node
/**
 * window-preflight.mjs — PreToolUse scope guard.
 *
 * Claude Code calls this BEFORE every Edit or Write tool invocation, passing the
 * tool input as JSON on stdin. This script checks whether the target file_path
 * falls within the current window's declared scope claim. If not, it exits 1 —
 * Claude Code interprets a non-zero PreToolUse exit as BLOCK: the edit is
 * cancelled before any file is touched.
 *
 * Exits 0 silently (allow) when:
 *   - stdin is not parseable JSON
 *   - tool input has no file_path field
 *   - file_path targets .claude/active-windows/ (self-claim update)
 *   - no active window claim exists (unclaimed session → no opinion)
 *   - WINDOW_SCOPE_BYPASS=1 is set
 *
 * Exits 1 (block) when:
 *   - active claim exists AND file_path is outside declared scope
 *
 * Wire in .claude/settings.json:
 *   "PreToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command",
 *     "command": "node scripts/window-preflight.mjs" }] }]
 */

import { resolve, relative } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentBranch, fileMatchesScope, loadClaimForBranch } from './lib/window-claim.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Bypass: explicit user approval for one-off out-of-scope edits
if (process.env.WINDOW_SCOPE_BYPASS === '1') process.exit(0)

// Read tool input from stdin (Claude Code passes it as JSON)
const raw = await new Promise((resolve) => {
  let buf = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (c) => { buf += c })
  process.stdin.on('end', () => resolve(buf))
  process.stdin.on('error', () => resolve(''))
  setTimeout(() => resolve(buf), 2000)
})

let toolInput
try {
  const parsed = JSON.parse(raw || '{}')
  // Claude Code may wrap as { tool_name, tool_input } or pass the input directly
  toolInput = parsed.tool_input ?? parsed
} catch {
  process.exit(0)
}

const rawPath = toolInput.file_path
if (!rawPath) process.exit(0)

// Normalize to forward slashes and make relative to project root
let filePath = rawPath.replace(/\\/g, '/')
if (filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath)) {
  // Absolute path — make relative to repo root
  try {
    filePath = relative(ROOT, resolve(rawPath)).replace(/\\/g, '/')
  } catch {
    // If relative() fails, use the normalized absolute path as-is
  }
}

// Always allow self-claim updates
if (/^\.claude\/active-windows\/.*\.json$/.test(filePath)) process.exit(0)

let branch
try { branch = currentBranch() } catch { process.exit(0) }
if (!branch) process.exit(0)

let claim
try { claim = loadClaimForBranch(branch) } catch { process.exit(0) }
if (!claim) process.exit(0)

if (!fileMatchesScope(filePath, claim.scope)) {
  process.stderr.write(`SCOPE VIOLATION — edit blocked by multi-window protocol\n`)
  process.stderr.write(`  File:  ${filePath}\n`)
  process.stderr.write(`  Scope: [${claim.scope.join(', ')}]\n`)
  process.stderr.write(`  Fix:   run \`node scripts/window-end.mjs\` then re-claim with a broader scope,\n`)
  process.stderr.write(`         or set WINDOW_SCOPE_BYPASS=1 if Colin has explicitly approved this edit.\n`)
  process.exit(1)
}

process.exit(0)
