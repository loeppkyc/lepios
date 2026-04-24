# CLAUDE.md — LepiOS

Global rules live in `~/.claude/CLAUDE.md` and apply here too.

**Single source of truth:** `ARCHITECTURE.md` at this project root. Read it before writing any code or making any design decision. If anything in this codebase contradicts it, flag it — do not silently fix it.

---

## 1 — Quick Context

LepiOS is Colin's life command center. Cockpit-style instrument panel.
Next.js App Router, Supabase, Tailwind, shadcn/ui (heavily customized),
Vercel.

**Current state (2026-04-21):**

Live in production at `lepios-one.vercel.app`, auto-deploying from
GitHub main. 370+ tests. Autonomous night_tick + morning_digest crons
running against production Supabase. Rule-based quality scoring v1
live, accumulating Tier 1 (`tier_1_laptop_ollama`) baseline data.

**Sprints shipped:**

- Sprint 1: Design Council primitives + cockpit shell
- Sprint 2: Betting tile (Kelly Sizer) — deployed, not active priority
- Sprint 3: PageProfit scan flow (Chunks A–E complete)
- Sprint 4 (current): Business Review Trust Layer (BR Tier 1–3 progression)

**Autonomous harness (parallel track):**

- Step 1–5 complete: knowledge store, handoffs, safety agent, scoring
  dashboard, Ollama + pgvector
- Step 6 complete: orchestration loop (night_tick + morning_digest)
  live in production as of 2026-04-20
- Step 6.5 pending: daytime Ollama tick + OLLAMA_TUNNEL_URL wiring
- Step 7–8 pending (see 8-component plan in docs/)

**Feedback loop scoring v1:** shipped 2026-04-21. See
docs/feedback-loop-scoring.md — §11 lists deferred work with
revisit triggers.

**Up next (as of this edit):** app-layer work on Sprint 4 Business
Review or Sprint 5 Amazon Orders + Payouts, per ARCHITECTURE.md §7
sprint queue. Autonomous harness expansion (Step 6.5 Ollama daytime)
gated on a clean week of overnight runs.

---

## 2 — Stack (locked, from ARCHITECTURE.md §9)

- **Framework:** Next.js App Router, TypeScript
- **Database/Auth:** Supabase (RLS enforced — Safety Agent reviews all migrations)
- **Payments:** Stripe (not v1-critical)
- **Hosting:** Vercel
- **UI:** React + Tailwind v4 + shadcn/ui — heavily customized per Design Council; no generic SaaS look
- **Local AI:** Ollama (Qwen 2.5 32B, Phi-4 14B)
- **Ingestion:** Telegram Bot API
- **Testing:** Puppeteer E2E, acceptance tests per module

---

## 3 — Architecture Rules (non-negotiable)

1. **Check-Before-Build (§8.4):** Before any new code/schema/config — verify it doesn't exist in the Streamlit OS baseline (Phase 2) or in this repo (Phase 3+). Default action: Beef-Up. Replace requires Colin's explicit approval. Build-New is last resort.
2. **Accuracy-Zone Pipeline (§8.5):** Tight-scope tasks (one sentence + acceptance criterion). Stop at 40-50% context window, write handoff note, fresh worker picks up. Reality-Check Agent reviews every report. Hallucination log: `docs/hallucination-log.md`.
3. **Decisions Are Colin's:** Agents propose; Colin decides. Every destructive operation, schema change, and migration plan requires explicit Colin approval.
4. **Tier 0 Safety:** Before any git operation, migration, deploy, or secret-adjacent action — confirm it is safe. If in doubt, stop and ask.
5. **Seamless or don't ship:** Every module uses Design Council primitives. No freelancing the look.
6. **Acceptance tests first:** Every module has written acceptance criteria before code is written.
7. **F17 — Behavioral ingestion justification required:** Every new module must justify its contribution to the behavioral ingestion spec and path probability engine. See `docs/vision/behavioral-ingestion-spec.md`. If a module has no engine-feeding signal, reconsider building it.

---

## 4 — Baseline Reference

The Streamlit OS (`../streamlit_app/`) is the 7-week baseline. It contains working logic for: Amazon scan/list/ship, expenses, betting (Kelly Sizer), Oura ingestion, Telegram bots, and more. Phase 2 audits document it in `audits/`. Phase 3 porting decisions (port vs. rebuild) require Colin's approval.

Do NOT modify the Streamlit OS during Phase 2. It remains running as reference until LepiOS v1 ships real value.

---

## 5 — Security Safeguards

**Before granting any user access to `loeppkyc/Loeppky`, the `loeppky_trigger_bot` token must be rotated via BotFather to invalidate the token still present in commit `fd8860c`'s history.** (INC-001 — risk accepted 2026-04-17 while repo is private, no collaborators.)

**INC-002 (2026-04-21): GitHub secret scanning detected two leaked Telegram bot tokens in `docs/security-log.md:114` and `audits/integrations-report.md:342`, both from Streamlit-era work. Both tokens revoked via BotFather the same day — no live security risk remains. Files were NOT scrubbed from the repo or history; alerts remain open in the GitHub Security tab. Defer cleanup until the repo direction is settled (delete + restart vs. scrub files + close alerts). If deciding to keep this repo long-term, do Option B: delete the two files in a commit, then mark the scanning alerts as revoked.**

**Never display, echo, or paste the contents of secrets, tokens, API keys, or credentials values in chat — not even for verification.** This applies to .env files, .streamlit/secrets.toml, Vercel env vars, BotFather tokens, database passwords, and anything labeled "secret," "token," "key," or "password." When updating such a value: confirm the update was made by name, show the before/after masked (first 4 + last 4 characters only, rest as dots), and state the file/line changed. If Colin asks you to display a secret anyway, remind him that chat transcripts are not secure and confirm twice before echoing. The default answer is "I updated it, first 4 / last 4 are X / Y."

---

## 6 — Data Integrity Rules

**Historical Streamlit bets data is NOT trusted for LepiOS signals pending an odds-integrity audit (BACKLOG-1).** Do not import bets from Streamlit SQLite/Sheets into the Supabase `bets` table without explicit approval from Colin and a verified audit. See `audits/migration-notes.md` BACKLOG-1 for scope and methodology requirements.

---

## 7 — Kill Criterion (ARCHITECTURE.md §11)

2 weeks from Phase 3 start: if LepiOS is not measurably helping Colin make or save money (Amazon Telegram alerts firing on real deals, Expenses tile tracking real spend, Betting/Trading tiles logging real activity), stop and simplify. Elegance is not a substitute for utility.

@AGENTS.md
