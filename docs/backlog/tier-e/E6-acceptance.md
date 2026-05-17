# E6 — Megan Reminder Inbox
**task_id:** 30eb6c0e-a5c9-4ffd-a8fb-bcfad1630a4b
**Status:** awaiting-colin-approval (bot decision required before build)
**Tier:** E | **Priority:** 3
**Written by coordinator:** 2026-05-17

---

## Scope

Megan texts a freeform reminder or task to a Telegram bot → LepiOS ingests it into a `megan_reminders` table → Colin sees a "From Megan" inbox card in his cockpit (initially on the `/family` page), with the ability to acknowledge each item.

**One acceptance criterion:** After Megan sends a Telegram message containing a reminder text, within 60 seconds that message appears in the LepiOS `/family` page under a "From Megan" section, and Colin can mark it acknowledged (removing it from the active list). Acknowledged items are soft-deleted (status='done'), not hard-deleted.

---

## Out of Scope (v1)

- Megan having a LepiOS account or login
- Two-way Telegram messaging (Colin replying to Megan via the bot)
- Reminder scheduling / snooze
- SMS fallback for Megan
- Categorisation or tagging of reminders
- Push to Colin's phone other than the Telegram receipt confirmation

---

## Files Expected to Change

**Schema (migration required):**
- New migration: `supabase/migrations/XXXX_megan_reminders.sql` — creates `megan_reminders` table

**Webhook routing (depends on bot decision — see Open Questions):**
- Option A (same bot): `app/api/telegram/webhook/route.ts` — detect Megan's Telegram user ID, route to new handler
- Option B (new bot): `app/api/telegram/megan-webhook/route.ts` — new route registered with BotFather webhook; `app/api/telegram/megan-webhook/route.ts`; `.env.example` addition for `MEGAN_TELEGRAM_BOT_TOKEN` and `MEGAN_TELEGRAM_WEBHOOK_SECRET`

**API:**
- `app/api/family/megan-reminders/route.ts` — GET (list active) + POST /ack (mark done)

**UI:**
- `app/(cockpit)/family/_components/MeganReminderInbox.tsx` — new component
- `app/(cockpit)/family/_components/FamilyPage.tsx` — add MeganReminderInbox section

**Env:**
- Option A: `MEGAN_TELEGRAM_USER_ID` (her numeric Telegram ID)
- Option B: `MEGAN_TELEGRAM_BOT_TOKEN` + `MEGAN_TELEGRAM_WEBHOOK_SECRET` + `MEGAN_TELEGRAM_CHAT_ID` (her chat with the new bot)

---

## Check-Before-Build Findings

- `idea_inbox` table exists but is designed for Colin's ideas (has score/promote/ship workflow). Not appropriate to repurpose for Megan's reminders — separate table is correct.
- `/family` page exists (`app/(cockpit)/family/`) with a FamilyPage component. Adding a new section there is the lowest-friction display location.
- `isAllowedUser()` in `lib/harness/telegram-buttons.ts` checks against `TELEGRAM_ALLOWED_USER_ID` (Colin only). Option A requires a parallel `isMeganUser()` check with separate routing — not mixed with the CRON_SECRET flow.
- Existing webhook at `/api/telegram/webhook` handles deploy gate, purpose review, budget commands — adding Megan routing here is feasible but increases coupling. Option B isolates it entirely.
- No GitHub prior art search needed — this is a simple ingest+display pattern. The webhook receive → Supabase insert → API read pattern already exists in `idea_inbox`.

---

## Schema — `megan_reminders`

```sql
CREATE TABLE megan_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  text        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  ack_at      timestamptz,
  telegram_message_id bigint,
  telegram_from_user  bigint
);

GRANT INSERT, UPDATE, DELETE ON megan_reminders TO service_role;
```

RLS: service_role only (no user-facing RLS needed; UI reads via service client).

---

