import { createClient } from '@/lib/supabase/server'
import { archiveConversation, getConversationOwner } from '@/lib/orb/persistence'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response(null, { status: 401 })

  const { id } = await params
  const owner = await getConversationOwner(id)
  if (owner !== user.id) return new Response(null, { status: 403 })

  await archiveConversation(id, user.id)
  return new Response(null, { status: 204 })
}
