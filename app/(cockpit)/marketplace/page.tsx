// F18: bench=marketplace_load<500ms; surface=marketplace_listings active count
// module_metric: marketplace_listings WHERE ebay_status='active' OR fb_status='active' OR kijiji_status='active'
import { MarketplacePage } from './_components/MarketplacePage'

export const metadata = { title: 'Marketplace Hub — LepiOS' }
export default function Page() {
  return <MarketplacePage />
}
