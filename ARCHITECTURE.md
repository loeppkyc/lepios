# LepiOS — Architecture & Operating Doctrine

> **Thesis:** Every day smarter, faster, more money, more happiness for myself and my family. LepiOS is the operating system that makes that progress loop tighter, measurable, and autonomous.

This document is the single source of truth for LepiOS. Every agent — human or AI — reads this before writing a line of code or making a design decision. Nothing ships that contradicts it. If reality forces a change, the change happens here first, then propagates.

---

## 1. Identity

**LepiOS is a life command center for Colin.**

- **Single operator:** Colin. Not multi-user. Not a household account.
- **Tracked subjects:** Colin, Megan (partner), Cora (daughter). Every data point, metric, and agent observation is tagged to a person (Colin / Megan / Cora / Shared / Business).
- **Primary surface:** a cockpit-style instrument panel showing the state of Colin's life at a glance.
- **Secondary surface:** a Situation Room where a council of specialist AI agents continuously deliberates about Colin's life and LepiOS itself, and Colin can observe or intervene.
- **Operating mode:** Colin is the Supreme. Agents propose, research, and execute structured work; **decisions are always Colin's**. Agents improve the probability of good decisions; they do not make them.

---

## 2. The Four Pillars

Life is organized into four top-level pillars. Every metric in the system rolls up to one of them. Every pillar rolls up into a single master metric: the **Quality of Life Index**.

| Pillar      | Core question                                   | Example inputs                                                                                                                    |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Money**   | Am I making money? Is wealth compounding?       | Amazon P&L, sports betting ROI, trading P&L, expenses (business vs personal, Colin vs Megan), cash position, net worth trajectory |
| **Health**  | Am I / we healthy?                              | Oura (readiness, HRV, sleep), weight, strength, energy, medical flags — for Colin, Megan, and Cora                                |
| **Growing** | Am I advancing? Is quality of life trending up? | Composite score benchmarked against age cohort; rolls up progress from other pillars plus skills, learning, project shipping      |
| **Happy**   | Am I / we happy?                                | Daily self-rating, mood signals, Cora's mental state, Megan's wellbeing, time spent on what matters                               |

Each pillar has specialist sub-agent(s) whose job is to (1) define what "good" looks like in that domain, (2) score current state, (3) recommend the next action, (4) explain itself in plain language. **Agents never make Colin's decisions — they sharpen them.**

---

## 3. The Council of Agents

LepiOS is a **situation room with a standing council of specialists** continuously analyzing Colin's life, deliberating with the Digital Twin, and executing structured work. Colin observes, ratifies, redirects.

### 3.1 Permanent Council Roster (v1)

**System-level agents (always on):**

- **Digital Twin** — synthesizes across all agents; speaks as Colin's proxy; produces the `Next Move` recommendation; owns the deliberation feed.
- **Safety & Security Agent** — Tier 0 monitor. Reads every proposed write, migration, git operation, secret-adjacent action. Vetoes or escalates. Always on. Preempts everything.
- **Reality-Check Agent** — grounds every other agent's output. Tags claims as **grounded** (evidence-backed) or **generated** (prose). Generated content cannot be promoted to canonical without Colin's explicit approval. Runs cheap, Ollama-eligible.
- **Token Budget Manager** — tracks Claude Code 5-hour rolling window; schedules work across Tier 0–3.
- **Context Budget Manager** — sibling to Token Budget Manager (see §8.5). Tokens are money; context depth is accuracy. Both get managed.

**Life-domain agents (Money pillar, v1 priority):**

- **Trading Agent** — decision support. Pre-market prep, setup summarization from sources Colin trusts, risk budget, P&L logging. **Does not generate trade signals for Colin to execute blindly.**
- **Betting Agent** — decision support and honest logging. Bankroll rules, Kelly sizing math on Colin's picks (integrates existing Kelly Sizer component), tilt detection, ROI tracking. **Picks come from Colin.**
- **Amazon Agent** — web scouting for online arbitrage deals, monitoring High Demand tier 1 authors and Collectibles tiers, Telegram alerts when deals hit. Orchestrates the scan/list/ship workflow Colin already uses. **Hands-on sourcing through pallets stays Colin's.**
- **Expenses Agent** — classifies business vs personal, Colin vs Megan; flags anomalies.

