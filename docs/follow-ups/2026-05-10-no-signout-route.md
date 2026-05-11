# Follow-up: No explicit sign-out route

**Logged:** 2026-05-10  
**Context:** Session timeout PR (feat/session-idle-timeout)

## Current state

There is no explicit sign-out button or route in the app. The only code path
that calls `supabase.auth.signOut()` is in `middleware.ts`, triggered when the
absolute session lifetime (8h) or idle timeout (1h) fires.

A user who wants to sign out manually has no mechanism to do so without waiting
for a timeout or clearing cookies in DevTools.

## Impact

- Multi-account switching is impossible without timeout expiry.
- Shared-computer risk: if someone else gains physical access to a logged-in
  session, they have up to 1h idle window before automatic sign-out.
- Supabase auth tokens remain valid on the server until Supabase's own expiry
  (1h JWT TTL, 1 week refresh token) even after the app's cookies are cleared.

## Recommended follow-up

Add a sign-out route and button:

1. `POST /api/auth/signout` — calls `supabase.auth.signOut()`, deletes
   `lepios_session_expires_at` and `lepios_last_active_at` cookies, redirects
   to `/login`.

2. A sign-out button in the cockpit sidebar/header (currently absent). Wire to
   the above route.

This is intentionally out of scope for the session-timeout PR to keep that
change focused and reviewable.
