# CHAT_UI_SPEC

**Status:** DRAFT 1 (2026-04-28) — for review. Not yet approved. No code written.
**Source of truth (when approved):** This doc.
**Authority (when approved):** Migration 0048 (or next-available number) + `lib/orb/tools/*.ts` are written from this doc.
**Parent component:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) §`chat_ui` — component #14 (T4, weight 6, currently 0% per foundation table — **stale; honest re-score: ~26%**, see §Foundation-spec drift finding). Foundation §Priority #10 sets target 30% / ~1 week. **This spec sets a higher honest target** — see §Completion accounting.
**Sibling specs:** [`ARMS_LEGS_S2_SPEC.md`](ARMS_LEGS_S2_SPEC.md) (provides pre-bound `telegram()` / `vercelRead()` / `httpRequest()` + `ArmsLegsHttpResult` discriminated union — chat_ui consumes these as tools) · [`SECURITY_LAYER_SPEC.md`](SECURITY_LAYER_SPEC.md) (provides `requireCapability()` + `agent_actions`) · [`MEMORY_LAYER_SPEC.md`](MEMORY_LAYER_SPEC.md) (provides `GET /api/memory/session-digest` — chat_ui-A1 calls it on conversation creation per memory spec §A2).
**Parallel tracker:** [`docs/orb-readiness.md`](../orb-readiness.md) — full Orb buildout breakdown (29 components across UI/brain/tools/identity/hardware). This spec covers the *harness component* slice of that broader work; orb-readiness tracks hardware + brand + non-harness UX.

---

## At a glance

| Field                                | Proposed                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Component count change               | **0** — sub-decomposes `chat_ui` for re-scoring                                                                                         |
| New tables                           | **0** in slice 1 — uses `conversations` + `messages` (live, migration 0042) + `agent_actions` (security_layer) + `agent_events`         |
| New endpoints                        | **0** in slice 1 — extends existing `POST /api/chat`                                                                                    |
| New libraries                        | **2** in slice 1 — `lib/orb/tools/registry.ts` + `lib/orb/tools/harness-rollup.ts`                                                      |
| New capability strings               | **1** — `tool.chat_ui.read.harness_rollup` (slice 1). More tools = more rows in slice 2+.                                               |
| Honest current %                     | **~26%** — shell + persistence + streaming + auth + identity already shipped. See §Foundation-spec drift finding.                       |
| Honest target slice 1                | **~45%** — adds tool-use bridge + 1 wired tool + audit + capability check (conditional on acceptance A–G all green; see §Completion accounting) |
| Foundation spec target               | 30% (~1 week) — **already met by the shell alone.** Honest re-target: 60% by slice 3. See §Completion accounting.                       |
| Estimated effort slice 1             | **~2 days wall-clock** — tool registry + 1 tool + audit wiring + tests                                                                  |
| Default posture                      | **Audit every tool call** — `agent_actions` row per cap_check, `agent_events` row per outcome (mirrors ARMS_LEGS_S2 AD4 sibling pattern) |
| Hard prerequisites                   | `arms_legs` S2 merged + `security_layer` slices 1+2 live (already are — verified 2026-04-28)                                            |

---

## The problem

Foundation spec §`chat_ui`:

> Claude.ai-style local interface for talking to the harness. Colin opens a browser tab, types "what's the harness rollup?" or "ship the queued tasks now," gets a response. Removes Claude-Code-as-only-entrypoint dependency.

> Interface: Next.js page at `/chat` (or `/orb`) backed by an LLM with arms_legs + digital_twin tool access. Streams responses. Persists conversation in Supabase.

### Live audit (verified 2026-04-28)

The shell is already shipped. What's actually in the repo:

| Capability                              | Files                                                                                | Status       |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| `/chat` page (`useChat`, sidebar, multi-conversation) | `app/(cockpit)/chat/page.tsx`                                          | ✅ live       |
| Streaming endpoint (Ollama → AI SDK 6)  | `app/api/chat/route.ts` (`streamText` + `ollama-ai-provider` + `qwen2.5-coder:3b`)  | ✅ live       |
| Conversation list endpoint              | `app/api/chat/conversations/route.ts`                                                | ✅ live       |
| Message-history endpoint                | `app/api/chat/conversations/[id]/messages/route.ts`                                  | ✅ live       |
| Persistence (CRUD on conversations + messages, owner-scoped) | `lib/orb/persistence.ts`                                        | ✅ live       |
| Schema (`conversations` + `messages` + RLS + DB trigger) | `supabase/migrations/0042_orb_chat_schema.sql` (per-user RLS via `auth.uid()`) | ✅ live       |
| LEPIOS system prompt + identity         | `lib/orb/identity.ts`                                                                | ✅ live       |
| Markdown + code-block rendering         | `components/orb/MarkdownMessage.tsx` (react-markdown + shiki)                        | ✅ live       |
| Auth (401 unauth, 403 cross-user)       | `app/api/chat/route.ts:32-55`                                                        | ✅ live       |
| Token + duration logging                | `app/api/chat/route.ts:85-96` (console.log only)                                     | 🟡 partial    |

