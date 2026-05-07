#!/usr/bin/env node
/**
 * F18 compliance pre-commit gate.
 *
 * F18 (lib/rules/registry.ts) requires every new cockpit module to ship:
 *   1. metrics capture (agent_events.insert or module-table write)
 *   2. a benchmark (BENCHMARK constant or module_benchmarks row)
 *   3. a surfacing path (page widget or morning_digest line)
 *
 * Statically detecting (2) + (3) is brittle. This gate enforces (1) + an
 * explicit acknowledgement of (2) and (3) via a marker comment in the new
 * module's page.tsx:
 *
 *     // F18: <bench source>; <surfacing path>
 *
 * The marker line must include the substring "F18:" anywhere in the file.
 *
 * Exemption (rare — hub pages, internal tools):
 *
 *     // F18-EXEMPT: <reason>
 *
 * Triggered on: any newly-added `app/(cockpit)/<slug>/page.tsx` in the
 * staged diff. Existing modules are tracked separately in
 * docs/f18-compliance.md and addressed by the retrofit campaign — this
 * gate stops new bleeding.
 *
 * Run via husky pre-commit. Bypass: F18_CHECK_BYPASS=1.
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const COCKPIT_PAGE_RE = /^app\/\(cockpit\)\/([^/]+)\/page\.tsx$/

export function getStagedAddedFiles() {
  try {
    // --diff-filter=A → only added files
    return execSync('git diff --cached --name-only --diff-filter=A', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return []
  }
}

export function findNewCockpitModules(addedFiles) {
  const modules = []
  for (const f of addedFiles) {
    const m = f.match(COCKPIT_PAGE_RE)
    if (m) modules.push({ slug: m[1], pageFile: f })
  }
  return modules
}

/**
 * Inspect a cockpit module for F18 markers. Pure function — pass in a reader
 * so this is testable without touching the filesystem.
 */
export function checkModuleCompliance(slug, readFile) {
  const findings = {
    slug,
    hasF18Marker: false,
    hasF18Exempt: false,
    hasCapture: false,
    captureEvidence: [],
    exemptReason: null,
  }

  const pagePath = `app/(cockpit)/${slug}/page.tsx`
  const pageSrc = readFile(pagePath) ?? ''

  // Look for marker / exemption comments anywhere in page.tsx.
  const exemptMatch = pageSrc.match(/\/\/\s*F18-EXEMPT:\s*(.+)$/m)
  if (exemptMatch) {
    findings.hasF18Exempt = true
    findings.exemptReason = exemptMatch[1].trim()
    return findings // exempt — short-circuit
  }
  if (/\/\/\s*F18:/m.test(pageSrc)) {
    findings.hasF18Marker = true
  }

  // Capture detection — agent_events.insert or a module-owned table write.
  // Search the page + obvious sibling files.
  const captureRe = /agent_events|module_metric|module_benchmark|logEvent\(/
  const candidates = [
    pagePath,
    `app/(cockpit)/${slug}/actions.ts`,
    `app/(cockpit)/${slug}/loaders.ts`,
    `lib/${slug}/index.ts`,
    `lib/${slug}/queries.ts`,
    `lib/${slug}/loaders.ts`,
    `lib/${slug}/actions.ts`,
  ]
  for (const c of candidates) {
    const src = readFile(c)
    if (src && captureRe.test(src)) {
      findings.hasCapture = true
      findings.captureEvidence.push(c)
    }
  }

  return findings
}

export function summarizeFindings(findings) {
  // F18-compliant if exempt OR (marker + capture).
  if (findings.hasF18Exempt) {
    return { ok: true, reason: `exempt: ${findings.exemptReason}` }
  }
  const missing = []
  if (!findings.hasF18Marker) missing.push('F18: marker comment in page.tsx')
  if (!findings.hasCapture) missing.push('metrics capture (agent_events / logEvent / module table)')
  if (missing.length === 0) {
    return {
      ok: true,
      reason: `marker present, capture in: ${findings.captureEvidence.join(', ')}`,
    }
  }
  return { ok: false, missing }
}

function readIfExists(path) {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function main() {
  if (process.env.F18_CHECK_BYPASS === '1') {
    console.log('check-f18-compliance: bypassed via F18_CHECK_BYPASS=1')
    process.exit(0)
  }

  const added = getStagedAddedFiles()
  const newModules = findNewCockpitModules(added)
  if (newModules.length === 0) process.exit(0)

  const failures = []
  for (const { slug } of newModules) {
    const findings = checkModuleCompliance(slug, readIfExists)
    const summary = summarizeFindings(findings)
    if (!summary.ok) failures.push({ slug, missing: summary.missing })
  }

  if (failures.length === 0) {
    process.exit(0)
  }

  console.error(`❌ F18 compliance gate — ${failures.length} new module(s) missing requirements:`)
  console.error('')
  for (const f of failures) {
    console.error(`   ${f.slug}:`)
    for (const m of f.missing) console.error(`     - ${m}`)
    console.error('')
  }
  console.error('   F18 (lib/rules/registry.ts): every new cockpit module must ship metrics')
  console.error('   capture + benchmark + surfacing. The gate enforces capture + a marker')
  console.error('   comment that names the benchmark and surfacing path. Add to page.tsx:')
  console.error('')
  console.error('       // F18: bench=<source>; surface=<page widget | morning_digest line>')
  console.error('')
  console.error('   Or, if the module is a hub or internal tool with no real metric:')
  console.error('')
  console.error('       // F18-EXEMPT: <reason>')
  console.error('')
  console.error('   See docs/f18-compliance.md for the full audit + retrofit priority order.')
  console.error('')
  console.error('   Bypass once (use rarely): F18_CHECK_BYPASS=1 git commit ...')
  process.exit(1)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
