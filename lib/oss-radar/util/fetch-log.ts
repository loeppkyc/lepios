// F19 — append-only jsonl fetch log at .oss-radar/fetch-log.jsonl.
// One line per HTTP call. Enables post-hoc source-efficiency comparison.
// Server-side only (scripts / cron routes). All callers are server-side via httpRequest().

import fs from 'fs'
import path from 'path'
import type { FetchLogEntry } from '@/lib/oss-radar/types'

const LOG_PATH = path.join(process.cwd(), '.oss-radar', 'fetch-log.jsonl')

export async function appendFetchLog(entry: FetchLogEntry): Promise<void> {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8')
  } catch {
    // Never throw — logging must never break callers.
  }
}