**What's missing — the harness participation gap:**

1. **Tool use bridge.** The LLM today can ONLY return text. It cannot call `getHarnessRollup()`, `queueTask(...)`, `telegram(...)`, or anything else. The system prompt explicitly admits this: *"Twin retrieval (lookups against his personal knowledge base) and tool use (file read, DB query, harness task submission, web fetch) are in active development and will land in the next few sprints. Do not pretend to have access you do not have."* — `lib/orb/identity.ts:7`.
2. **Capability checks.** Chat actions don't pass through `requireCapability()`. When tool use lands, every tool call must be audited.
3. **Audit trail.** Today's audit is `console.log` from the AI SDK `onFinish` callback. No `agent_actions` rows. No `agent_events` rows. Invisible to morning_digest.
4. **Twin retrieval.** No `digital_twin` integration on the chat path. The LLM has no access to the personal corpus (Anthropic memory, CLAUDE.md ingest, idea_inbox, decisions_log).
5. **Memory layer integration.** MEMORY_LAYER_SPEC §A2 says chat_ui-A1 should call `GET /api/memory/session-digest` at conversation creation. Today it doesn't.

The shell exists. The harness participation does not. Slice 1 fixes #1 + #2 + #3 for the smallest possible E2E (one tool wired). #4 and #5 are slice 2 + slice 3.

---

## Foundation-spec drift finding

Foundation spec table reports `chat_ui` at 0%. Repo audit shows ~26% already shipped (shell + persistence + auth + streaming + identity + markdown). Foundation table is stale.

Implication: rollup recompute (54.32% as of 2026-04-28) under-counts harness state by chat_ui's drift alone. Other components may have similar drift — particularly those with shipped infra pre-dating their formal spec.

Audit-other-components-for-drift task queued separately. Suggested next-targets: `arms_legs` (S2 spec landed today redefines surface area), `digital_twin` (rescored today, may have pre-shipped infra), `specialized_agents`.

---

## Architecture decisions (six)

### AD1. Use Vercel AI SDK 6 native tool-use, not a custom agent loop

The repo already uses `streamText` from `ai@6`. `streamText` accepts a `tools` parameter — a record of `{ description, parameters (zod schema), execute }` — and the SDK handles the tool-call → tool-result → continuation loop natively. We use this rather than building a `ToolLoopAgent` from scratch (the orb-readiness D7 placeholder).

**Why:** the SDK's loop already handles streaming reconciliation, partial tool-call streaming, and the multi-step round-trip. Reimplementing is surface area without payoff.

**Trade-off:** the SDK's tool-call shape is locked to Anthropic/OpenAI conventions. If we ever swap to a runtime that doesn't speak that shape, we re-wrap. Acceptable — every modern provider speaks it.

### AD2. Tool registry pattern — declarative, type-safe, capability-tagged

Each tool is one file in `lib/orb/tools/{name}.ts` exporting a `ChatTool` object:

```typescript
import { z } from 'zod'
import type { Tool } from 'ai'

export interface ChatTool<P, R> {
  name: string                          // canonical, e.g. 'getHarnessRollup'
  description: string                   // surfaced to the LLM
  parameters: z.ZodSchema<P>            // input shape
  capability: Capability                // requireCapability() target — see security_layer
  needsApproval?: (args: P) => boolean  // optional gate; default false (auto-approve)
  execute: (args: P, ctx: ChatToolContext) => Promise<R>
  resultDescription?: (result: R) => string  // optional summary for the LLM
}

export interface ChatToolContext {
  agentId: string                       // 'chat_ui' (for now — see Open Q1)
  conversationId: string
  userId: string                        // Supabase auth.uid()
  toolCallId: string                    // AI SDK 6 toolCallId — used as correlation_id
}
```

`lib/orb/tools/registry.ts` exports `function buildTools(ctx)` that returns the AI SDK 6-shaped tool record by mapping each registered `ChatTool` to a wrapper that:

