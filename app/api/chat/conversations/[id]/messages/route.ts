import { createClient } from '@/lib/supabase/server'
import {
  getConversationOwner,
  loadConversationMessages,
} from '@/lib/orb/persistence'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const ownerId = await getConversationOwner(id)
  if (ownerId !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const messages = await loadConversationMessages(id)
  return Response.json(messages)
}
