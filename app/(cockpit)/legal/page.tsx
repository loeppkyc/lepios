// F17: Legal page — tracks contracts, compliance, IP; risk signals feed behavioral engine.
// F18: bench=open_legal_items_count; surface=LegalClient status header counts.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { LegalClient } from './_components/LegalClient'

export const dynamic = 'force-dynamic'

export default async function LegalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: items } = await supabase
    .from('legal_items')
    .select('*')
    .order('created_at', { ascending: false })

  await logEvent('legal', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Legal Advisor
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Contracts · Compliance · IP · Employment · Corporate matters
        </p>
      </div>
      <LegalClient initialItems={items ?? []} />
    </div>
  )
}
