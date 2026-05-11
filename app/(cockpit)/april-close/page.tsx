// F18: bench=bookkeeping completeness vs accountant sign-off; surface=april-close page reconciliation gaps
import { AprilClosePage } from './_components/AprilClosePage'
import { logEvent } from '@/lib/knowledge/client'

export const metadata = { title: 'April 2026 Close — LepiOS' }

export default async function Page() {
  await logEvent('bookkeeping', 'april_close_view')
  return <AprilClosePage />
}
