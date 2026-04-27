export type Category =
  | 'amazon'
  | 'inventory'
  | 'finance'
  | 'health'
  | 'life'
  | 'betting_trading'
  | 'automation'
  | 'misc'

export interface CategoryResult {
  category: Category
  confidence: number
}

// Keyword rules checked in order; first match wins.
// Content rules can boost confidence or detect category when filename is ambiguous.
const FILENAME_RULES: Array<{ pattern: RegExp; category: Category; confidence: number }> = [
  { pattern: /Amazon|Repricer|Marketplace_Hub|Keepa_Intel|Product_Intel|Retail_Radar|eBay/i, category: 'amazon', confidence: 0.95 },
  { pattern: /8_Health|Oura_Health|Pet_Health/i, category: 'health', confidence: 0.95 },
  { pattern: /Trading_Journal|Sports_Betting|Prediction_Engine|Polymarket/i, category: 'betting_trading', confidence: 0.95 },
  { pattern: /Command_Centre|Paper_Trail|Notifications|Automations|Agent_Swarm|AI_Coach|AI_Chat|Local_AI|GPU_Day|Accuracy_Dashboard|Dropbox_Archiver|n8n_Webhook/i, category: 'automation', confidence: 0.9 },
  { pattern: /Life_PL|Monthly_Expenses|Monthly_PL|Tax_Centre|Bookkeeping|Payouts|Expense_Dashboard|Personal_Expenses|Sales_Charts|Category_PL|Retirement_Tracker|Business_History|Monthly_Close|Tax_Return|Net_Worth|Debt_Payoff|Cash_Forecast|Savings_Goals|Subscriptions|Crypto|MileIQ|Vehicles|Utility_Tracker|Phone_Plans|Insurance|Receipts/i, category: 'finance', confidence: 0.9 },
  { pattern: /Inventory|Scout|PageProfit|Shipment|Scoutly|Retail_Scout|Arbitrage|Lego_Vault|Retail_Monitor|Cashback|Groceries|Grocery_Tracker|Deal_Tracker|Retail_HQ|Scanner_Phone|Coupon_Lady|3D_Printer/i, category: 'inventory', confidence: 0.9 },
  { pattern: /Calendar|Goals|Family|Coras_Future|Welcome|Help|Life_Compass|Personal_Archive|Legal_Advisor|Profile/i, category: 'life', confidence: 0.85 },
]

const CONTENT_RULES: Array<{ pattern: RegExp; category: Category; confidenceBoost: number }> = [
  { pattern: /\bsp_api\b|from sp_api|amazon_sp/i, category: 'amazon', confidenceBoost: 0.15 },
  { pattern: /\bkeepa\b/i, category: 'amazon', confidenceBoost: 0.1 },
  { pattern: /kelly|backtest|expected.value|implied_prob|\bodds\b/i, category: 'betting_trading', confidenceBoost: 0.1 },
  { pattern: /\bgst\b|\bhst\b|tax.return|\bcra\b|fiscal.year/i, category: 'finance', confidenceBoost: 0.1 },
  { pattern: /oura|readiness_score|sleep_score|heartrate/i, category: 'health', confidenceBoost: 0.15 },
]

export function categorize(filename: string, content: string): CategoryResult {
  const base = filename.replace(/^.*[\\/]/, '')

  for (const rule of FILENAME_RULES) {
    if (rule.pattern.test(base)) {
      let confidence = rule.confidence
      for (const cr of CONTENT_RULES) {
        if (cr.category === rule.category && cr.pattern.test(content.slice(0, 2000))) {
          confidence = Math.min(1.0, confidence + cr.confidenceBoost)
        }
      }
      return { category: rule.category, confidence }
    }
  }

  // Content-only detection for ambiguous filenames
  const scores: Partial<Record<Category, number>> = {}
  for (const cr of CONTENT_RULES) {
    if (cr.pattern.test(content.slice(0, 2000))) {
      scores[cr.category] = (scores[cr.category] ?? 0.4) + cr.confidenceBoost
    }
  }
  const best = (Object.entries(scores) as [Category, number][]).sort(([, a], [, b]) => b - a)[0]
  if (best && best[1] >= 0.5) {
    return { category: best[0], confidence: Math.min(best[1], 0.7) }
  }

  return { category: 'misc', confidence: 0.3 }
}
