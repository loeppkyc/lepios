// F18: bench=calibration_page_load<1s; surface=gate_status per domain in trust_state
// module_metric: predictions WHERE resolved_at IS NOT NULL AND domain IN ('trading','sports')
import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamicConfig = 'force-dynamic'

const CalibrationPage = dynamic(() =>
  import('./_components/CalibrationPage').then((m) => m.CalibrationPage)
)

export const metadata = { title: 'Calibration — LepiOS' }

export default async function Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <CalibrationPage />
}
