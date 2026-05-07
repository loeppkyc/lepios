import { createServiceClient } from '@/lib/supabase/service'
import { askOllama } from '@/lib/llm/ollama'
import { saveKnowledge } from '@/lib/knowledge/client'
import type { CheckResult } from '../types'

const LOOK_BACK_HOURS = 24
const MAX_MESSAGES_PER_CONV = 40
const MAX_CONVS = 10

const EXTRACT_SYSTEM = `Extract factual, self-referential statements from this conversation between Colin (user) and his AI assistant.
Return only statements that describe Colin's preferences, decisions, principles, or facts about him.
Format: one fact per line, starting with "Colin ". Return at most 5 facts.
Skip pleasantries, tool outputs, and assistant-generated text. If there are no clear facts, return nothing.`

export async function checkChatSummarize(): Promise<CheckResult> {
  const start = Date.now()
  const counts: Record<string, number> = { conversations_scanned: 0, facts_saved: 0 }
  const flags: CheckResult['flags'] = []

  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - LOOK_BACK_HOURS * 3_600_000).toISOString()

    const { data: convs, error: convErr } = await db
      .from('conversations')
      .select('id, title')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(MAX_CONVS)

    if (convErr) throw new Error(convErr.message)
    if (!convs || convs.length === 0) {
      return {
        name: 'chat_summarize',
        status: 'pass',
        flags,
        counts,
        duration_ms: Date.now() - start,
      }
    }

    for (const conv of convs as { id: string; title: string | null }[]) {
      counts.conversations_scanned++

      const { data: msgs } = await db
        .from('messages')
        .select('role, content')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES_PER_CONV)

      if (!msgs || msgs.length === 0) continue

      const transcript = (msgs as { role: string; content: unknown[] }[])
        .map((m) => {
          const parts = Array.isArray(m.content) ? m.content : []
          const text = parts
            .filter(
              (p): p is { type: string; text?: string } =>
                p !== null && typeof p === 'object' && 'type' in p
            )
            .filter((p) => p.type === 'text')
            .map((p) => p.text ?? '')
            .join('')
          return text ? `${m.role}: ${text}` : null
        })
        .filter(Boolean)
        .join('\n')

      if (!transcript.trim()) continue

      const ollamaResult = await askOllama(
        `Conversation:\n${transcript}\n\nExtract self-referential facts about Colin:`,
        { system: EXTRACT_SYSTEM }
      )

      if (!ollamaResult) {
        flags.push({
          severity: 'warn',
          message: 'Ollama unreachable — chat summarization skipped',
          entity_type: 'ollama',
        })
        break
      }

      const facts = ollamaResult.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.toLowerCase().startsWith('colin ') && l.length > 10)

      for (const fact of facts) {
        await saveKnowledge('principle', 'chat_summary', fact, {
          context: conv.title ?? undefined,
          tags: ['chat_derived'],
          confidence: ollamaResult.confidence,
        })
        counts.facts_saved++
      }
    }

    return {
      name: 'chat_summarize',
      status: flags.some((f) => f.severity === 'critical') ? 'fail' : 'pass',
      flags,
      counts,
      duration_ms: Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      name: 'chat_summarize',
      status: 'fail',
      flags: [{ severity: 'critical', message: msg, entity_type: 'check' }],
      counts,
      duration_ms: Date.now() - start,
    }
  }
}
