# Acceptance Doc — Scanner Phone (MID batch 2)

**Streamlit source:** `pages/99_Scanner_Phone.py` (168 lines)
**LepiOS route:** `/scan/phone` → `app/scan/phone/`  
**Layout:** NO cockpit layout — bare page, sidebar hidden, optimized for one-handed mobile use
**Branch:** `feat/mid-batch-profile`
**Migration:** 0185 — `phone_relay_scans` table

## Streamlit study

Mobile barcode relay page (no sidebar):

1. Reads `?session=CODE` from query params
2. If no session → show help message
3. If `?isbn=ISBN` present → calls `relay_write_isbn(session_code, isbn)` → writes to Google Sheets → shows green success card → clears isbn param → auto-reloads after 1.5s
4. Main view: embeds html5-qrcode.js scanner iframe, on scan navigates to `?session=CODE&isbn=SCANNED`

Desktop side: PageProfit Phone Relay tab polls Google Sheets for new ISBNs.

## LepiOS implementation

Replace Google Sheets relay with Supabase `phone_relay_scans` table.

- Page lives at `app/scan/phone/page.tsx` with a minimal layout (`app/scan/layout.tsx` — no cockpit shell, just `<html><body>{children}</body></html>`)
- `?session=CODE` read via `useSearchParams()`
- `?isbn=ISBN` triggers POST to `/api/phone-relay` → INSERT into `phone_relay_scans(session_code, isbn)` → redirects to `?session=CODE` (clears isbn)
- Scanner HTML unchanged from Streamlit (html5-qrcode CDN, same JS logic)
- Auto-reload after 1.5s on success (same as Streamlit)

Desktop polling: PageProfit Phone Relay tab should poll `GET /api/phone-relay?session=CODE&since=ISO` for new scans. This wiring is OUT OF SCOPE for this chunk — the table exists so PageProfit can be updated separately.

## 20% improvements

- **Supabase relay instead of Sheets** — inserts are immediate (no Sheets write latency ~1-2s)
- **Session auto-expiry** — `phone_relay_scans` rows older than 2h are ignored by queries (no explicit DELETE needed; a future cron can prune)
- **RLS allows anon inserts** — phone doesn't need auth cookie; session_code is the shared secret

## Layout (app/scan/layout.tsx)

```tsx
export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

Separate from `app/(cockpit)/layout.tsx` so the cockpit shell (sidebar, nav) never loads on the phone page.

## API: app/api/phone-relay/route.ts

- `POST { session_code, isbn }` → INSERT `phone_relay_scans` → return `{ ok: true }`
- `GET ?session=CODE&since=ISO` → SELECT scans for session newer than `since` → return `{ scans: [] }`

## Files

```
app/scan/layout.tsx
app/scan/phone/page.tsx
app/api/phone-relay/route.ts
supabase/migrations/0185_phone_relay_scans.sql
```

## Acceptance criteria

- [ ] `/scan/phone` with no `?session=` shows help message, no sidebar
- [ ] `/scan/phone?session=ABC` shows the barcode scanner UI
- [ ] On scan (simulated by navigating to `?session=ABC&isbn=9780385737951`): success card renders, `phone_relay_scans` row inserted, page auto-reloads after 1.5s
- [ ] `GET /api/phone-relay?session=ABC&since=<now-5min>` returns the inserted row
- [ ] No cockpit sidebar or nav on any `/scan/*` route
- [ ] No `style={}` (F20), migration 0185 applies cleanly

## F17 signal

Strong — ISBN scanned on phone feeds directly into PageProfit scan flow. Each scan = potential purchase decision signal.

## F18 metric

Count rows in `phone_relay_scans` per day = scan volume metric. Benchmark: < 500ms from scan-complete to success-card (Sheets was ~1-2s; Supabase target ~200ms).
