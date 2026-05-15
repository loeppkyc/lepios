import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ScanSettingsClient } from './_components/ScanSettingsClient'

export const dynamic = 'force-dynamic'

export default async function ScanSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <ScanSettingsClient />
}
