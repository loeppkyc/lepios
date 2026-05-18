// F18: bench=projects_completed_monthly vs prior month; surface=3D Printer KPI tile
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { PrinterClient } from './_components/PrinterClient'

export const metadata = { title: '3D Printer HQ -- LepiOS' }
export const dynamic = 'force-dynamic'

export default async function PrinterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('3d-printer', 'page.viewed', { actor: user.id, status: 'success', entity: '3d-printer' })
  return <PrinterClient />
}