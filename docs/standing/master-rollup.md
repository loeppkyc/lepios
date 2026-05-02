# Master Rollup — LepiOS

**Last updated:** 2026-05-01 (B4 partial credit + Cloudflare Access blocker)
**Updated by:** B4 scored 50% partial; Cloudflare Access policy gap logged as active blocker; rollups recomputed
**Recompute protocol:** update this file after every PR merge or meaningful state change

---

## How to use this doc

Two portfolio-wide numbers live at the top. **Strategic rollup** answers "what should I work on next" — tracks are weighted by revenue and leverage impact, so the number moves when you ship the things that matter most. **Total scope rollup** answers "how much of everything I've ever wanted have I built" — every discrete item (component, module, line item, idea) counts equally; nothing gets weighted away. The gap between the two numbers is the backlog's gravity. The **Top 10 Leverage Sort** at the bottom is the answer to "biggest progress per paste" — ranked by direct points plus downstream unlock value divided by estimated effort.

---

## Portfolio Rollup

| Rollup          | Value     | Basis                                                                                                     |
| --------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| **Strategic**   | **47.6%** | Weighted by track importance (T1=20, T1b=5, T2=40, T3=5, T4=15, T5=15). T4's 0% has 15% portfolio weight. |
| **Total scope** | **15.0%** | 4,874 completion-points across 324 discrete items. T4's 234 zeros dominate. Without T4: 54.2%.            |

Strategic rollup math: T1 20%×58.38=11.68 · T1b 5%×88.0=4.40 · T2 40%×52.3=20.92 · T3 5%×0=0 · T4 15%×0=0 · T5 15%×71.0=10.65 · **sum=47.65**

Total scope math: 324 items total (T1:21 · T1b:7 · T2:21 · T3:3 · T4:234 · T5:27 · T6:3 · T7:8) · sum of completion-pcts=4,874 · 4874÷324=**15.0%**

---

## Track Summary

| #   | Track                    | Items         | %            | Strategic weight | Source                                                                            |
| --- | ------------------------ | ------------- | ------------ | ---------------- | --------------------------------------------------------------------------------- |
| 1   | Autonomous Harness       | 21 components | **58.4%**    | 20%              | `harness_components` — live DB, queried 2026-05-01                                |
| 1b  | Product Components       | 7 components  | **88.0%**    | 5%               | `product_components` — live DB, queried 2026-05-01                                |
| 2   | Amazon Pipeline          | 21 components | **52.3%**    | 40%              | `docs/lepios/amazon-pipeline-rollup.md`                                           |
| 3   | Local Sales              | 3 items       | **0%**       | 5%               | `docs/acceptance/local-sales-webhook.md` (acceptance doc written, not built)      |
| 4   | Streamlit Port Backlog   | 234 modules   | **0%**       | 15%              | `docs/streamlit-port-catalog.md` (all pending; promotion via acceptance-doc flow) |
| 5   | GPU Day Readiness        | 27 line items | **71.0%**    | 15%              | `docs/gpu-day-readiness.md`                                                       |
| 6   | Life Tracks              | 3 items       | visible only | unweighted       | memory; no capture infrastructure                                                 |
| 7   | Parked / Future Products | 8 ideas       | 0% by design | unweighted       | `docs/harness/PENDING_ADDITIONS.md`                                               |

---

## T1 — Autonomous Harness

**Rollup: 58.38 / 100** · source: `harness_components`, live Supabase, queried 2026-05-01

Tier labels derived from spec weight bands (no tier column exists in DB):

### T1-A — Core Loop (weight 24 / 100)

| Slug              | Display name               | Weight | %        | Pts       |
| ----------------- | -------------------------- | ------ | -------- | --------- |
| coordinator_loop  | Coordinator / builder loop | 12     | 100%     | 12.00     |
| task_pickup       | Task pickup                | 5      | 100%     | 5.00      |
| remote_invocation | Remote invocation          | 4      | 100%     | 4.00      |
| deploy_gate       | Deploy gate                | 3      | 100%     | 3.00      |
| **Subtotal**      |                            | **24** | **100%** | **24.00** |

### T1-B — Observability + Improvement (weight 16 / 100)

