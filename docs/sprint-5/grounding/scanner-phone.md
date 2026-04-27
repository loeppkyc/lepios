# Grounding Doc — Scanner Phone (99_Scanner_Phone.py)

**Prepared:** 2026-04-27  
**Status:** Pre-staged. Do NOT fire until ec1d00c7 confirmed and ranks 1–4 queued or in-flight.  
**Overlap category:** GREENFIELD — coordinator loop stress test  
**Migration slots:** 0046 (scan_relay)  
_(Assumes keepa 0041–0042, goals 0043–0044, oura 0045. Recount from actual last migration before firing.)_

---

## 1. What Already Exists in LepiOS

### Scan infrastructure (relevant existing code)

`app/(cockpit)/scan/_components/ScannerClient.tsx` — the desktop scan UI. This is where scanned ISBNs arrive and are processed. The phone relay must deliver ISBNs to this component in real-time.

`app/api/scan/route.ts` — POST endpoint that takes an ISBN, calls SP-API + Keepa + eBay, returns profit data. This is the analysis pipeline — the phone relay does NOT call this directly.

**No relay infrastructure exists:** Grep for "relay", "phone", "qr", "QR", "session code", "isbn_param" in `app/` returned zero matches. This is a clean build.

**No Google Sheets client in LepiOS lib:** `lib/google*` glob returned zero matches. The Streamlit `relay_write_isbn()` function writes to Sheets — that mechanism does not exist in LepiOS and will not be ported.

---

## 2. Streamlit Source Analysis

Source: `pages/99_Scanner_Phone.py` (168 lines)

### Architecture in Streamlit

```
[Desktop: PageProfit scan tab]
    → generates session code (random 6-char string)
    → renders QR code pointing to ?session=ABC123

[Phone: opens 99_Scanner_Phone.py?session=ABC123]
    → html5-qrcode library via st.components.v1.html
    → on scan: window.parent.location.assign(base + "?session=ABC123&isbn=XXXXXXXX")
    → Streamlit picks up ?isbn= query param
    → relay_write_isbn(session_code, isbn_param) → Google Sheets

[Desktop: polls Sheets for new ISBNs in session]
```

### Input mechanism (grounded from source lines 98–156)

```javascript
// html5-qrcode v2.3.8 via CDN
var html5QrCode = new Html5Qrcode('reader')
var cfg = { fps: 10, qrbox: { width: 260, height: 110 } }

function onScan(t) {
  if (t === lastScan) return // deduplicate rapid rescans
  lastScan = t
  // Navigate to same page with isbn param — Streamlit picks up new query params
  var base = window.parent.location.pathname
  window.parent.location.assign(base + '?session=' + SESSION + '&isbn=' + encodeURIComponent(t))
}

// Camera selection: back/rear/environment preferred; falls back to user-facing; falls back to null
Html5Qrcode.getCameras().then(function (d) {
  cameras = d || []
  if (cameras.length > 1) {
    /* show dropdown, prefer back camera */
  } else if (cameras.length === 1) startCam(cameras[0].id)
  else startCam(null) // no enumeration, try environment facingMode
})
```

**Camera preference:** environment (rear) first, user (front) as fallback. Multi-camera devices show a dropdown. This logic is browser-native and should be ported as-is.

### ISBN relay in Streamlit (source lines 53–83)

```python
# When ?isbn= param is present:
if isbn_param:
    relay_write_isbn(session_code, isbn_param)   # writes to Sheets
    # Show success confirmation card
    st.query_params["session"] = session_code    # keep session
    del st.query_params["isbn"]                  # clear isbn
    # Auto-reload after 1.5s so scanner restarts (new query params = fresh page render)
    components.html('<script>setTimeout(function(){window.location.reload();},1500);</script>')
    st.stop()
```

### Phone page appearance (grounded from source lines 26–38)

```python
# Full-bleed, no sidebar, no nav — intentionally minimal for one-handed use
st.markdown("""
<style>
[data-testid="collapsedControl"] {display:none}
section[data-testid="stSidebar"] {display:none}
#MainMenu {visibility:hidden}
footer {visibility:hidden}
header {visibility:hidden}
.main .block-container {padding-top: 1rem; padding-bottom: 1rem}
</style>
""", unsafe_allow_html=True)
```

