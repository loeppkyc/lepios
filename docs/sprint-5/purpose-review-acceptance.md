# Acceptance Doc — Purpose Review Gate
**Feature:** `purpose_review` phase inserted before Phase 1a in all Streamlit port chunks
**Date:** 2026-04-25
**Status:** ready for builder
**task_queue id:** 9778dee9-275e-4b95-a556-7122c6db571a (priority 1 — blocks all downstream ports)

---

## 1. Overview

Every Streamlit port chunk gains a new Phase 0.5: **purpose_review**. Before the
coordinator reads the source file in depth, the harness generates a 5-bullet module
summary, sends it to Colin via Telegram inline keyboard, and waits for his decision:

- **👍 Port as-is** → proceed to Phase 1a study immediately
- **✏️ Port with changes** → await Colin's free-text reply → store in
  `task_queue.metadata.purpose_notes` → proceed to Phase 1a with notes
- **🗑️ Skip** → set task status to `cancelled`, log rationale, alert Colin

72-hour auto-timeout: if no reply, task advances to `review_timeout` and fires a
Telegram alert so Colin can unblock manually.

---

## 2. Updated Port Chunk Flow

```
[BEFORE]
Phase 1a → Phase 1b → Phase 1c → Phase 1d → Builder → Deploy gate

[AFTER]
Phase 0.5 (purpose_review) → [kill? → cancelled]
        ↓ approve / approve_with_notes
Phase 1a (study, with notes if present)
        ↓
Phase 1b → Phase 1c → Phase 1d → Builder → Deploy gate
```

Heartbeat required at: phase 0.5 start, after Telegram send, after reply received,
at every existing phase boundary.

---

## 3. Summary Generation

### Input
- `streamlit_modules` row for the module (path, classification, suggested_tier,
  f17_signal, f18_metric_candidate, lines, external_deps, notes)
- First 30 lines of the source file (imports, class/def names, top docstring)

### Process
1. Coordinator reads `streamlit_modules` row and source file header
2. Generates bullets (a)–(d) deterministically from field values + file read
3. Sends to Ollama ANALYSIS (qwen2.5:32b) to generate bullet (e) — 1–2 alternatives
4. If Ollama unreachable or circuit OPEN: Claude API fallback (claude-haiku-4-5)
5. Formats Telegram message

### Output Format
```
📋 Port Review — {module_path}
Tier {suggested_tier} · {lines} lines · {classification}

(a) Does: {what it does in plain English}
(b) Goal: {what it's trying to achieve}
(c) Issues: {broken / half-built / assumed}
(d) Baked in: {design decisions and external deps}
(e) Could instead: {1–2 alternatives}

[👍 Port as-is]  [✏️ Port with changes]  [🗑️ Skip]
```

Message fits in one Telegram message (<4096 chars). If module summary exceeds limit,
truncate (e) to one alternative.

