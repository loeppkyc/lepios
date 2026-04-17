# CLAUDE.md — LepiOS

Global rules live in `~/.claude/CLAUDE.md` and apply here too.

**Single source of truth:** `ARCHITECTURE.md` at this project root. Read it before writing any code or making any design decision. If anything in this codebase contradicts it, flag it — do not silently fix it.

---

## 1 — Quick Context

LepiOS is Colin's life command center. Cockpit-style instrument panel. Next.js App Router, Supabase, Tailwind, shadcn/ui (heavily customized), Vercel.

**Phase status:**
- Phase 1 (Big Picture Definition): COMPLETE — ARCHITECTURE.md is the output
- Phase 2 (Research Audits): IN PROGRESS — see `audits/`
- Phase 3 (Delegated Parallel Build): NOT STARTED
- Phase 4 (Integration & Polish): NOT STARTED

No code changes during Phase 2. Research and inventory only.

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

---

## 4 — Baseline Reference

The Streamlit OS (`../streamlit_app/`) is the 7-week baseline. It contains working logic for: Amazon scan/list/ship, expenses, betting (Kelly Sizer), Oura ingestion, Telegram bots, and more. Phase 2 audits document it in `audits/`. Phase 3 porting decisions (port vs. rebuild) require Colin's approval.

Do NOT modify the Streamlit OS during Phase 2. It remains running as reference until LepiOS v1 ships real value.

---

## 5 — Security Safeguards

**Before granting any user access to `loeppkyc/Loeppky`, the `loeppky_trigger_bot` token must be rotated via BotFather to invalidate the token still present in commit `fd8860c`'s history.** (INC-001 — risk accepted 2026-04-17 while repo is private, no collaborators.)

---

## 6 — Kill Criterion (ARCHITECTURE.md §11)

2 weeks from Phase 3 start: if LepiOS is not measurably helping Colin make or save money (Amazon Telegram alerts firing on real deals, Expenses tile tracking real spend, Betting/Trading tiles logging real activity), stop and simplify. Elegance is not a substitute for utility.

@AGENTS.md
