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

### Open from this session

- "GitHackers" — Colin mentioned, name unclear. Possibly GitHub trending, HN jobs, or something else. Capture name if it resurfaces.

### Specs landed

- 2026-04-28: SANDBOX_LAYER_SPEC.md drafted, hard-blocked on security_layer slices 1/2/6
