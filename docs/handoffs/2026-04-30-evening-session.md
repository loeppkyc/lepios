# 2026-04-30 evening session handoff

## Open PRs
- #44 `feature/gmail-daily-scanner` — feat(gmail): daily scan run audit table + watermark
- #43 `feature/sp-api-financial-events-v2` — feat(amazon): SP-API financial events parser + ingest
- #42 `feature/cogs-week1` — feat(cogs): backend layer (week 1)
- #41 `harness/task-8ab362ac-cde9-42fd-b0bc-d5fde8f9ea47` — task: 8ab362ac — Dropbox Archiver acceptance doc awaiting Colin approval [DRAFT]
- #40 `feature/gmail-classifiers-week1-v2` — gmail: invoice + receipt classifiers (migration 0055)
- #39 `feature/gst-calc-week1` — tax: GST split + ZERO_GST exemption list (migration 0056)
- #38 `feature/auth-fail-closed-hardening` — security: cron-secret auth hardening across 22 routes (F22)
- #37 `feat/chart-library-shadcn` — feat(charts): adopt shadcn/ui Chart (Recharts) as chart library
- #36 `feature/status-page-v2` — feat(status): status page v2 — 90-day bars, incident log, dual timezone, nav link
- #35 `harness/task-8b3d7030-a873-431a-b82f-6dbd4ceda83d` — fix(harness): clear three autonomous bottlenecks (drain 403, utility digest, BUMP PR body)

## Worktrees
C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios                                    e72a332 [main]
C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios/.worktrees/sp-api-financial-events 354b700 [feature/sp-api-financial-events-v2]
C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios/.worktrees/window-2                6d1bd73 (detached HEAD)
C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios/.worktrees/window-3                6d1bd73 (detached HEAD)
C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios/.worktrees/window-4                6d1bd73 (detached HEAD)

## Migration numbers claimed across all branches

### main (0002–0040, two 0036 collision)
0036_amazon_settlements, 0036_register_tax_sanity_component ← COLLISION on main

### feature/auth-fail-closed-hardening (PR #38)
0052_build_metrics, 0053_build_metrics_security_invoker

### feature/cogs-week1 (PR #42)
0054_cogs_entries

### feature/gmail-classifiers-week1-v2 (PR #40)
0055_gmail_classifiers

### feature/gst-calc-week1 (PR #39)
0056_gst_columns

### feature/sp-api-financial-events-v2 (PR #43)
0057_amazon_financial_events

### feature/gmail-daily-scanner (PR #44)
0058_gmail_daily_scan_runs

### feature/langfuse-observability (recovery)
0059_langfuse_schema

### feature/orb-chat-orphan-recovery (recovery)
0042_orb_chat_schema ← safe, only claimant; Langfuse vacated to 0059

### feature/status-page-v2 (PR #36)
0041_pending_drain_triggers, 0043–0053 (full harness foundation stack)

### Numbers 0041–0051 gap on main
0041–0051 are on feature/status-page-v2 only. Not on main. Will land when #36 or #38 merges.