### Routing Rule
- Summary generation: **Ollama ANALYSIS** (cheap, low-stakes text task)
- Revision interpretation (✏️ free-text reply): **Claude API** (high stakes —
  misreading Colin's intent corrupts Phase 1a study input)

---

## 4. Telegram Reply Handling

### Callback Query (button tap)

Handler: new `handlePurposeReview(callbackQuery)` in `app/api/telegram/webhook/route.ts`.

Callback data format: `purpose_review:<action>:<task_queue_id>`
where action ∈ {`approve`, `revise`, `skip`}.

| Action   | Bot response                                    | task_queue update                              |
|----------|-------------------------------------------------|------------------------------------------------|
| approve  | Edit message: append ✅ "Approved — starting study" | status stays `claimed`; metadata.purpose_review = 'approved' |
| revise   | Edit message: append ✏️ "Send your changes:"        | status = `awaiting_review`; await text reply   |
| skip     | Edit message: append 🗑️ "Skipped"                   | status = `cancelled`; metadata.purpose_review = 'skipped' |

### Text Reply (after ✏️)

Correlated via `reply_to_message.message_id` (tier 2 in findMatchingRow).
Bot edits original message to: ✏️ "Notes received — starting study with your input."
`task_queue.metadata.purpose_notes` = Colin's reply text (raw).
`task_queue.metadata.purpose_review` = `'approved_with_notes'`.
`task_queue.status` = `'claimed'` (resumes pipeline).

### Reply States

```
pending           — review message sent, no reply yet
approved          — 👍 tapped
approved_with_notes — ✏️ tapped + text received
skipped           — 🗑️ tapped
review_timeout    — 72h elapsed, no reply
```

Stored in `task_queue.metadata.purpose_review` (text).
Task status when blocked: `awaiting_review` (new valid status — requires migration).

---

## 5. Auto-Timeout (72h)

Mechanism: existing stale-detection logic in task-pickup harness checks
`last_heartbeat_at`. Purpose review sets heartbeat on send; coordinator polls
(or the pickup cron checks) whether 72h has elapsed.

On timeout:
1. Set `task_queue.status = 'review_timeout'` (new valid status — requires migration)
2. `task_queue.metadata.purpose_review = 'review_timeout'`
3. Fire Telegram alert to `loeppky_alerts_bot`:
   "⏰ Review timeout: {module_path} — no reply in 72h. Reply /review {task_id}
   approve|skip to unblock."

---

## 6. Required Migrations

### 6a — Extend task_queue status check constraint

```sql
-- Adds: awaiting_review, review_timeout
ALTER TABLE task_queue
  DROP CONSTRAINT task_queue_status_check,
  ADD CONSTRAINT task_queue_status_check
    CHECK (status = ANY (ARRAY[
      'queued','claimed','running','completed','failed','cancelled',
      'auto_proceeded','approved','dismissed',
      'awaiting_review','review_timeout'
    ]));
```

### 6b — No schema changes to task_queue columns required

`metadata` JSONB already exists. `purpose_review`, `purpose_notes` stored there.

---

## 7. F17 — Behavioral Ingestion Signal

Every purpose review event is a behavioral signal:

| Event                       | Signal type              | Path engine use                      |
|-----------------------------|--------------------------|--------------------------------------|
| 👍 approve                  | module preference (keep) | P(port) += weight for this class     |
| 🗑️ skip                     | module preference (kill) | P(port) -= weight for this class     |
| ✏️ approve_with_notes        | revision intent          | Strongest signal — raw Colin text    |
| review_timeout              | engagement gap           | Flag module for future re-evaluation |

Log every event to `agent_events`:
- domain: `'purpose_review'`
- action: `'purpose_review.{approved|approved_with_notes|skipped|timeout}'`
- actor: `'colin'` (from Telegram) or `'system'` (timeout)
- meta: `{ module_path, classification, suggested_tier, purpose_notes }`

Revision text (`purpose_notes`) is the highest-quality intent signal the harness
collects. Route to twin corpus ingestion pipeline (domain=`'personal'`) after review.

---

## 8. F18 — Metrics + Benchmarks

| Metric | How captured | Benchmark | Surface path |
|--------|-------------|-----------|--------------|
| Review latency p50/p95 | `outbound_notifications.sent_at` → `response_received_at` | p50 < 4h, p95 < 24h | `/api/harness/metrics` or morning_digest |
| Approve/revise/skip distribution | `agent_events` count by action | Baseline: first 20 modules | morning_digest weekly rollup |
| Revision iteration count | Count `approved_with_notes` events per task | Target: ≤ 1 revision avg | morning_digest |
| Design-system compliance rate | Acceptance test grep pass rate | 100% required | builder deploy gate |
| Review timeout rate | Count `review_timeout` / total sent | < 5% target | morning_digest |

---

## 9. F19 — Design System Enforcement

**Rule:** Every port chunk must use shadcn/ui components and Tailwind utility classes
only. No inline `style={}` in TSX files. No ad-hoc CSS files. All shared components
in `app/components/` or `components/ui/`.

**Acceptance test (mandatory in every port chunk acceptance doc):**

```bash
# Scoped to files changed in this chunk — fail if any match
git diff --name-only HEAD~1 | grep '\.tsx$' | xargs grep -l 'style=' && exit 1 || exit 0
```

**Also add to CLAUDE.md as F19** (Architecture Rules §3, after F18):
> F19 — Design system enforcement: all port chunk UI uses shadcn/ui + Tailwind utility
> classes only. No inline style attributes. No ad-hoc CSS files. Acceptance tests must
> verify compliance on every TSX file in the chunk's diff. See
> docs/sprint-5/purpose-review-acceptance.md §9.

---

## 10. Attribution

Record attribution for every purpose_review event:

```typescript
void recordAttribution(
  { actor_type: 'colin', actor_id: 'telegram' },
  { type: 'task_queue', id: task_queue_id },
  'purpose_reviewed',
  { action, module_path, purpose_notes }
)
```

---

## 11. Tests

| Test | What it verifies |
|------|-----------------|
| `purpose-review.test.ts` — summary generation | 5 bullets present, fits in 4096 chars |
| `purpose-review.test.ts` — Ollama fallback | If Ollama unreachable, Claude haiku used |
| `purpose-review.test.ts` — callback parse | approve/revise/skip extracted from callback_data |
| `purpose-review.test.ts` — revise flow | Free-text reply stored in metadata.purpose_notes |
| `purpose-review.test.ts` — skip flow | task status = cancelled, agent_event logged |
| `purpose-review.test.ts` — timeout | 72h elapsed → status = review_timeout, alert fired |
| `design-system.test.ts` | Grep finds `style=` in test fixture → test fails |

All tests use mocks. No real Telegram API or Ollama calls.

---

## 12. Acceptance Criteria

- [ ] New `purpose_review` handler in `app/api/telegram/webhook/route.ts`
- [ ] Summary generator: 5 bullets from streamlit_modules + file read + Ollama
- [ ] Inline keyboard: 👍/✏️/🗑️ with `purpose_review:<action>:<id>` callback data
- [ ] ✏️ flow: follow-up prompt → text reply → notes stored → pipeline resumes
- [ ] 🗑️ flow: task cancelled, agent_event logged
- [ ] 72h timeout: status=review_timeout, Telegram alert fires
- [ ] Migration 0026: task_queue status constraint extended (awaiting_review, review_timeout)
- [ ] F17: every review event logged to agent_events + routed to twin corpus
- [ ] F18: review latency, distribution, iteration count, timeout rate queryable
- [ ] F19: design-system acceptance test in every future port chunk acceptance doc
- [ ] F19: rule added to CLAUDE.md as Architecture Rule §3 F19
- [ ] All 7 test cases pass
- [ ] Attribution recorded per review event
- [ ] Existing port chunks (sprint-5 attribution, gmail, etc.) are grandfathered —
      purpose_review only required for chunks not yet in Phase 1a

---

## 13. Downstream Impact

All Streamlit port chunks not yet past Phase 1a are now gated by purpose_review.
Currently queued:
- Any sprint-5 chunks not yet started
- All sprint-6+ chunks

Already-started chunks (past Phase 1a) are grandfathered — no retroactive review.