| Slug                 | Display name               | Weight | %       | Pts       |
| -------------------- | -------------------------- | ------ | ------- | --------- |
| improvement_loop     | 20% Better feedback loop   | 4      | 100%    | 4.00      |
| stall_detection      | Stall detection (T1–T5)    | 3      | 100%    | 3.00      |
| notification_drain   | Notification drain + dedup | 3      | 100%    | 3.00      |
| f18_surfacing        | F18 surfacing              | 3      | 100%    | 3.00      |
| smoke_test_framework | Smoke test framework       | 3      | 90%     | 2.70      |
| **Subtotal**         |                            | **16** | **98%** | **15.70** |

### T1-C — Agentic Capabilities (weight 45 / 100)

| Slug                 | Display name                          | Weight | %       | Pts       | Gate / note                                             |
| -------------------- | ------------------------------------- | ------ | ------- | --------- | ------------------------------------------------------- |
| arms_legs            | Arms & legs (file/shell/HTTP/browser) | 9      | 30%     | 2.70      | Needs unified contract under `lib/harness/arms-legs/*`  |
| sandbox              | Sandbox (isolated execution)          | 7      | **0%**  | 0.00      | Worktree primitive exists; not hardened                 |
| security_layer       | Security layer (capability + audit)   | 7      | 30%     | 2.10      | Missing capability scope + audit trail                  |
| self_repair          | Self-repair loop                      | 6      | **0%**  | 0.00      | Gated on sandbox + security_layer                       |
| digital_twin         | Digital Twin Q&A                      | 6      | 62%     | 3.72      | F-L14 corpus gap; idea_inbox + session_digest pending   |
| specialized_agents   | Specialized agents                    | 5      | 55%     | 2.75      | coordinator + builder shipped; reviewer/planner pending |
| push_bash_automation | Push/bash auto-decide                 | 3      | **0%**  | 0.00      | Gated on sandbox + security_layer                       |
| debate_consensus     | Debate / consensus before action      | 2      | 10%     | 0.20      | Skill exists; not wired into harness decision points    |
| **Subtotal**         |                                       | **45** | **25%** | **11.47** |                                                         |

### T1-D — Communication + Intelligence (weight 15 / 100)

| Slug              | Display name                    | Weight | %       | Pts      | Gate / note                                   |
| ----------------- | ------------------------------- | ------ | ------- | -------- | --------------------------------------------- |
| chat_ui           | Chat UI (claude.ai-style local) | 6      | 26%     | 1.56     | Gated on arms_legs + digital_twin             |
| telegram_outbound | Telegram outbound + thumbs      | 4      | 75%     | 3.00     | drain shipped; Phase 4 pending                |
| attribution       | Attribution (branch + actor)    | 3      | 55%     | 1.65     | Branch naming shipped; per-commit/PR pending  |
| ollama_daytime    | Ollama daytime tick             | 2      | 50%     | 1.00     | Tunnel live; scheduler + work-routing pending |
| **Subtotal**      |                                 | **15** | **48%** | **7.21** |                                               |

**Harness total: 24.00 + 15.70 + 11.47 + 7.21 = 58.38 / 100**

---

## T1b — Product Components

**Rollup: 12.32 / 14 = 88.0%** · source: `product_components`, live Supabase, queried 2026-05-01

These were migrated from `harness_components` via migration 0043. Denominator is 14 (not 100).

| Slug                              | Display name                        | Weight | %       | Pts       |
| --------------------------------- | ----------------------------------- | ------ | ------- | --------- |
| amazon_settlements_sync           | Amazon settlements sync cron        | 4      | 100%    | 4.00      |
| amazon_orders_sync                | Amazon orders sync cron             | 4      | 100%    | 4.00      |
| prestaged_tasks                   | Pre-staged tasks tracker            | 2      | 66%     | 1.32      |
| tax_sanity                        | Tax sanity check                    | 1      | 100%    | 1.00      |
| streamlit_module_scanner          | Streamlit module scanner            | 1      | 100%    | 1.00      |
| streamlit_rebuild_utility_tracker | Streamlit rebuild — Utility Tracker | 1      | 100%    | 1.00      |
| amazon_reports_view               | Amazon reports view (/amazon page)  | 1      | **0%**  | 0.00      |
| **Total**                         |                                     | **14** | **88%** | **12.32** |

---

## T2 — Amazon Pipeline

**Rollup: 52.3% · 62.80 / 120** · source: `docs/lepios/amazon-pipeline-rollup.md`, recomputed 2026-05-01; row 6 updated 2026-05-01

Pipeline purpose: COGS → Gmail scanner → financial events → reconciliation → tax outputs → anomaly detection.
Reconciliation (row 11) is the keystone — without it the pipeline is disconnected ingestion.

