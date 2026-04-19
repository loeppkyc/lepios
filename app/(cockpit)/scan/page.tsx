import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ScannerClient = dynamicImport(
  () => import('./_components/ScannerClient').then((m) => ({ default: m.ScannerClient })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          padding: '24px 16px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
        }}
      >
        Loading scanner…
      </div>
    ),
  }
)

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <ScannerClient />
}
