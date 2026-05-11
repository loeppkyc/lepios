// F18: bench=retail_hq_deals_load<600ms; surface=deals row count + avg_roi_pct
// module_metric: deals WHERE found_date >= now()-interval '30 days'
import { RetailHQPage } from './_components/RetailHQPage'

export const metadata = { title: 'Retail HQ — LepiOS' }
export default function Page() {
  return <RetailHQPage />
}
