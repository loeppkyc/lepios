# Purpose Review Gate — Phase 1 Study
**Date:** 2026-04-25
**Status:** complete — feeds purpose-review-acceptance.md

---

## Phase 1a — Streamlit Study

### Current Port Chunk Flow

Coordinator runs four sub-phases before writing any acceptance doc:

```
Phase 0   — Cache-match eligibility gate (does chunk already exist?)
Phase 1a  — Streamlit source study (read .py end-to-end, write study doc)
Phase 1b  — Twin Q&A (batch ambiguities → twin first, Colin only if twin can't answer)
Phase 1c  — 20% Better loop (explicit "how do we improve this vs Streamlit?")
Phase 1d  — Write acceptance doc (from study + twin + improvements)
  ↓
Builder   — Reads acceptance doc, writes code, runs tests, commits, pushes, deploys
  ↓
Deploy gate — Telegram inline keyboard (promote/abort/rollback) → await Colin reply
  ↓
task_queue  — status: queued → claimed → completed | failed | cancelled
```

Sources: `ARCHITECTURE.md` §7, `.claude/agents/coordinator.md` lines 22–205,
`docs/sprint-5/task-pickup-100-study.md` lines 62–156.

### Heartbeat Rule

Coordinator must POST heartbeat to `/api/harness/task-heartbeat` at each phase
boundary. Stale window: 15 minutes. Missing heartbeat → task auto-cancelled,
Telegram alert fires.

### Telegram Infrastructure

Webhook at `/api/telegram/webhook` — handles `message` and `callback_query` update
types. Source: `app/api/telegram/webhook/route.ts`.

**Inline keyboards:** already implemented for improvement engine (👍/👎 approve/dismiss)
and deploy gate (promote/abort/rollback). Callback data is JSON-encoded, correlated
via `outbound_notifications` table. `findMatchingRow()` (lines 246–302) supports
three correlation tiers: (1) callback `correlation_id`, (2) `reply_to_message` message_id,
(3) most recent `requires_response=true` in last 24h.

**Fire-and-forget send:** `void handleXxx(...).catch(err => void logEvent(...))` —
returns 200 immediately, processes in background. Same pattern should apply to
purpose review dispatch.

**Message edit:** After callback received, bot edits original message to append
result emoji (✅/🗑️/✏️) so Colin's chat shows final state without a second message.

### Ollama vs Claude Routing

`lib/ollama/client.ts` + `lib/ollama/models.ts` + circuit breaker in `lib/ollama/circuit.ts`.

| Task type       | Model              | Env override              |
|-----------------|--------------------|---------------------------|
| GENERAL         | qwen2.5:7b         | OLLAMA_GENERAL_MODEL      |
| ANALYSIS        | qwen2.5:32b        | OLLAMA_ANALYSIS_MODEL     |
| CODE            | qwen2.5-coder:7b   | OLLAMA_CODE_MODEL         |
| EMBED           | nomic-embed-text   | —                         |
| TWIN            | qwen2.5:32b        | OLLAMA_TWIN_MODEL         |

Circuit breaker: OPEN after 3 failures in 5 min → callers skip Ollama, log
`circuit_skip`. HALF_OPEN after 5 min silence → probe with healthCheck.

Routing rule for purpose review:
- **Summary generation** = ANALYSIS task → qwen2.5:32b (or 7b if 32b down). Cheap,
  low-stakes. Ollama-first, Claude fallback acceptable.
- **Revision interpretation** (when Colin replies ✏️ + free text) = Claude API.
  High stakes: misreading Colin's intent poisons the Phase 1a study input.

### shadcn/ui + Tailwind v4

- `package.json`: `shadcn ^4.3.0`, `tailwindcss ^4`, `@tailwindcss/postcss ^4`
- `components.json`: style=`base-nova`, base-color=`neutral`, CSS vars enabled,
  components alias=`@/components`
