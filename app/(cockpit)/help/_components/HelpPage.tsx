'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

const ROUTE_MAP: Record<string, string> = {
  'Bookkeeping Hub': '/bookkeeping-hub',
  'Receipts': '/receipts',
  'Monthly Close': '/monthly-close',
  'Tax Return': '/tax-centre',
  'Amazon Orders': '/amazon',
  'Net Worth': '/net-worth',
  'Debt Payoff': '/debt-payoff',
}

function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2)
      const route = ROUTE_MAP[inner]
      if (route) {
        return (
          <Link key={i} href={route} className="font-semibold text-[var(--color-accent-gold)] hover:underline">
            {inner}
          </Link>
        )
      }
      return <strong key={i}>{inner}</strong>
    }
    return <span key={i}>{part}</span>
  })
}

const FAQ: Record<string, Array<[string, string]>> = {
  'Getting Started': [
    ['How do I navigate the app?', 'Use the **sidebar** on the left to browse categories. Each category expands to show its pages. Click any page name to open it.'],
    ['What are modules?', "Modules are groups of related pages. During onboarding you pick which modules appear in your sidebar. Change your picks anytime in Profile > Module Preferences."],
    ['How do I customize my sidebar?', 'Go to **Profile** (under System in the sidebar) and scroll to Module Preferences. Select the categories you want to see.'],
    ['How do I re-run the onboarding wizard?', 'Go to Welcome (under System in the sidebar) to run through the setup wizard again and update your module picks.'],
  ],
  'Accounting & Expenses': [
    ['How do I enter expenses?', 'Go to **Bookkeeping Hub** — upload bank/credit card statements and the app will parse and categorize transactions automatically.'],
    ['How do receipts work?', 'Go to **Receipts** — upload a photo or PDF of your receipt. Claude Vision reads it automatically and matches it to a transaction.'],
    ['What is Monthly Close?', '**Monthly Close** walks you through a checklist to finalize each month\'s books: verify statement coverage, match receipts, flag missing items, and sign off.'],
    ['How does the Tax Return page work?', '**Tax Return** auto-fills CRA form T2125 (business income) from your categorized expenses. It also generates GST return data and personal deduction summaries.'],
  ],
  'Amazon & Inventory': [
    ['How do I sync Amazon orders?', 'Go to **Amazon Orders** and use the Order Sync tab. Connect via Amazon SP-API or upload a CSV settlement report.'],
    ['How does the Arbitrage Scanner work?', 'Enter an ASIN or ISBN in the scanner. It pulls price history from Keepa, calculates ROI after FBA fees, and shows a buy/pass recommendation.'],
    ['What is PageProfit?', 'PageProfit calculates your profit per book page — it shows which inventory items have the best margins after all Amazon fees.'],
  ],
  'Deals & Savings': [
    ['How does Cashback HQ work?', 'Cashback HQ tracks your loyalty programs, stacks cashback across programs, and tells you the best card/store combo for each purchase.'],
    ['What is the Purchase Router?', 'The Purchase Router tells you where, when, and how to buy any item to maximize your total cashback across all your loyalty programs.'],
  ],
  'Trading & Betting': [
    ['How do I log a trade?', 'Go to Trading Journal, scroll to the entry form, and fill in: date, ticker, direction, entry/exit price, stop loss, and your mood. The app calculates R-multiple and tracks your equity curve.'],
    ['What is the Kelly criterion?', 'In Sports Betting, the Edge Finder uses Kelly criterion to calculate optimal bet sizing based on your estimated edge vs. the implied probability.'],
  ],
  'Personal Finance': [
    ['How does Net Worth tracking work?', 'Go to **Net Worth** — enter your assets and liabilities. Some values auto-pull from your inventory. Save a snapshot each month to track your wealth trajectory over time.'],
    ['What debt strategies are available?', '**Debt Payoff** supports snowball (smallest balance first) and avalanche (highest interest first) strategies with cash flow projections.'],
  ],
  'Account & Security': [
    ['How do I change my password?', 'Go to **Profile** (under System) and use the Change Password form.'],
    ['What happens if I forget my password?', "On the login page, click Forgot password? and enter your email. You'll receive a reset link (valid for 1 hour)."],
    ['Why was I logged out?', 'Sessions expire after 6 hours of inactivity. Also, if you sign in on another device, your previous session is invalidated (single-session policy).'],
  ],
}

function CategorySection({ category, items, defaultOpen }: {
  category: string
  items: Array<[string, string]>
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-border rounded-md border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {category}
          <span className="ml-2 text-xs font-normal text-[var(--color-text-secondary)]">
            {items.length} topic{items.length !== 1 ? 's' : ''}
          </span>
        </span>
        <span className="text-[var(--color-text-secondary)]">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {items.map(([question, answer]) => (
            <div key={question}>
              <p className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">{question}</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{linkify(answer)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function HelpPage() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQ
    const result: typeof FAQ = {}
    for (const [cat, items] of Object.entries(FAQ)) {
      const matches = items.filter(
        ([question, answer]) =>
          question.toLowerCase().includes(q) || answer.toLowerCase().includes(q),
      )
      if (matches.length > 0) result[cat] = matches
    }
    return result
  }, [query])

  const totalMatches = Object.values(filtered).reduce((s, items) => s + items.length, 0)
  const hasQuery = query.trim().length > 0

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Help Centre</h1>
      <p className="mb-6 text-sm text-[var(--color-text-secondary)]">Search help topics or browse by category</p>

      <input
        type="text"
        placeholder="Search help topics…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border-border bg-cockpit-surface mb-6 w-full rounded-md border px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-gold)]"
      />

      {hasQuery && totalMatches === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          No results for &ldquo;{query}&rdquo;. Try different keywords or clear the search.
        </p>
      )}

      <div className="space-y-2">
        {Object.entries(filtered).map(([category, items]) => (
          <CategorySection key={category} category={category} items={items} defaultOpen={hasQuery} />
        ))}
      </div>
    </div>
  )
}
