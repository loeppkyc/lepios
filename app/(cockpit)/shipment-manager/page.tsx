// F18-EXEMPT: Shipment Manager is an operational hub — metric is shipment plan creation
// success rate (ShipmentId returned from SP-API). No behavioral signal.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ShipmentManagerClient } from './_components/ShipmentManagerClient'

export const dynamic = 'force-dynamic'

export default async function ShipmentManagerPage() {
  // F-N5: server component auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
          Shipment Manager
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
          Create Amazon FBA inbound shipment plans · Print FNSKU labels
        </p>
      </div>

      {/* Client component */}
      <ShipmentManagerClient />
    </div>
  )
}
