import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const revalidate = 0

const SYSTEM_PROMPT =
  "You are Colin's personal life and business coach. Be direct, practical, and results-focused."

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    session_id?: string
    message?: string
  }

  const { session_id, message } = body
  if (!session_id || !message?.trim()) {
    return NextResponse.json({ error: 'session_id and message are required' }, { status: 400 })
  }

  // Fetch session to get message history
  const { data: session, error: fetchErr } = await supabase
    .from('ai_coach_sessions')
    .select('id, messages')
    .eq('id', session_id)
    .single()

  if (fetchErr || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const existingMessages: Message[] = Array.isArray(session.messages) ? session.messages : []

  // Build messages for Anthropic
  const anthropicMessages = [
    ...existingMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message.trim() },
  ]

  // Call Anthropic
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let assistantContent = ''
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages,
    })
    const block = response.content[0]
    assistantContent = block.type === 'text' ? block.text : ''
  } catch (err) {
    return NextResponse.json({ error: `Anthropic API error: ${String(err)}` }, { status: 502 })
  }

  const now = new Date().toISOString()
  const updatedMessages: Message[] = [
    ...existingMessages,
    { role: 'user', content: message.trim(), timestamp: now },
    { role: 'assistant', content: assistantContent, timestamp: now },
  ]

  // Derive a title from first user message if still default
  const isDefaultTitle = !session_id || existingMessages.length === 0
  const newTitle = isDefaultTitle
    ? message.trim().slice(0, 60) + (message.trim().length > 60 ? '…' : '')
    : undefined

  const updatePayload: Record<string, unknown> = {
    messages: updatedMessages,
    updated_at: now,
  }
  if (newTitle) updatePayload.title = newTitle

  await supabase.from('ai_coach_sessions').update(updatePayload).eq('id', session_id)

  return NextResponse.json({
    message: assistantContent,
    title: newTitle ?? null,
  })
}
