# Pending — needs Colin's answer

**Living queue.** Each row is a question that blocks something downstream. When Colin answers, the answer flows back to the source doc (acceptance, leverage-target, etc.) AND the row moves to **§Answered** at the bottom.

**Authoring rule:** only Claude/coordinator adds rows. Only Colin (or Colin via twin) supplies answers. The doc never grows past about a screen — answered rows roll into Archive in a separate doc once they're stale.

---

## Active questions

### Q-001 — BBV cross-system access (blocks T-004)

- **Source:** [`docs/leverage-targets.md` T-004](leverage-targets.md#t-004--pageprofit--amazon-scanner-revised-2026-05-08) — open architectural question
- **Blocks:** Phase 1c of T-004 (PageProfit / Amazon Scanner)
- **Asked:** 2026-05-08

**Question.** BBV is a separate Supabase project (`oolgsvhupxutpicxxjfw`, Stripe LIVE) on a different account from LepiOS (`xpanlbcjueimeofgsara`). T-004's BBV path requires upserting into `bbv_inventory` from a LepiOS scan. Which integration pattern?

| Option                | How                                                                                           | Trade-off                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A**                 | LepiOS holds BBV's service-role key; writes directly to BBV Supabase                          | Simple, low latency. **But:** a LepiOS bug can corrupt a Stripe-LIVE storefront. Cross-system blast radius.                               |
| **B** _(recommended)_ | BBV exposes `/api/inventory/upsert-by-isbn` route in BBV repo. LepiOS calls with bearer auth. | Clean boundary; BBV controls its own writes; matches F22 cron-secret pattern. **Cost:** small BBV-side build (route + auth + rate limit). |
| **C**                 | LepiOS writes to a shared queue (Supabase function or bucket); BBV consumes async             | Most isolated. **But:** eventual consistency surprises the scanner UX (\"is this book already in BBV?\" answer can be stale).             |

**Recommendation:** **B.** Cleanest blast-radius posture for a Stripe-LIVE system. Coordinator can spec the BBV-side endpoint as a 1-day add-on.

**Colin's answer:** _(pending)_

---

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

### Q-003 — Safety Agent risk-score calibration (blocks T-002)

- **Source:** [`docs/leverage-targets.md` T-002](leverage-targets.md#t-002--safety-agent-revised-2026-05-08) — risk scorer + thresholds
- **Blocks:** Phase 1b of T-002 (Safety Agent)
- **Asked:** 2026-05-08

**Question.** T-002's risk scorer assigns 0–100 to every PR using weighted signals, then routes by tier. Two calibration inputs you need to set initial values for:

**3a. Signal weights** — how much does each signal contribute to the score? Suggestion (you adjust):

| Signal                                                                               | Initial weight   |
| ------------------------------------------------------------------------------------ | ---------------- |
| Secret detected (any)                                                                | +100 (auto-high) |
| Migration with destructive ops (DROP, RENAME, NOT NULL on existing rows)             | +60              |
| Migration additive only                                                              | +10              |
| Test coverage drop > 5% vs base                                                      | +30              |
| Test coverage drop > 15% vs base                                                     | +60              |
| LOC delta > 2× planned                                                               | +20              |
| Known-failure regex match (per-pattern, top match wins)                              | +25 to +50       |
| Touches shared seam (`package.json`, `middleware.ts`, etc., per CLAUDE.md seam list) | +40              |
| Touches `app/api/**` route handler net-new                                           | +15              |
| All other signals quiet                                                              | base 5           |

**3b. Tier thresholds** — where do the tier boundaries sit? Default proposal:

- **Low:** risk < 30 → auto-merge silently
- **Medium:** 30–70 → twin arbiter
- **High:** > 70 → telegram Colin directly

Are 30 and 70 the right cutoffs, or do you want them tighter/looser?

**Why this matters.** Bad calibration means either (a) Colin gets paged on every trivial PR (low threshold too tight) or (b) destructive changes auto-merge (low threshold too loose). The deploy-gate `RISK_TIER` from PR #133 had the same calibration problem — we shipped with conservative defaults and observed for 7 days before flipping. Same playbook here.

**Note:** these are calibration parameters, not architectural locks. First values can be wrong; the 7-day observe-only run will surface miscalibrations. The point of asking now is to set the _starting_ values closer to your judgment than to a guess.

**Colin's answer:** _(pending)_

---

## Answered

_(none yet — first batch authored 2026-05-08)_

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

**Last updated:** 2026-05-08 — first batch (Q-001 BBV access, Q-002 tier rules) from T-004 spec expansion.
