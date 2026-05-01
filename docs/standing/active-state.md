# LepiOS Active State

**Last updated:** 2026-05-01 (session — BBV audit + standing doc build)
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
- **Main HEAD:** `7e50fb7 feat(charts): adopt shadcn/ui Chart (Recharts) as chart library (#37)`

---

## Open PRs (6 open)

- **#44** `feature/gmail-daily-scanner` — feat(gmail): daily scan run audit table + watermark
- **#43** `feature/sp-api-financial-events-v2` — feat(amazon): SP-API financial events parser + ingest
- **#41** [DRAFT] `harness/task-8ab362ac-...` — Dropbox Archiver acceptance doc awaiting Colin approval
- **#40** `feature/gmail-classifiers-week1-v2` — gmail: invoice + receipt classifiers (migration 0055)
- **#39** `feature/gst-calc-week1` — tax: GST split + ZERO_GST exemption list (migration 0056)
- **#36** `feature/status-page-v2` — feat(status): status page v2 — 90-day bars, incident log, dual timezone, nav link

**Merge-order notes:** #37 and #38 merged this session — their downstream blockers are now clear. #39, #40, #44 are unblocked. #36 is unblocked. #41 is DRAFT — check harness state before promoting.

**Merged this session (2026-05-01):** #38 (F22 auth hardening), #45 (cogs-v2), #37 (chart library).

---

## Worktrees

```
lepios/                                    7e50fb7 [main]
lepios/.worktrees/sp-api-financial-events  354b700 [feature/sp-api-financial-events-v2]
lepios/.worktrees/window-2                 6d1bd73 (detached HEAD)
lepios/.worktrees/window-3                 6d1bd73 (detached HEAD)
lepios/.worktrees/window-4                 6d1bd73 (detached HEAD)
```

window-2/3/4 are detached — check out to a branch before use.

---

## Active branches (open PRs — ahead/behind main)

| Branch | Ahead | Behind | Last commit |
|---|---|---|---|
| `feature/gmail-daily-scanner` | 2 | 13 | 11 h ago |
| `feature/sp-api-financial-events-v2` | 1 | 15 | 12 h ago |
| `feature/gst-calc-week1` | 1 | 15 | 18 h ago |
| `feature/gmail-classifiers-week1-v2` | 1 | 15 | 14 h ago |
| `feature/status-page-v2` | 35 | 19 | 19 h ago |

Note: all branches 13+ behind main — rebase before merge.

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
0038_streamlit_module_scanner_component.sql
0039_utility_bills.sql
0040_register_utility_tracker_component.sql
0052_build_metrics.sql
0053_build_metrics_security_invoker.sql
0054_cogs_entries.sql
0060_pallet_invoices.sql
0061_cogs_drop_pallet_mode.sql
0100_chunk_h_promote.sql
```

**0036 collision:** two files share prefix `0036` — logged in `docs/follow-ups/2026-04-30-0036-migration-collision.md`.
**Next available slot:** check `ls supabase/migrations/ | sort | tail -5` before creating any new migration — there are gaps (0041–0051, 0055–0059 appear unused on main; PRs #39/#40 claim 0055/0056).

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

**Rollup: 33.6% complete · 73.00 points remaining**

See `docs/lepios/amazon-pipeline-rollup.md` for the full component table.

---

## Recent session handoffs

- `docs/handoffs/2026-04-30-evening-session.md`
- `docs/handoffs/auto-proceed-log.md`
- `docs/handoffs/cost-log.md`
- `docs/handoffs/principle-evolution.md`
- `docs/handoffs/step5-e2e-verification.md`

---

## Open follow-ups (newest first)

- `docs/follow-ups/2026-04-30-pallet-total-cost.md`
- `docs/follow-ups/2026-04-30-0036-migration-collision.md`
- `docs/follow-ups/2026-04-30-0036-investigation.md`
- `docs/follow-ups/2026-04-28-streamlit-dead-reference-audit.md`
- `docs/follow-ups/2026-04-28-coordinator-cloud-source-access.md`
- `docs/follow-ups/2026-04-27-f20-inline-style-conflict.md`

---

## Standing rules (condensed)

| Rule | Summary |
|---|---|
| F18 | Every module ships with metrics + benchmark + surfacing path |
| F19 | Every system evaluated for 20% faster/cheaper/better |
| F20 | No `style={}` in port-chunk TSX; page scaffolds OK |
| F21 | Acceptance doc before code — `docs/sprint-N/chunk-{id}-acceptance.md` |
| F22 | Cron routes fail-closed — merged in #38 |
| Audit-first | Before integrating: audit existing code/env/routes/tables |
| Migration numbering | `ls supabase/migrations/ \| sort \| tail -5` before creating new |
| One-PR-one-concern | Never carry helper code from another PR into yours |
| Worktrees | `.worktrees/window-2\|3\|4` for parallel work |

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
