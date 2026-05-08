/**
 * lib/harness/safety/v2/signals/scope.ts
 *
 * Scope signals — bundles three checks that all answer "is this PR doing more
 * than its task said it would?":
 *
 *   1. LOC_DELTA_2X    — actual_loc > plan_loc * 2 (only when plan_loc set)
 *   2. SHARED_SEAM_TOUCH — touches a path in the seam allowlist
 *   3. API_ROUTE_NETNEW  — new app/api/**​/route.ts file
 *
 * The scope-creep check from lib/safety/checker.ts is path-prefix based and
 * runs at pre-commit. This module is PR-scope and uses the LOC delta from
 * `git diff --shortstat` (recorded by the gate adapter) against task_queue.plan_loc.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (signal #4)
 */

import type { SignalFinding, PRDiffInput } from '../types'

// F18: lib/harness/safety/v2/signals/scope

/**
 * Shared-seam paths. Mirror of `.claude/CLAUDE.md` "Shared seams" list. A PR
 * touching any of these is structurally riskier than the LOC count alone
 * suggests because every other window depends on these files.
 *
 * Kept in sync with `.husky/pre-commit` SEAM_PATTERNS by reviewer-agent.
 */
const SHARED_SEAMS = [
  // App boundaries
  'package.json',
  'package-lock.json',
  'app/layout.tsx',
  'middleware.ts',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'tailwind.config.ts',
  'tailwind.config.js',
  'tsconfig.json',
  '.env.example',
  'eslint.config.mjs',
  'eslint.config.js',
  '.gitignore',
  // Schema
  'supabase/seed.sql',
  // Multi-window protocol
  '.claude/CLAUDE.md',
  'scripts/window-start.mjs',
  'scripts/window-end.mjs',
  'scripts/window-status.mjs',
  'scripts/window-scope-check.mjs',
  'scripts/lib/window-claim.mjs',
  '.husky/pre-commit',
  '.husky/commit-msg',
  '.husky/prepare-commit-msg',
  '.husky/post-merge',
]

function isApiRoute(path: string): boolean {
  return /^app\/api\/.+\/route\.tsx?$/.test(path)
}

function isSharedSeam(path: string): boolean {
  return SHARED_SEAMS.includes(path)
}

/**
 * Scope-LOC check. Returns a finding when actual additions exceed planned * 2.
 * `loc_added` is used because deletions don't grow scope — refactoring that
 * removes 500 LOC and adds 50 should not flag.
 *
 * Plan_loc absence (NULL in task_queue) means no scope contract was set —
 * silent on this signal in that case (not a false positive).
 */
function detectLocDelta(input: PRDiffInput): SignalFinding[] {
  if (input.plan_loc == null || input.plan_loc <= 0) return []
  const threshold = input.plan_loc * 2
  if (input.loc_added <= threshold) return []
  return [
    {
      id: 'loc_delta_2x',
      name: `LOC ${input.loc_added} > 2× plan ${input.plan_loc}`,
      weight_key: 'SAFETY_WEIGHT_LOC_DELTA_2X',
      evidence: `+${input.loc_added} actual vs ${input.plan_loc} planned (threshold ${threshold})`,
    },
  ]
}

/**
 * Shared-seam touch — one finding per seam file. Multiple seams in one PR
 * stack (e.g. package.json + tailwind.config.ts in the same PR is two findings
 * worth of weight from the scorer's perspective).
 */
function detectSharedSeams(input: PRDiffInput): SignalFinding[] {
  const findings: SignalFinding[] = []
  for (const path of input.files_changed) {
    if (!isSharedSeam(path)) continue
    findings.push({
      id: `seam_touch_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: `shared seam touched: ${path}`,
      weight_key: 'SAFETY_WEIGHT_SHARED_SEAM_TOUCH',
      evidence: path,
    })
  }
  return findings
}

/**
 * Net-new API route — counts only files in input.new_files (so a modification
 * to an existing route doesn't flag).
 */
function detectNewApiRoutes(input: PRDiffInput): SignalFinding[] {
  if (!input.new_files || input.new_files.length === 0) return []
  const findings: SignalFinding[] = []
  for (const path of input.new_files) {
    if (!isApiRoute(path)) continue
    findings.push({
      id: `api_route_netnew_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: `new API route: ${path}`,
      weight_key: 'SAFETY_WEIGHT_API_ROUTE_NETNEW',
      evidence: path,
    })
  }
  return findings
}

/**
 * Detect all three scope signals in one pass. Order is preserved (LOC, seams,
 * API routes) so audit rendering is deterministic.
 */
export function detectScope(input: PRDiffInput): SignalFinding[] {
  return [...detectLocDelta(input), ...detectSharedSeams(input), ...detectNewApiRoutes(input)]
}
