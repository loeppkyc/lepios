// F18: bench=tax_return_load_latency<400ms; surface=tax-return page views in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { TaxReturnClient } from './_components/TaxReturnClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tax Return — LepiOS' }

export default async function TaxReturnPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('tax-return', 'page.viewed', { actor: 'user', status: 'success' })

  const currentYear = new Date().getFullYear()

  const { data: docs } = await supabase
    .from('tax_return_docs')
    .select('*')
    .order('doc_type', { ascending: true })

  return <TaxReturnClient initialDocs={docs ?? []} defaultYear={currentYear} />
}