**Life-domain agents (v2+, stubs in v1):**

- **Doctor Agent** — health composite for Colin, Megan, Cora; flags trajectory changes.
- **Fitness/Trainer Agent** — Oura + workout + strength.
- **Nutrition Agent** — food inventory, groceries, eating patterns.
- **Coach Agent** — progress against lifetime goals; weekly review facilitator.
- **Teacher Agent** — learning, skills, research.
- **Friend / Stranger Agent** — outside perspective; devil's advocate.

**Design Council (ships v1 looking like a cockpit, not a generic SaaS app):**

- **Art Director Agent** — aesthetic vision; references Bloomberg Terminal, Apollo mission control, high-end trading platforms, sci-fi HUDs, Teenage Engineering. Actively prevents generic-Claude-coder look.
- **Motion Agent** — animation, transitions, micro-interactions.
- **Data-viz Agent** — chooses the truthful, beautiful visualization per metric.
- **Typography & Color Agent** — tokens. Monospace numbers, display pillar labels, tight sans body. Dark base.
- **Frontend Engineer Agent** — ships what the Design Council specifies. Builds primitives (`<Gauge>`, `<PillBar>`, `<StatusLight>`, `<CockpitRow>`). Heavily customizes shadcn/Tailwind.

### 3.2 Priority Stack (Token Budget Manager allocates by this)

- **Tier 0 — Safety/Security:** preempts all. Always-on monitor. Wakes Colin if critical.
- **Tier 1 — Urgent:** something broke; real-time alert.
- **Tier 2 — Scheduled:** morning standup, weekly review, cron, nightly convene.
- **Tier 3 — Background (daytime):** life analysis, deliberation feed, urgent code fixes.
- **Tier 3 — Background (overnight):** in v1 limited to research and logging; **no autonomous code-writing overnight until the council has proven itself during supervised daytime hours.**

### 3.3 Token-Aware Scheduling Rules

- Track 5-hour window at all times. Surface remaining budget as a cockpit gauge.
- Within ~1 hour of reset with meaningful tokens: blast big jobs.
- Going to sleep: work until tokens run out, unless wake time is before next reset — then throttle.
- Colin actively in Claude Code: background agents go low-power.
- Colin away: normal cadence on queued work.
- Never leave Colin waiting 3 hours because overnight agents drained budget.

---

## 4. The Cockpit — Home Screen Design Language

**Aesthetic:** instrument panel. Gauges, pill-shaped power bars, status lights. Dark background. Everything readable at a glance. Color earns its brightness. If something is off, the gauge turns amber or red and Colin notices without reading a word.

### 4.1 Home screen layout

1. **Top band — Master Gauge.** Quality of Life Index with delta. **Next Move** button adjacent.
2. **Four Pillar Rows:** Money / Health / Growing / Happy. Strips of pill gauges per row.
3. **Status Lights — system plumbing.** Oura synced / Amazon feed live / Supabase healthy / Safety agent green / Token budget window remaining / Context budget green.
4. **Situation Room Ticker.** Slim strip showing latest council deliberation headline.

### 4.2 Reusable Primitives

`<Gauge>`, `<PillBar>`, `<StatusLight>`, `<CockpitRow>`, `<NextMoveButton>`, `<SituationTicker>`. Every section uses these. No freelancing.

### 4.3 Design Council Deliverable (Phase 2 gate)

Mood boards, typography/color tokens, motion principles, coded mockups of each primitive, and a 10-minute **taste session** with Colin to lock direction before any cockpit code is written.

---

## 5. Ingestion Model

1. **Voice/text via Claude Code** — at the desk.
2. **Telegram bot** — on the go. Text, photo, voice → webhook → Supabase. Prioritized over WhatsApp.
3. **Ollama (local) routing** — takes clerical work so frontier tokens are reserved for hard reasoning.

**Passive ingestion:** Oura, Amazon feed, eventually Stripe / Tesla / bank feeds. Silent unless an agent flags something.

---

## 6. Daily Loop

1. Wake → cockpit → scan overnight council activity → state of life at a glance.
2. Trading session → Trading tile → pre-market brief → execute on TradingView → log results.
3. Sports betting → Betting tile → review data, apply Kelly sizing on own picks → Play Alberta → place → log.
4. Amazon → Amazon tile → review overnight deal-scouting results and sourcing list → go source pallets and online deals → scan/list/ship in-app → log.
5. Family & health → log via voice or Telegram.
6. End of day → tell the system what happened → sleep.
7. Overnight → Tier 3 research and deal-scouting within token budget.

