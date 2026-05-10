// F18: bench=Streamlit_flyer_search_latency<3s; surface=agent_events flyer-intel.search + morning_digest scan count
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { FlyerIntelClient } from './_components/FlyerIntelClient'

export const dynamic = 'force-dynamic'

export default async function FlyerIntelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('flyer-intel', 'page.viewed', { actor: 'user', status: 'success' })
  return <FlyerIntelClient />
}
