import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  listPalletInvoices,
  sumPalletSpendLast12Months,
  listActivePalletsWithScanCount,
  listClosedPalletsAwaitingAp,
  listSettledPalletsWithAp,
  listDonatedBooks,
} from '@/lib/pallets/queries'
import { PalletInvoiceForm } from './_components/PalletInvoiceForm'
import { PalletInvoiceTable } from './_components/PalletInvoiceTable'
import { PalletIntakeForm } from './_components/PalletIntakeForm'
import { ActivePalletsList } from './_components/ActivePalletsList'
import { PalletApSection } from './_components/PalletApSection'
import { DonateLog } from './_components/DonateLog'

export const dynamic = 'force-dynamic'

export default async function PalletsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [invoices, last12Total, activePallets, closedPallets, settledPallets, donatedBooks] =
    await Promise.all([
      listPalletInvoices(24),
      sumPalletSpendLast12Months(),
      listActivePalletsWithScanCount(),
      listClosedPalletsAwaitingAp(),
      listSettledPalletsWithAp(10),
      listDonatedBooks(30),
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
          Pallet intake · active pallets · monthly invoices
        </p>
      </div>

      {/* Sub-module 1: pallet intake form */}
      <PalletIntakeForm />

      {/* Active pallets list */}
      <div className="mt-4">
        <ActivePalletsList pallets={activePallets} />
      </div>

      {/* Sub-module 2: AP settlement (closed pallets + settled history) */}
      <div className="mt-4">
        <PalletApSection closedPallets={closedPallets} settledPallets={settledPallets} />
      </div>

      {/* Sub-module 8: donate log */}
      {donatedBooks.length > 0 && (
        <div className="mt-4">
          <DonateLog books={donatedBooks} />
        </div>
      )}

      <hr className="border-border my-6" />

      {/* Invoice form (legacy gross-spend tracker) */}
      <PalletInvoiceForm />

      {/* Invoices table + total tile */}
      <div style={{ marginTop: 24 }}>
        <PalletInvoiceTable invoices={invoices} last12Total={last12Total} />
      </div>
    </div>
  )
}
