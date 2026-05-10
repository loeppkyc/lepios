import { Suspense } from 'react'
import { ScannerPhonePage } from './_components/ScannerPhonePage'

export const metadata = { title: 'Book Scanner' }
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-gray-400">
          Loading scanner…
        </div>
      }
    >
      <ScannerPhonePage />
    </Suspense>
  )
}
