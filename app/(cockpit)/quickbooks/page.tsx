// F18: bench=QBO account balance accuracy vs QBO web app; surface=quickbooks page balance totals
import { QuickBooksPage } from './_components/QuickBooksPage'

export const metadata = { title: 'QuickBooks — LepiOS' }

export default function Page() {
  return <QuickBooksPage />
}
