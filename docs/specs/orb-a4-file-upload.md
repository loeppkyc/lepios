# Spec — Orb A4: File Upload (text/code only, v1)

**Date:** 2026-05-05
**Status:** decided to build; queued in `task_queue`
**Tracker:** orb-readiness A4 (1 pt, currently 0%)

## Decision

Build text/code file upload only. **No vision routing in v1.** Images and binary docs are out of scope until Colin actually starts using the orb regularly and has a concrete need.

## Scope (v1)

User uploads one or more files via a paperclip button next to the chat input. Allowed types:

- `text/plain`, `text/markdown`, `text/csv`
- Source code: `.ts`, `.tsx`, `.js`, `.mjs`, `.py`, `.sql`, `.sh`, `.ps1`, `.json`, `.yaml`, `.yml`, `.toml`
- `text/html` (stripped of script/style tags before context injection)

Excluded:

- Images (PNG/JPG/etc.) — would need llava routing, deferred
- PDFs — would need extraction, deferred
- Office docs — would need conversion, deferred
- Binary blobs — never

## Implementation

### Client (`app/(cockpit)/chat/page.tsx`)

- Paperclip button next to the text input. Opens `<input type="file" multiple accept="<allowlist>">`.
- Shows attached files as chips above the input with × to remove.
- On submit: file content is read client-side, encoded as additional `parts` on the user message:

  ```ts
  parts: [
    { type: 'text', text: userText },
    { type: 'text', text: `--- attached: ${file.name} ---\n${fileContents}` },
  ]
  ```

  This reuses the existing parts pipeline — no schema change, no DB change.

### Server (`app/api/chat/route.ts`)

No changes required. The existing `partsText()` flattens all text parts into the user message that's passed to the model. Files become inline context.

### Limits

- Max 5 files per message
- Max 32KB per file (truncate-with-warning on exceed)
- Max 128KB total per message (reject if exceeded — too much for context window without compaction)

These limits are enforced client-side (UI shows error before send) and server-side (route rejects 413 if total parts > 128KB).

## Acceptance criteria

- [ ] Paperclip button visible at all viewport widths
- [ ] File chips show name + size, removable
- [ ] Allowed file types pass; disallowed types reject client-side with toast
- [ ] Files appear in the persisted user message (`messages.content` JSONB) as additional text parts
- [ ] Per-file truncation at 32KB shows a `[truncated …]` marker in the injected text
- [ ] Total-size cap at 128KB rejects with a toast, no message sent
- [ ] No new env vars
- [ ] No new migrations (existing JSONB `content` is extensible)

## Out of scope (v2+)

- Image upload routed to `llava:7b`
- PDF text extraction (consider `pdf-parse` lib in v2)
- Drag-and-drop (v1 is button-only)
- File pinning (attach once, persist across messages in same conversation)

## Build estimate

1 builder session, ~1.5 hours including tests.

## Tracker impact

A4: 0% → 100% on completion (+1.0 pt).
