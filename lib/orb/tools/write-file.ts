/**
 * writeFile — chat_ui action tool.
 *
 * Writes content to a file in the LepiOS repo.
 * dryRun=true (default): returns preview — what would be written, current line count vs new.
 * dryRun=false: actually writes the file (creates or overwrites).
 *
 * Same path security as readFileTool: ALLOWED_PREFIXES + DENY_PATTERNS.
 * Content size capped at 32KB to prevent accidental large writes.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

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

const DENY_PATTERNS = ['.env', 'secret', 'credential', '.pem', '.key', 'token']

// 32KB — enough for any realistic file edit; prevents accidental huge writes
const MAX_CONTENT_BYTES = 32_768

type Input = {
  path: string
  content: string
  dryRun?: boolean
}

type Output =
  | {
      written: false
      preview: { path: string; content: string; current_lines: number | null; new_lines: number }
    }
  | { written: true; path: string; size_bytes: number }
  | { error: 'path_not_allowed'; path: string }
  | { error: 'content_too_large'; size_bytes: number; max_bytes: number }
  | { error: 'write_error'; message: string }

function validatePath(
  inputPath: string
): { resolved: string; fullPath: string } | { error: string } {
  const stripped = inputPath.replace(/^[/\\]+/, '')
  const resolved = path.normalize(stripped).replace(/\\/g, '/')

  const allowed = ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix))
  if (!allowed) return { error: 'not_allowed' }

  const lower = resolved.toLowerCase()
  const denied = DENY_PATTERNS.some((pattern) => lower.includes(pattern))
  if (denied) return { error: 'not_allowed' }

  const fullPath = path.resolve(REPO_ROOT, resolved)
  if (!fullPath.startsWith(REPO_ROOT + path.sep) && fullPath !== REPO_ROOT) {
    return { error: 'not_allowed' }
  }

  return { resolved, fullPath }
}

export const writeFileTool: ChatTool<Input, Output> = {
  name: 'writeFile',
  description:
    'Write content to a file in the LepiOS repository. ' +
    'Allowed paths: app/, lib/, components/, tests/, docs/, supabase/migrations/, public/, scripts/. ' +
    'Always call with dryRun: true first to preview what will be written. ' +
    'Set dryRun: false only after confirming the preview looks correct. ' +
    'Content is capped at 32KB.',
  parameters: z.object({
    path: z.string().describe('Relative path from repo root, e.g. lib/orb/tools/example.ts'),
    content: z.string().describe('Full file content to write'),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe('true (default) = preview only, no write; false = actually write the file'),
  }),
  capability: 'tool.chat_ui.action.write_file',
  execute: async ({ path: inputPath, content, dryRun = true }) => {
    const validation = validatePath(inputPath)
    if ('error' in validation) {
      return { error: 'path_not_allowed', path: inputPath }
    }
    const { resolved, fullPath } = validation

    // Content size guard
    const sizeBytes = Buffer.byteLength(content, 'utf-8')
    if (sizeBytes > MAX_CONTENT_BYTES) {
      return { error: 'content_too_large', size_bytes: sizeBytes, max_bytes: MAX_CONTENT_BYTES }
    }

    if (dryRun) {
      // Read current file for line count context (null if doesn't exist yet)
      let currentLines: number | null = null
      try {
        const current = fs.readFileSync(fullPath, 'utf-8')
        currentLines = current.split('\n').length
      } catch {
        // File doesn't exist yet — that's fine for a new file
      }

      return {
        written: false,
        preview: {
          path: resolved,
          content,
          current_lines: currentLines,
          new_lines: content.split('\n').length,
        },
      }
    }

    // Actual write
    try {
      // Ensure parent directory exists
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, content, 'utf-8')
      return { written: true, path: resolved, size_bytes: sizeBytes }
    } catch (err) {
      return { error: 'write_error', message: String(err) }
    }
  },
}