**This is the key UX constraint:** the phone page must have ZERO chrome. No cockpit shell, no nav, no sidebar. It must look like a standalone mobile app.

### No-session fallback (source lines 45–51)

```python
if not session_code:
    st.title("📱 Book Scanner")
    st.info("Open this page from your Phone Relay QR code on the Page Profit desktop tab.")
    st.stop()
```

---

## 3. Decisions (Resolved Pre-fire)

| Decision                    | Resolution                                                                      | Rationale                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheets relay → LepiOS relay | **Supabase Realtime via `scan_relay` table**                                    | No Sheets client in LepiOS. Supabase Realtime is instant (< 100ms) vs. Sheets polling. Desktop ScannerClient subscribes to Realtime channel; phone calls POST /api/scan/relay.    |
| Phone page location         | **`/scanner` (outside cockpit shell)**                                          | Must have zero chrome. A route outside `app/(cockpit)/` gets no cockpit layout. Same reason as Utility Tracker's standalone route pattern.                                        |
| Relay mechanism details     | **POST /api/scan/relay → upsert `scan_relay` row → Realtime pushes to desktop** | Desktop ScannerClient subscribes to Supabase Realtime on channel `scan:SESSION_CODE`. Phone fires POST after each scan. Desktop receives event, auto-submits ISBN to `/api/scan`. |
| Session code generation     | **6-char uppercase alphanum (same as Streamlit)**                               | Desktop generates on "Start Phone Relay" click, creates Supabase Realtime channel, renders QR.                                                                                    |
| QR code generation          | **`qrcode.react` or inline canvas**                                             | Check if `qrcode.react` is in package.json. If not, use qrcode.js via CDN in the QR modal on the desktop. Coordinator should grep `package.json` before speccing.                 |
| html5-qrcode on phone       | **PORT via `<script>` tag CDN**                                                 | html5-qrcode works in Next.js as a client component with a `<script>` tag or dynamic import. CDN approach from Streamlit is acceptable.                                           |
| Session_relay auto-cleanup  | **TTL: rows older than 2 hours deleted by nightly cron**                        | Relay rows are ephemeral — no permanent value. Add `created_at` + cleanup in `night_tick`.                                                                                        |
| Auth on `/scanner`          | **No auth required**                                                            | Phone opens via QR — could be anyone's phone. Session code is the access token. Relay only accepts ISBNs (low-risk data).                                                         |
| Grounding checkpoint        | **None needed**                                                                 | No financial data. Harness validation stress test only.                                                                                                                           |

---

## 4. What to Port / Skip / Rebuild

| Item                       | Action                      | Reason                                                                               |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| html5-qrcode scanner UI    | **PORT** (client component) | html5-qrcode works in browser; wrap in Next.js client component                      |
| Camera preference logic    | **PORT exactly**            | environment → user → null fallback; multi-camera dropdown                            |
| No-session fallback screen | **PORT**                    | Direct translation                                                                   |
| Scan → ISBN relay          | **REBUILD**                 | Streamlit used Sheets; LepiOS uses Supabase Realtime                                 |
| Auto-reload after scan     | **PORT**                    | 1.5s reload so scanner re-initializes — same in Next.js (`window.location.reload()`) |
| Zero-chrome phone page     | **PORT** (CSS)              | Next.js: no cockpit layout wrapper; Tailwind: suppress any global nav                |
| QR generation on desktop   | **REBUILD**                 | Streamlit generated QR inline; LepiOS needs a QR lib on desktop scan page            |
| relay_write_isbn (Sheets)  | **SKIP / REPLACE**          | Supabase Realtime replaces this entirely                                             |
| Desktop scan polling       | **REBUILD**                 | Streamlit polled Sheets; LepiOS uses Realtime subscription in ScannerClient          |

---

## 5. New Schema (Coordinator Must Spec)

### `scan_relay` (migration 0046)

```sql
id uuid primary key default gen_random_uuid(),
session_code text not null,     -- 6-char uppercase alphanum generated by desktop
isbn text not null,             -- scanned barcode (may be ISBN-10, ISBN-13, or ASIN)
consumed boolean default false, -- true once desktop ScannerClient picks it up
created_at timestamptz default now()
```

