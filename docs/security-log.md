# LepiOS Security Log

---

## INC-001 — Telegram Bot Token Exposed in Committed n8n Workflows

**Date discovered:** 2026-04-17  
**Discovered by:** LepiOS Phase 2 Agent D (Integrations Audit)  
**Severity:** High — live credential in public-accessible git history  
**Status:** Partially remediated. One open question outstanding (see below).

---

### What happened

The `loeppky_trigger_bot` (builder bot) Telegram API token was hardcoded in plaintext inside 5 committed n8n workflow JSON files:

- `n8n/01_daily_statement_sync.json`
- `n8n/02_missing_statement_alert.json`
- `n8n/03_app_health_check.json`
- `n8n/04_price_drop_monitor.json`
- `n8n/05_retirement_price_check.json`

All 5 files were committed to the Streamlit OS repo (`loeppkyc/Loeppky`) on the `main` branch. The token was present in git history from the original commits.

The `secrets.toml` file (which also contained the token under `[builder_bot]`) is correctly gitignored and was never at risk in the remote repo.

---

### Remediation steps taken

1. **Colin revoked the old token via BotFather.** Old bot numeric ID: `8502932021`. Old token is now dead.

2. **Error by Claude (commit `fd8860c`):** In the first remediation pass, the new token was substituted directly into all 5 n8n JSON files and committed. This was incorrect — the new valid token is now present in git history at commit `fd8860c` in the Streamlit OS repo. This commit has NOT been removed from history.

3. **Second pass (commit `3c89e63`):** All 5 n8n JSON files updated to use the placeholder `{{TELEGRAM_BOT_TOKEN}}` — consistent with the existing `{{N8N_WEBHOOK_TOKEN}}` convention in the same files. Token no longer appears in any committed file in the working tree.

4. **`secrets.toml`** updated with new token under `[builder_bot]` (gitignored — safe).

---

### Current git history exposure

| Commit | Repo | Branch | Token exposed |
|--------|------|--------|--------------|
| Multiple commits before `fd8860c` | Streamlit OS | main | Old revoked token (`8502932021:...`) — dead |
| `fd8860c` | Streamlit OS | main | **New live token** (`8660843715:AAG...`) |
| `3c89e63` (current HEAD) | Streamlit OS | main | No token — placeholder only |

**The new token is present in commit `fd8860c` in git history.** History has not been rewritten tonight per Colin's instruction. If this repo is public or shared, consider running `git filter-repo` to purge both commits. If private, revocation of the token before the next compromise window is the mitigation.

---

### Open question — `[alerts_bot]` discrepancy

During the final verification grep, `secrets.toml` was found to contain **two entries with the same numeric bot ID** (`8660843715`):

- `[builder_bot]` → new token just set (correct)
- `[alerts_bot]` → different hash, same numeric ID — **cannot be a different bot**

This means the `[alerts_bot]` entry in `secrets.toml` is stale or incorrectly set. The `loeppky_alerts_bot` should have its own distinct numeric bot ID. `secrets.toml` was not changed further pending Colin's clarification on which token belongs to which bot.

**Action required from Colin:** Verify the correct token for `[alerts_bot]` and update `secrets.toml` manually.

---

### n8n re-import instruction

When importing any of the 5 n8n workflow JSON files into a running n8n instance, substitute `{{TELEGRAM_BOT_TOKEN}}` with the actual builder bot token before or during import. Do not commit the substituted version back to git.

---

### Lessons

1. Credentials must never be hardcoded in workflow definition files committed to version control — even private repos.
2. When rotating a credential, replace with a variable reference in the same operation. Do not do a two-step (replace-with-new, then-replace-with-placeholder) that creates an intermediate commit with a live credential.
3. The `{{VARIABLE}}` placeholder convention already used in these files (`{{N8N_WEBHOOK_TOKEN}}`) should be applied consistently to all credentials at the time the workflow files are first created.
