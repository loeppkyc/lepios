import { createServiceClient } from '@/lib/supabase/service'

export type MessagePart = { type: string; text?: string }

export type Conversation = {
  id: string
  user_id: string
  title: string | null
  message_count: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ChatMessage = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: MessagePart[]
  model: string | null
  tokens_used: number | null
  created_at: string
}

export async function createConversation(
  userId: string,
  title?: string,
): Promise<Conversation> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('conversations')
    .insert({ user_id: userId, title: title ?? null })
    .select()
    .single()
  if (error) throw error
  return data as Conversation
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('conversations')
    .select('id, user_id, title, message_count, created_at, updated_at, archived_at')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Conversation[]
}

export async function getConversationOwner(conversationId: string): Promise<string | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .maybeSingle()
  return (data?.user_id as string | undefined) ?? null
}

export async function appendMessage(
  conversationId: string,
  role: ChatMessage['role'],
  content: MessagePart[],
  model?: string,
  tokensUsed?: number,
): Promise<ChatMessage> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      model: model ?? null,
      tokens_used: tokensUsed ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as ChatMessage
}

export async function loadConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, role, content, model, tokens_used, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}
