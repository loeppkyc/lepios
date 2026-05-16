# C4 — Tesla Auto-Valuation Button on Net Worth Page

**task_id:** `9e210b02-a0c5-4f17-8e8a-d413d52da9e1`  
**tier:** C  
**status:** awaiting-q1-answer (Tesla model: Model 3 or Model Y?)  
**written by:** coordinator (2026-05-16), updated (2026-05-16)  
**branch:** `harness/task-9e210b02-a0c5-4f17-8e8a-d413d52da9e1`  
**colin_approved:** 2026-05-16 (overall approach — Puppeteer + AutoTrader.ca)  
**q2_resolved:** Option A — on scrape error, show toast + open inline Edit mode (coordinator decision, reversible)  
**q3_resolved:** Confirmation step before save — "Comps found: median $XX,XXX from N listings — Use This Value | Cancel" (coordinator decision, reversible)  
**q1_blocking:** Colin must specify Tesla model — see Open Questions below

---

## Scope (one sentence + acceptance criterion)

Add an **Estimate Value** button to the Tesla row on the Net Worth page. When clicked, the button scrapes AutoTrader.ca Alberta Tesla listings via Puppeteer, computes a median comparable market price (CAD), and presents it as a draft value for Colin to confirm before updating the balance.

**Acceptance criterion:** On the Net Worth page, the "2022 Tesla (Vehicle)" row shows an Estimate Value button. Clicking it triggers a server-side scrape of AutoTrader.ca Alberta Tesla listings, returns a median comparable price in CAD, and presents a "Use This Value / Cancel" confirmation UI before writing any balance update. The prior balance is never overwritten silently.

---

## Out of scope

- Automatic/scheduled valuation (manual button-click only — v1)
- Historical valuation chart or trend tracking
- Any other vehicle rows (scoped to the Tesla row only)
- ICBC/insurance valuation lookup (AutoTrader.ca only per task spec)
- Scraping beyond AutoTrader.ca (no Kijiji, Facebook Marketplace, etc.)

---

## Grounded findings (Phase 1 — Check-Before-Build)

### Tesla row in balance_sheet_entries
- **Row name:** `"2022 Tesla (Vehicle)"`
- **Row id:** `bbe41f11-ba74-4e16-9912-fe835bc7a6ab`
- **Balance:** `$39,500.00`
- **as_of_date:** `2026-05-06`
- **source:** `manual`
- **category:** `equipment` / `account_type: asset`

Row is `source=manual` — the "Edit" button is already visible and functional. The Estimate Value button would appear alongside it.

### AutoTrader.ca endpoint live-test (Principle 1)
```
curl https://www.autotrader.ca/cars/tesla/?prx=100&prv=Alberta&loc=Edmonton
→ HTTP 403
```
Plain HTTP requests are rejected — bot-protection is active. A real browser (Puppeteer/Chromium) is **required**. Server-side HTML scraping without a browser is not viable for this site.

### Puppeteer in codebase (Check-Before-Build)
- `puppeteer: ^24.0.0` is already installed (package.json)  
- Used in `lib/harness/arms-legs/browser-handlers.ts` (coordinator harness infrastructure, not deployed to Vercel API routes)
- No production Vercel API route currently imports or uses Puppeteer — **this would be the first**
- The comment in `browser-handlers.ts` explicitly notes: *"On Vercel serverless, set `PUPPETEER_EXECUTABLE_PATH` to a bundled Chromium binary (e.g. via `@sparticuz/chromium`)"*
- `@sparticuz/chromium` is **not yet** in package.json — would be a new dependency

### Vercel Hobby bundle size risk (stated kill signal)
- Full `puppeteer` package bundles ~300 MB Chromium binary → **exceeds Vercel Hobby's 50 MB function size limit**
- Required approach: `@sparticuz/chromium` (~45 MB compressed) + `puppeteer-core` (no bundled Chromium)
- This is the known-good serverless pattern; `browser-handlers.ts` anticipates it
- New npm packages: `@sparticuz/chromium`, `puppeteer-core` → `package.json` is a **seam file** (requires `[seam-approved]` in commit message, per `.claude/CLAUDE.md`)

---

## Files expected to change

| File | Change |
|------|--------|
| `package.json` | Add `@sparticuz/chromium` + `puppeteer-core` (seam file — `[seam-approved]` required) |
| `package-lock.json` | Updated automatically (seam file) |
| `app/api/net-worth/tesla-estimate/route.ts` | New POST route — Puppeteer scrape + median calc |
| `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` | Add Estimate Value button to Tesla row |

No schema migration required (the existing `balance_sheet_entries` table PATCH via `/api/balance-sheet` handles the update).

---

## Open questions for Colin (REQUIRED before builder proceeds)

### Q1 — Tesla model for the search query ⚠️ STILL BLOCKING
The row is `"2022 Tesla (Vehicle)"` — no model specified. AutoTrader.ca search is much more accurate when filtered by model (Model 3, Model Y, Model S, Model X). Comparable listings for different models vary by $10,000–$20,000 CAD.

**Colin: what model is the 2022 Tesla?**
- Tap **[Model 3]** in Telegram to use `model_3` in the AutoTrader search
- Tap **[Model Y]** in Telegram to use `model_y` in the AutoTrader search

Builder cannot proceed without this answer.

### Q2 — Fallback UX ✅ RESOLVED (coordinator decision)
**Decision:** Option A — on scrape error, show toast "Auto-estimate failed. Enter value manually." and open the existing inline Edit mode for the Tesla row. Reversible via UI change.