- `app/globals.css`: `@import "tailwindcss"` (v4 syntax), `@theme inline { ... }` with
  full design token set (backgrounds, accents, pillar colors, radius scale, fonts)
- Custom cockpit utilities: `.pillar-rail-*`, `.label-caps`, etc. in globals.css

No inline `style=` attributes detected in globals.css. Components directory at
`app/components/` (shadcn convention, not globally inventoried but config confirms it).

Tailwind v4 uses CSS-first configuration — no `tailwind.config.ts` object. All tokens
live in `app/globals.css` `@theme` block. Builder must use utility classes; `style={}`
in TSX is a violation of the design system.

---

## Phase 1b — Twin Q&A

All five questions answered from corpus + infrastructure evidence. No escalation to
Colin required.

### Q1: Review gate placement — BEFORE or AFTER Phase 1a study?

**Answer: BEFORE Phase 1a study.**

Rationale: The purpose review's primary value is preventing wasted work on modules
Colin will kill. A 5-bullet summary can be generated from data already available in
`streamlit_modules` (path, classification, suggested_tier, f17_signal, lines) plus a
20-line file read (imports, class names, top-level docstring). Cost: ~1 Ollama ANALYSIS
call + file read. If Colin marks 🗑️, zero study tokens are spent. If Colin marks 👍 or
✏️, Phase 1a runs with the revision notes as additional input, making the study more
focused, not less.

Counter-argument: summary is less rich without a full study. Rejected — the 5 bullets
are about module identity and purpose, not deep logic analysis. That's Phase 1a's job.

### Q2: Review content scope — 5 bullets confirmed?

**Answer: Yes, confirmed as specified.**

The 5 bullets map directly to fields already in `streamlit_modules` + a file read:

| Bullet | Source |
|--------|--------|
| (a) What it does | classification tag + module path + top docstring |
| (b) What it's trying to achieve | f17_signal field + module name context |
| (c) Broken / half-built / assumed | file read: TODO comments, `pass` stubs, bare `except` |
| (d) Design decisions baked in | external_deps array + import analysis |
| (e) What it might do instead | Ollama ANALYSIS generation from (a)–(d) |

Bullets (a)–(d) are mostly deterministic extraction. Bullet (e) is Ollama-generated.
The whole summary fits in one Telegram message (~300 chars + module name header).

### Q3: Telegram reply UX — emoji buttons or text-only?

**Answer: Emoji inline keyboard (👍/✏️/🗑️) for the initial reply. Free-text for revision.**

Rationale: Inline keyboards are already implemented and working (improvement engine,
deploy gate). Colin can review a module in one tap. The ✏️ path triggers a follow-up
bot message: "Describe changes for [module]:" — awaits next text reply, correlated via
`reply_to_message`. This is consistent with existing patterns and requires no new
infrastructure.

Text-only alternative rejected: requires Colin to type "approve" / "skip" for every
module — high friction at volume (200+ modules).

Button layout:
```
[👍 Port as-is]  [✏️ Port with changes]  [🗑️ Skip]
```

Callback data format: `purpose_review:<action>:<task_queue_id>` where action ∈
{approve, revise, skip}.

### Q4: Revision loop — re-summarize or write to notes?

**Answer: Write to notes field; proceed to Phase 1a study with notes as input.**

Rationale: Immediate re-summarize (option a) creates a chat loop. At 200+ modules,
this becomes a synchronous back-and-forth that blocks the pipeline and creates
Telegram message clutter. Option (b) is async: Colin taps ✏️, types his changes,
bot confirms receipt (edits original message to ✏️ "received, proceeding with notes"),
coordinator runs Phase 1a study with notes injected as "Colin's intent" context.

Notes storage: `task_queue.metadata.purpose_notes` (text). Phase 1a study prompt
template includes a `{{purpose_notes}}` slot.

One revision round per module. If Colin needs more back-and-forth, that happens during
Phase 1b twin Q&A escalation (which already has Colin as the escalation path).

### Q5: Design system enforcement — F19?

