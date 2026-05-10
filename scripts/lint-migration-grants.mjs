#!/usr/bin/env node
/**
 * F24 — lint-migration-grants.mjs
 *
 * For every migration >= 0180 containing CREATE TABLE, verify it also
 * contains GRANT INSERT, UPDATE, DELETE ... TO service_role OR is marked
 * -- AD7-exempt. Exits 1 on any violation.
 *
 * Legacy migrations (< 0180) are excluded — they predate this rule.
 */
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const MIN_MIGRATION = 180

let violations = 0
let checked = 0

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

for (const file of files) {
  const num = parseInt(file.slice(0, 4), 10)
  if (num < MIN_MIGRATION) continue
  const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
  if (!content.toUpperCase().includes('CREATE TABLE')) continue
  checked++
  if (content.includes('-- AD7-exempt')) continue
  if (/GRANT\s+INSERT.*TO\s+service_role/is.test(content)) continue
  console.error(`❌ ${file}: CREATE TABLE without GRANT INSERT/UPDATE/DELETE TO service_role (add -- AD7-exempt to skip)`)
  violations++
}

if (violations > 0) {
  console.error(`\n${violations} violation(s). Add GRANT block or mark -- AD7-exempt.`)
  process.exit(1)
} else {
  console.log(`✅ ${checked} migration(s) >= 0180 with CREATE TABLE checked — all compliant.`)
}
