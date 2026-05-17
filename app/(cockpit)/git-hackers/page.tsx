// F18: bench=githackers_load<5s; surface=agent_events WHERE action='githackers_api_fetch'
// module_metric: latency_ms per tab, result_count per tab
import { GitHackersPage } from './_components/GitHackersPage'

export const metadata = { title: 'GitHackers — LepiOS' }

export default function Page() {
  return <GitHackersPage />
}
