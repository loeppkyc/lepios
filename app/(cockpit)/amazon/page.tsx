import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { OrdersRow } from '@/lib/amazon/orders-sync'
import type { SettlementRow } from '@/lib/amazon/reports'
import {
  aggregateForKpiRow,
  aggregateForDailyChart,
  aggregateForTopSellers,
  aggregateForStatusBreakdown,
} from '@/lib/amazon/reports'
import { AmazonKpiRow } from './_components/AmazonKpiRow'
import { AmazonDailyChart } from './_components/AmazonDailyChart'
import { AmazonTopSellersTable } from './_components/AmazonTopSellersTable'
import { AmazonSettlementsPanel } from './_components/AmazonSettlementsPanel'
import { AmazonStatusBreakdown } from './_components/AmazonStatusBreakdown'

export const dynamic = 'force-dynamic'

// ── Error card (matches business-review error pattern) ────────────────────────

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        padding: '20px 24px',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-small)',
        color: 'var(--color-critical)',
      }}
    >
      Failed to load Amazon data: {message}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AmazonReportsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()

  // Fetch window boundaries
  // Orders: last 60d (30d current + 30d prior for delta computation)
  const ordersAfter = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // Settlements: last 35d
  const settlementsAfter = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString()

  // Parallel fetch — orders and settlements are independent
  const [ordersResult, settlementsResult] = await Promise.allSettled([
    supabase
      .from('orders')
      .select(
        'id, order_date, asin, title, quantity, revenue_cad, status, marketplace, person_handle, fiscal_year, marketplace_fees, shipping_cost, cogs_cad, profit_cad, currency, _source'
      )
      .gte('order_date', ordersAfter)
      .order('order_date', { ascending: false }),
    supabase
      .from('amazon_settlements')
      .select(
        'id, period_start_at, period_end_at, net_payout, gross, fees_total, fund_transfer_status, currency'
      )
      .gte('period_end_at', settlementsAfter)
      .order('period_end_at', { ascending: false }),
  ])

  // Surface fetch errors as a visible card — never throw from a server page
  const ordersError =
    ordersResult.status === 'rejected'
      ? String(ordersResult.reason)
      : ordersResult.value.error?.message

  const settlementsError =
    settlementsResult.status === 'rejected'
      ? String(settlementsResult.reason)
      : settlementsResult.value.error?.message

  const orders =
    ordersResult.status === 'fulfilled' && !ordersResult.value.error
      ? (ordersResult.value.data as OrdersRow[])
      : []

  const settlements =
    settlementsResult.status === 'fulfilled' && !settlementsResult.value.error
      ? (settlementsResult.value.data as SettlementRow[])
      : []

  // Aggregate — pure functions, no I/O
  const kpiData = aggregateForKpiRow(orders, settlements, now)
  const chartData = aggregateForDailyChart(orders, now)
  const topSellers = aggregateForTopSellers(orders, now)
  const statusBreakdown = aggregateForStatusBreakdown(orders, now)

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
          Amazon Reports
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
          Last 30 days · Orders sync at 04:00 UTC · Settlements sync at 06:00 UTC
        </p>
      </div>

      {/* Data fetch errors — surface both independently */}
      {ordersError && <ErrorCard message={`Orders: ${ordersError}`} />}
      {settlementsError && (
        <div style={{ marginTop: ordersError ? 12 : 0 }}>
          <ErrorCard message={`Settlements: ${settlementsError}`} />
        </div>
      )}

      {/* KPI row */}
      <AmazonKpiRow data={kpiData} />

      {/* Daily chart */}
      <div style={{ marginTop: 24 }}>
        <AmazonDailyChart data={chartData} />
      </div>

      {/* Top sellers + status breakdown side by side on wide screens, stacked narrow */}
      <div
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 24,
        }}
      >
        <AmazonTopSellersTable data={topSellers} />
        <AmazonStatusBreakdown data={statusBreakdown} />
      </div>

      {/* Settlements panel */}
      <div style={{ marginTop: 24 }}>
        <AmazonSettlementsPanel data={settlements} />
      </div>
    </div>
  )
}
