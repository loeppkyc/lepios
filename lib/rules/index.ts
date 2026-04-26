/**
 * lib/rules/index.ts — canonical registry of LepiOS architectural rules.
 *
 * **This file is the single source of truth for F-numbered rule IDs.**
 *
 * The F19/F19 collision (commit 344ca13, logged as F-L8) happened because two
 * coordinators in parallel windows appended to CLAUDE.md §3 independently with
 * no compile-time check for collision. A typed `as const` object makes a
 * duplicate key a TypeScript error — the failure mode is moved from
 * "manual review catches it later" to "tsc --noEmit fails immediately."
 *
 * To add a new rule:
 *   1. Claim the next ID in this file (`nextRuleId()` returns it).
 *   2. Add the entry; TypeScript will block any duplicate key.
 *   3. Mirror the prose into CLAUDE.md §3. The registry test asserts both files
 *      stay in sync.
 *
 * The `ingest` block on each rule is consumed by scripts/ingest-claude-md.ts,
 * which loops over this registry to emit knowledge-base chunks. Adding F21
 * here automatically gives it a chunk on the next ingest run.
 */

export interface RuleIngest {
  title: string
  problem: string
  solution: string
  context: string
  confidence: number
}

export interface ArchitectureRule {
  id: string
  slug: string
  title: string
  shipped: string
  section: string
  ingest: RuleIngest
}

export const ARCHITECTURE_RULES = {
  F17: {
    id: 'F17',
    slug: 'behavioral',
    title: 'Behavioral ingestion justification required',
    shipped: '2026-04-21',
    section: '§3.7',
    ingest: {
      title: 'F17: Every new module must justify its behavioral ingestion signal',
      problem: 'What do I need to justify before building a new LepiOS module?',
      solution:
        'Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. If a module has no engine-feeding signal, reconsider building it. See docs/vision/behavioral-ingestion-spec.md.',
      context:
        'Source: lepios CLAUDE.md §3 Architecture Rules F17. Keywords: behavioral, ingestion, signal, module, justify',
      confidence: 0.85,
    },
  },
  F18: {
    id: 'F18',
    slug: 'measurement',
    title: 'Measurement + benchmark required',
    shipped: '2026-04-21',
    section: '§3.8',
    ingest: {
      title: 'F18: Every new module must ship with metrics, benchmark, and surfacing path',
      problem: 'What observability requirements must every new LepiOS module meet?',
      solution:
        "Every new module must ship with: (a) metrics capture (agent_events or dedicated table), (b) a defined benchmark to compare against (industry standard, known-good reference, or Colin target), (c) a surfacing path so Colin can ask 'how is X doing?' and get a number + comparison. Required for autonomous operation.",
      context:
        'Source: lepios CLAUDE.md §3 Architecture Rules F18. Keywords: metrics, benchmark, measurement, observability, module',
      confidence: 0.85,
    },
  },
  F19: {
    id: 'F19',
    slug: 'continuous-improvement',
    title: 'Continuous improvement (process layer)',
    shipped: '2026-04-26',
    section: '§3.9',
    ingest: {
      title: 'F19: Every system/process/workflow evaluated for 20% faster/cheaper/better',
      problem:
        'What continuous improvement obligation applies to every LepiOS system and build process?',
      solution:
        'Every system, process, and workflow is continuously evaluated for "how can this be 20% faster, cheaper, or better?" Scope: (a) build process — parallelization, batching, idle resource detection; (b) module quality — correctness, performance, UX, extensibility, data model, observability; (c) communication patterns — paste blocks, friction signals, repeated clarifications; (d) resource utilization — Claude Code windows, coordinator quota, Ollama vs frontier routing; (e) Colin-time vs autonomous-time ratio — should trend toward autonomous. Every build cycle ends with "what would have made this 20% faster?" logged to CLAUDE.md §9. 20% Better loop surfaces top 3 suggestions in morning_digest.',
      context:
        'Source: lepios CLAUDE.md §3 Architecture Rules F19. Instrumented: lib/harness/process-efficiency.ts (4 signals: queue throughput, pickup latency, queue depth, friction index). Keywords: 20% better, continuous improvement, build process, efficiency, autonomous',
      confidence: 0.85,
    },
  },
  F20: {
    id: 'F20',
    slug: 'design-system',
    title: 'Design system enforcement',
    shipped: '2026-04-26',
    section: '§3.10',
    ingest: {
      title: 'F20: No inline style={} in TSX — shadcn/ui + Tailwind only',
      problem: 'Can I use inline style attributes or ad-hoc CSS in LepiOS TSX files?',
      solution:
        "No inline style={} attributes in TSX files. No ad-hoc CSS files. shadcn/ui components and Tailwind utility classes only. All shared components in app/components/ or components/ui/. Builder acceptance tests must grep new TSX files for 'style=' and fail if found.",
      context:
        'Source: lepios CLAUDE.md §3 Architecture Rules F20. Keywords: inline style, TSX, shadcn, Tailwind, CSS',
      confidence: 0.9,
    },
  },
} as const satisfies Record<string, ArchitectureRule>

export type RuleId = keyof typeof ARCHITECTURE_RULES

export function nextRuleId(): string {
  const nums = Object.keys(ARCHITECTURE_RULES).map((k) => parseInt(k.slice(1), 10))
  return `F${Math.max(...nums) + 1}`
}
