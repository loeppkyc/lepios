import { createServiceClient } from '@/lib/supabase/service'

// Lightweight Postgres-backed trace/span/generation API matching Langfuse SDK semantics.
// Writes directly to the langfuse schema via service role client (bypasses RLS).
// Stub: swap the createServiceClient() calls for the real Langfuse SDK if Colin
// migrates to docker-hosted Langfuse later — the function signatures stay identical.

export interface TraceParams {
  name: string
  userId?: string
  metadata?: Record<string, unknown>
}

export interface GenerationParams {
  name: string
  model: string
  input: unknown
  output?: unknown
  promptTokens?: number
  completionTokens?: number
  latencyMs?: number
}

// Starts a trace and returns its UUID.
export async function startTrace(params: TraceParams): Promise<string> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .schema('langfuse')
    .from('traces')
    .insert({
      name: params.name,
      user_id: params.userId ?? 'system',
      metadata: params.metadata ?? null,
      start_time: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`langfuse.startTrace: ${error.message}`)
  return (data as { id: string }).id
}

// Adds a generation observation to an existing trace. Returns the observation UUID.
// Sets started_at = now() - latencyMs and ended_at = now() when latencyMs is provided,
// so the timeline reflects when the LLM call actually occurred relative to the call site.
export async function addGeneration(traceId: string, params: GenerationParams): Promise<string> {
  const supabase = createServiceClient()
  const endedAt = new Date()
  const startedAt =
    params.latencyMs != null ? new Date(endedAt.getTime() - params.latencyMs) : endedAt

  const { data, error } = await supabase
    .schema('langfuse')
    .from('observations')
    .insert({
      trace_id: traceId,
      type: 'generation',
      name: params.name,
      model: params.model,
      input: params.input ?? null,
      output: params.output ?? null,
      prompt_tokens: params.promptTokens ?? null,
      completion_tokens: params.completionTokens ?? null,
      latency_ms: params.latencyMs ?? null,
      started_at: startedAt.toISOString(),
      ended_at: params.latencyMs != null ? endedAt.toISOString() : null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`langfuse.addGeneration: ${error.message}`)
  return (data as { id: string }).id
}

// Closes a trace by stamping end_time.
export async function endTrace(traceId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .schema('langfuse')
    .from('traces')
    .update({ end_time: new Date().toISOString() })
    .eq('id', traceId)

  if (error) throw new Error(`langfuse.endTrace: ${error.message}`)
}
