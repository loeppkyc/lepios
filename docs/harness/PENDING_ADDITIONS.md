# Pending Foundation Spec Additions

Captured 2026-04-28. Incorporate into HARNESS_FOUNDATION_SPEC.md at
next revision after current memory-layer + security-layer work lands.

---

## 1. custom_mcp — new component, T3 tier (agentic capabilities)

**Purpose:** Model Context Protocol server purpose-built for LepiOS.
Exposes Supabase schema, harness_components, product_components,
idea_inbox, decisions_log, branch-naming rules, and any other
LepiOS-specific surface as tools Claude Code can call directly.
Eliminates the manual paste loop between Claude Code and Claude API
for tasks like research, scoring, cross-window coordination.

**Status:** 0% — not started
**Suggested weight:** 4 (rebalance from elsewhere in T3)
**Gates on:** nothing — can start anytime
**Unlocks:** scout_agent, chat_ui, faster cross-window work,
elimination of human-in-the-loop pasting

**Why it's a foundation gap:** Colin's primary friction today is
copy-pasting between Claude Code and Claude API. A custom MCP closes
that loop by giving Claude Code direct programmatic access to LepiOS
internals. Adjacent to arms_legs (#11) and specialized_agents (#15)
but neither covers it cleanly.

---

## 2. ci_cd — new component, T2 tier (observability + improvement)

**Purpose:** GitHub Actions or equivalent CI pipeline. Tests run on
every PR, lint/typecheck enforced at PR level (not just local commit),
preview environment per PR with smoke tests, deploy gate fires after
CI green.

**Current state:** ~20% — Vercel auto-deploy + husky pre-commit +
AI reviewer exist, but no PR-level CI
**Suggested weight:** 3
**Gates on:** nothing — can start anytime
**Unlocks:** safer parallel windows (PR breaks don't reach main),
reduced reliance on local hooks (which crash on libuv today)

**Why it's a foundation gap:** Existing setup catches most things at
commit time, but commit-time enforcement breaks the moment hooks
crash (today's libuv bug). PR-level CI is independent of local
environment and catches things hooks miss.

---

## Source

Captured from voice-transcript brainstorm 2026-04-28. Original
prompt was "custom MCP to kill the pasting bottleneck, then
Turborepo + ESBuild for faster builds, then CI/CD." Turborepo +
ESBuild deferred — they're optimization for an established system,
not foundation gaps.

## Working agreement

- This is CAPTURE ONLY. Do not modify HARNESS_FOUNDATION_SPEC.md.
- Do not start either component.
- Do not propose weight rebalances yet — those happen at next
  spec revision when other components have shipped and we know
  the new totals.

---

### training_pipeline (T3, deferred)

LoRA fine-tune of 7B base model on LepiOS training corpus. Inference moves local once trained.

- Base candidates: Qwen 2.5 7B (Apache 2.0) | Llama 3.1 8B (note 700M MAU clause)
- Source: Hugging Face + free auth token
- Gates: 3060 GPU acquisition (12GB VRAM borderline for QLoRA, confirm before purchase), 6+ months training corpus, fine-tuning skills
- Open: training data format (JSONL/ChatML/instruction tuples — decide before corpus capture), eval methodology (held-out set + N-prompt human eval), inference target (3060 vs adapter-merge into Ollama), adapter registry/versioning

### arbitrage_training_corpus (T2, data discipline)

Capture every Amazon reselling decision as structured training data. Unique signal. Feeds training_pipeline.

- Status: ~10% (pricing tiers documented, decision logging ad-hoc)
- Open: decision schema (timestamp, ASIN/ISBN, decision_type, inputs_seen, decision_made, rationale, outcome_pending_until), storage (Supabase `arbitrage_decisions` table?), capture mechanism (must hook into existing reselling tooling to survive), outcome attribution job (back-link sell-through to decision row), negative-example capture (rejected books, same schema)

### dev_market_intel (parked product idea — NOT harness component)

"Keepa for development work" — pricing/scoping intelligence on Upwork, Toptal, Fiverr Pro completed-job data. Standalone product. Park alongside Amazon legal tool + building permit pre-screener.

- Hard problem: source data acquisition (no public completed-job feeds, scraping ToS-fragile, Fiverr Pro gated)

### square_webhook_ingestion (T2, sales ingestion — deferred from local_sales v1)

In-person sales via Colin's Square debit machine. Separate component from the
Stripe webhook ingestion (`local_sales`).

- **Trigger:** Square sends webhooks on `payment.completed` events
- **Schema:** Extend `local_sales` with `channel = 'in_person'` rows, or a
  separate `square_sales` table — decide at spec time
- **Env vars needed:** `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_ACCESS_TOKEN`
- **Endpoint:** `app/api/webhooks/square/route.ts` — signature verification via
  HMAC-SHA256 (Square's method, not Stripe-style)
- **Gates on:** `local_sales` Stripe webhook (migration 0062) merged to main
- **Status:** 0% — not started
- **Captured:** 2026-05-01 during local_sales acceptance doc authorship (PB-3)

---

### Open from this session

- "GitHackers" — Colin mentioned, name unclear. Possibly GitHub trending, HN jobs, or something else. Capture name if it resurfaces.

### Specs landed

- 2026-04-28: SANDBOX_LAYER_SPEC.md drafted, hard-blocked on security_layer slices 1/2/6
- 2026-04-28: ARMS_LEGS_S2_SPEC.md drafted. Hard-blocked on arms_legs S1 (queued) + security_layer slices 1+2 (live). Q1/Q2 resolved in-spec; Q3-Q7 deferred.
- 2026-04-28: F19_PRIME_SPEC.md drafted. Methodology spec, no harness_components row. Soft prereqs all live (decisions_log, agent_events, process-efficiency.ts). Demo target: friction index, slice 1.
- 2026-04-28: CHAT_UI_SPEC.md drafted. Foundation spec table stale on chat_ui (0% reported, ~26% shipped). Slice 1 target ~45%. Hard prereqs all live (arms_legs S2 spec drafted, security_layer slices 1+2 live, chat shell+persistence+auth live). Q1/Q2/Q3/Q5/Q6/Q7 deferred.
- 2026-04-28: SELF_REPAIR_SPEC.md drafted. Hard-blocked on sandbox slice 1 + security_layer slices 1+2+6. Slice 1 seed action type: coordinator_await_timeout.

### Implementation gaps

- 2026-04-28: knowledge ingest spawning duplicate Ollama-burndown stubs (31+ rows in single cluster). Root cause TBD per audit 2026-04-28. Cleanup deferred to knowledge_dedupe phase 2a.

### Foundation spec drift

- 2026-04-28: Foundation spec stale on chat_ui (reported 0%, audit shows ~26% shipped — shell + persistence + auth + streaming + identity + markdown). Other components may have similar drift. Audit task queued.

### Research queued

- Token-savings frameworks investigation 2026-04-28: see [docs/research/claude-code-token-savings-2026-04.md](../research/claude-code-token-savings-2026-04.md). Top candidate: caveman (CLAUDE.md style directive, ~65% output reduction). CCR + RTK incompatible with Anthropic Routines — local-machine proxies only. Branch-guard verified safe vs RTK (execSync, no Claude-observation seam). F19' input.
