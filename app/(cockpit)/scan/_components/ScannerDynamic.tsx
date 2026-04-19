'use client'

import dynamic from 'next/dynamic'

const ScannerClient = dynamic(
  () => import('./ScannerClient').then((m) => ({ default: m.ScannerClient })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          maxWidth: 520,
          margin: '0 auto',
          padding: '24px 16px',
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-small)',
          color: 'var(--color-text-muted)',
        }}
      >
        Loading scanner…
      </div>
    ),
  }
)

export function ScannerDynamic() {
  return <ScannerClient />
}
