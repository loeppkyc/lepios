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
