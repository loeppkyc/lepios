# Acceptance Doc — Profile Page (MID batch 2)

**Streamlit source:** `pages/9_Profile.py` (114 lines)
**LepiOS route:** `/profile` → `app/(cockpit)/profile/`
**Branch:** `feat/mid-batch-profile`
**Migration:** 0183 — `ALTER TABLE user_profiles ADD display_name, module_prefs`

## Streamlit study

Three sections:

1. **Account Info** — display username, role, email, member-since from Google Sheets user record
2. **Change Display Name** — form → `update_display_name(username, new_name)` writes to Sheets
3. **Change Password** — form → `change_password(username, current, new)` validates via Sheets hash
4. **Module Preferences** — `st.multiselect` of `SECTION_NAMES`; saves via `update_selected_modules(username, modules)`

## LepiOS implementation

Auth is Supabase — no Sheets. All four sections map cleanly:

1. **Account Info** — `supabase.auth.getUser()` provides email + created_at. `user_profiles` provides role. Display `display_name` if set, else email prefix.
2. **Change Display Name** — PATCH `/api/profile` with `{ display_name }` → UPDATE `user_profiles.display_name`
3. **Change Password** — Supabase `supabase.auth.updateUser({ password: newPw })` — no current password re-verification possible client-side (Supabase limitation). Show a note: "You'll need to re-confirm via email if your session is old."
4. **Module Preferences** — PATCH `/api/profile` with `{ module_prefs: [...] }` → UPDATE `user_profiles.module_prefs` (jsonb). Sidebar reads this in a future sprint; for now it saves and confirms.

## 20% improvements

- **No Sheets round-trip** — all ops are native Supabase auth + DB (immediate, no latency cliff)
- **module_prefs persisted in DB** — survives browser clears, accessible from any device (Streamlit stored in Sheets per-username, same semantics but with lepiOS native RLS)

## Schema (migration 0183)

```sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS display_name  text,
  ADD COLUMN IF NOT EXISTS module_prefs  jsonb NOT NULL DEFAULT '[]'::jsonb;
```

## API route: `app/api/profile/route.ts`

- `GET` — returns `{ user, profile }` where user = Supabase auth user, profile = `user_profiles` row
- `PATCH` — body `{ display_name?: string, module_prefs?: string[] }` → UPDATE `user_profiles`

## Files

```
app/(cockpit)/profile/page.tsx
app/(cockpit)/profile/_components/ProfilePage.tsx
app/api/profile/route.ts
lib/profile/types.ts
supabase/migrations/0183_profile_columns.sql
```

## Acceptance criteria

- [ ] Account info section shows email, role (from `user_profiles`), display_name or email prefix, and created_at
- [ ] Display name form saves to `user_profiles.display_name` and refreshes on success
- [ ] Password change calls `supabase.auth.updateUser` and shows success/error
- [ ] Module preferences multiselect saves to `user_profiles.module_prefs` and confirms
- [ ] No `style={}` in TSX (F20), no `import type` from route files (F11)
- [ ] Migration 0183 applies cleanly to prod

## F17 signal

Profile page → module_prefs changes = explicit user intent signal. Future: "Colin added Amazon → probability of opening Amazon next session increases." Queued for behavioral ingestion Phase 2.

## F18 metric

`agent_events` row on each profile save: `{ event_type: 'profile_update', metadata: { field } }`. Benchmark: < 500ms round-trip for display_name save (target: < 200ms).
