import { createServiceClient } from '@/lib/supabase/service'

// F18: Chat UI tool bridge observability — morning_digest summary line.
// Counts tool calls + denials in the last 24h from agent_events + agent_actions.
// Never throws — returns 'Chat UI: stats unavailable' on any error.

export async function buildChatUiDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const [callsResult, deniesResult] = await Promise.all([
      db
        .from('agent_events')
        .select('action', { count: 'exact', head: true })
        .eq('domain', 'chat_ui')
        .in('action', ['chat_ui.tool.ok', 'chat_ui.tool.error', 'chat_ui.tool.timeout'])
        .gte('occurred_at', since),
      db
        .from('agent_actions')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', 'chat_ui')
        .eq('result', 'denied')
        .gte('occurred_at', since),
    ])

    const toolCalls = callsResult.count ?? 0
    const denies = deniesResult.count ?? 0

    if (toolCalls === 0 && denies === 0) return 'Chat UI (24h): no tool calls'

    return `Chat UI (24h): ${toolCalls} tool calls, ${denies} denies`
  } catch {
    return 'Chat UI: stats unavailable'
  }
}
