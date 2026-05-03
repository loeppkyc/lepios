// fs-handlers.ts — wires fs module into the dispatch registry.
//
// These registrations happen at module load time (side-effectful import).
// Import this module for side effects only:
//   import '@/lib/harness/arms-legs/fs-handlers'
//
// Path guard: all operations are restricted to process.cwd().
// Traversal attempts (e.g. ../../etc/passwd) are rejected before the fs call.

import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { resolve, dirname, sep } from 'path'
import { registerHandler } from './dispatch'

// ── Payload types ─────────────────────────────────────────────────────────────

export interface FsReadPayload {
  filePath: string
  encoding?: BufferEncoding
}

export interface FsWritePayload {
  filePath: string
  content: string
  encoding?: BufferEncoding
}

export interface FsDeletePayload {
  filePath: string
}

// ── Path guard ────────────────────────────────────────────────────────────────

function assertWithinProject(filePath: string): void {
  const root = resolve(process.cwd())
  const normalized = resolve(filePath)
  if (normalized !== root && !normalized.startsWith(root + sep)) {
    throw new Error(`fs operation outside project root: ${filePath}`)
  }
}

// ── Handler registrations ─────────────────────────────────────────────────────

registerHandler<FsReadPayload, { content: string }>('fs.read', async (payload) => {
  assertWithinProject(payload.filePath)
  const content = readFileSync(payload.filePath, payload.encoding ?? 'utf-8') as string
  return { content }
})

registerHandler<FsWritePayload, { written: true }>('fs.write', async (payload) => {
  assertWithinProject(payload.filePath)
  mkdirSync(dirname(payload.filePath), { recursive: true })
  writeFileSync(payload.filePath, payload.content, payload.encoding ?? 'utf-8')
  return { written: true }
})

registerHandler<FsDeletePayload, { deleted: true }>('fs.delete', async (payload) => {
  assertWithinProject(payload.filePath)
  unlinkSync(payload.filePath)
  return { deleted: true }
})
