// F18: bench=archive_items_count vs prior month; surface=Archive KPI tile
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { ArchiveClient } from './_components/ArchiveClient'

export const metadata = { title: 'Personal Archive -- LepiOS' }
export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('archive', 'page.viewed', { actor: user.id, status: 'success', entity: 'archive' })
  return <ArchiveClient />
}