**Index:** `(session_code, consumed, created_at)` for desktop subscription query.  
**RLS:** no auth required on INSERT (phone side); SELECT restricted to matching session_code pattern.  
**Cleanup:** `DELETE FROM scan_relay WHERE created_at < now() - interval '2 hours'` — add to night_tick cron.

---

## 6. New Route / Page Structure

```
app/scanner/page.tsx                         — phone-facing, NO cockpit layout wrapper
  — Must NOT import from app/(cockpit) layout
  — No nav, no sidebar, minimal CSS
  — Renders html5-qrcode scanner component
  — On scan: POST /api/scan/relay

app/api/scan/relay/route.ts                  — POST { session_code, isbn } → upsert scan_relay row
                                               — no auth required (session_code is the token)

app/(cockpit)/scan/_components/ScannerClient.tsx  — EXTEND ONLY (not a new file)
  — Add "Phone Relay" tab or mode
  — When activated: generate session_code, create QR code, subscribe to Supabase Realtime
  — On Realtime event: auto-submit ISBN to /api/scan, mark scan_relay row consumed
```

---

## 7. Supabase Realtime Subscription Pattern

```typescript
// ScannerClient.tsx (desktop) — on "Start Phone Relay":
const channel = supabase
  .channel(`scan:${sessionCode}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'scan_relay',
      filter: `session_code=eq.${sessionCode}`,
    },
    (payload) => {
      const isbn = payload.new.isbn
      // auto-submit to /api/scan
      submitScan(isbn)
      // mark consumed
      supabase.from('scan_relay').update({ consumed: true }).eq('id', payload.new.id)
    }
  )
  .subscribe()
```

This is the 20% Better upgrade: Streamlit polled Sheets every render (several seconds). Supabase Realtime pushes the ISBN to the desktop in < 100ms.

---

## 8. 20% Better Opportunities

1. **Realtime relay** (spec above): < 100ms vs. multi-second Sheets polling. No token cost.
2. **Session code as Supabase Realtime channel**: Clean architecture — session code is both the QR payload and the Realtime filter. No coordination overhead.
3. **Zero-install phone experience**: Same as Streamlit — pure browser, no app required. html5-qrcode works on iOS Safari and Android Chrome without any install.
4. **Auto-submit on desktop**: When Realtime delivers the ISBN, desktop auto-submits to `/api/scan` without any click. Streamlit required the user to manually submit after seeing the ISBN appear. LepiOS can make this fully hands-free.

---

## 9. Blockers / Open Questions

| Item                                               | Status                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR code library in package.json?                   | Unknown — coordinator must `grep "qrcode" package.json` before speccing desktop QR modal. If absent, use `qrcode.js` CDN in a `<Script>` tag.              |
| Supabase Realtime enabled on this project?         | Likely yes (used in other features) — coordinator should verify `supabase.channel()` is available in `lib/supabase/client.ts`                              |
| RLS on `scan_relay` INSERT (unauthenticated phone) | Table must allow anon INSERT. Policy: `FOR INSERT TO anon WITH CHECK (true)`. Low risk — ISBNs are not sensitive.                                          |
| ScannerClient.tsx scope                            | This doc says EXTEND ONLY — coordinator must read ScannerClient.tsx fully before speccing the "Phone Relay" tab addition. Do not break existing scan flow. |

---

## 10. Grounding Manifest

| Claim                                                     | Evidence                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| No relay infrastructure in LepiOS app/                    | Grounded — Grep for "relay", "phone", "qr" in app/ returned zero matches 2026-04-27 |
| No Google Sheets client in LepiOS lib/                    | Grounded — Glob for lib/google\*/\*\* returned zero matches 2026-04-27              |
| html5-qrcode v2.3.8 via CDN is the scanner                | Grounded — source line 101, read 2026-04-27                                         |
| Camera preference: back → front → null                    | Grounded — source lines 148–155, read 2026-04-27                                    |
| 1.5s auto-reload after scan                               | Grounded — source lines 79–82, read 2026-04-27                                      |
| Full chrome-suppression CSS on phone page                 | Grounded — source lines 26–38, read 2026-04-27                                      |
| `relay_write_isbn` writes to Sheets (not a REST endpoint) | Grounded — import from utils.sheets, source line 17, read 2026-04-27                |
| `app/(cockpit)/scan/` ScannerClient.tsx exists            | Grounded — Glob confirmed path 2026-04-27                                           |
