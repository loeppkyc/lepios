// F18: bench=ra_scout_scans.profitable_count avg vs 0 baseline; surface=scans/wk + BUY rate in morning_digest
import { createClient } from '@/lib/supabase/server'
import RAScoutClient from './_components/RAScoutClient'
import { redirect } from 'next/navigation'
import { logEvent } from '@/lib/knowledge/client'

export const metadata = { title: 'RA Scout — LepiOS' }

export default async function RAScoutPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('ra-scout', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: recentScans } = await supabase
    .from('ra_scout_scans')
    .select('*')
    .eq('scanned_by', user.id)
    .order('scanned_at', { ascending: false })
    .limit(10)

  return <RAScoutClient recentScans={recentScans ?? []} />
}