1. Calls `requireCapability()` and short-circuits with `{ allowed: false, reason, auditId }` on deny.
2. On allow, races `tool.execute()` against a 30s timeout (acceptance D.1).
3. On success, writes a sibling `agent_events` row `chat_ui.tool.ok` with `correlation_id` = the cap_check `audit_id`.
4. On error, writes `chat_ui.tool.error` with the same correlation pattern; rethrows.
5. On timeout, writes `chat_ui.tool.timeout` with the same correlation pattern; rejects.

Full implementation in §M1. **New tools = new files in `lib/orb/tools/`. No central enum to update beyond a one-line import in `registry.ts`.** This is the same shape arms_legs uses for pre-bound functions.

### AD3. Deny semantics — return `{allowed:false, reason}`, never throw (Option C parity with arms_legs)

When `requireCapability()` returns `allowed:false`, the tool's `execute` returns `{ allowed: false, reason, auditId }`. The LLM sees this in the tool-result message and can react ("I don't have permission to do that — would you like me to ask Colin?"). No throw; no UI error; just a structured tool result.

Today every relevant `tool.*` cap will be `log_only` (security spec default). When security slice 7 flips them to `enforce`, chat_ui ships clean — the discriminated result already handles it.

### AD4. agentId for chat_ui = `'chat_ui'` (system identity), not `'colin'` (human identity)

Why not `'colin'`: capabilities are about *what process* is acting, not *whose behalf*. The chat_ui process is autonomous code (LLM reasoning, then tool execution); attributing actions to "colin" would conflate "Colin pressed a button" (clear human consent) with "the LLM decided to call a tool" (algorithmic decision). Audit signal needs the distinction.

Why `'chat_ui'`: gives security_layer a clean attribution channel. The `agent_actions.agent_id` column tells us which subsystem invoked which capability. Cross-cutting Colin-attribution lives in `userId` on the chat tool context (recorded in `agent_events.context.user_id`), so we don't lose the human consent thread — we just keep it separate from the agent-action thread.

Concretely: `'chat_ui'` is a new agent identity. Slice 1 first commit migrates its capability seed:

```sql
INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES ('chat_ui', 'tool.chat_ui.read.harness_rollup', 'log_only', 'colin', 'chat_ui slice 1 — first wired tool');
```

### AD5. Memory-layer + Twin integrations are slice 2/3, NOT slice 1

Per the parent spec: chat_ui consumes `arms_legs` AND `digital_twin`. Slice 1 wires *one* tool through the entire stack to prove the bridge works. Wiring memory-layer session-digest at conversation creation (memory spec §A2) and Twin pre-message context inject (orb C2) are separate slices because each adds its own failure modes (digest budget overrun, Twin latency masking, etc.).

Slice ordering:

- **Slice 1** — Tool registry + `getHarnessRollup` tool + audit + capability + tests. ~45%.
- **Slice 2** — Memory layer integration: call `/api/memory/session-digest` on `createConversation()` and prepend to system prompt. ~50%.
- **Slice 3** — Twin tool: `queryTwin(question)` returning citations + answer. ~60%.
- **Slice 4+** — Pre-bound arms_legs tools (`telegramTool`, `vercelReadTool`, `queueTaskTool`), more harness queries, approval gating for destructive tools.

### AD6. needsApproval defaults to `false`; explicit per-tool opt-in for destructive/expensive

Read-only tools (`getHarnessRollup`, `queryTwin`, `listConversations`) auto-execute. Side-effecting tools (`telegram`, `queueTask`, `vercelDeploy`) require approval — the AI SDK 6 `needsApproval` callback returns true for those tools, surfacing an approval UI in the chat (slice 4+ scope; not slice 1).

Slice 1's only tool is read-only, so this is a contract definition, not active policy yet.

---

## Components — sub-systems within `chat_ui` for honest re-scoring

The `chat_ui` row stays atomic in `harness_components` at weight 6. This internal decomposition is for re-score honesty — same pattern as memory_layer / security_layer / sandbox.

| Slug (internal)         | Weight inside chat_ui | Today | Target slice 1 | Notes                                                                |
| ----------------------- | --------------------- | ----- | -------------- | -------------------------------------------------------------------- |
| `chat_shell`            | 15%                   | 95%   | 95%            | Page + sidebar + streaming + multi-conversation. Live (orb A1+A2+A6). |
| `persistence_auth`      | 10%                   | 90%   | 90%            | conversations/messages tables + RLS + user-scope. Live (orb A2+0042).  |
| `system_identity`       | 5%                    | 50%   | 50%            | LEPIOS system prompt. Live (orb B3 partial); Modelfile pending.       |
| `tool_use_bridge`       | 30%                   | 0%    | 60%            | AI SDK `streamText({ tools })` wired + registry + execute + timeout pattern. 60% (not 100%) because the bridge proves on ONE read-only tool — destructive + chained-tool variety lands slice 4+. |
| `arms_legs_tools`       | 15%                   | 0%    | 10%            | First tool (`getHarnessRollup`) wired in slice 1. Pre-bound surface in slice 4+. |
| `digital_twin_tool`     | 15%                   | 0%    | 0%             | Slice 3.                                                              |
| `audit_trail`           | 10%                   | 0%    | 100%           | `agent_actions` cap_check + `agent_events` outcome rows per tool call. |

