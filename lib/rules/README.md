# lib/rules — F-Rule Registry

`registry.ts` is the canonical source of truth for all F-numbered architecture
and process enforcement rules. It is the only place where rule numbers are
officially assigned.

## The problem this solves

F19 was assigned twice in one day (continuous-improvement and design-system
enforcement), requiring a mid-session renumber across 6 files. Root cause: rule
numbers were claimed independently by different coordinators and sessions with no
shared authority. This registry makes collisions impossible to miss.

## Adding a new rule

1. **Claim a number** — call `getNextRuleNumber()` or look at the last entry and add 1. Never pick a number from memory.
2. **Append to RULES** in `lib/rules/registry.ts`. Fill in all fields:
   - `number` — the claimed number
   - `name` — kebab-case, unique
   - `scope` — `'global'` if it applies to all projects, `'project'` if LepiOS-specific
   - `summary` — one or two sentences; the enforcement rule, not the backstory
   - `defined_at` — `'path/to/CLAUDE.md:line'` where the prose lives
   - `references` — source files that cite this rule (can add more later)
3. **Run tests** — `npm test -- tests/rules`. Must stay green. A collision or
   missing field will fail the suite.
4. **Add prose** — write the rule body in the relevant CLAUDE.md section. Reference
   the registry as authority: "see lib/rules/registry.ts".

## Rule scopes

| Scope     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `global`  | Applies to all Colin's projects; primary definition in `~/.claude/CLAUDE.md` |
| `project` | LepiOS-specific; primary definition in `lepios/CLAUDE.md`                    |

## Current rules

| Number | Name                               | Scope   |
| ------ | ---------------------------------- | ------- |
| F17    | behavioral-ingestion-justification | project |
| F18    | measurement-benchmark-required     | project |
| F19    | continuous-improvement-process     | global  |
| F20    | design-system-enforcement          | project |

## Namespace note

F1–F21 also appear in `~/.claude/CLAUDE.md §4` as sequential labels for failure
log entries (a different namespace — those are incident codes, not enforcement
rules). This registry covers only the architecture/process rules where number
collisions cause real spec drift.