**Inversion goal:** within weeks, Colin lives in LepiOS, not in Claude Code. Claude Code becomes maintenance.

---

## 7. v1 Scope — The Amazon Earning Loop

v1 is the first unified slice of LepiOS that replaces the Loeppky Streamlit prototype for real earning activity. Ship Amazon first because Amazon is the only thing currently making money. Everything else waits its turn.

The Streamlit app (Loeppky Business OS, ~60 modules) is a brain-dump prototype, not a production system. Multiple sections carry hardcoded approximations, silently-swallowed errors, and dead code paths. Nothing is being actively used to run the business yet. LepiOS is the rebuild — not a migration. Streamlit is reference material; Next.js + Supabase is the destination.

### 7.1 Sprint queue (locked)

**Sprint 3 — PageProfit Core.** [SHIPPED 2026-04-19]

**Sprint 4 — Business Review Trust Layer (Tier 1).** Wire the honest, non-sheet-backed sections of Business Review into LepiOS: Today Live, Yesterday, What You're Owed, Statement Coverage, Recent Days (honest zeros, no back-fills). Kill-criterion: every visible number on the Sprint 4 BR matches its source system (Seller Central, Dropbox statement folder) to the penny, with zero approximations carried forward from Streamlit.

**Sprint 5 — Amazon Orders + Payouts.** SP-API order sync, Payout Register reconciliation. Fills the per-order fee/payout data that removes the Streamlit 65% approximation. Closes the live-money loop. KILL-CRITERION GATE: after Sprint 5, Colin must have actual order-level fees and payouts flowing. If not, stop and re-evaluate.

**Sprint 6 — Business Review Tier 2.** Refine the partially-working BR sections now that trust layer + order data are live: Life P&L with honest error surfacing, Financial Snapshot driven by real bookkeeping writes, Inventory Potential Profit with real referral fee logic (no more 65%).

**Sprint 7 — Bookkeeping Core.** Bookkeeping Hub + Receipts ingest (Claude Vision) + Paper Trail reconciliation + Monthly Close sign-off. Ledger foundation that feeds BR Tier 2 and beyond.

**Sprint 8 — Business Review Tier 3 + Shipment Manager Core.** Rebuild the broken BR sections (Monthly Expenses, Health, view toggles) with accumulated judgment from Sprints 4–7. Ship the FBA inbound/label workflow once the trust layer is verified.

**Sprint 9 — Amazon reporting.** Sales Charts + Category P&L + Business History. Read-only views on Sprints 3–5 data.

**Sprint 10+** — Marketplace expansion, Tax layer, Household, Life/Pets/Health/Family/Calendar/Goals per original queue.

### 7.2 Sequencing rationale

**Trust before tools.** Colin's stated pattern: "once my numbers, bookkeeping, and statements all come in first page accurately is when I trust actually listing and shipping stuff." Shipment Manager sat at Sprint 4 in the prior plan. Moving it to Sprint 8 reflects that building shipping tools before the trust layer is ready produces dead features.

**Honest first, then refine, then rebuild.** BR is tier-sorted by verifiability against source systems. Sprint 4 ships only the already-honest sections. Sprints 5–7 fill the data gaps that make partially-working sections trustworthy. Sprint 8 rebuilds the structurally broken sections with accumulated judgment.

### 7.3 Multi-user HARD GATE

Multi-user HARD GATE from previous §7.3 still applies before any second user touches auth.users. See migration-notes MN-3. Before any second user is added to auth.users, the following must ship and be verified: (a) a `profiles(user_id uuid PRIMARY KEY, person_handle text NOT NULL)` table with FK to auth.users, (b) updated RLS policies on all person-scoped tables (`bets`, `trades`, `transactions`, `products`, `deals`, `net_worth_snapshots`, `agent_events`) replacing the permissive `auth.uid() IS NOT NULL` check with `person_handle = (SELECT person_handle FROM profiles WHERE user_id = auth.uid())` on both USING and WITH CHECK, (c) removal of hardcoded `person_handle = 'colin'` from `app/api/bets/route.ts` and any other route that acquires this constraint during v1. Verification: attempt cross-user SELECT and INSERT as a second auth user and confirm both are blocked. See `audits/migration-notes.md` MN-3 for SQL migration sketch.

