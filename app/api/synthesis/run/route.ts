/**
 * POST /api/synthesis/run
 *
 * Claims one pending synthesis_debates row, runs Ollama pre-filter (phi4:14b),
 * then Claude hard synthesis. Stores structured result back to Supabase and
 * logs to agent_events.
 *
 * Auth: requireCronSecret (F22)
 * Scheduled: pg_cron every 6h via migration 0275 (Vercel cron slots exhausted).
 * GET alias: pg_cron may use GET.
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { generate, hydrateOllamaConfig, OllamaUnreachableError } from '@/lib/ollama/client'
import { logEvent } from '@/lib/knowledge/client'
import Anthropic from '@anthropic-ai/sdk'
import { logClaudeTokens } from '@/lib/ai/log-tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface DebateRow {
  id: string
  source: 'reddit' | 'hn'
  url: string
  title: string
  body_snippet: string | null
  controversy_score: number
  domain: string
}

interface SynthesisResult {
  side_a_summary: string | null
  side_b_summary: string | null
  resolution_text: string | null
  synthesis_text: string | null
}

function parseJsonResponse(text: string): SynthesisResult | null {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Partial<SynthesisResult>
    return {
      side_a_summary: parsed.side_a_summary ?? null,
      side_b_summary: parsed.side_b_summary ?? null,
      resolution_text: parsed.resolution_text ?? null,
      synthesis_text: parsed.synthesis_text ?? null,
    }
  } catch {
    return null
  }
}

async function runClaude(debate: DebateRow): Promise<{
  result: SynthesisResult
  tokens_used: number
}> {
  const client = new Anthropic()

  const systemPrompt = `Expert debate analyst. Find what is genuinely true in each position. Produce a resolution a smart, honest person on either side could accept.`

  const userMessage = [
    `Debate: ${debate.title}`,
    `Source: ${debate.source} — ${debate.url}`,
    `Snippet: ${debate.body_snippet ?? '(no body)'}`,
    '',
    'Return raw JSON (no markdown) with exactly these keys:',
    '{"side_a_summary": "...", "side_b_summary": "...", "resolution_text": "...", "synthesis_text": "..."}',
    '',
    'side_a_summary: What the mainstream/consensus side got right (1-2 sentences).',
    'side_b_summary: What the skeptic/dissenting side got right (1-2 sentences).',
    'resolution_text: The honest synthesis both sides could accept (2-3 sentences).',
    'synthesis_text: Full analysis paragraph (4-6 sentences).',
  ].join('\n')

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })
  logClaudeTokens(resp, 'synthesis')

  const tokensUsed = (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0)
  const rawText = resp.content[0]?.type === 'text' ? resp.content[0].text.trim() : ''

  let parsed = parseJsonResponse(rawText)

  // Retry once on parse failure
  if (!parsed) {
    const retry = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: rawText },
        {
          role: 'user',
          content:
            'Your response was not valid JSON. Return ONLY raw JSON with no markdown or explanation.',
        },
      ],
    })
    logClaudeTokens(retry, 'synthesis')
    const retryTokens = (retry.usage?.input_tokens ?? 0) + (retry.usage?.output_tokens ?? 0)
    const retryText = retry.content[0]?.type === 'text' ? retry.content[0].text.trim() : ''

    parsed = parseJsonResponse(retryText)
    if (!parsed) {
      // Store raw text if still unparseable
      return {
        result: {
          side_a_summary: null,
          side_b_summary: null,
          resolution_text: null,
          synthesis_text: retryText || rawText,
        },
        tokens_used: tokensUsed + retryTokens,
      }
    }
    return { result: parsed, tokens_used: tokensUsed + retryTokens }
  }

  return { result: parsed, tokens_used: tokensUsed }
}

async function handler(request: Request): Promise<NextResponse> {
  // 1. F22: requireCronSecret first
  const authError = requireCronSecret(request)
  if (authError) return authError

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // 2. Hydrate Ollama config (runtime config pattern — S-L1)
  await hydrateOllamaConfig()

  // 3. Find and claim one pending debate (optimistic lock: update where status=pending)
  const { data: debateRows, error: selectErr } = await supabase
    .from('synthesis_debates')
    .select(
      'id, source, url, title, body_snippet, controversy_score, domain'
    )
    .eq('synthesis_status', 'pending')
    .order('controversy_score', { ascending: false })
    .limit(1)

  if (selectErr) {
    return NextResponse.json(
      { error: 'DB select failed', detail: selectErr.message },
      { status: 500 }
    )
  }

  if (!debateRows || debateRows.length === 0) {
    return NextResponse.json({ ok: true, message: 'no pending debates' })
  }

  const debate = debateRows[0] as DebateRow

  // Mark as processing — only claim if still pending (avoids double-processing)
  const { error: lockErr } = await supabase
    .from('synthesis_debates')
    .update({ synthesis_status: 'processing' })
    .eq('id', debate.id)
    .eq('synthesis_status', 'pending')

  if (lockErr) {
    return NextResponse.json(
      { error: 'DB lock failed', detail: lockErr.message },
      { status: 500 }
    )
  }

  let ollamaVerdict: 'yes' | 'no' | 'skipped' = 'skipped'

  // 4. Ollama pre-filter — gracefully skips if unreachable (circuit open)
  try {
    const ollamaPrompt = [
      'Is this debate genuinely unresolved with valid points on both sides?',
      `Title: ${debate.title}.`,
      `Snippet: ${debate.body_snippet ?? '(no body)'}.`,
      'Answer: YES or NO + one sentence explaining why.',
    ].join(' ')

    const ollamaResult = await generate(ollamaPrompt, { task: 'analysis' })
    const responseUpper = ollamaResult.text.trim().toUpperCase()

    if (responseUpper.startsWith('NO')) {
      ollamaVerdict = 'no'
      await supabase
        .from('synthesis_debates')
        .update({
          synthesis_status: 'failed',
          synthesis_text: 'Filtered: Ollama assessed as resolved or one-sided',
        })
        .eq('id', debate.id)

      void logEvent('synthesis', 'synthesis.run', {
        actor: 'system',
        status: 'warning',
        meta: {
          debate_id: debate.id,
          source: debate.source,
          title: debate.title,
          ollama_verdict: 'no',
          tokens_used: 0,
          domain: debate.domain,
        },
      })

      return NextResponse.json({
        ok: true,
        debate_id: debate.id,
        title: debate.title,
        source: debate.source,
        ollama_verdict: 'no',
        synthesis_status: 'failed',
        tokens_used: 0,
      })
    }

    ollamaVerdict = 'yes'
  } catch (err) {
    if (err instanceof OllamaUnreachableError) {
      // Circuit open or unreachable — degrade gracefully, proceed to Claude
      ollamaVerdict = 'skipped'
    } else {
      // Unknown error — degrade gracefully
      ollamaVerdict = 'skipped'
    }
  }

  // 5. Claude hard synthesis
  let synthResult: SynthesisResult
  let tokensUsed = 0

  try {
    const { result, tokens_used } = await runClaude(debate)
    synthResult = result
    tokensUsed = tokens_used
  } catch (err) {
    await supabase
      .from('synthesis_debates')
      .update({
        synthesis_status: 'failed',
        synthesis_text: `Claude call failed: ${String(err).slice(0, 200)}`,
      })
      .eq('id', debate.id)

    void logEvent('synthesis', 'synthesis.run', {
      actor: 'system',
      status: 'failure',
      errorMessage: String(err).slice(0, 200),
      meta: {
        debate_id: debate.id,
        source: debate.source,
        title: debate.title,
        ollama_verdict: ollamaVerdict,
        tokens_used: 0,
        domain: debate.domain,
      },
    })

    return NextResponse.json(
      { error: 'Claude synthesis failed', detail: String(err) },
      { status: 500 }
    )
  }

  // 6. UPDATE debate as done with structured fields
  const { error: updateErr } = await supabase
    .from('synthesis_debates')
    .update({
      synthesis_status: 'done',
      side_a_summary: synthResult.side_a_summary,
      side_b_summary: synthResult.side_b_summary,
      resolution_text: synthResult.resolution_text,
      synthesis_text: synthResult.synthesis_text,
      synthesized_at: new Date().toISOString(),
    })
    .eq('id', debate.id)

  if (updateErr) {
    return NextResponse.json(
      { error: 'DB update failed', detail: updateErr.message },
      { status: 500 }
    )
  }

  // 7. Log agent_events
  void logEvent('synthesis', 'synthesis.run', {
    actor: 'system',
    status: 'success',
    durationMs: Date.now() - startedAt,
    meta: {
      debate_id: debate.id,
      source: debate.source,
      title: debate.title,
      ollama_verdict: ollamaVerdict,
      tokens_used: tokensUsed,
      domain: debate.domain,
    },
  })

  // 8. Return result
  return NextResponse.json({
    ok: true,
    debate_id: debate.id,
    title: debate.title,
    source: debate.source,
    ollama_verdict: ollamaVerdict,
    synthesis_status: 'done',
    tokens_used: tokensUsed,
  })
}

export { handler as POST, handler as GET }
