/**
 * lib/rules/registry.ts
 *
 * Canonical source of truth for all F-numbered architecture/process rules.
 * F-numbers are claimed here first; prose references in CLAUDE.md files are secondary.
 *
 * To add a rule:
 *   1. Call getNextRuleNumber() to claim the next safe number.
 *   2. Append a new entry to RULES.
 *   3. Run `npm test -- tests/rules` — must stay green.
 *   4. Add prose to the relevant CLAUDE.md section.
 *
 * Note: F1–F16 and F17–F21 also appear in ~/.claude/CLAUDE.md §4 as sequential
 * failure-log labels (a separate namespace). This registry covers only the
 * architecture/process enforcement rules where collisions cause spec drift.
 */

export interface Rule {
  number: number
  name: string
  scope: 'global' | 'project'
  summary: string
  defined_at: string // "path:line" — path relative to project root (or absolute for global rules)
  references: string[] // source files that cite this rule
}

export const RULES: readonly Rule[] = [
  {
    number: 17,
    name: 'behavioral-ingestion-justification',
    scope: 'project',
    summary:
      'Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. If a module has no engine-feeding signal, reconsider building it.',
    defined_at: 'CLAUDE.md:70',
    references: [
      'app/api/twin/ask/route.ts',
      'app/api/cron/gmail-scan/route.ts',
      'lib/work-budget/parser.ts',
      'lib/harness/pickup-runner.ts',
      'scripts/embed-streamlit-source.ts',
      'docs/vision/measurement-framework.md',
      'docs/sprint-5/20-percent-better-engine-acceptance.md',
      'docs/sprint-5/attribution-acceptance.md',
    ],
  },
  {
    number: 18,
    name: 'measurement-benchmark-required',
    scope: 'project',
    summary:
      'Every new module must ship with (a) metrics capture in agent_events or a dedicated table, (b) a defined benchmark, and (c) a surfacing path so Colin can ask "how is X doing?" and get a number + comparison without reading code.',
    defined_at: 'CLAUDE.md:71',
    references: [
      'app/api/harness/notifications-drain/route.ts',
      'app/api/cron/gmail-scan/route.ts',
      'lib/orchestrator/digest.ts',
      'lib/harness/branch-guard.ts',
      'lib/harness/pickup-runner.ts',
      'lib/twin/fts-fallback.ts',
      'lib/work-budget/tracker.ts',
      'lib/harness/stall-check.ts',
      'lib/harness/telegram-stats.ts',
      'tests/harness/branch-guard.test.ts',
      'docs/vision/measurement-framework.md',
      'docs/sprint-5/20-percent-better-engine-acceptance.md',
      'docs/sprint-5/attribution-acceptance.md',
    ],
  },
  {
    number: 19,
    name: 'continuous-improvement-process',
    scope: 'global',
    summary:
      'Every system, process, and workflow is continuously evaluated for "how can this be 20% faster, cheaper, or better?" Extends the module-level 20% Better loop to the build process, communication patterns, resource utilization, and Colin-time vs autonomous-time ratio.',
    defined_at: '~/.claude/CLAUDE.md:73',
    references: [
      'CLAUDE.md:72',
      'lib/harness/process-efficiency.ts',
      'docs/handoffs/2026-04-27-w3.md',
    ],
  },
  {
    number: 20,
    name: 'design-system-enforcement',
    scope: 'project',
    summary:
      'Every port chunk must use shadcn/ui components and Tailwind utility classes only. No inline style={} attributes in TSX files. No ad-hoc CSS files. All shared components in app/components/ or components/ui/. Builder acceptance tests must grep new TSX files for style= and fail if found.',
    defined_at: 'CLAUDE.md:73',
    references: [
      'tests/design-system.test.ts',
      'docs/sprint-5/purpose-review-acceptance.md',
      'docs/sprint-5/purpose-review-study.md',
      'docs/sprint-5/work-budget-acceptance.md',
    ],
  },
  {
    // F21 was previously unlabeled (CLAUDE.md §3 rule 6, list position only).
    // Registered 2026-04-27 to prevent agents from conflating it with F17, which
    // sits immediately below it in the numbered list. Audit confirmed no actual
    // F17 drift — F17 consistently means behavioral-ingestion-justification.
    number: 21,
    name: 'acceptance-tests-first',
    scope: 'project',
    summary:
      'Every module must have written acceptance criteria before any code is written. The acceptance doc is the contract; code exists to satisfy it, not the other way around.',
    defined_at: 'CLAUDE.md:69',
    references: [
      '.claude/agents/coordinator.md',
      '.claude/agents/builder.md',
      'docs/sprint-5/20-percent-better-engine-acceptance.md',
      'docs/sprint-5/attribution-acceptance.md',
      'docs/sprint-5/gmail-scanner-acceptance.md',
      'docs/sprint-5/ollama-100-acceptance.md',
      'docs/sprint-5/purpose-review-acceptance.md',
      'docs/sprint-5/work-budget-acceptance.md',
    ],
  },
] as const

/**
 * Returns rule numbers that appear more than once in the given list.
 * Extracted so tests can inject a synthetic colliding list.
 */
export function detectCollisions(rules: readonly Rule[]): number[] {
  const seen = new Set<number>()
  const collisions: number[] = []
  for (const rule of rules) {
    if (seen.has(rule.number)) collisions.push(rule.number)
    seen.add(rule.number)
  }
  return collisions
}

/**
 * Throws if any two rules share the same number.
 * Called in CI via the registry test suite.
 */
export function assertNoCollisions(rules: readonly Rule[] = RULES): void {
  const collisions = detectCollisions(rules)
  if (collisions.length > 0) {
    throw new Error(
      `Rule number collision: F${collisions.join(', F')} assigned to multiple entries. ` +
        'Use getNextRuleNumber() to claim a safe number before adding a rule.'
    )
  }
}

/**
 * Returns the next safe rule number (max existing + 1).
 * Always call this before appending a new rule to RULES.
 */
export function getNextRuleNumber(): number {
  if (RULES.length === 0) return 17
  return Math.max(...RULES.map((r) => r.number)) + 1
}
