# LepiOS Active State

**Last updated:** 2026-05-01 (session — #36/#39/#40/#43/#44/#47 merged; rollup reconciled)
**Updated by:** end-of-session write; read this first when starting any new chat

---

## How to use this doc

Start of every new chat (phone, laptop, any window):

1. Paste: `Read docs/standing/active-state.md`
2. Paste your goal

End of every session: update this doc before closing. The next session starts here.

---

## Project

- **Repo:** lepios (Next.js 16, Supabase, Vercel, Tailwind, shadcn/ui)
- **Path:** `C:/Users/Colin/Downloads/Claude_Code_Workspace_TEMPLATE (1)/lepios`
- **Deploy:** https://lepios-one.vercel.app
- **Main HEAD:** `1ef6788 docs(migrations): record 0041-0051 already applied in prod; reconcile ledger (#47)`

---

## Open PRs (2 open)

- **#46** `feature/inventory-filter-zero-qty` — fix(inventory): hide zero-fulfillable SKUs
- **#41** [DRAFT] `harness/task-8ab362ac-...` — Dropbox Archiver acceptance doc awaiting Colin approval

**Merged this session (2026-05-01):** #38 (F22 auth hardening), #45 (cogs-v2), #37 (chart library), #39 (GST calc), #40 (gmail classifiers), #43 (SP-API financial events), #44 (gmail daily scanner), #36 (status page v2), #47 (migration ledger reconcile).

---

## Worktrees

```
lepios/                                    1ef6788 [main]
lepios/.worktrees/sp-api-financial-events  354b700 [feature/sp-api-financial-events-v2]
lepios/.worktrees/window-2                 6d1bd73 (detached HEAD)
lepios/.worktrees/window-3                 6d1bd73 (detached HEAD)
lepios/.worktrees/window-4                 6d1bd73 (detached HEAD)
```

window-2/3/4 are detached — check out to a branch before use.

---

## Active branches (open PRs — ahead/behind main)

| Branch                               | PR  | Status               |
| ------------------------------------ | --- | -------------------- |
| `feature/inventory-filter-zero-qty`  | #46 | Open                 |
| `harness/task-8ab362ac-...`          | #41 | Draft                |
| `feature/sp-api-financial-events-v2` | —   | Worktree; no open PR |

---

## Stashes (5)

```
stash@{0}: On main: main-untracked-before-37-checkout
stash@{1}: On feature/cogs-week1: tax-files-belong-to-pr-39
stash@{2}: On feature/auth-fail-closed-hardening: auth-hardening-window1-unstaged-recovery
stash@{3}: On feature/auth-fail-closed-hardening: cogs-week1-recovery
stash@{4}: On feature/status-page-v2: status-page-v2 WIP
```

stash@{1} and stash@{4} are likely safe to drop (PRs merged or exist). Verify before dropping.

---

## Migrations on main (latest 10)

```
0041_pending_drain_triggers.sql
0043_harness_foundation_renormalize.sql
0044_memory_layer_decisions_log.sql
0045_security_layer_schema.sql
0046_decisions_log_updated_at_trigger.sql
0047_knowledge_dedupe_audit.sql
0048_knowledge_dedupe_audit_executed_column.sql
0049_knowledge_content_hash.sql
0050_enable_rls_gmail_window_sessions.sql
0051_enable_rls_harness_internal.sql
0052_build_metrics.sql
0053_build_metrics_security_invoker.sql
0054_cogs_entries.sql
0055_gmail_classifiers.sql
0056_gst_columns.sql
0057_amazon_financial_events.sql
0058_gmail_daily_scan_runs.sql
0060_pallet_invoices.sql
0061_cogs_drop_pallet_mode.sql
0100_chunk_h_promote.sql
```

**0036 collision:** two files share prefix `0036` — logged in `docs/follow-ups/2026-04-30-0036-migration-collision.md`.
**0041–0051 status (audited 2026-05-01):** all 11 already APPLIED to prod — the schema artifacts (tables, indexes, triggers, RLS, content_hash column, dedupe execute) are all live. Do NOT re-apply. Re-running 0043 in particular would `DELETE FROM harness_components` and wipe live `completion_pct` drift. See `docs/follow-ups/2026-05-01-migration-ledger-reconcile.md`.
**0042 missing:** intentional gap (`feature/orb-chat-orphan-recovery` claimed it; not on main). Treat 0042 as reserved.
**Next available slot:** check `ls supabase/migrations/ | sort | tail -5` before creating any new migration — gap remains at 0059 (PR-claimed but not on main).

---

## Untracked files on main (33 entries)

Not committed, not gitignored — top-level groups:

```
.clinerules/
.markdownlint.json
app/(cockpit)/utility/_components/
components/ui/card.tsx, chart.tsx
docs/follow-ups/
docs/gpu-day-checklist.md, gpu-day-readiness.md
docs/grounding/
docs/handoffs/
docs/lepios/
docs/ollama-triage.md
docs/ops/
docs/orb-readiness.md
docs/overnight-runs/
docs/research/
docs/sprint-5/
docs/standing/          ← this file
docs/streamlit-rebuild-overlap-deep-audit.md
scripts/fix-md040.py, test-ollama-tunnel.ts
supabase/.temp/
tests/chart-migration.test.ts
```

Most are docs-only — safe to collect into a housekeeping commit if desired.

---

## Amazon pipeline rollup

**Rollup: 49.0% complete** (recomputed 2026-05-01 post merge wave — #38, #39, #40, #42, #43, #44, #45 merged; total weight 120)

See `docs/lepios/amazon-pipeline-rollup.md` for the full component table.

---

## Harness rollup (live from `harness_components`, 2026-05-01)

**Rollup: 58.38% (58.38/100) — denominator now 100, not 120.**

Migration 0043 reseated `harness_components` from 24 drifted rows (SUM=112) to 21 spec rows (SUM=100), and moved 7 product rows out to `product_components`. Any prior rollup citing a 112 or 120 denominator is stale. Live rollup recomputes from `SUM(weight_pct * completion_pct) / SUM(weight_pct)` on `harness_components`.

---

## Recent session handoffs

- `docs/handoffs/2026-04-30-evening-session.md`
- `docs/handoffs/auto-proceed-log.md`
- `docs/handoffs/cost-log.md`
- `docs/handoffs/principle-evolution.md`
- `docs/handoffs/step5-e2e-verification.md`

---

## Open follow-ups (newest first)

- `docs/follow-ups/2026-05-01-migration-ledger-reconcile.md`
- `docs/follow-ups/2026-04-30-pallet-total-cost.md`
- `docs/follow-ups/2026-04-30-0036-migration-collision.md`
- `docs/follow-ups/2026-04-30-0036-investigation.md`
- `docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md`
- `docs/follow-ups/2026-04-28-coordinator-cloud-source-access.md`
- `docs/follow-ups/2026-04-27-f20-inline-style-conflict.md`

---

## Standing rules (condensed)

| Rule                | Summary                                                               |
| ------------------- | --------------------------------------------------------------------- |
| F18                 | Every module ships with metrics + benchmark + surfacing path          |
| F19                 | Every system evaluated for 20% faster/cheaper/better                  |
| F20                 | No `style={}` in port-chunk TSX; page scaffolds OK                    |
| F21                 | Acceptance doc before code — `docs/sprint-N/chunk-{id}-acceptance.md` |
| F22                 | Cron routes fail-closed — merged in #38                               |
| Audit-first         | Before integrating: audit existing code/env/routes/tables             |
| Migration numbering | `ls supabase/migrations/ \| sort \| tail -5` before creating new      |
| One-PR-one-concern  | Never carry helper code from another PR into yours                    |
| Worktrees           | `.worktrees/window-2\|3\|4` for parallel work                         |

Full rule set: `lib/rules/registry.ts` + `CLAUDE.md §3`.

---

## Other repos

- **brick-and-book-vault:** `/c/Users/Colin/Desktop/brick-and-book-vault` — Next.js 16, `master` branch, live at brickandbookvault.ca (Vercel, Stripe LIVE). Audit 2026-05-01: three doc gaps fixed (4 commits pushed). Two medium gaps logged in `docs/follow-ups/2026-05-01-bbv-audit-gaps.md` (CSP header, no CI).

---

## When to update this doc

- After any PR opens or merges
- After any new branch or worktree
- After any rollup recompute
- At the end of every session
