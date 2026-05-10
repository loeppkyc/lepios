// F18: bench=deal_tracker_load<500ms; surface=deal_tracker_items row count
// module_metric: deal_tracker_items WHERE user_id = auth.uid()
import { DealTrackerPage } from './_components/DealTrackerPage'

export const metadata = { title: 'Deal Tracker — LepiOS' }
export default function Page() {
  return <DealTrackerPage />
}
