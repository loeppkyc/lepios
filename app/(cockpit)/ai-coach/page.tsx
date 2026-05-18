// F17: AI Coach feeds behavioral ingestion — coaching themes → path probability engine.
// F18: bench=sessions_per_week; surface=AiCoachClient session count badge.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { AiCoachClient } from './_components/AiCoachClient'

export const dynamic = 'force-dynamic'

export default async function AiCoachPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load recent sessions server-side for initial render
  const { data: sessions } = await supabase
    .from('ai_coach_sessions')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(20)

  await logEvent('ai-coach', 'page.viewed', { actor: 'user', status: 'success' })

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          AI Coach
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          Personal life and business coaching · Direct · Practical · Results-focused
        </p>
      </div>
      <AiCoachClient initialSessions={sessions ?? []} />
    </div>
  )
}