**Answer: Yes, add as F19. Lives in both CLAUDE.md and builder acceptance template.**

Rule text:
> F19 — Design system enforcement: every port chunk must use shadcn/ui components and
> Tailwind utility classes only. No inline `style={}` attributes in TSX. No ad-hoc CSS
> files. All shared components in `app/components/` or `components/ui/`. Builder
> acceptance tests must grep new TSX files for `style=` and fail if found.

CLAUDE.md placement: §3 Architecture Rules, after F18. Builder acceptance template:
new mandatory section "Design System Compliance" with test: `grep -r 'style=' app/`
against the new chunk's files (scoped to changed files only).

Why both places: CLAUDE.md ensures future coordinators writing acceptance docs include
the rule; the acceptance template ensures builders can't miss it even if they don't
re-read CLAUDE.md.

---

## Phase 1c — Pending Colin Qs Consolidated

Three pending question sets found across sprint-5 study docs. None block the
purpose-review acceptance doc; all noted for routing.

**From task-pickup-100-study.md:180–193:**
- Q1 (BLOCKING for hourly pickup): Is Vercel plan Pro or Hobby?
  If Hobby, hourly cron isn't available → needs Telegram /pickup trigger instead.
- Q2 (non-blocking): Is notifications-drain triggered by something beyond Vercel cron?

**From ollama-100-study.md:231–246:**
- Q1: qwen2.5:32b failure mode — tunnel up but model not running, or tunnel down?
- Q2: Is Step 6.5 (daytime Ollama tick) in scope for ollama-100?

**From 20-percent-better-engine-study.md:211–250:**
- 5 Qs marked `escalate: true` (corpus gap) — all require Colin input before the
  improvement engine acceptance doc can be written. These are a separate escalation
  batch, not consolidated here.

Action: these are pre-existing backlogs in their respective streams. The purpose-review
acceptance doc does not depend on any of them.

---

## Phase 1c — 20% Better Improvements

Compared to a hypothetical "just port the coordinator instructions as a text file":

1. **Pre-study kill gate** — eliminates wasted study work on dead modules. 200 modules
   × 0.3 kill rate × 15 min/study = ~15 hours of harness time saved. No Streamlit
   equivalent.

2. **Structured 5-bullet summary** — formalises knowledge extraction that coordinator
   was doing informally. Becomes a queryable signal in `task_queue.metadata`.

3. **Behavioral signal capture** (F17) — approve/revise/skip distribution + revision
   text = a direct preference signal for the path probability engine. Colin's edit
   instructions are the clearest ground-truth of his intent available to the harness.

4. **Async pipeline** — review runs before study; study runs with notes. No blocking
   back-and-forth. Pipeline stays sequential without idle wait.

5. **Design system gate** (F19) — catches inline styles at acceptance-test time, not
   at design review time. Prevents style debt accumulation across 200+ port chunks.

6. **72h timeout with alert** — prevents a module from silently blocking the queue
   if Colin doesn't respond. Auto-advances to `review_timeout` so pipeline can be
   unblocked manually.

---

## Grounding Manifest

| Claim | Evidence | File:line |
|-------|----------|-----------|
| Phase 1a–1d sequence | coordinator.md | .claude/agents/coordinator.md:73–205 |
| Heartbeat + stale window | task-pickup-100-study.md | docs/sprint-5/:135, :180 |
| Telegram inline keyboards live | webhook/route.ts | app/api/telegram/webhook/route.ts:750–786 |
| findMatchingRow correlation tiers | webhook/route.ts | :246–302 |
| Ollama model routing | models.ts | lib/ollama/models.ts:13–29 |
| Circuit breaker spec | ollama-100-acceptance.md | docs/sprint-5/:72–150 |
| shadcn v4.3.0 installed | package.json | package.json:30 |
| Tailwind v4 + @theme | globals.css | app/globals.css:10–82 |
| streamlit_modules table + fields | 0023_add_streamlit_modules.sql | supabase/migrations/0023 |
