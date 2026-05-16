/**
 * index.mjs — LepiOS MCP Server
 *
 * Local MCP server exposing key LepiOS Supabase tables and harness tools as
 * typed MCP tools that Claude Code can call directly via stdio transport.
 *
 * Usage (from repo root):
 *   node mcp-server/index.mjs
 *
 * Reads credentials from .env.local (same file as the Next.js app).
 * If credentials are missing, the server still starts — each tool call
 * returns a descriptive error explaining what's missing.
 *
 * F18: every tool call is logged to agent_events with action='mcp_tool_call',
 * meta.tool_name, and meta.latency_ms.
 * Benchmark: <5s per call (vs ~3min paste-loop baseline).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerQueryTool } from './tools/query.mjs'
import { registerHarnessTools } from './tools/harness.mjs'
import { registerTaskTools } from './tools/tasks.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ──────────────────────────────────────────────────────────
// The server is typically invoked with cwd = repo root.
// .env.local lives at <repo-root>/.env.local.
// __dirname is <repo-root>/mcp-server, so go up one level.
function loadEnvLocal() {
  const envPath = join(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return {}

  const env = {}
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    let v = trimmed.slice(eq + 1).trim()
    // Strip surrounding quotes if present
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    // Strip Windows \r artifacts (F15 prevention)
    env[k] = v.replace(/\r$/, '')
  }
  return env
}

const envVars = loadEnvLocal()
const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  envVars['NEXT_PUBLIC_SUPABASE_URL'] ??
  ''
).trim()
const serviceKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  envVars['SUPABASE_SERVICE_ROLE_KEY'] ??
  ''
).trim()

// ── Supabase client (null if creds missing) ──────────────────────────────────
let db = null
if (supabaseUrl && serviceKey) {
  db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
} else {
  process.stderr.write(
    '[lepios-mcp] WARNING: Supabase credentials missing. ' +
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local. ' +
      'Tool calls will return errors until credentials are present.\n'
  )
}

// ── F18: log tool call to agent_events ───────────────────────────────────────
// Non-blocking — a logging failure must never crash the server.
async function logToolCall(toolName, latencyMs) {
  if (!db) return
  try {
    await db.from('agent_events').insert({
      domain: 'mcp_server',
      action: 'mcp_tool_call',
      actor: 'lepios-mcp',
      status: 'success',
      input_summary: toolName,
      meta: { tool_name: toolName, latency_ms: latencyMs },
    })
  } catch {
    // Intentionally swallowed — log failures must not interrupt tool responses.
  }
}

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer(
  { name: 'lepios', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ── Register tools ───────────────────────────────────────────────────────────
registerQueryTool(server, db, logToolCall)
registerHarnessTools(server, db, logToolCall)
registerTaskTools(server, db, logToolCall)

// ── Start transport ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)

process.stderr.write('[lepios-mcp] Server started. Listening on stdio.\n')
