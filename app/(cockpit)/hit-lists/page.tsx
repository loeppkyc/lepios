import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HitListClient } from './_components/HitListClient'

export const dynamic = 'force-dynamic'

export default async function HitListsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <HitListClient />
}
