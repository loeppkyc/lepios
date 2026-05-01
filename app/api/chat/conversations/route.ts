import { createClient } from '@/lib/supabase/server'
import { listConversations } from '@/lib/orb/persistence'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const conversations = await listConversations(user.id)
  return Response.json(conversations)
}
