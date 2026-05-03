/**
 * self_repair/drafter.ts
 *
 * One Claude Sonnet call via httpRequest({capability:'net.outbound.anthropic'}).
 * Returns a git-apply-able unified diff + summary + rationale.
 *
 * AD6: drafter LLM is Claude Sonnet (claude-sonnet-4-6). Temperature 0. No retry.
 * AD5: no confidence score in slice 1 — pass/fail is the binary gate.
 * Never auto-merges. Never applies diffs to main workspace.
 */

import { httpRequest } from '@/lib/harness/arms-legs'
import { requireCapability } from '@/lib/security/capability'
import { createServiceClient } from '@/lib/supabase/service'
import type { FailureContext } from './context'

export interface DraftedFix {
  unifiedDiff: string
  summary: string
  rationale: string
  promptTokens: number
  completionTokens: number
}

const LLM_TIMEOUT_MS = 30_000 // TODO: tune with real data — slice 1 default per spec §Out of scope

const SYSTEM_PROMPT = `You are LepiOS's self_repair agent. You are given:
1. A failure event from the harness (action type, timestamp, context)
2. Recent git commits that may have introduced the failure
3. Relevant source files (or empty if files were not found)
4. Related events in the same time window

Your task: output a JSON object (no markdown, no code fences — raw JSON only) with exactly these fields:
{
  "unifiedDiff": "<git-apply-able unified diff string, or empty string if no fix can be determined>",
  "summary": "<3 sentences describing what this fix does>",
  "rationale": "<1-2 sentences explaining why this is the likely cause and fix>"
}

Rules:
- The unifiedDiff must be valid unified diff format (--- a/path, +++ b/path, @@ ... @@) or empty string.
- Do NOT include binary files, package-lock.json, or generated files in the diff.
- If you cannot determine a safe, targeted fix, return an empty unifiedDiff with a summary explaining why.
- Never suggest deleting files, dropping tables, or modifying migrations.
- Target minimal changes — prefer fixing the specific timeout/handler logic over refactoring.`

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicResponse {
  content?: { type: string; text: string }[]
  usage?: { input_tokens: number; output_tokens: number }
  error?: { type: string; message: string }
}

/**
 * Format the failure context into a user message for the LLM.
 */
function buildUserMessage(ctx: FailureContext): string {
  const parts: string[] = []

  parts.push(`## Failure event`)
  parts.push(`action_type: ${ctx.failure.actionType}`)
  parts.push(`occurred_at: ${ctx.failure.occurredAt}`)
  parts.push(`event_id: ${ctx.failure.eventId}`)
  parts.push(`agent_id: ${ctx.failure.agentId ?? 'unknown'}`)
  parts.push(`context: ${JSON.stringify(ctx.failure.context, null, 2)}`)

  if (ctx.relatedEvents.length > 0) {
    parts.push(`\n## Related events (same 1h window, most recent first)`)
    for (const ev of ctx.relatedEvents.slice(0, 10)) {
      parts.push(`- ${ev.occurred_at}: ${ev.action}`)
    }
  }

  if (ctx.recentCommits.length > 0) {
    parts.push(`\n## Recent commits (oldest to newest)`)
    for (const commit of ctx.recentCommits) {
      const fileList = commit.files.slice(0, 5).join(', ')
      const more = commit.files.length > 5 ? ` (+${commit.files.length - 5} more)` : ''
      parts.push(`- ${commit.sha.slice(0, 8)}: ${commit.subject} [${fileList}${more}]`)
    }
  }

  if (ctx.relevantFiles.length > 0) {
    parts.push(`\n## Relevant source files`)
    for (const file of ctx.relevantFiles) {
      parts.push(`\n### ${file.path}`)
      parts.push('```')
      parts.push(file.content)
      parts.push('```')
    }
  } else {
    parts.push(`\n## Relevant source files`)
    parts.push('(no files found for this action type — base fix on commits and context only)')
  }

  return parts.join('\n')
}

/**
 * Call Claude Sonnet to draft a fix.
 * Writes audit events before and after the call.
 * Returns null if the LLM returns invalid JSON or the call fails.
 */
export async function draftFix(ctx: FailureContext): Promise<DraftedFix | null> {
  const db = createServiceClient()

  // Capability check — log_only, never blocks
  const capResult = await requireCapability({
    agentId: 'self_repair',
    capability: 'tool.self_repair.draft_fix',
  }).catch(() => ({ audit_id: '' }))

  const auditId = capResult.audit_id

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: 'ANTHROPIC_API_KEY not set',
    })
    return null
  }

  const userMessage = buildUserMessage(ctx)

  const messages: AnthropicMessage[] = [{ role: 'user', content: userMessage }]

  const result = await httpRequest({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    capability: 'net.outbound.anthropic',
    agentId: 'self_repair',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages,
    },
    timeoutMs: LLM_TIMEOUT_MS,
  })

  if (!result.ok) {
    const errMsg = result.error ?? `HTTP ${result.status}`
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: `LLM call failed: ${errMsg}`,
      status: result.status,
    })
    return null
  }

  let parsed: AnthropicResponse
  try {
    parsed = JSON.parse(result.body) as AnthropicResponse
  } catch {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: 'Failed to parse LLM response JSON',
    })
    return null
  }

  if (parsed.error) {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: `Anthropic error: ${parsed.error.message}`,
      error_type: parsed.error.type,
    })
    return null
  }

  const textContent = (parsed.content ?? []).find((c) => c.type === 'text')
  if (!textContent?.text) {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: 'LLM returned no text content',
    })
    return null
  }

  let draftJson: { unifiedDiff?: string; summary?: string; rationale?: string }
  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = textContent.text
      .trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
    draftJson = JSON.parse(cleaned) as typeof draftJson
  } catch {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: 'LLM response was not valid JSON',
      raw_preview: textContent.text.slice(0, 200),
    })
    return null
  }

  if (
    typeof draftJson.unifiedDiff !== 'string' ||
    typeof draftJson.summary !== 'string' ||
    typeof draftJson.rationale !== 'string'
  ) {
    await logDraftEvent(db, 'self_repair.draft.error', 'error', auditId, {
      reason: 'LLM response missing required fields (unifiedDiff, summary, rationale)',
    })
    return null
  }

  const promptTokens = parsed.usage?.input_tokens ?? 0
  const completionTokens = parsed.usage?.output_tokens ?? 0

  await logDraftEvent(db, 'self_repair.draft.ok', 'success', auditId, {
    correlation_id: auditId,
    tokens_in: promptTokens,
    tokens_out: completionTokens,
    diff_bytes: draftJson.unifiedDiff.length,
  })

  return {
    unifiedDiff: draftJson.unifiedDiff,
    summary: draftJson.summary,
    rationale: draftJson.rationale,
    promptTokens,
    completionTokens,
  }
}

async function logDraftEvent(
  db: ReturnType<typeof createServiceClient>,
  action: string,
  status: 'success' | 'error',
  correlationId: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    await db.from('agent_events').insert({
      domain: 'self_repair',
      action,
      actor: 'self_repair',
      status,
      meta: { ...meta, correlation_id: correlationId },
    })
  } catch {
    // Non-fatal
  }
}
