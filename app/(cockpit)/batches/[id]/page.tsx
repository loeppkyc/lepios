import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BatchDetailClient } from './_components/BatchDetailClient'

export const dynamic = 'force-dynamic'

export default async function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <BatchDetailClient batchId={id} />
}
