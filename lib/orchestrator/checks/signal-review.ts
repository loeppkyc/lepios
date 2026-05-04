import { generate, OllamaUnreachableError, extractConfidence } from '@/lib/ollama/client'
import { createServiceClient } from '@/lib/supabase/service'
import type { CheckResult, Flag } from '../types'

const GENERATE_TIMEOUT_MS = 45_000
const LOOKBACK_HOURS = 12
const LOW_CONFIDENCE_THRESHOLD = 0.4

// Fetches the last 12h of agent_events and asks Ollama to surface anomalies.
// status='warn' flags encode the failure mode for the scorer (unreachable/timeout/confidence).
// status='pass' flags are actual anomaly lines from the Ollama response.
export async function checkSignalReview(): Promise<CheckResult> {
  const start = Date.now()
  const flags: Flag[] = []

  // Fetch recent events
  let eventsSummary = ''
  let eventCount = 0
  try {
    const supabase = createServiceClient()
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
    const { data, error } = await supabase
      .from('agent_events')
      .select('action, status, output_summary, occurred_at')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(50)

    if (error) throw new Error(error.message)

    const rows = data ?? []
    eventCount = rows.length
    eventsSummary = rows
      .map((r) => `[${r.action}] ${r.status}: ${(r.output_summary ?? '').slice(0, 100)}`)
      .join('\n')
      .slice(0, 3000)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'warn',
      message: `Failed to read agent_events: ${msg}`,
      entity_type: 'database',
    })
    return {
      name: 'signal_review',
      status: 'warn',
      flags,
      counts: {},
      duration_ms: Date.now() - start,
    }
  }

  if (!eventsSummary) {
    return {
      name: 'signal_review',
      status: 'pass',
      flags: [],
      counts: { events_reviewed: 0, anomalies_found: 0 },
      duration_ms: Date.now() - start,
    }
  }

  // Ask Ollama to review
  const prompt = `You are reviewing the last ${LOOKBACK_HOURS} hours of system events from a personal OS (LepiOS). Identify any anomalies, unexpected patterns, or issues that warrant attention.

Events:
${eventsSummary}

Format your response as a numbered list of issues found. If no issues, say "No anomalies detected."`

  let ollamaText: string
  let confidence: number

  try {
    const result = await generate(prompt, { task: 'analysis', timeoutMs: GENERATE_TIMEOUT_MS })
    ollamaText = result.text
    confidence = result.confidence
  } catch (err) {
    if (err instanceof OllamaUnreachableError) {
      const causeIsAbort =
        err.cause instanceof Error &&
        (err.cause.name === 'AbortError' || err.cause.message.includes('aborted'))
      const msgStr = err.cause instanceof Error ? err.cause.message : ''
      const isTimeout = causeIsAbort || msgStr.includes('timed out')

      if (isTimeout) {
        flags.push({
          severity: 'warn',
          message: `Ollama generate timed out after ${GENERATE_TIMEOUT_MS / 1000}s — signal_review degraded`,
          entity_type: 'ollama',
        })
      } else {
        flags.push({
          severity: 'warn',
          message: `skipped — Ollama unreachable`,
          entity_type: 'ollama',
        })
      }
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      flags.push({ severity: 'warn', message: `Ollama error: ${msg}`, entity_type: 'ollama' })
    }
    return {
      name: 'signal_review',
      status: 'warn',
      flags,
      counts: { events_reviewed: eventCount },
      duration_ms: Date.now() - start,
    }
  }

  // Confidence gate
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    flags.push({
      severity: 'warn',
      message: `Ollama confidence below threshold (${confidence.toFixed(2)}): response treated as inconclusive`,
      entity_type: 'ollama',
    })
    return {
      name: 'signal_review',
      status: 'warn',
      flags,
      counts: { events_reviewed: eventCount, confidence_score: Math.round(confidence * 100) },
      duration_ms: Date.now() - start,
    }
  }

  // Parse anomaly lines from response
  const lower = ollamaText.toLowerCase()
  if (!lower.includes('no anomal') && !lower.includes('no issues')) {
    const anomalyLines = ollamaText
      .split('\n')
      .filter((line) => /^\s*\d+[.)]\s/.test(line) || /^\s*[-*•]\s/.test(line))
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    for (const line of anomalyLines) {
      flags.push({ severity: 'warn', message: line.slice(0, 300), entity_type: 'ollama_signal' })
    }
  }

  return {
    name: 'signal_review',
    status: 'pass',
    flags,
    counts: { events_reviewed: eventCount, anomalies_found: flags.length },
    duration_ms: Date.now() - start,
  }
}
