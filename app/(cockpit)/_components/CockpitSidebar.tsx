'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useDevMode } from '@/lib/hooks/useDevMode'

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
      { label: 'Life P&L', href: '/money' },
      { label: 'Trading Journal', href: null },
      { label: 'Sports Betting', href: null },
    ],
  },
  {
    id: 'amazon',
    label: 'Amazon & Inventory',
    items: [
      { label: 'Amazon', href: '/amazon' },
      { label: 'PageProfit', href: null },
      { label: 'Shipment Manager', href: null },
      { label: 'Inventory', href: '/inventory' },
      { label: 'Repricer', href: null },
      { label: 'Sales Charts', href: null },
      { label: 'Amazon Orders', href: null },
      { label: 'Payouts', href: null },
      { label: 'Inventory Spend', href: null },
    ],
  },
  {
    id: 'deals',
    label: 'Deals & Sourcing',
    items: [
      { label: 'Arbitrage Scanner', href: '/scan' },
      { label: 'Hit Lists', href: '/hit-lists' },
      { label: 'Pallets', href: '/pallets' },
      { label: 'Lego Vault', href: null },
      { label: 'Keepa Intel', href: null },
      { label: 'Retail HQ', href: null },
      { label: 'Cashback HQ', href: null },
      { label: 'Coupon Lady', href: null },
      { label: 'Retail Monitor', href: null },
      { label: 'Deal Tracker', href: null },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting & Tax',
    items: [
      { label: 'Bookkeeping Hub', href: '/bookkeeping-hub' },
      { label: 'Monthly Expenses', href: '/monthly-expenses' },
      { label: 'Recurring Expenses', href: '/recurring' },
      { label: 'Import Statement', href: '/import' },
      { label: 'Monthly P&L', href: null },
      { label: 'Category P&L', href: '/cogs' },
      { label: 'Receipts', href: '/receipts' },
      { label: 'Paper Trail', href: '/reconciliation' },
      { label: 'Monthly Close', href: null },
      { label: 'Tax Centre', href: '/tax-centre' },
      { label: 'GST Return', href: '/gst-return' },
      { label: 'Tax Return', href: null },
      { label: 'Mileage Log', href: '/mileage' },
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    items: [
      { label: 'eBay Listings', href: null },
      { label: 'Marketplace Hub', href: null },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    items: [
      { label: 'Crypto', href: null },
      { label: 'Prediction Engine', href: null },
    ],
  },
  {
    id: 'household',
    label: 'Household',
    items: [
      { label: 'Net Worth', href: null },
      { label: 'Personal Expenses', href: null },
      { label: 'Debt Payoff', href: null },
      { label: 'Retirement', href: null },
      { label: 'Insurance', href: null },
      { label: 'Cash Forecast', href: null },
      { label: 'Subscriptions', href: null },
      { label: 'Savings Goals', href: null },
      { label: 'Vehicles', href: null },
      { label: 'Utilities', href: null },
      { label: 'Phone Plans', href: null },
      { label: 'Groceries', href: null },
    ],
  },
  {
    id: 'life',
    label: 'Life',
    items: [
      { label: 'Health', href: null },
      { label: 'Oura Health', href: null },
      { label: 'Life Compass', href: null },
      { label: 'Calendar', href: null },
      { label: 'Goals & Habits', href: null },
      { label: 'Family', href: null },
      { label: "Cora's Future", href: null },
      { label: 'Pet Health', href: null },
      { label: '3D Printer HQ', href: null },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Automation',
    items: [
      { label: 'Autonomous', href: '/autonomous' },
      { label: 'AI Coach', href: null },
      { label: 'Local AI', href: null },
      { label: 'Agent Swarm', href: null },
      { label: 'Automations', href: null },
      { label: 'Personal Archive', href: null },
      { label: 'Legal Advisor', href: null },
      { label: 'Dropbox Archiver', href: null },
      { label: 'GPU Day', href: null },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { label: 'Profile', href: null },
      { label: 'Notifications', href: null },
      { label: 'Help Centre', href: null },
      { label: 'Admin', href: null },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { label: 'Status', href: '/status' },
      { label: 'Utility', href: '/utility' },
      { label: 'Command Centre', href: null },
      { label: 'Business History', href: null },
      { label: 'Debug', href: null },
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