## Bot Options (BLOCKING — Colin decides)

### Option A — Use the existing bot (`loeppky_daily_bot` or whichever bot handles Colin's current `TELEGRAM_BOT_TOKEN`)

- Megan opens a chat with that bot and starts sending messages
- Webhook detects `from.id == MEGAN_TELEGRAM_USER_ID` → routes to `megan_reminders` insert
- Requires: `MEGAN_TELEGRAM_USER_ID` env var (Megan's Telegram user ID, obtainable by her forwarding a message to @userinfobot)
- **Pro:** No new bot registration. One webhook URL.
- **Con:** Megan and Colin share the same bot. If Colin's bot ever changes or is rotated, Megan's ingest breaks too. Less clean separation.

### Option B — New Megan-specific bot

- Register new bot via BotFather → new `MEGAN_TELEGRAM_BOT_TOKEN`
- Register a new webhook at `/api/telegram/megan-webhook`
- Megan texts the new bot; webhook is unambiguous — all messages are from Megan
- Requires: new BotFather registration, `MEGAN_TELEGRAM_BOT_TOKEN`, `MEGAN_TELEGRAM_WEBHOOK_SECRET`, `MEGAN_TELEGRAM_CHAT_ID` (Megan's chat ID with the new bot)
- **Pro:** Full isolation. Colin's bot can rotate without affecting Megan's ingest. Clean audit trail.
- **Con:** Two bots to maintain. Megan needs to onboard to a second bot.

**Coordinator recommendation:** Option B if Megan is comfortable with a second bot. The isolation benefit is significant and the setup cost is a one-time 5-minute BotFather + webhook registration step. If Megan prefers simplicity and will only ever use one bot, Option A is acceptable.

---

## External Deps

- Telegram Bot API — verified accessible (200) in prior coordinator sessions. Webhook registration requires BotFather for Option B.
- No new third-party services required.

---

## Grounding Checkpoint

Colin (or Megan) sends a test message to the configured bot → confirm:
1. `SELECT * FROM megan_reminders ORDER BY created_at DESC LIMIT 3` shows the message within 60s
2. `/family` page displays the item under "From Megan" without page reload (or after refresh)
3. Clicking acknowledge updates `status='done'` and item disappears from active list

---

## Kill Signals

- Colin decides the reminder flow should be SMS, not Telegram → scope changes fundamentally (rescope, not kill)
- Megan doesn't want to use Telegram at all → defer E6 to future (Megan-native UX unknown)

---

## F17 — Behavioral Ingestion Justification

Megan's reminders represent family-pillar signals: things Megan needs Colin to act on. These are direct "happy" and "family" pillar inputs. Behavioral value: frequency and content of reminders signals load distribution and coordination overhead. Future: if reminder frequency spikes → stress signal for the Doctor Agent. Qualifies under F17 as a Happy/Family pillar data feed.

## F18 — Measurement

- Table: `megan_reminders` row counts, ack latency (created_at → ack_at), unacked count in morning digest
- Benchmark: target < 5 unacked reminders at any time (from Colin's stated preference for low inbox overhead)
- Surface: morning digest line "Megan inbox: N active" when N > 0

---

## Cached-Principle Decisions

None applicable — this is a fresh greenfield task with no principle cache-match possible without Colin's bot decision. Escalating to Colin per Phase 2 non-negotiable.

---

## Open Questions

1. **[BLOCKING] Bot decision:** Option A (existing bot + `MEGAN_TELEGRAM_USER_ID`) or Option B (new Megan-specific bot)?
   - If Option B: has Colin registered the new bot with BotFather, and is the token ready?
2. **Display location:** `/family` page (coordinator default) or a separate `/megan-inbox` page?
3. **Acknowledgement UX:** Inline button in the cockpit card (✓ Done) — or does Colin want to be able to reply via Telegram to ack? (v1 scope: cockpit-only ack; Telegram ack is v2)
