// F18: benchmark=total_build_cost_vs_budget; surface=/systems/hardware

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HardwareTable } from './_components/HardwareTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PC Build — LepiOS' }

export interface HardwareComponent {
  id: string
  name: string
  category: string
  status: string
  budget_cad: number | null
  actual_cad: number | null
  product_url: string | null
  notes: string | null
  added_at: string
  updated_at: string
}

export default async function HardwarePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('hardware_components')
    .select('id, name, category, status, budget_cad, actual_cad, product_url, notes, added_at, updated_at')
    .order('added_at', { ascending: false })

  const initialComponents: HardwareComponent[] = error ? [] : (data ?? [])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <a href="/systems" className="label-caps text-muted-foreground hover:text-foreground transition-colors text-xs">
          ← Systems
        </a>
        <h1 className="label-caps mt-2">PC Build</h1>
        <p className="text-muted-foreground/70 text-sm mt-1">Hardware component tracker — budget vs actual</p>
      </div>

      <HardwareTable initialComponents={initialComponents} />
    </div>
  )
}