### Q3 — Confirmation before save ✅ RESOLVED (coordinator decision)
**Decision:** Confirmation step retained — "Comps found: median $XX,XXX from N listings — Use This Value | Cancel" inline. Colin clicks "Use This Value" to trigger the PATCH. Protects against silent balance overwrite. Reversible via UI change.

---

## Grounding checkpoint

After builder ships, Colin verifies:
1. Navigate to `/net-worth`. The "2022 Tesla (Vehicle)" row shows an "Estimate Value" button.
2. Click the button. After a loading state (5–20 sec), a comparable price appears with a "Use This Value / Cancel" UI.
3. The price is a plausible 2022 Alberta Tesla market value (within ~20% of $39,500 current balance).
4. Click "Use This Value" — balance updates in the table. Refresh confirms the DB write persisted.
5. Click "Edit" to manually revert to the prior value if the estimate was wrong.

**Kill signal:** If `@sparticuz/chromium` causes the Vercel deployment to fail (function bundle > 50 MB or build timeout), revert the package.json change and implement fallback-only mode (button shows toast: "Auto-estimate requires manual entry — opening edit mode").

---

## Check-Before-Build findings

| Component | Prior art | Decision |
|-----------|-----------|----------|
| PATCH balance | `/api/balance-sheet/route.ts` PATCH already exists | Reuse — no new route needed for saving |
| Puppeteer harness | `lib/harness/arms-legs/browser-handlers.ts` | Reference — same `@sparticuz/chromium` pattern |
| EditableRow inline save | `EditableRow` in `NetWorthPage.tsx` | Extend — add "Estimate Value" button as a sibling to "Edit" |
| Scraping infrastructure | No prior AutoTrader.ca scraper in codebase | Build-new (first AutoTrader.ca scrape) |

---

## 20% Better vs. Streamlit baseline

No Streamlit predecessor — this is a greenfield feature. The 20% better lens applied to the task spec:

| Category | Improvement vs "just update balance manually" |
|----------|----------------------------------------------|
| Correctness | Median of N comparables (not just one listing) reduces outlier skew |
| Observability | Show count of listings used ("median of 12 Alberta listings") so Colin knows sample size |
| Grounding | Confirmation step prevents silent overwrites — keeps net worth trustworthy |
| Extensibility | `tesla-estimate` route is structured to accept model/year params — prep for other vehicles |

---

## Cached-principle decisions (Phase 0 / META-C assessment)

**Phase 0 result:** `cache_match_enabled: true` (sprint-state.md, last_reviewed_by_colin_at: 2026-05-01)

**META-C assessment: CANNOT cache-match → escalate**

```
2026-05-16T00:00:00Z sprint=standalone task=9e210b02 doc=docs/backlog/tier-c/C4-acceptance.md
cited_principles: [15, 1, META-C]
trigger_match_evidence: |
  Principle 15 trigger: "Proposed module is an outlier from the observed pattern
  ('we've never done this before')."
  Situation: This is the first production Vercel API route to use Puppeteer/Chromium
  in this codebase. browser-handlers.ts exists in harness but is not deployed to
  production Vercel API routes. New terrain.
  Principle 1 trigger: "Any external API mentioned in a proposed acceptance doc."
  Situation: AutoTrader.ca live-tested → HTTP 403 (Puppeteer required — confirmed).
  Open questions Q1, Q2, Q3 cannot be resolved without Colin's decision.
  Additionally: package.json is a seam file — new deps require Colin approval per
  .claude/CLAUDE.md seam rules.
reversibility_check: |
  Acceptance doc: new file, fully reversible (delete or rewrite).
  package.json deps: reversible — npm remove @sparticuz/chromium puppeteer-core.
  New API route: reversible — delete file.
  NetWorthPage.tsx button: reversible — remove the button UI.
  All decisions: LOW cost to reverse.
confidence: n/a — escalation mandatory (Principle 15 + open questions + seam dep)
outcome: escalated
escalation_reasons:
  - principle_15_new_terrain (first production Vercel Puppeteer route)
  - open_question_Q1 (Tesla model unknown — required for search query)
  - open_question_Q2 (fallback UX — needs Colin confirmation)
  - open_question_Q3 (confirmation step — needs Colin confirmation)
  - seam_file_package_json (new deps require [seam-approved] — Colin must explicitly approve)
```

---

## F17 — Behavioral ingestion justification

The Tesla valuation button generates `net_worth.tesla_estimate` events. Each scrape result (median price, listing count, date) is logged to `agent_events` — feeding the net worth accuracy signal for the Money pillar.

## F18 — Measurement

- Log each estimate to `agent_events`: `domain=net_worth, action=tesla_estimate, meta={median_price, listing_count, prior_balance, delta_pct}`
- Colin can ask: "How has the Tesla estimated value trended?" → query `agent_events WHERE action='tesla_estimate'`
- Benchmark: current manual balance of $39,500 is the baseline; each scrape shows delta vs. the registered value

## F20 — Design system note

The existing `NetWorthPage.tsx` uses inline `style={}` attributes throughout (pre-F20 era page). The Estimate Value button will **match the existing inline-style pattern** for visual consistency, rather than forcing a page-wide refactor to Tailwind. The button will use the same CSS vars (`var(--color-accent-gold)`, `var(--font-ui)`, etc.) as adjacent buttons on the page. A full F20 refactor of NetWorthPage is a separate scope item.

---

## Kill signals

1. `@sparticuz/chromium` Vercel bundle exceeds 50 MB → implement fallback-only (toast + edit mode)
2. AutoTrader.ca changes its structure and scrape returns 0 listings → surface "No comparables found" with fallback to manual
3. Scrape latency exceeds 20 seconds → add a loading timeout and graceful error