### 7.4 Shipped / deferred / dumped

- **Shipped and holding:** Sprint 2 Betting tile (stays deployed at lepios-one.vercel.app, not active priority).
- **Deferred to v3+:** Trading Journal, Life Compass, 3D Printer HQ.
- **Dumped:** Dropbox Archiver (Streamlit-specific workflow, doesn't translate to web).
- **Consolidated:** Arbitrage Scanner → Retail HQ; Retail Monitor → Retail HQ; Deal Tracker → Cashback HQ; Retirement Tracker → Lego Vault; Oura Health → Health; Coupon Lady → Grocery Tracker; Tax Return → Tax Centre.
- **Confirmed dead in Streamlit (delete, don't port):** Book Scout, Scoutly, Expense Dashboard, Retail Scout, Product Intel, Shipments redirect. ~2,800 lines.

### 7.5 Rules that carry through the queue

- Every module writes structured events to the local knowledge store (Ollama collection layer). GPU arrives later; until then collection-only.
- Tier 0 Safety (Safety & Security Agent, Reality-Check Agent) preempts all sprint work. _Note: Reality-Check Agent is currently performed by Colin in person; agent implementation targets Sprint 5+._
- Kill criterion from §11 holds at sprint granularity: does this sprint make or save money this week? If no, stop.

### 7.6 What v1 is NOT

- v1 is not the full Council of Agents speaking to Colin. Agents run silently under sprints as needed (Safety, Reality-Check, Amazon, Expenses). The Situation Room, Digital Twin deliberation feed, and Design Council full rollout are v2+.
- v1 is not the cockpit aesthetic with master Quality of Life gauge, pillar gauges, and status lights as the primary home. Business Review serves as functional home through the tier progression (Sprint 4 Tier 1 → Sprint 6 Tier 2 → Sprint 8 Tier 3); the full cockpit design is v2.
- v1 is not multi-user, Megan login, Tesla API, WhatsApp, or cross-border relocation features.

---

## 8. Architectural Principles (non-negotiable)

1. **Safety and security preempt everything.** Tier 0 is sacred.
2. **Decisions are Colin's.** Agents raise probability of good decisions; they do not decide.
3. **Don't waste tokens.** Ollama for clerical; frontier Claude for hard reasoning.
4. **Never hallucinate into the database.** Staging layer; Safety + Reality-Check review; promote to canonical only after grounding or explicit approval.
5. **Seamless or don't ship.** Every module uses the same Design Council primitives.
6. **Acceptance tests first.** Every module has written acceptance criteria before code.
7. **Parallel via worktrees.** Build agents work in parallel git worktrees to avoid collisions.
8. **Colin is Supreme.** Every destructive operation requires explicit approval.
9. **Progress is the product.** Every feature must tighten the daily progress loop.
10. **Check before build** (see §8.4).
11. **Work in the accuracy zone** (see §8.5).

### 8.4 Check-Before-Build Doctrine

**Before proposing new code, schema, config, or integration, every agent MUST check whether it already exists in the codebase.** LepiOS has accumulated 7+ weeks of work. Much of what we need is probably already there in some form.

For every proposed unit of work, the agent asks and documents:

1. **Does this already exist?** Grep the repo, list the files, check Supabase schema, check existing components, check past Claude Code sessions. Report findings.
2. **If it exists, what's the state?** _Working / Partial / Broken / Stale._
3. **What's the right action?** Pick one:
   - **Leave alone** (works, meets v1 bar) — document and move on.
   - **Beef up** (exists but under-built) — extend in place, don't rewrite.
   - **Replace** (exists but fundamentally wrong shape for v1) — deprecate with a migration plan, don't just delete.
   - **Build new** (genuinely doesn't exist) — only after the first three are ruled out.
4. **Confirm with Colin before replacing or deleting existing work.** Beefing up is default-safe; replacement is not.

This rule applies to components, database tables, RLS policies, agents, scripts, config, MCPs, and documentation. **"Build new" is the last resort, not the first instinct.**

### 8.5 Accuracy-Zone Pipeline — Hallucination Management

Context degradation under scope is the #1 quality risk. Model accuracy falls _exponentially_ as context depth and task scope increase. The "good zone" is early in a fresh context on a tight-scope task. We must stay in that zone.

**Tight-scope execution rule.** Every agent task has a token budget and a scope budget. A build task is "implement `<Gauge>` primitive to pass these three tests" — not "build the cockpit." A research task is "audit Supabase `expenses` table schema" — not "audit everything." If a task can't be stated in one sentence with a clear acceptance criterion, it's too big. Break it.

**Context window hygiene.** When an agent's context passes ~40-50% of the window, it stops, writes a structured **handoff note** (what was done, what's next, what's verified, grounding manifest), and a fresh agent picks up from the handoff note — not from the old context. Old context is discarded. Hallucinations cannot compound across stages because stages don't share memory — they share only validated artifacts.

**Grounding checkpoints.** Between stages, the Reality-Check Agent reads each artifact and tags claims **grounded** or **generated**. Generated content is not promoted to canonical without explicit Colin approval.

**Star topology, not long chains.** A coordinator holds the plan and dispatches short, independent tasks to workers. Each worker returns a small verified artifact and its context is discarded. The plan is the artifact, not the coordinator's memory. If the coordinator's context fills, coordinator swap.

**Calibrated confidence.** Every output includes confidence level and grounding statement. "Megan's BP trending up 4% over 3 weeks (grounded: Oura BP field, 21 readings)" is fine. Unsourced prose is flagged and not surfaced. Agents are taught to say _I don't know_.

**Hot-zone mapping.** Empirically measure where accuracy drops for each task type on each model. Log failures with context depth, task type, model. The accuracy zone is _tuned with data from our own runs_, not assumed.

**Hallucination log.** Every caught hallucination goes in `docs/hallucination-log.md` with context depth, task, model, and corrective action. This feeds the CLAUDE.md #4 failures-and-successes bucket.

---

## 9. Tech Stack (locked)

- **Framework:** Next.js (App Router)
- **Database / Auth:** Supabase (RLS enforced; coordinator reviews all migration PRs before apply)
- **Payments:** Stripe (not v1-critical)
- **Hosting:** Vercel
- **UI:** React + Tailwind + shadcn/ui as foundation only; heavily customized per Design Council
- **Local AI:** Ollama (Qwen 2.5 32B, Phi-4 14B; flash attention; KV cache tuned for 16–24GB VRAM)
- **Ingestion:** Telegram Bot API
- **Testing:** Puppeteer end-to-end; acceptance tests per module
- **Dev env:** Claude Code with sub-agents, `/loop`, git worktrees, CLAUDE.md, hooks

---

## 10. CLAUDE.md Alignment

CLAUDE.md (global + project) must capture:

1. Knowledge compression (`/init`).
2. Preferences/conventions — e.g., _write acceptance tests first_, _check before build_, _tight-scope tasks_, _never freelance the look_, _Ollama for clerical_.
3. Capabilities declaration — tools, MCPs, skills, sub-agents, when to use them.
4. Failures & successes log — fed continuously from the hallucination log and build retrospectives.

ARCHITECTURE.md is the north star. CLAUDE.md is the working playbook.

---

## 11. Phase Plan and Kill Criterion

- **Phase 1 — Big Picture Definition:** this document + kickoff prompt. **(Complete.)**
- **Phase 2 — Parallel Research Audits:** UX, data, feature completeness, integrations, design mood. Check-before-build inventory. No code changes. Output: structured markdown reports + grounding manifests.
- **Phase 3 — Delegated Parallel Build:** v1 scope built in parallel worktrees with tight-scope tasks, handoffs, acceptance tests, Reality-Check gates.
- **Phase 4 — Integration & Polish:** merge, Puppeteer end-to-end, ship v1.

**Kill criterion — 2 weeks from Phase 3 start.** If LepiOS is not measurably helping Colin make or save money by that point (Amazon deal-scouting firing real Telegram alerts Colin acts on, Expenses tile accurately tracking his actual spend, Betting/Trading tiles logging his activity honestly), we stop, re-evaluate, and possibly simplify the architecture. No sunk-cost. _Does this make money this week?_ is the test. Elegance is not a substitute for utility.

---

_Last updated: April 17, 2026. Supersedes all prior informal specs. Changes require explicit Colin ratification._
