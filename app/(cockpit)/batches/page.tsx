// F18-EXEMPT: FBA Batch Manager is an operational hub — metric is DB row count in fba_batch_items (SELECT COUNT(*) surfaced on this page). No behavioral signal; items-in-batch is the instrument.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BatchesClient } from './_components/BatchesClient'

export const dynamic = 'force-dynamic'

export default async function BatchesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <BatchesClient />
}
