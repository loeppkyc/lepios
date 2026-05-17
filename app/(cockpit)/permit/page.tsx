import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PermitPreScreener } from './_components/PermitPreScreener'

export const dynamic = 'force-dynamic'

export default async function PermitPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 font-[var(--font-ui)] text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Building Permit Pre-Screener
        </h1>
        <p className="mt-1 font-[var(--font-ui)] text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Edmonton property lookup · Tax class · Permit guidance
        </p>
      </div>
      <PermitPreScreener />
    </div>
  )
}