Math (today): 0.15·0.95 + 0.10·0.90 + 0.05·0.50 + 0 + 0 + 0 + 0
            = 0.1425 + 0.090 + 0.025
            = **0.2575 ≈ 26%**

Math (slice 1 target): 0.15·0.95 + 0.10·0.90 + 0.05·0.50 + 0.30·0.60 + 0.15·0.10 + 0 + 0.10·1.00
                     = 0.1425 + 0.090 + 0.025 + 0.180 + 0.015 + 0 + 0.100
                     = **0.4525 ≈ 45%**

These slug names DO NOT land as new rows in `harness_components`. They live in this spec for re-score traceability only.

---

## M1. `lib/orb/tools/registry.ts` — tool registry + AI SDK 6 adapter

```typescript
import { tool, type Tool } from 'ai'
import { requireCapability } from '@/lib/security/capabilities'
import { logEvent } from '@/lib/orchestrator/events'  // existing helper, writes agent_events
import type { Capability } from '@/lib/security/types'

export interface ChatToolContext {
  agentId: 'chat_ui'                    // locked per AD4
  conversationId: string
  userId: string
  toolCallId: string                    // AI SDK 6 — used as correlation_id
}

export interface ChatTool<P = unknown, R = unknown> {
  name: string
  description: string
  parameters: import('zod').ZodSchema<P>
  capability: Capability
  needsApproval?: (args: P) => boolean
  execute: (args: P, ctx: ChatToolContext) => Promise<R>
}

export type ChatToolResult<R> =
  | { allowed: true;  result: R; auditId: string }
  | { allowed: false; reason: string; auditId: string }

export const TOOL_TIMEOUT_MS = 30_000

class ToolTimeoutError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool ${toolName} exceeded ${TOOL_TIMEOUT_MS}ms timeout`)
  }
}

// Registered tools — slice 1 ships ONE
import { harnessRollupTool } from './harness-rollup'
const REGISTERED: ChatTool[] = [harnessRollupTool]

export function buildTools(ctx: ChatToolContext): Record<string, Tool> {
  return Object.fromEntries(
    REGISTERED.map((t) => [
      t.name,
      tool({
        description: t.description,
        parameters: t.parameters,
        execute: async (args: unknown) => {
          const cap = await requireCapability({
            agentId: ctx.agentId,
            capability: t.capability,
            context: { sessionId: ctx.conversationId, reason: t.name },
          })
          if (!cap.allowed) {
            return { allowed: false, reason: cap.reason, auditId: cap.audit_id } as ChatToolResult<never>
          }
          const t0 = Date.now()
          try {
            // 30s timeout race — see acceptance D.1
            const result = await Promise.race([
              t.execute(args as Parameters<typeof t.execute>[0], ctx),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new ToolTimeoutError(t.name)), TOOL_TIMEOUT_MS)
              ),
            ])
            await logEvent('chat_ui.tool.ok', {
              correlation_id: cap.audit_id,
              tool: t.name,
              conversation_id: ctx.conversationId,
              user_id: ctx.userId,
              tool_call_id: ctx.toolCallId,
              durationMs: Date.now() - t0,
            })
            return { allowed: true, result, auditId: cap.audit_id } as ChatToolResult<unknown>
          } catch (err) {
            const isTimeout = err instanceof ToolTimeoutError
            await logEvent(isTimeout ? 'chat_ui.tool.timeout' : 'chat_ui.tool.error', {
              correlation_id: cap.audit_id,
              tool: t.name,
              conversation_id: ctx.conversationId,
              error: String(err),
              durationMs: Date.now() - t0,
            })
            throw err
          }
        },
      }),
    ])
  )
}
```

## M2. `lib/orb/tools/harness-rollup.ts` — slice 1's ONE tool

```typescript
import { z } from 'zod'
import type { ChatTool } from './registry'
import { computeHarnessRollup } from '@/lib/harness/rollup'  // existing — see §Signature extension below

