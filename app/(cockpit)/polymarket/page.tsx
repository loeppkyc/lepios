// F18: bench=polymarket_load<500ms; surface=polymarket_predictions row count
// module_metric: polymarket_predictions WHERE user_id = auth.uid()
import { PolymarketPage } from './_components/PolymarketPage'

export const metadata = { title: 'Polymarket — LepiOS' }
export default function Page() {
  return <PolymarketPage />
}
