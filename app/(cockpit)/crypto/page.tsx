// F18: bench=crypto_load_latency<400ms; surface=crypto page views in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { CryptoClient } from './_components/CryptoClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crypto — LepiOS' }

export default async function CryptoPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('crypto', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: holdings } = await supabase
    .from('crypto_holdings')
    .select('*')
    .order('symbol', { ascending: true })

  return <CryptoClient initialHoldings={holdings ?? []} />
}