export const harnessRollupTool: ChatTool<
  { tier?: 'T1' | 'T2' | 'T3' | 'T4' | 'all' },
  { rollupPct: number; componentCount: number; computedAt: string; byTier?: Record<string, number> }
> = {
  name: 'getHarnessRollup',
  description: 'Returns the current weighted harness completion percentage. Optionally filtered by tier (T1–T4).',
  parameters: z.object({
    tier: z.enum(['T1', 'T2', 'T3', 'T4', 'all']).optional().default('all'),
  }),
  capability: 'tool.chat_ui.read.harness_rollup',
  // read-only; no approval needed
  execute: async ({ tier }) => {
    const r = await computeHarnessRollup(tier === 'all' ? undefined : { tier })
    return {
      rollupPct: r.pct,
      componentCount: r.components.length,
      computedAt: r.computedAt,
      byTier: r.byTier,
    }
  },
}
```

**Signature extension (resolves former Open Q4):** Slice 1 first commit extends `computeHarnessRollup` signature in `lib/harness/rollup.ts` to accept optional `{ tier?: 'T1'|'T2'|'T3'|'T4' }`. Implementation: one-line type addition to the function signature, one-line filter inside the function body (`if (opts?.tier) components = components.filter(c => c.tier === opts.tier)`). Migration: zero. Test: fixture call with `tier: 'T3'` returns only T3 contributions and the `byTier` map contains a single key.

## M3. `app/api/chat/route.ts` — wire `tools: buildTools(ctx)` into `streamText`

One-block diff to existing route:

```typescript
const result = streamText({
  model: ollamaProvider(MODEL) as unknown as LanguageModel,
  system: LEPIOS_SYSTEM_PROMPT,
  messages: await convertToModelMessages(/* ... */),
  temperature: 0.7,
  // NEW: tool surface
  tools: buildTools({
    agentId: 'chat_ui',
    conversationId,
    userId: user.id,
    toolCallId: '',  // populated per-call by AI SDK 6
  }),
  toolChoice: 'auto',  // LLM picks when to call
  // …existing onFinish persistence…
})
```

System prompt updates one line: removes the "tool use … in active development" clause; adds "You can call `getHarnessRollup({tier?})` to query the live harness completion %." Slice 2+ extends as more tools land. Asserted in acceptance B.1.

---

## Slice 1 acceptance criteria — smallest E2E path

### A. Schema + capability seed land

- [ ] Migration `0048_chat_ui_capability_seed.sql` applies on prod:
      ```sql
      INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
      VALUES ('tool.chat_ui.read.harness_rollup', 'tool', 'chat_ui — getHarnessRollup tool', 'log_only', false);

      INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
      VALUES ('chat_ui', 'tool.chat_ui.read.harness_rollup', 'log_only', 'colin', 'chat_ui slice 1');
      ```
- [ ] `SUM(weight_pct) FROM harness_components = 100` (unchanged — no new component rows).

### B. Tool registry + harnessRollupTool exist and type-check

- [ ] `lib/orb/tools/registry.ts` exports `buildTools(ctx)` + `ChatTool` + `ChatToolContext` + `ChatToolResult` + `TOOL_TIMEOUT_MS` per §M1.
- [ ] `lib/orb/tools/harness-rollup.ts` exports `harnessRollupTool` per §M2.
- [ ] `lib/harness/rollup.ts` `computeHarnessRollup` signature accepts optional `{ tier?: 'T1'|'T2'|'T3'|'T4' }` (resolved former Open Q4).
- [ ] `tsc --noEmit` passes.

### B.1. System prompt updated in same commit as `registry.ts`

- [ ] `lib/orb/identity.ts` no longer contains the string `"in active development"` (the prior hedge about tool use).
- [ ] `lib/orb/identity.ts` contains a new sentence describing `getHarnessRollup` (e.g., a line naming the tool and what it returns).
- [ ] Prompt change ships in the SAME commit as `registry.ts`. Asserted by a CI check that flags drift between "registry contains tool X" and "system prompt mentions tool X" for any tool whose `name` is not present in the prompt body.

### C. Cap-check fires + audit row exists (allowed path)

- [ ] In a test, mock the Supabase client + Ollama provider; trigger `POST /api/chat` with a message that the LLM should answer via the tool ("what's the harness rollup right now?").
- [ ] Assert: `requireCapability` called once with `agentId='chat_ui'`, `capability='tool.chat_ui.read.harness_rollup'`.
- [ ] Assert: one `agent_actions` row exists with `agent_id='chat_ui'`, `capability='tool.chat_ui.read.harness_rollup'`, `result='allowed'`, `action_type='cap_check'`.

### C.1. Sibling outcome row exists in `agent_events`

- [ ] Assert: one `agent_events` row with `action='chat_ui.tool.ok'`.
- [ ] `context->>'correlation_id'` equals the `agent_actions.id` of the cap_check row.
- [ ] `context` JSONB contains `tool='getHarnessRollup'`, `conversation_id`, `durationMs` (number), `tool_call_id`.
- [ ] `JOIN agent_actions ON agent_actions.id = (agent_events.context->>'correlation_id')::uuid` reconstructs the call.

### D. Tool execution returns the right shape

- [ ] Mocked `computeHarnessRollup()` returns fixture `{ pct: 54.32, components: [...], computedAt: '...' }`.
- [ ] Tool's `execute` returns `{ allowed: true, result: { rollupPct: 54.32, componentCount, computedAt, byTier? }, auditId }`.
- [ ] AI SDK's tool-result message body matches this shape.

### D.1. Tool execute timeout — 30s wrapper

- [ ] `Promise.race` wrapper in `registry.ts` caps `tool.execute()` at 30s (`TOOL_TIMEOUT_MS = 30_000`).
- [ ] Test seeds a tool whose `execute` sleeps 60s, triggers it via the chat path, asserts the wrapper rejects after ~30s (assert duration < 32s).
- [ ] Assert: one `agent_events` row written with `action='chat_ui.tool.timeout'` and `correlation_id` matching the cap_check audit row's id.
- [ ] Assert: `context.durationMs` in that event row is approximately 30_000 (within ±500ms).

### E. LLM completion incorporates the tool result

- [ ] In an integration test (mock Ollama with a deterministic response), the LLM's final assistant message after the tool round-trip contains the rollup percentage as a string (e.g., "54.32%" or "54%").
- [ ] Assistant message persisted via existing `appendMessage()` flow.

### F. Denied-tool path returns structured error (no throw)

- [ ] `agent_id='chat_ui'` grant for `tool.chat_ui.read.harness_rollup` is REVOKE'd in a test fixture (separate connection; not the prod registry).
- [ ] Tool call returns `{ allowed: false, reason: 'no_grant_for_agent', auditId }` to the LLM.
- [ ] `agent_actions` has the `result='denied'` row.
- [ ] No `agent_events` outcome row (denied calls don't generate outcome rows — same pattern as ARMS_LEGS_S2 acceptance C).
- [ ] No throw bubbles up; the chat continues; the LLM sees the deny and (per system prompt) reports it plainly.

### G. Production smoke

- [ ] After deploy: open `/chat` in a browser, ask "what's the harness rollup?", get a numeric answer in the assistant response.
- [ ] One new `agent_actions` row exists for the production user_id within 30 seconds.
- [ ] Console log line for the tool call appears in Vercel runtime logs (existing `console.log` pattern).

### H. Rollup honesty

- [ ] After slice 1: `harness_components.completion_pct` for `chat_ui` updated 0 → **45** (per §Completion accounting). Foundation spec table is stale; the bump reflects the shell-already-shipped reality + slice 1 work.
- [ ] morning_digest reflects: "chat_ui: 0 → 45 (slice 1 — tool bridge, +1 read-only tool)".

### I. F18 surfacing — morning_digest line

- [ ] New digest line: `Chat UI (24h): N tool calls, M denies, top tools: [{tool, count}, ...]`.
- [ ] Aggregates from `agent_actions` + `agent_events` joined.

---

## Completion accounting

Foundation spec target for `chat_ui`: 30% (~1 week). **Already met by the shell.** Honest re-target in this spec:

| Slice  | Ships                                                                 | Honest %  | Notes                                          |
| ------ | --------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| (today)| Shell + persistence + auth + streaming + identity (orb-readiness §A1+A2+A3+A5+A6+B3+B5 already shipped) | **~26%**  | Foundation spec's "0%" is stale — see §Foundation-spec drift finding |
| **S1** | **Tool registry + `getHarnessRollup` + audit + capability + 30s timeout** | **~45%**  | This spec's primary deliverable                |
| S2     | Memory-layer integration (`/api/memory/session-digest` on conv. create) | ~50%      | Per memory spec §A2                            |
| S3     | Twin tool (`queryTwin(question)` returning citations + answer)        | ~60%      | Pre-message context inject (orb C2)            |
| S4     | Pre-bound arms_legs tools (`telegram`, `vercelRead`, `queueTask`) + approval gating | ~75% | needsApproval policy lands here                |
| S5     | F18 surfacing maturity, voice calibration, Modelfile, brand polish    | ~85%      | Per orb-readiness §B/E                         |

The 100% line is reserved for "chat_ui is the canonical Colin-to-harness interface" — at that point Claude Code becomes a fallback, not the primary entry point. Foundation-spec target of 30% lands at slice 1; this spec re-targets the component to a higher honest ceiling because the foundation number was set before the shell shipped.

**The 45% slice 1 target is conditional on acceptance A–G all green.** If any single acceptance fails, completion is recomputed against actual landed work, not against the spec target. F19' verifier (when shipped) grades this retroactively. This pin protects against "shipped the spec, not the work" inflation.

---

## Out of scope (slice 1)

- **Twin retrieval / Twin tool** — Slice 3.
- **Memory-layer session digest on conversation creation** — Slice 2 (per memory spec §A2).
- **Pre-bound arms_legs tools as chat tools** (telegram, vercelRead, queueTask) — Slice 4. Slice 1 wires ONE tool to prove the bridge.
- **Approval gating UI for destructive tools** — Slice 4 (`needsApproval` is defined in M1 but no tool uses it in slice 1).
- **OAuth / multi-user session management** — Per security spec §Out of scope. Single-user RLS via `auth.uid()` matches existing pattern.
- **Voice calibration test suite** — orb-readiness §B3 / E2 — not harness scope.
- **LEPIOS Modelfile** (model-level identity, vs API-level system prompt) — orb-readiness §B3 second-half.
- **Custom favicon / login wordmark** — orb-readiness §E1 — pure UX polish.
- **Nightly chat-summarization → Twin chunks** (orb C4) — separate workstream; depends on Twin schema decisions.
- **Production Ollama tunnel hardening** — covered by `gpu-day-readiness.md`. Slice 1 assumes the tunnel works as it does in current dev.
- **Custom `ToolLoopAgent`** — AD1 explicitly defers to AI SDK 6's native loop.
- **Streaming tool-call partials in the UI** — AI SDK 6 supports it natively; slice 1 takes whatever the SDK gives. UI polish is slice 5+.
- **Per-tool timeout configuration** — slice 1 ships a single 30s default. Per-tool overrides land in slice 3 alongside Twin (Twin queries may need ~60s).

---

## Open questions — flag, do not guess

**Q4 from earlier draft is resolved in-spec** — see §M2 (`computeHarnessRollup` signature extension). Remaining open questions retain their original numbering for stable cross-reference:

1. **agentId attribution.** AD4 says `'chat_ui'`. **Q: confirm — or do we want `'chat_ui:colin'` to bake in user identity for future multi-user readiness?** Recommendation: `'chat_ui'` for slice 1; revisit when a second user is on the table (not soon). Multi-user OAuth is gated separately per security spec.

2. **Tool-call streaming UX.** AI SDK 6 streams partial tool calls (the LLM is mid-emitting the JSON args). The current `MarkdownMessage` component doesn't render tool-call states ("calling getHarnessRollup…" → "got result" → "writing response"). **Q: does slice 1 need a tool-call status UI, or can we ship with raw streaming and polish later?** Recommendation: ship with raw streaming. The result text contains the answer; status decoration is slice 5+ polish.

3. **System prompt growth.** Adding tool descriptions to the system prompt costs tokens. Slice 1 adds ~80 tokens for `getHarnessRollup`. Slice 4's full arms_legs surface could add 500+. **Q: do we cap system-prompt tokens or accept growth as the tool surface grows?** Recommendation: defer; revisit when prompt > 1500 tokens (we're at ~180 today).

5. **Denied-tool messaging.** When a tool returns `{ allowed:false }`, the LLM sees the structured result but its prose response isn't constrained. It might say "I can't access that" or invent a reason. **Q: pin the LLM's denied-response shape via the system prompt, or trust the model?** Recommendation: trust for slice 1 (qwen2.5-coder:3b is small but reliable on this); audit conversation logs after a week; tighten the prompt if denials get framed misleadingly.

6. **Conversation ↔ agent_actions linkage.** `agent_actions.context` JSONB carries `sessionId = conversationId`. **Q: do we also write `conversation_id` as a top-level audit-table column for indexed queries, or trust JSONB GIN indexing?** Recommendation: trust JSONB. Volume is low; indexing pre-emptively is premature.

7. **Tool call inside a denied conversation.** If a chat user is somehow deauthenticated mid-conversation (token expired), should the tool call just fail or should the chat error out completely? **Q: error semantics for auth-mid-stream?** Recommendation: existing 401 handling at the top of `POST /api/chat` is enough — auth lapses fail the whole request before tools fire.

---

## Dependencies

### Hard prerequisites (slice 1 cannot ship without these)

| Component                  | What chat_ui needs                                                                                     | Live status (verified 2026-04-28)         |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `arms_legs` S2             | Pre-bound tool patterns + `ArmsLegsHttpResult` discriminated union (chat_ui M1 mirrors AD2/AD4 patterns) | ⬜ DRAFT (this session, commit 078578f)    |
| `security_layer` slice 1   | `agent_actions` table + `lib/security/audit.ts`                                                         | ✅ live                                    |
| `security_layer` slice 2   | `capability_registry` + `agent_capabilities` + new agent_id `'chat_ui'` (slice 1 first commit adds it) | ✅ live (registry has 34 rows; chat_ui agent grants land in slice 1's migration 0048) |
| Existing chat shell        | `/chat` page + `/api/chat` endpoint + persistence + auth                                                | ✅ live                                    |
| `lib/harness/rollup.ts`    | `computeHarnessRollup()` callable function (slice 1 extends signature with optional `{ tier }`)         | ✅ live (signature extension is one-line)  |

### Soft dependencies

| Component               | What it adds                                                                  | Defer to                              |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| `digital_twin`          | `queryTwin(question)` tool                                                    | Slice 3                               |
| `memory_layer`          | session-digest on conversation creation                                       | Slice 2                               |
| `f18_surfacing`         | morning_digest line for chat tool calls                                       | Same PR as slice 1 (acceptance I)     |
| `secrets.get()` (sec slice 4) | Replace direct env reads if any tool needs secrets                       | Slice 4+ when tools start needing creds |

### Downstream consumers

| Component             | What chat_ui slice 1 unlocks                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| Colin's daily ops     | "What's the harness rollup?" answered in browser without opening Claude Code  |
| Future scout_agent    | Same tool registry pattern is reusable for scout's tool surface                |
| Future ollama_daytime | Daytime tick can use the same tools (different agentId, same caps registry)   |

---

## Risks called out for redline

- **R1.** AI SDK 6 tool-call shape changes. SDK is at v6 today; v7 may rework the tool API. Mitigation: registry abstracts the SDK call; reshaping is one file (`registry.ts`).
- **R2.** Ollama's qwen2.5-coder:3b may be too small to reliably call tools. Smaller models often emit malformed tool JSON. Mitigation: production smoke (acceptance G) catches it; if reliability < 80%, swap to qwen2.5:14b (already on the orb-readiness path post-eGPU) or fall back to a deterministic regex-based intent detector for slice 1.
- **R3.** Cap-check latency on every tool call adds ~50ms + DB round-trip. For one tool per turn, fine. For chained tool calls (LLM calls 5 tools in one turn), 250ms. Mitigation: in-process registry cache from security spec R1 already mitigates.
- **R4.** Audit volume. One cap_check + one event row per tool call. At 10 conversations/day × 5 tool calls each = 100 rows/day. Trivial. Same scaling note as ARMS_LEGS_S2 R2.
- **R5.** Tool-call timeout. Mitigated in slice 1 per acceptance D.1 (30s `Promise.race` wrapper, dedicated `chat_ui.tool.timeout` event row). Residual risk: 30s default may be too tight for slow Twin queries — revisit timeout-per-tool in slice 3.
- **R6.** System prompt drift. The "Capabilities right now" line in `lib/orb/identity.ts` claims tool use isn't live; slice 1 must update it the same commit it ships the tool. Mitigation: acceptance B.1 enforces this in CI.
- **R7.** chat_ui's agent_id is brand-new. If `'chat_ui'` is misspelled anywhere (`'chatui'`, `'chat-ui'`, `'orb'`), capability lookups silently fail (`unregistered_agent`). Mitigation: parity test in `tests/security/grant-parity.test.ts` (already added in ARMS_LEGS_S2 F.5) extends to assert the chat_ui agent_id matches across code + DB.

---

## Working agreement reminders

- Specs first, code second.
- No padding. chat_ui is honestly ~26% today (foundation table says 0% — that's stale; see §Foundation-spec drift finding). Slice 1 lands at ~45%, conditional on acceptance A–G all green.
- Acceptance tests written before building (§Slice 1 acceptance criteria, above).
- Doc-as-source: this file is authoritative once approved; `lib/orb/tools/*.ts` and migration 0048 follow it.
- Read existing files before drafting anything new — done; `app/api/chat/route.ts`, `lib/orb/{identity,persistence,ollama}.ts`, `components/orb/MarkdownMessage.tsx`, `supabase/migrations/0042_orb_chat_schema.sql`, and `docs/orb-readiness.md` audited inline.
- **This window is SCOPE ONLY. No code, no commits beyond this spec doc.**
