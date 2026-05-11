# Personal Data Inventory

_Last updated: 2026-05-10_

## Local exports (on 24 TB hard drive + C:\AI_Data\exports\)

| Source     | Local path                        | What's in it                                      |
|------------|-----------------------------------|---------------------------------------------------|
| Dropbox    | `C:\AI_Data\exports\dropbox\`     | All Dropbox files (Apps, Receipts, Hubdoc, etc.)  |
| Gmail      | `C:\AI_Data\exports\gmail\`       | Email archive (pre-2025 + current)                |
| Google     | `C:\AI_Data\exports\google-takeout\` | Drive, Photos, Calendar, etc. via Takeout       |
| Facebook   | `C:\AI_Data\exports\facebook\`    | Posts, photos (1,047 files), messages, profile    |

Facebook archive: two ZIPs (~5.7 GB total), extracted 2026-05-10.
Key folders: `your_facebook_activity/posts/media/` for photos, `your_facebook_activity/messages/` for messages.

---

## What deleting Google + Facebook + Dropbox would NOT remove

Transferring local data and deleting those three accounts is a meaningful step but does not come close to erasing your internet presence. Data remains in:

**Services you use directly:**
- Amazon — full order history, seller account, browsing behavior
- GitHub — all code repositories
- Stripe — full payment/payout history
- Supabase — LepiOS database
- Vercel — deployment logs
- Telegram — messages and bot history
- LinkedIn, Reddit, and any other accounts
- Banks + credit card companies — full financial history
- Government — tax records, vehicle registration, property records

**Services you never directly interacted with:**
- Credit bureaus (Equifax, TransUnion, Experian) — credit history, address history, income estimates
- Data brokers (Acxiom, LexisNexis, hundreds of others) — 1,000–3,000+ data points on the average adult: address history, relatives, purchasing behavior, estimated income, etc.
- ISP — browsing logs retained for months to years
- Ad networks — behavioral tracking profiles built from browsing history

**Archived copies:**
- Wayback Machine (web.archive.org) — any public content you've ever posted is likely archived permanently
- Anyone who received your emails — they keep their copy regardless of what you do with yours
- Any app that used "Sign in with Google/Facebook" — they pulled your data at login time and kept it

---

## Reducing your footprint beyond account deletion

- **DeleteMe** (joindeleteme.com) — paid service that submits opt-out requests to hundreds of data brokers on your behalf. Multi-month process. Recurring subscription needed because brokers re-add you over time.
- Manual broker opt-outs — most major brokers (Spokeo, Whitepages, BeenVerified, etc.) have individual opt-out forms. Tedious but free.
- Credit bureau opt-outs — separate process from data brokers.

Realistically, deleting the three accounts removes your *self-controlled* cloud footprint. The long tail (brokers, third parties, archives) requires active ongoing effort to minimize.
