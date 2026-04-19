import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ScannerClient } from './_components/ScannerClient'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <ScannerClient />
}
