import { streamText, convertToModelMessages } from 'ai'
import { createOllama } from 'ollama-ai-provider'
import type { LanguageModel } from 'ai'
import { LEPIOS_SYSTEM_PROMPT } from '@/lib/orb/identity'
import { createClient } from '@/lib/supabase/server'
import {
  createConversation,
  appendMessage,
  getConversationOwner,
  type MessagePart,
} from '@/lib/orb/persistence'
import { buildTools } from '@/lib/orb/tools/registry'
import { buildSessionDigest } from '@/lib/memory/session-digest'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const MODEL = process.env.OLLAMA_CHAT_MODEL ?? 'qwen2.5-coder:3b'

const ollamaProvider = createOllama({ baseURL: `${OLLAMA_BASE_URL}/api` })

type IncomingMessage = { role: string; parts?: MessagePart[] }

function partsText(parts: MessagePart[] | undefined): string {
  if (!parts) return ''
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text ?? '')
    .join('')
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { messages, conversationId: incomingId } = (await req.json()) as {
    messages: IncomingMessage[]
    conversationId?: string | null
  }
  const t0 = Date.now()

  const userMsg = messages.at(-1)
  const userText = partsText(userMsg?.parts)

  let conversationId: string
  let isNew = false
  if (!incomingId) {
    const conv = await createConversation(user.id, userText.slice(0, 50) || undefined)
    conversationId = conv.id
    isNew = true
  } else {
    const ownerId = await getConversationOwner(incomingId)
    if (ownerId !== user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    conversationId = incomingId
  }

  await appendMessage(
    conversationId,
    'user',
    userMsg?.parts ?? [{ type: 'text', text: userText }],
  )

  // On new conversations: inject session digest into system prompt (spec A2).
  // 3s timeout — never blocks session start (spec acceptance E).
  let systemPrompt = LEPIOS_SYSTEM_PROMPT
  if (isNew) {
    try {
      const digest = await Promise.race([
        buildSessionDigest({ requested_by: 'chat_ui', topic: userText.slice(0, 100) || undefined }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])
      if (digest) {
        systemPrompt = `${LEPIOS_SYSTEM_PROMPT}\n\n---\n${digest.markdown}`
      }
    } catch {
      // digest unavailable — continue with base system prompt
    }
  }

  const result = streamText({
    // ollama-ai-provider@1.x returns LanguageModelV1; ai@6 expects V2/V3.
    // Cast through unknown to bridge the provider version gap at type level only.
    model: ollamaProvider(MODEL) as unknown as LanguageModel,
    system: systemPrompt,
    messages: await convertToModelMessages(
      messages as Parameters<typeof convertToModelMessages>[0],
    ),
    temperature: 0.7,
    tools: buildTools({
      agentId: 'chat_ui',
      conversationId,
      userId: user.id,
      toolCallId: '',
    }),
    toolChoice: 'auto',
    onFinish: async ({ text, usage, finishReason }) => {
      const totalTokens =
        (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) || undefined
      await appendMessage(
        conversationId,
        'assistant',
        [{ type: 'text', text }],
        MODEL,
        totalTokens,
      )
      console.log(
        '[orb-chat]',
        JSON.stringify({
          ts: new Date().toISOString(),
          model: MODEL,
          conversation_id: conversationId,
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          duration_ms: Date.now() - t0,
          finish_reason: finishReason,
        }),
      )
    },
  })

  const streamResponse = result.toUIMessageStreamResponse()
  if (!isNew) return streamResponse

  const headers = new Headers(streamResponse.headers)
  headers.set('X-Conversation-Id', conversationId)
  return new Response(streamResponse.body, {
    status: streamResponse.status,
    statusText: streamResponse.statusText,
    headers,
  })
}
