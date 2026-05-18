// F17: Synthesis Engine — epistemic environment signals feed Twin corpus (v2 calibration loop).
// F18: bench=synthesis completion rate ≥80% within 24h; surface=agent_events domain='synthesis'.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SynthesisClient } from './_components/SynthesisClient'

export const dynamic = 'force-dynamic'

interface DebateRow {
  id: string
  source: 'reddit' | 'hn'
  url: string
  title: string
  controversy_score: number
  domain: string
  side_a_summary: string | null
  side_b_summary: string | null
  resolution_text: string | null
  synthesis_text: string | null
  synthesized_at: string | null
}

export default async function SynthesisPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceClient()

  const { data: debates } = await service
    .from('synthesis_debates')
    .select(
      'id, source, url, title, controversy_score, domain, side_a_summary, side_b_summary, resolution_text, synthesis_text, synthesized_at'
    )
    .eq('synthesis_status', 'done')
    .order('synthesized_at', { ascending: false })
    .limit(50)

  const { count: pendingCount } = await service
    .from('synthesis_debates')
    .select('id', { count: 'exact', head: true })
    .eq('synthesis_status', 'pending')

  return (
    <div className="min-h-screen bg-[var(--color-base)] p-6">
      <div className="mb-6 h-[2px] bg-[var(--color-rail)] shadow-[0_0_12px_var(--color-rail-glow)]" />
      <div className="mb-6">
        <h1 className="m-0 text-[length:var(--text-heading)] font-semibold text-[var(--color-text-primary)]">
          Synthesis Engine
        </h1>
        <p className="mt-1 text-[length:var(--text-small)] tracking-wider text-[var(--color-text-muted)]">
          {(debates ?? []).length} resolved · {pendingCount ?? 0} pending
        </p>
      </div>
      <SynthesisClient initialDebates={(debates ?? []) as DebateRow[]} />
    </div>
  )
}
