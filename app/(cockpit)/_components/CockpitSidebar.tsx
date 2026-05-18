'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useDevMode } from '@/lib/hooks/useDevMode'
import { HeartbeatTile } from './HeartbeatTile'
import { PageProfitTile } from './PageProfitTile'

interface NavItem {
  label: string
  href: string | null
}

interface NavSection {
  id: string
  label: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    items: [
      { label: 'Business Review', href: '/business-review' },
      { label: 'Money', href: '/money' },
      { label: 'Position', href: '/position' },
      { label: 'Life P&L', href: '/life-pnl' },
      { label: 'Net Worth', href: '/net-worth' },
      { label: 'Accounts', href: '/accounts' },
      { label: 'Annual Review', href: '/annual-review' },
    ],
  },
  {
    id: 'amazon',
    label: 'Amazon & Inventory',
    items: [
      { label: 'Amazon', href: '/amazon' },
      { label: 'PageProfit', href: '/scan' },
      { label: 'Shipment Manager', href: '/shipment-manager' },
      { label: 'Inventory', href: '/inventory' },
      { label: 'Repricer', href: '/repricer' },
      { label: 'FBA Batches', href: '/batches' },
      { label: 'Sales Charts', href: '/amazon-sales' },
      { label: 'Amazon Orders', href: '/amazon-orders' },
      { label: 'Amazon Legal', href: '/amazon-legal' },
      { label: 'Payouts', href: '/payouts' },
      { label: 'Inventory Spend', href: '/inventory-spend' },
    ],
  },
  {
    id: 'deals',
    label: 'Deals & Sourcing',
    items: [
      { label: 'Arbitrage Scanner', href: '/scan' },
      { label: 'Hit Lists', href: '/hit-lists' },
      { label: 'Pallets', href: '/pallets' },
      { label: 'Lego Vault', href: '/lego-vault' },
      { label: 'Keepa Intel', href: '/keepa-intel' },
      { label: 'Price Intel', href: '/price-intel' },
      { label: 'Retail HQ', href: '/retail-hq' },
      { label: 'Retail Radar', href: '/retail-radar' },
      { label: 'Retail Monitor', href: '/retail-monitor' },
      { label: 'Flyer Intel', href: '/flyer-intel' },
      { label: 'Deal Tracker', href: '/deal-tracker' },
      { label: 'Deal Watch', href: '/deal-watch' },
      { label: 'RA Scout', href: '/ra-scout' },
      { label: 'Cashback HQ', href: '/cashback-hq' },
      { label: 'Coupon Lady', href: '/coupons' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting & Tax',
    items: [
      { label: 'Bookkeeping Hub', href: '/bookkeeping-hub' },
      { label: 'Reconcile (auto)', href: '/bookkeeping/reconcile' },
      { label: 'QB Export', href: '/bookkeeping/qb-export' },
      { label: 'QuickBooks', href: '/quickbooks' },
      { label: 'Monthly Expenses', href: '/monthly-expenses' },
      { label: 'Recurring Expenses', href: '/recurring' },
      { label: 'Import Statement', href: '/import' },
      { label: 'Statement Lines', href: '/statement-lines' },
      { label: 'Monthly P&L', href: '/monthly-pnl' },
      { label: 'Category P&L', href: '/cogs' },
      { label: 'Balance Sheet', href: '/balance-sheet' },
      { label: 'Receipts', href: '/receipts' },
      { label: 'Paper Trail', href: '/reconciliation' },
      { label: 'Bank Register', href: '/bank-register' },
      { label: 'Monthly Close', href: '/monthly-close' },
      { label: 'Tax Centre', href: '/tax-centre' },
      { label: 'GST Return', href: '/gst-return' },
      { label: 'Tax Return', href: '/tax-return' },
      { label: 'Mileage Log', href: '/mileage' },
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    items: [
      { label: 'eBay Listings', href: '/ebay-listings' },
      { label: 'Marketplace Hub', href: '/marketplace' },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    items: [
      { label: 'Trading Journal', href: '/trading' },
      { label: 'Sports Intel', href: '/sports-intel' },
      { label: 'Polymarket', href: '/polymarket' },
      { label: 'Prediction Engine', href: '/predictions' },
      { label: 'Sports Betting', href: '/sports-betting' },
      { label: 'Crypto', href: '/crypto' },
      { label: 'Calibration', href: '/calibration' },
    ],
  },
  {
    id: 'household',
    label: 'Household',
    items: [
      { label: 'Net Worth', href: '/net-worth' },
      { label: 'Personal Expenses', href: '/personal-expenses' },
      { label: 'Debt Payoff', href: '/debt-payoff' },
      { label: 'Retirement', href: '/retirement' },
      { label: 'Insurance', href: '/insurance' },
      { label: 'Cash Forecast', href: '/cash-forecast' },
      { label: 'Subscriptions', href: '/subscriptions' },
      { label: 'Savings Goals', href: '/savings-goals' },
      { label: 'Vehicles', href: '/vehicles' },
      { label: 'Permit Pre-Screener', href: '/permit' },
      { label: 'Utilities', href: '/utilities' },
      { label: 'Phone Plans', href: '/phone-plans' },
      { label: 'Groceries', href: '/diet' },
      { label: 'Grocery Finder', href: '/grocery-finder' },
    ],
  },
  {
    id: 'life',
    label: 'Life',
    items: [
      { label: 'Life Signals', href: '/signals' },
      { label: 'Health', href: '/health' },
      { label: 'Oura Health', href: '/oura' },
      { label: 'Focus', href: '/focus' },
      { label: 'Life Compass', href: '/life-compass' },
      { label: 'Calendar', href: '/calendar' },
      { label: 'Goals & Habits', href: '/goals' },
      { label: 'Family', href: '/family' },
      { label: "Cora's Future", href: '/coras-future' },
      { label: 'Pet Health', href: '/pet-health' },
      { label: '3D Printer HQ', href: '/3d-printer' },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Automation',
    items: [
      { label: 'Autonomous', href: '/autonomous' },
      { label: 'AI Control', href: '/ai-control' },
      { label: 'Chat', href: '/chat' },
      { label: 'AI Coach', href: '/ai-coach' },
      { label: 'Local AI', href: '/local-ai' },
      { label: 'Agent Swarm', href: '/agent-swarm' },
      { label: 'Automations', href: '/automations' },
      { label: 'Personal Archive', href: '/archive' },
      { label: 'Legal Advisor', href: '/legal' },
      { label: 'Dropbox Archiver', href: '/dropbox-archiver' },
      { label: 'GPU Day', href: '/gpu-day' },
      { label: 'GitHackers', href: '/git-hackers' },
      { label: 'Free Events', href: '/events' },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { label: 'Profile', href: '/profile' },
      { label: 'Notifications', href: '/notifications' },
      { label: 'Help Centre', href: '/help' },
      { label: 'Admin', href: '/admin' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { label: 'Status', href: '/status' },
      { label: 'Systems', href: '/systems' },
      { label: 'Utility', href: '/utility' },
      { label: 'Failures', href: '/failures' },
      { label: 'Command Centre', href: '/command-centre' },
      { label: 'Business History', href: '/business-history' },
      { label: 'Debug', href: '/debug' },
    ],
  },
]

const SIDEBAR_WIDTH = 240
const RAIL_WIDTH = 48

export function CockpitSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>(['dashboard'])
    for (const section of NAV_SECTIONS) {
      if (section.items.some((item) => item.href && pathname.startsWith(item.href))) {
        initial.add(section.id)
        break
      }
    }
    return initial
  })
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [devMode, toggleDevMode] = useDevMode()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function toggleSection(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside
      style={{
        width: open ? SIDEBAR_WIDTH : RAIL_WIDTH,
        minWidth: open ? SIDEBAR_WIDTH : RAIL_WIDTH,
        transition: 'width 0.2s ease, min-width 0.2s ease',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {!open ? (
        // Collapsed rail — just a hamburger
        <button
          onClick={() => setOpen(true)}
          title="Open menu"
          style={{
            width: RAIL_WIDTH,
            height: RAIL_WIDTH,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            fontSize: '1.1rem',
            flexShrink: 0,
          }}
        >
          ☰
        </button>
      ) : (
        <>
          {/* ── Header ── */}
          <div style={{ padding: '14px 14px 0', flexShrink: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display, var(--font-ui))',
                    fontWeight: 900,
                    fontSize: '1.05rem',
                    letterSpacing: '0.14em',
                    color: 'var(--color-accent-gold)',
                    textTransform: 'uppercase',
                    lineHeight: 1.1,
                  }}
                >
                  LOEPPKY
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '0.57rem',
                    letterSpacing: '0.22em',
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    marginTop: 3,
                  }}
                >
                  BUSINESS OS
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                title="Collapse sidebar"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-text-disabled)',
                  fontSize: '1.1rem',
                  padding: '2px 4px',
                  lineHeight: 1,
                  marginTop: 2,
                }}
              >
                ‹
              </button>
            </div>
            <div
              style={{
                height: 1,
                background: 'var(--color-accent-gold)',
                opacity: 0.45,
                marginBottom: 6,
              }}
            />
          </div>

          {/* ── Heartbeat tile ── */}
          <HeartbeatTile />

          {/* ── PageProfit tile ── */}
          <PageProfitTile />

          {/* ── Nav sections ── */}
          <nav
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '2px 0 8px',
            }}
          >
            {NAV_SECTIONS.map((section) => {
              const isExpanded = expanded.has(section.id)
              return (
                <div key={section.id}>
                  <button
                    onClick={() => toggleSection(section.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.6rem',
                        color: 'var(--color-text-disabled)',
                        width: 8,
                        flexShrink: 0,
                      }}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        color: 'var(--color-text-primary)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {section.label}
                    </span>
                  </button>

                  {isExpanded && (
                    <div style={{ paddingBottom: 2 }}>
                      {section.items.map((item) => {
                        const isActive = !!item.href && pathname === item.href
                        if (item.href) {
                          return (
                            <Link
                              key={item.label}
                              href={item.href}
                              style={{
                                display: 'block',
                                margin: '1px 8px',
                                padding: '5px 8px 5px 22px',
                                fontFamily: 'var(--font-ui)',
                                fontSize: 'var(--text-small)',
                                fontWeight: isActive ? 600 : 400,
                                color: isActive
                                  ? 'var(--color-accent-gold)'
                                  : 'var(--color-text-primary)',
                                textDecoration: 'none',
                                background: isActive ? 'var(--color-surface-2)' : 'none',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              {item.label}
                            </Link>
                          )
                        }
                        return (
                          <span
                            key={item.label}
                            style={{
                              display: 'block',
                              margin: '1px 8px',
                              padding: '5px 8px 5px 22px',
                              fontFamily: 'var(--font-ui)',
                              fontSize: 'var(--text-small)',
                              color: 'var(--color-text-disabled)',
                              userSelect: 'none',
                            }}
                          >
                            {item.label}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* ── Footer: email + sign out ── */}
          <div
            style={{
              padding: '10px 12px',
              borderTop: '1px solid var(--color-border)',
              flexShrink: 0,
            }}
          >
            {email ? (
              <div
                title={email}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-nano)',
                  color: 'var(--color-text-disabled)',
                  marginBottom: 8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </div>
            ) : (
              <Link
                href="/login"
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-nano)',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  color: 'var(--color-accent-gold)',
                  textDecoration: 'none',
                  marginBottom: 8,
                }}
              >
                Sign In
              </Link>
            )}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: devMode ? 'var(--color-text-muted)' : 'var(--color-text-disabled)',
                userSelect: 'none',
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={devMode}
                onChange={toggleDevMode}
                style={{ accentColor: 'var(--color-accent-gold)', cursor: 'pointer' }}
              />
              Dev Mode
            </label>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                width: '100%',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                padding: '5px 10px',
                background: 'none',
                color: signingOut ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: signingOut ? 'not-allowed' : 'pointer',
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
