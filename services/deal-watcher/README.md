# Deal Watcher — Railway Service

Persistent polling service that monitors watch targets (Amazon ASINs, LEGO.ca pages, generic URLs) and fires Telegram alerts via the LepiOS notifications pipeline when something changes.

## How it works

1. On startup, loads all `watch_targets` where `is_active = true` from Supabase.
2. Ticks every 30 seconds, checking each target against its own `check_interval_min`.
3. On a triggered alert, writes to `watch_events` and inserts a `pending` row into `outbound_notifications`, then POSTs to the LepiOS drain endpoint to flush it to Telegram.
4. Refreshes the target list from the DB every 5 minutes so newly-added targets are picked up without restart.

## Deploy on Railway

1. Create a new Railway service pointing to this repo, root directory: `services/deal-watcher`.
2. Set the following environment variables:

| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`              | Supabase project URL (from Vercel env or Supabase dashboard)       |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (from Supabase dashboard → Settings → API)        |
| `CRON_SECRET`               | Same value as in LepiOS Vercel env — used to auth the drain POST   |
| `LEPIOS_URL`                | Production URL (default: `https://lepios-one.vercel.app`)          |
| `KEEPA_API_KEY`             | Keepa API key — only needed if you have `amazon-asin` type targets |

## Target types

- **amazon-asin**: checks via Keepa API (domain=6, amazon.ca). Supports `in_stock`, `price_drop`, `any_change` alert modes. Set `asin` field.
- **lego-ca**: fetches LEGO.ca product page HTML, looks for "Add to Bag". Supports `in_stock`, `any_change`. Set `url` field.
- **generic-url**: HTTP GET + text pattern match. Set `url` and `notes` field. Notes format:
  - `MATCH:Add to Cart` — alert when text IS found
  - `ABSENT:Sold Out` — alert when text is NOT found
  - Bare string — treated as MATCH

## Adding a watch target

Insert directly into Supabase or use the LepiOS Deal Watch page at `/deal-watch`.
