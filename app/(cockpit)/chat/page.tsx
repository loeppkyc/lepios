import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/orb/persistence'
import { ChatClient, type ConversationSummary } from './_components/ChatClient'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/chat')

  const conversations = await listConversations(user.id)
  const initialConversations: ConversationSummary[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    message_count: c.message_count,
    updated_at: c.updated_at,
  }))

  return <ChatClient initialConversations={initialConversations} />
}