| #         | Component                                          | Weight  | %        | Pts       | Status                                                                                                |
| --------- | -------------------------------------------------- | ------- | -------- | --------- | ----------------------------------------------------------------------------------------------------- |
| 1         | COGS backend (table, API, lib, actions)            | 8       | 100%     | 8.00      | merged #42                                                                                            |
| 2         | COGS UI (superseded by row 20)                     | 6       | 0%       | 0.00      | superseded by COGS v2 (#45)                                                                           |
| 3         | COGS recompute / backfill                          | 4       | 90%      | 3.60      | merged #42; prod data untested                                                                        |
| 4         | Gmail invoice classifier                           | 6       | 90%      | 5.40      | merged #40; prod validation pending OAuth row 6                                                       |
| 5         | Gmail receipt classifier                           | 6       | 90%      | 5.40      | merged #40; same gate as row 4                                                                        |
| 6         | Gmail OAuth + Vercel env wiring                    | 4       | **100%** | 4.00      | env vars configured 2026-05-01 (`dpl_AGZHXA3rQd2iEoeW2WGM8jWcGHNM`); rows 4+5 classifier quality open |
| 7         | Gmail daily scanner (cron + ingest)                | 8       | 75%      | 6.00      | merged #44; classifier integration pending                                                            |
| 8         | SP-API financial events parser                     | 8       | 100%     | 8.00      | merged #43; 34 tests pass                                                                             |
| 9         | SP-API backfill script                             | 4       | 100%     | 4.00      | merged #43; $0.01 gate passed                                                                         |
| 10        | Financial events migration (0057)                  | 2       | 100%     | 2.00      | merged #43; pure DDL                                                                                  |
| 11        | **Reconciliation engine (orders ↔ events ↔ COGS)** | **10**  | **0%**   | **0.00**  | **KEYSTONE — not started**                                                                            |
| 12        | Reconciliation UI / drift report                   | 6       | 0%       | 0.00      | not started; depends on row 11                                                                        |
| 13        | GST calc module                                    | 6       | 100%     | 6.00      | merged #39; 68 tests; $0 drift                                                                        |
| 14        | GST UI / business-review surfacing                 | 4       | 10%      | 0.40      | partial; low-contrast bug open                                                                        |
| 15        | Income tax / CPP projection                        | 6       | 0%       | 0.00      | baseline ~$2,100; no module                                                                           |
| 16        | Tax export / filing outputs                        | 4       | 0%       | 0.00      | not started                                                                                           |
| 17        | Anomaly detection (refunds, fees, missing COGS)    | 8       | 0%       | 0.00      | not started                                                                                           |
| 18        | Historical product intel (SP-API + Keepa)          | 6       | 0%       | 0.00      | backlog                                                                                               |
| 19        | Per-component F18 metrics                          | 4       | 40%      | 1.60      | build_metrics live; Amazon-specific not wired                                                         |
| 20        | COGS v2 — Inventory (live FBA + FIFO)              | 6       | 80%      | 4.80      | merged #45; FBA QTY bug under investigation                                                           |
| 21        | COGS v2 — Pallet invoices                          | 4       | 90%      | 3.60      | merged #45; awaiting first prod entry                                                                 |
| **Total** |                                                    | **120** |          | **58.80** |                                                                                                       |

**Remaining: 57.20 points across 7 unstarted + 5 partial components**

---

## T3 — Local Sales

**Rollup: 0%** — track created 2026-05-01 · no builder task assigned yet

| Component                                             | Status                                             | Source                                   |
| ----------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| Stripe webhook → `local_sales` table (migration 0062) | Acceptance doc written; awaiting sprint assignment | `docs/acceptance/local-sales-webhook.md` |
| Manual entry form (cash / e-transfer)                 | Deferred to v1.1                                   | out of scope v1                          |
| Square Terminal webhook                               | Deferred; separate component; gates on 0062        | `docs/harness/PENDING_ADDITIONS.md`      |

**Next action:** create a `task_queue` row pointing to `docs/acceptance/local-sales-webhook.md` and assign it to the next sprint.

---

## T4 — Streamlit Port Backlog

**Rollup: 0 / 234 modules** · source: `docs/streamlit-port-catalog.md` · all status = pending

This is a backlog reservoir, not an active sprint. Modules move from here to an acceptance doc, then to a builder task — not in bulk. Promotion via acceptance-doc flow only.

Utility Tracker (52_Utility_Tracker.py) is the only ported module with a completed build — tracked separately under `product:streamlit_rebuild_utility_tracker` (100%).

| Tier | Description                      | Approx count | % complete |
| ---- | -------------------------------- | ------------ | ---------- |
| T0   | Core infrastructure (not a page) | ~10          | —          |
| T1   | Revenue-critical pages           | ~30          | 0%         |
| T2   | Time-saving tools                | ~60          | 0%         |
| T3   | Lifestyle + tracking             | ~80          | 0%         |
| T4   | Parked / deprioritized           | ~54          | 0%         |

**High-effort notable modules** (not yet in any sprint):

| Module                  | Lines | Priority signal  |
| ----------------------- | ----- | ---------------- |
| 83_Grocery_Tracker.py   | 1,557 | T3 daily driver  |
| tax_centre/megan_tax.py | 1,074 | Megan's business |
| 88_Pet_Health.py        | 490   | T3 lifestyle     |

---

## T5 — GPU Day Readiness

**Rollup: 71.0 / 100** · source: `docs/gpu-day-readiness.md`, last updated 2026-05-01

| Category                   | Weight  | Earned   | %       |
| -------------------------- | ------- | -------- | ------- |
| A — Ollama Pipeline        | 25      | 21.25    | 85%     |
| B — Harness Reliability    | 30      | 23.70    | 79%     |
| C — Doctrine + Docs        | 15      | 7.00     | 47%     |
| D — Staged Batch Readiness | 20      | 17.00    | 85%     |
| E — Environment + Secrets  | 10      | 2.00     | 20%     |
| **Total**                  | **100** | **71.0** | **71%** |

**Open gaps** (not 100%):

| Item                                     | Category | Weight | %       | Notes                                                                                                                                                                                                             |
| ---------------------------------------- | -------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B4 — cloudflared as Windows service      | B        | 8      | **50%** | Service installed, runs on boot, 4 edge connections live. Remaining: ollama.loeppky.xyz returns 403 (Cloudflare Access policy blocking Vercel). Fix: configure Access policy bypass OR wire Vercel service token. |
| ⚠ Cloudflare Access policy gap           | B        | —      | Blocker | ollama.loeppky.xyz returns 403; needs Access policy config in CF dashboard OR Vercel→Ollama service token before B4 reaches 100% and Vercel can reach Ollama                                                      |
| B6 — Direct SQL audit gap                | B        | 2      | **0%**  | Task 305a9528 queued, not started                                                                                                                                                                                 |
| C3 — Safety Agent doctrine               | C        | 4      | **0%**  | No decision queued                                                                                                                                                                                                |
| C5 — Status page spec'd / shipped        | C        | 4      | **0%**  | No spec, no queue entry                                                                                                                                                                                           |
| E2 — OURA_ACCESS_TOKEN in harness_config | E        | 3      | **0%**  | Prerequisite for Oura module                                                                                                                                                                                      |
| E3 — Staged-batch env vars audit         | E        | 3      | **0%**  | Required before next autonomous batch                                                                                                                                                                             |
| D5 — Inventory grounding doc             | D        | 2      | **0%**  | Next batch pre-work                                                                                                                                                                                               |
| D6 — Local_AI / Retail_Monitor decision  | D        | 2      | 50%     | Documented but decisions not yet made                                                                                                                                                                             |
| A4 — First real ship via Ollama          | A        | 5      | 25%     | Test file generated, not committed                                                                                                                                                                                |

---

## T6 — Life Tracks

Visible but unweighted. No % contribution to either portfolio rollup. No infrastructure for systematic tracking exists yet; items are captured here so they don't disappear between sessions.

| Track                 | Status                                          |
| --------------------- | ----------------------------------------------- |
| USA move planning     | Referenced in prior sessions; no doc, no module |
| Tesla API integration | Parked idea; no spec                            |
| Edge injury insurance | Parked idea; no spec                            |

---

## T7 — Parked / Future Products

0% by design — holding queue, not in any sprint.

| Idea                                    | Gate / notes                                       | Source            |
| --------------------------------------- | -------------------------------------------------- | ----------------- |
| Amazon legal tool (IP pre-screener)     | No hard gate; parked                               | PENDING_ADDITIONS |
| Building permit pre-screener            | No hard gate; parked                               | PENDING_ADDITIONS |
| dev_market_intel ("Keepa for dev work") | Hard problem: no public completed-job feeds        | PENDING_ADDITIONS |
| training_pipeline (LoRA 7B fine-tune)   | Gates: GPU + 6 months corpus + fine-tuning skills  | PENDING_ADDITIONS |
| arbitrage_training_corpus               | ~10% — decision logging ad-hoc; schema not defined | PENDING_ADDITIONS |
| AI control center                       | Name/scope not specified                           | memory            |
| GitHackers                              | Name unclear; surfaced once                        | PENDING_ADDITIONS |
| Square webhook ingestion                | Gates on local_sales T3 (migration 0062) landing   | PENDING_ADDITIONS |

---

## Top 10 Leverage Sort

Ranked by: (direct points recoverable) × (downstream unlock multiplier) × (effort inverse).
Items that unblock other items score higher even if their direct points are smaller.
This is the answer to "biggest progress per paste."

| Rank   | Action                                       | Track | Effort                | Direct pts | Downstream unlock                                                               | Why it ranks here                                                        |
| ------ | -------------------------------------------- | ----- | --------------------- | ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **1**  | Gmail OAuth + Vercel env (row 6)             | T2    | Config only (~30 min) | 4.0        | Validates rows 4+5 (12 pts already earned)                                      | Fastest unlock in the system — env var config, not a build               |
| **2**  | Reconciliation engine (row 11)               | T2    | Large build           | 10.0       | Row 12 (6 pts) + entire pipeline becomes trustworthy                            | Keystone; without it all ingestion is disconnected                       |
| **3**  | B4 — Cloudflare Access policy fix (50% done) | T5    | Config ~30 min        | 4.0 GPU    | Completes B4; unlocks ollama_daytime (T1, 1 pt remaining) + prod Ollama traffic | Tunnel is live; Access policy / service token is the only remaining gate |
| **4**  | Harness sandbox (T1-C)                       | T1    | Medium build          | 7.0        | Enables self_repair (6 pts) + push_bash_automation (3 pts)                      | Gate for 9 pts of gated components                                       |
| **5**  | Harness security_layer (T1-C, 30→100%)       | T1    | Medium build          | 4.9        | Required for sandbox → chains to self_repair + push_bash                        | Multiplier: completing it unlocks 16 pts of downstream                   |
| **6**  | Harness arms_legs (T1-C, 30→100%)            | T1    | Medium build          | 6.3        | Unblocks chat_ui (4.44 pts remaining)                                           | Second-largest remaining T1-C component                                  |
| **7**  | Local sales Stripe webhook                   | T3    | Small build           | —          | First real local revenue signal in DB                                           | Acceptance doc ready; fast to builder                                    |
| **8**  | GST UI / business-review surfacing (row 14)  | T2    | Small build           | 3.6        | Closes Sprint 4 kill criterion gap                                              | Low effort; high visibility; low-contrast bug is the blocker             |
| **9**  | Anomaly detection (row 17)                   | T2    | Large build           | 8.0        | Pipeline quality; catches fee / refund / COGS gaps                              | 0% on 8-weight component; no prereqs                                     |
| **10** | Income tax / CPP projection (row 15)         | T2    | Medium build          | 6.0        | Tax output chain                                                                | 0% on 6-weight component with clear Streamlit baseline                   |

**Fastest single win:** Gmail OAuth (rank 1) — validates 12 already-built points for the cost of adding env vars in Vercel.

**Highest single-action impact:** Reconciliation engine (rank 2) — makes the entire Amazon pipeline trustworthy; without it all data is disconnected ingestion.

**Biggest unlock chain:** Harness security_layer → sandbox → self_repair + push_bash_automation (ranks 4+5) — completing both adds ~21 pts and enables the autonomous self-healing layer.

---

## Open Questions for Colin

| #   | Question                                                                                                                | Blocking what |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| Q2  | Streamlit Port (T4): are any specific tiers or modules ready to be promoted to the next sprint?                         | T4 roadmap    |
| Q3  | Life Tracks (T6): do USA move / Tesla API / injury insurance warrant a formal spec + weighting, or remain capture-only? | T6 structure  |

---

_Source docs: `harness_components` (DB), `product_components` (DB), `task_queue` (DB), `docs/lepios/amazon-pipeline-rollup.md`, `docs/standing/active-state.md`, `docs/gpu-day-readiness.md`, `docs/streamlit-port-catalog.md`, `docs/harness/PENDING_ADDITIONS.md`, `docs/acceptance/local-sales-webhook.md`_
