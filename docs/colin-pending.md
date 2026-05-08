# Pending — needs Colin's answer

**Living queue.** Each row is a question that blocks something downstream. When Colin answers, the answer flows back to the source doc (acceptance, leverage-target, etc.) AND the row moves to **§Answered** at the bottom.

**Authoring rule:** only Claude/coordinator adds rows. Only Colin (or Colin via twin) supplies answers. The doc never grows past about a screen — answered rows roll into Archive in a separate doc once they're stale.

---

## Active questions

### Q-002 — Tier classification rules (blocks T-004)

- **Source:** [`docs/leverage-targets.md` T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08) — sub-module #4 (Tier classifier)
- **Blocks:** Phase 1b of T-004 (twin Q&A would have to invent these otherwise)
- **Asked:** 2026-05-08

**Question.** T-004 routes scans through tier classification: **high-demand tier 1 / collectible tier / standard**. The rules live in your head, not the codebase. What are they?

For each tier, please specify:

| Tier                   | Threshold rules                                                                                 | Example product types                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **High-demand tier 1** | (e.g., BSR <X, sales velocity >Y, margin >$Z, demand stability ≥N months)                       | (e.g., textbooks during back-to-school, popular series) |
| **Collectible**        | (e.g., out-of-print, signed editions, certain ISBN prefixes, condition matters more than price) | (e.g., first editions, limited prints)                  |
| **Standard**           | (default — everything else)                                                                     | (everything not in the other two)                       |

**Why this matters.** The tier drives the GO/BBV/DONATE decision and downstream pricing/listing behavior. Without your rules, the classifier defaults to "everything is standard" and the scanner is no better than today's manual decision.

**Colin's answer:** _(pending)_

---

---

## Answered

### Q-001 — BBV cross-system access (resolved 2026-05-08)

- **Source:** [`docs/leverage-targets.md` T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08)
- **Blocks unblocked:** T-004 Phase 1c
- **Asked:** 2026-05-08 · **Answered:** 2026-05-08

**Decision: Option B.** BBV exposes `/api/inventory/upsert-by-isbn` route in the BBV repo. LepiOS calls with bearer auth (F22 cron-secret pattern). BBV-side endpoint is a ~1-day add-on (route + auth + rate limit).

**Rationale.** Cleanest blast-radius posture for a Stripe-LIVE system. BBV controls its own writes. No shared service-role keys across systems.

**Source doc updated:** T-004 "Open architectural question" section converted to "Decided: B" in the same PR.

---

### Q-003 — Safety Agent risk-score calibration (resolved 2026-05-08)

- **Source:** [`docs/leverage-targets.md` T-002](leverage-targets.md#t-002--safety-agent-revised-2026-05-08)
- **Blocks unblocked:** T-002 Phase 1b
- **Asked:** 2026-05-08 · **Answered:** 2026-05-08

**Decision: ship with the proposed initial values.** Calibration parameters, not architectural locks — observe-only for 7 days then tune.

**Initial signal weights:**

| Signal                                                                   | Initial weight   |
| ------------------------------------------------------------------------ | ---------------- |
| Secret detected (any)                                                    | +100 (auto-high) |
| Migration with destructive ops (DROP, RENAME, NOT NULL on existing rows) | +60              |
| Migration additive only                                                  | +10              |
| Test coverage drop > 5% vs base                                          | +30              |
| Test coverage drop > 15% vs base                                         | +60              |
| LOC delta > 2× planned                                                   | +20              |
| Known-failure regex match (per-pattern, top match wins)                  | +25 to +50       |
| Touches shared seam (`package.json`, `middleware.ts`, etc.)              | +40              |
| Touches `app/api/**` route handler net-new                               | +15              |
| All other signals quiet                                                  | base 5           |

**Initial tier thresholds:** Low <30, Medium 30–70, High >70.

**Source doc updated:** T-002 spec now lists these as the initial calibration values; same observe-then-tune playbook as `DEPLOY_GATE_RISK_TIER` from PR #133.

---

## Update protocol

- **New question:** Coordinator/Claude adds a `### Q-NNN — <title>` section under "Active questions". Includes Source, Blocks, Asked date, the question itself, options/recommendation if applicable.
- **Colin answers** by editing the "Colin's answer" line OR by replying in chat (Claude/coordinator transcribes into the doc).
- **On answer:**
  1. Move the row to "Answered" with the answer + date answered.
  2. Update the source doc (e.g., bake the BBV decision into T-004's spec, removing the "open architectural question" section).
  3. If the answer unblocks a queued task, log it in the task's `metadata.unblocked_at` field.
- **Stale answered rows** (>30 days) move to `docs/colin-answered-archive.md` (created on first archive).
- **Naming:** Q-001 onward, never reused even after archive.

---

**Last updated:** 2026-05-08 — Q-001 + Q-003 resolved (BBV = B, calibration = proposed values). Q-002 (tier rules) still pending.
