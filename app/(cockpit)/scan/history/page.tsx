import { Suspense } from 'react'
import { ScanHistoryClient } from './_components/ScanHistoryClient'

export const metadata = { title: 'Scan History' }

export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ScanHistoryClient />
    </Suspense>
  )
}
