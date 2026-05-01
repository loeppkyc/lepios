import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listPalletInvoices, sumPalletSpendLast12Months } from '@/lib/pallets/queries'
import { PalletInvoiceForm } from './_components/PalletInvoiceForm'
import { PalletInvoiceTable } from './_components/PalletInvoiceTable'

export const dynamic = 'force-dynamic'

export default async function PalletsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [invoices, last12Total] = await Promise.all([
    listPalletInvoices(24),
    sumPalletSpendLast12Months(),
  ])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-base)', padding: '24px' }}>
      {/* Cockpit top rail */}
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Pallets
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          Monthly pallet invoices · gross spend tracking
        </p>
      </div>

      {/* Invoice form */}
      <PalletInvoiceForm />

      {/* Invoices table + total tile */}
      <div style={{ marginTop: 24 }}>
        <PalletInvoiceTable invoices={invoices} last12Total={last12Total} />
      </div>
    </div>
  )
}
