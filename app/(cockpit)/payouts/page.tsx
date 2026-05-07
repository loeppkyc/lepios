// F18: bench=BENCHMARK_MONTHLY_NET_CAD (lib/payouts/benchmark.ts); surface=PaceBadge widget at top of PayoutsPage
// Capture: agent_events 'payouts.viewed' on every API fetch — see app/api/payouts/route.ts.
import { PayoutsPage } from './_components/PayoutsPage'

export const metadata = { title: 'Amazon Payouts — LepiOS' }

export default function Page() {
  return <PayoutsPage />
}