## Untracked files on main (post-cleanup)
(these remain untracked — not yet on any branch)
- .clinerules, .markdownlint.json
- app/(cockpit)/utility/_components/UtilityBarChart.tsx
- components/ui/card.tsx, components/ui/chart.tsx (chart library — PR #37 branch)
- docs/follow-ups/2026-04-27-f20-inline-style-conflict.md
- docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md
- docs/gpu-day-checklist.md, docs/gpu-day-readiness.md
- docs/grounding/, docs/ops/, docs/standing/, docs/overnight-runs/, docs/research/
- docs/handoffs/2026-04-27-w1.md, docs/handoffs/2026-04-27-w3.md
- docs/lepios/adopted-vs-built.md, docs/lepios/retros/, docs/lepios/time-to-orb.md, docs/lepios/twin-v2-schema.md
- docs/ollama-triage.md, docs/orb-readiness.md
- docs/sprint-5/ (handoff JSONs + grounding)
- docs/streamlit-rebuild-overlap-deep-audit.md
- scripts/fix-md040.py, scripts/test-ollama-tunnel.ts
- supabase/.temp/
- tests/chart-migration.test.ts

## Tomorrow's queue
1. Investigate 0036 collision (see docs/follow-ups/2026-04-30-0036-migration-collision.md)
2. Review and merge PR #38 (auth-fail-closed) — unblocks build_metrics seeding for #43 and tonight's session backfill
3. Review and merge #42 (COGS), #43 (SP-API events), #44 (Gmail audit/watermark) — all independent
4. Review #39 (GST), #40 (Gmail classifiers) — #40 prod validation needs OAuth env wiring (component #6)
5. Quality review feature/orb-chat-orphan-recovery and feature/langfuse-observability before merging
6. Run scripts/seed-build-metrics-2026-04-30.ts after #38 lands (script not yet created — blocked on build_metrics not being on main)
7. Create build_metrics seed script for tonight's session once #38 merges

## JOB 1 status (build_metrics seed script)
BLOCKED. build_metrics (migrations 0052+0053) is on feature/auth-fail-closed-hardening (PR #38) and feature/status-page-v2 (PR #36) — not on main. Seed script cannot be created until #38 merges.

## Rollup status
Amazon pipeline: 33.6% (37.0/110), see docs/lepios/amazon-pipeline-rollup.md

## Merge order constraints (discovered late)

### #38 before #36
Both PRs carry byte-identical migrations 0052_build_metrics.sql + 0053_build_metrics_seed.sql + tests/migrations/0052-build-metrics.test.ts. Merge #38 first (smaller, surgical), then resolve #36 by removing the duplicate files from its branch before merging.

### #37 chart files vs main working tree
Disk versions of components/ui/card.tsx, components/ui/chart.tsx, tests/chart-migration.test.ts differ from the #37 branch versions. Diff before merging — disk may contain real edits worth preserving, or may be noise to discard.

### #37 recharts dependency
recharts ^3.8.0 is in #37's package.json but not installed in main's node_modules. The 4 failing chart-migration tests on main are this leak's footprint. Merging #37 + npm install resolves both.

## #37 disk vs branch verdict (resolved)
All three disk files are Prettier/whitespace noise vs branch versions. No real edits to preserve. Merge #37 as-is — branch wins for all three files.
- components/ui/card.tsx: single→double quote, Tailwind reorder. Noise.
- components/ui/chart.tsx: same pattern. Noise.
- tests/chart-migration.test.ts: alignment whitespace. Noise.
Action: merge #37 + npm install resolves the leak and the 4 failing tests in one shot.

## PR triage (auto-generated 2026-05-01)

### #38 feature/auth-fail-closed-hardening — security: cron-secret auth hardening across 22 routes (F22)
- Size: 30 files, +780/-196
- Mergeable: yes (independent)
- Migrations: 0052_build_metrics, 0053_build_metrics_security_invoker (only claimant on these)
- Tests: yes (cron-secret.test.ts, 0052-build-metrics.test.ts)
- Cross-branch imports: none
- Verdict: READY TO MERGE — merge FIRST; unblocks build_metrics seeding for #43 and dedup surgery for #36
- One-line note: Adds cron-secret fail-closed auth to 22 API routes + build_metrics telemetry table

### #37 feat/chart-library-shadcn — feat(charts): adopt shadcn/ui Chart (Recharts) as chart library
- Size: 13 files, +2238/-175
- Mergeable: yes (independent, no migrations)
- Migrations: none
- Tests: yes (chart-migration.test.ts — currently failing on main; merge + npm install resolves)
- Cross-branch imports: none
- Verdict: READY TO MERGE — run `npm install` after merge to fix 4 failing chart-migration tests
- One-line note: Adds recharts + shadcn chart primitives; disk card.tsx/chart.tsx are Prettier noise, branch wins

### #39 feature/gst-calc-week1 — tax: GST split + ZERO_GST exemption list (migration 0056)
- Size: 4 files, +433/-0
- Mergeable: yes (independent)
- Migrations: 0056_gst_columns (only claimant)
- Tests: yes (gst.test.ts — 68 tests)
- Cross-branch imports: none
- Verdict: READY TO MERGE
- One-line note: GST calculation module + ZERO_GST exemption list + gst_amount/gst_rate columns on expenses

### #40 feature/gmail-classifiers-week1-v2 — gmail: invoice + receipt classifiers (migration 0055)
- Size: 9 files, +1346/-0
- Mergeable: yes (independent)
- Migrations: 0055_gmail_classifiers (only claimant)
- Tests: yes (invoice.test.ts, receipt.test.ts — 41 tests)
- Cross-branch imports: none (self-contained new lib)
- Verdict: READY TO MERGE — prod validation deferred; blocked on OAuth env wiring (component #6), not on this PR
- One-line note: Invoice + receipt classifiers for Gmail scanner; dryrun script included

### #43 feature/sp-api-financial-events-v2 — feat(amazon): SP-API financial events parser + ingest
- Size: 5 files, +1393/-0
- Mergeable: yes (independent)
- Migrations: 0057_amazon_financial_events (only claimant)
- Tests: yes (financial-events.test.ts — 34 tests)
- Cross-branch imports: none (imports lib/amazon/client + lib/supabase/service, both on main)
- Verdict: READY TO MERGE — seed script self-guards (exits 1 if build_metrics absent); run seed after #38 merges
- One-line note: Parses ShipmentEvent/RefundEvent/ServiceFeeEvent from SP-API per settlement group; $0.01 gate backfill script

### #44 feature/gmail-daily-scanner — feat(gmail): daily scan run audit table + watermark
- Size: 4 files, +399/-32
- Mergeable: yes (independent)
- Migrations: 0058_gmail_daily_scan_runs (only claimant)
- Tests: yes (gmail-scanner.test.ts)
- Cross-branch imports: none (statement classifier on main; invoice/receipt classifiers intentionally deferred with TODO comments)
- Verdict: READY TO MERGE
- One-line note: Adds audit table + scan watermark to gmail-scan cron; invoice/receipt classification stubbed pending #40

### #35 harness/task-8b3d7030 — fix(harness): clear three autonomous bottlenecks (drain 403, utility digest, BUMP PR body)
- Size: 24 files, +2163/-34
- Mergeable: yes (independent)
- Migrations: 0039+0040 (already on main), 0041_pending_drain_triggers (new; identical copy also in #36)
- Tests: yes (deploy-gate, notifications-drain, utility-digest, orchestrator/digest)
- Cross-branch imports: none
- Verdict: NEEDS REVIEW — #36 contains all 5 commits from this branch (confirmed via git); recommend closing #35 and letting #36 carry the work to avoid duplicate merge
- One-line note: Fixes coordinator drain 403, utility-digest gap, BUMP PR body; fully superseded by #36

### #36 feature/status-page-v2 — feat(status): status page v2 — 90-day bars, incident log, dual timezone, nav link
- Size: 77 files, +10973/-191
- Mergeable: BLOCKED — carries duplicate 0052+0053 that must be removed before merge
- Migrations: 0039+0040 (on main), 0041-0053 (new, but 0052+0053 duplicate #38 exactly)
- Tests: yes (extensive — 10+ test files)
- Cross-branch imports: none
- Verdict: BLOCKED BY #38 — after #38 merges, remove 0052_build_metrics.sql + 0053_build_metrics_security_invoker.sql + tests/migrations/0052-build-metrics.test.ts from #36 branch, then merge
- One-line note: Status page v2 + full harness foundation (migrations 0041-0051) — the largest single PR in the queue

### #41 harness/task-8ab362ac — task: 8ab362ac — Dropbox Archiver acceptance doc awaiting Colin approval [DRAFT]
- Size: 31 files, +4269/-31
- Mergeable: DRAFT
- Migrations: 0039+0040 (already on main — no new migrations in this PR)
- Tests: yes (coordinator-drain-auth, pickup-runner, task-pickup-100, task-source-content, utility-tracker)
- Cross-branch imports: none
- Verdict: DRAFT — acceptance doc requires Colin sign-off before builder work begins; do not merge
- One-line note: Contains completed utility-tracker work + Dropbox Archiver acceptance doc pending approval; harness coordinator will proceed once accepted

## Recommended merge order (2026-05-01)

Priority order, accounting for all dependencies discovered in this triage:

```
1. #38  auth-fail-closed    MERGE NOW — creates build_metrics; required before #36 can be cleaned
2. #37  chart-library       MERGE + npm install — fixes 4 failing tests, no deps
3. #39  gst-calc            MERGE — smallest, cleanest, fully independent
4. #40  gmail-classifiers   MERGE — code complete; prod validation deferred to OAuth component
5. #43  sp-api-events       MERGE — then run scripts/seed-build-metrics-financial-events.ts
6. #44  gmail-scanner       MERGE — independent; invoice/receipt stubs fill in when #40 is wired
7. #35  harness-bottlenecks CLOSE (superseded by #36) or MERGE if independent review wanted
8. #36  status-page-v2      MERGE LAST — after #38, do branch surgery to remove 0052+0053+test file
9. #41  dropbox-archiver    HOLD — draft; needs Colin acceptance doc approval
```

### Branch surgery required for #36 before merge
```bash
git checkout feature/status-page-v2
git rm supabase/migrations/0052_build_metrics.sql
git rm supabase/migrations/0053_build_metrics_security_invoker.sql
git rm tests/migrations/0052-build-metrics.test.ts
git commit -m "chore: remove duplicate build_metrics files (landed via #38)"
git push origin feature/status-page-v2
```
