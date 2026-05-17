// F18: bench=pending_transactions rows by account vs. expected accounts; surface=account coverage chips on this page
import { StatementLinesClient } from './_components/StatementLinesClient'

export const metadata = { title: 'Statement Lines — LepiOS' }

export default function StatementLinesPage() {
  return <StatementLinesClient />
}
