/**
 * readFile — chat_ui Slice 6 read tool.
 *
 * Reads a file from the LepiOS repo. Read-only; no approval gate.
 * Only allowed path prefixes; hard-deny patterns block secrets.
 *
 * Spec: docs/acceptance/chat-ui-slice-6.md §read_file.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import fs from 'fs'
import path from 'path'

// Repo root — 4 levels up from lib/orb/tools/
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

// Allowed path prefixes (relative to repo root). NEVER allow .env, secrets, credentials.
const ALLOWED_PREFIXES = [
  'app/',
  'lib/',
  'components/',
  'tests/',
  'docs/',
  'supabase/migrations/',
  'public/',
  'scripts/',
]

// Hard deny patterns — checked against the normalized relative path (lowercased)
const DENY_PATTERNS = ['.env', 'secret', 'credential', '.pem', '.key', 'token']

const MAX_BYTES = 8192

type Input = { path: string }

type Output =
  | { path: string; content: string; size_bytes: number; truncated: boolean }
  | { error: 'path_not_allowed'; path: string }
  | { error: 'not_found'; path: string }
  | { error: 'read_error'; message: string }

export const readFileTool: ChatTool<Input, Output> = {
  name: 'readFile',
  description:
    'Read a file from the LepiOS repository. ' +
    'Only allowed paths: app/, lib/, components/, tests/, docs/, supabase/migrations/, public/, scripts/. ' +
    'Returns file contents truncated to 8KB.',
  parameters: z.object({
    path: z.string().describe('Relative path from repo root, e.g. lib/orb/tools/registry.ts'),
  }),
  capability: 'tool.chat_ui.read.file',
  execute: async ({ path: inputPath }) => {
    // 1. Normalize — strip leading slash, collapse traversal segments
    const stripped = inputPath.replace(/^[/\\]+/, '')
    const resolved = path.normalize(stripped).replace(/\\/g, '/')

    // 2. Check allowed prefix
    const allowed = ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix))
    if (!allowed) {
      return { error: 'path_not_allowed', path: resolved }
    }

    // 3. Hard deny — check lowercased resolved path for sensitive patterns
    const lower = resolved.toLowerCase()
    const denied = DENY_PATTERNS.some((pattern) => lower.includes(pattern))
    if (denied) {
      return { error: 'path_not_allowed', path: resolved }
    }

    // 4. Ensure no path traversal escapes repo root
    const fullPath = path.resolve(REPO_ROOT, resolved)
    if (!fullPath.startsWith(REPO_ROOT + path.sep) && fullPath !== REPO_ROOT) {
      return { error: 'path_not_allowed', path: resolved }
    }

    // 5. Read file
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8')
      const truncated = Buffer.byteLength(raw, 'utf-8') > MAX_BYTES
      const content = truncated ? raw.slice(0, MAX_BYTES) + '\n[truncated]' : raw
      return {
        path: resolved,
        content,
        size_bytes: content.length,
        truncated,
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return { error: 'not_found', path: resolved }
      }
      return { error: 'read_error', message: String(err) }
    }
  },
}
