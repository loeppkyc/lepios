import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ScannerDynamic } from './_components/ScannerDynamic'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <ScannerDynamic />
}
