# Telegram Inbound Webhook Setup

Route: `POST /api/telegram/webhook`
Handles: unified inbound webhook — `outbound_notifications` correlation (requires_response flows),
👍/👎 feedback taps, and deploy-gate promote/abort/rollback callbacks

---

## One-time setup steps

### 1. Set env var in Vercel

Add `TELEGRAM_WEBHOOK_SECRET` to the Vercel project:

- Dashboard → lepios → Settings → Environment Variables
- Key: `TELEGRAM_WEBHOOK_SECRET`
- Value: the 48-char hex secret (generated at setup time — keep in 1Password)
- Environments: Production + Preview

### 2. Redeploy

Trigger a redeploy so the new env var is live before registering the webhook.
The route won't process requests until `TELEGRAM_WEBHOOK_SECRET` is set.

### 3. Register the webhook with Telegram

Replace `<BOT_TOKEN>` with the bot token and `<YOUR_TELEGRAM_WEBHOOK_SECRET>`
with the value you set in step 1:

```sh
curl -s -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://lepios-one.vercel.app/api/harness/telegram-webhook",
    "secret_token": "<YOUR_TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

### 4. Verify

```sh
curl -s "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" | jq .
```

Confirm:

- `url` matches `https://lepios-one.vercel.app/api/telegram/webhook`
- `has_custom_certificate` is `false`
- `pending_update_count` is `0` (or low)
- `last_error_message` is absent or empty

---

## Notes

- The existing webhook at `/api/telegram/webhook` handles thumbs feedback and
  deploy-gate button taps. That registration is separate (different bot or
  same bot depending on which token is used). Check `getWebhookInfo` to confirm
  which URL is currently registered before running `setWebhook`.
- If both endpoints need to receive updates from the same bot, a fan-out proxy
  or merger is required (not yet implemented). Coordinate which handler owns
  the registration during step 6.
- `allowed_updates: ["message", "callback_query"]` filters out edited_message,
  channel_post, etc. — keeps volume low.
