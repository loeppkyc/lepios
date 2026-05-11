// F18: bench=repricer_rules_load<400ms; surface=repricer_rules row count + last reprice event
// module_metric: repricer_rules WHERE enabled=true
import { RepricerPage } from './_components/RepricerPage'

export const metadata = { title: 'Repricer — LepiOS' }
export default function Page() {
  return <RepricerPage />
}
