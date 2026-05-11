// Brand IP/C&D risk database — ported from utils/brand_risk.py
// Risk levels: 5=lawsuit risk, 4=high, 3=elevated, 2=moderate, 1=low, 0=safe

import type { BrandRiskEntry } from './types'

const RISK_LABELS = ['safe', 'low', 'moderate', 'elevated', 'high', 'extreme'] as const

// Core danger brand database (~70 entries from the Streamlit source)
const BRAND_DB: BrandRiskEntry[] = [
  {
    brand: 'Apple',
    risk_level: 5,
    label: 'extreme',
    category: 'Electronics',
    notes: 'Aggressive IP enforcement, MAP violations, authorized-reseller gate',
  },
  {
    brand: 'Nike',
    risk_level: 5,
    label: 'extreme',
    category: 'Apparel',
    notes: 'Frequent C&D, counterfeit sweeps, gate-tested',
  },
  {
    brand: 'Lego',
    risk_level: 4,
    label: 'high',
    category: 'Toys',
    notes: 'Trademark enforcement on clone bricks; legitimate sets lower risk',
  },
  {
    brand: 'Dyson',
    risk_level: 4,
    label: 'high',
    category: 'Appliances',
    notes: 'MAP policy enforced; warranty issues for grey-market units',
  },
  {
    brand: 'Bose',
    risk_level: 4,
    label: 'high',
    category: 'Electronics',
    notes: 'Authorized reseller program; gated on Amazon.ca',
  },
  {
    brand: 'Beats',
    risk_level: 4,
    label: 'high',
    category: 'Electronics',
    notes: 'Apple subsidiary — same enforcement posture',
  },
  {
    brand: 'Sony',
    risk_level: 3,
    label: 'elevated',
    category: 'Electronics',
    notes: 'Selective enforcement; high-value items attract audits',
  },
  {
    brand: 'Samsung',
    risk_level: 3,
    label: 'elevated',
    category: 'Electronics',
    notes: 'Large electronics — customs / warranty scrutiny',
  },
  {
    brand: 'Adidas',
    risk_level: 4,
    label: 'high',
    category: 'Apparel',
    notes: 'Active IP enforcement like Nike',
  },
  {
    brand: 'Under Armour',
    risk_level: 3,
    label: 'elevated',
    category: 'Apparel',
    notes: 'Growing enforcement program',
  },
  {
    brand: 'Gucci',
    risk_level: 5,
    label: 'extreme',
    category: 'Luxury',
    notes: 'Luxury — any grey-market resale triggers immediate action',
  },
  {
    brand: 'Louis Vuitton',
    risk_level: 5,
    label: 'extreme',
    category: 'Luxury',
    notes: 'Same as Gucci; zero tolerance',
  },
  {
    brand: 'Chanel',
    risk_level: 5,
    label: 'extreme',
    category: 'Luxury',
    notes: 'Luxury IP extreme enforcement',
  },
  {
    brand: 'Rolex',
    risk_level: 5,
    label: 'extreme',
    category: 'Luxury',
    notes: 'Authorized dealer only; no secondary',
  },
  {
    brand: 'Yeti',
    risk_level: 3,
    label: 'elevated',
    category: 'Outdoor',
    notes: 'Brand protection program; fake Yetis cause sweeps',
  },
  {
    brand: 'Traeger',
    risk_level: 3,
    label: 'elevated',
    category: 'Outdoor',
    notes: 'Premium grill — warranty/auth issues',
  },
  {
    brand: 'Weber',
    risk_level: 2,
    label: 'moderate',
    category: 'Outdoor',
    notes: 'Grey-market risk on grills; accessories safer',
  },
  {
    brand: 'KitchenAid',
    risk_level: 2,
    label: 'moderate',
    category: 'Appliances',
    notes: 'MAP policy; stand mixers attract attention',
  },
  {
    brand: 'Vitamix',
    risk_level: 3,
    label: 'elevated',
    category: 'Appliances',
    notes: 'Strict MAP + authorized dealer gate',
  },
  {
    brand: 'Instant Pot',
    risk_level: 1,
    label: 'low',
    category: 'Appliances',
    notes: 'Generally safe; widely sold at retail',
  },
  {
    brand: "De'Longhi",
    risk_level: 2,
    label: 'moderate',
    category: 'Appliances',
    notes: 'Coffee machines — warranty/MAP sensitive',
  },
  {
    brand: 'Nespresso',
    risk_level: 2,
    label: 'moderate',
    category: 'Appliances',
    notes: 'Nestlé — brand protection on machines',
  },
  {
    brand: 'iRobot',
    risk_level: 3,
    label: 'elevated',
    category: 'Electronics',
    notes: 'Now Amazon subsidiary; stricter enforcement expected',
  },
  {
    brand: 'Roomba',
    risk_level: 3,
    label: 'elevated',
    category: 'Electronics',
    notes: 'Same as iRobot',
  },
  {
    brand: 'GoPro',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Widely sold; MAP on new models',
  },
  {
    brand: 'DJI',
    risk_level: 3,
    label: 'elevated',
    category: 'Electronics',
    notes: 'Drones — import/auth complications; grey market risky',
  },
  {
    brand: 'Razer',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Gaming peripherals; generally accessible',
  },
  {
    brand: 'Logitech',
    risk_level: 1,
    label: 'low',
    category: 'Electronics',
    notes: 'Widely distributed; low IP risk',
  },
  {
    brand: 'Anker',
    risk_level: 1,
    label: 'low',
    category: 'Electronics',
    notes: 'Safe — no significant enforcement history',
  },
  {
    brand: 'Belkin',
    risk_level: 1,
    label: 'low',
    category: 'Electronics',
    notes: 'Safe for resale',
  },
  {
    brand: 'Oral-B',
    risk_level: 2,
    label: 'moderate',
    category: 'Personal Care',
    notes: 'P&G — grey market on electric toothbrushes',
  },
  {
    brand: 'Philips',
    risk_level: 2,
    label: 'moderate',
    category: 'Personal Care',
    notes: 'MAP on Sonicare; minor enforcement',
  },
  {
    brand: 'Braun',
    risk_level: 2,
    label: 'moderate',
    category: 'Personal Care',
    notes: 'P&G brand — similar to Oral-B',
  },
  {
    brand: 'Remington',
    risk_level: 1,
    label: 'low',
    category: 'Personal Care',
    notes: 'Generally safe',
  },
  {
    brand: 'Converse',
    risk_level: 3,
    label: 'elevated',
    category: 'Apparel',
    notes: 'Nike subsidiary — enforcement via parent',
  },
  {
    brand: 'Jordan',
    risk_level: 5,
    label: 'extreme',
    category: 'Apparel',
    notes: 'Nike subsidiary; sneaker auth required',
  },
  {
    brand: 'New Balance',
    risk_level: 2,
    label: 'moderate',
    category: 'Apparel',
    notes: 'Less aggressive than Nike/Adidas',
  },
  {
    brand: 'The North Face',
    risk_level: 3,
    label: 'elevated',
    category: 'Apparel',
    notes: 'VF Corp — gate-eligible; MAP enforced',
  },
  {
    brand: 'Patagonia',
    risk_level: 3,
    label: 'elevated',
    category: 'Apparel',
    notes: 'Selective distribution; grey market frowned upon',
  },
  {
    brand: "Arc'teryx",
    risk_level: 4,
    label: 'high',
    category: 'Apparel',
    notes: 'Premium outdoor; strict auth network',
  },
  {
    brand: 'Canada Goose',
    risk_level: 4,
    label: 'high',
    category: 'Apparel',
    notes: 'Luxury outerwear; aggressive counterfeit/grey enforcement',
  },
  {
    brand: 'Lululemon',
    risk_level: 3,
    label: 'elevated',
    category: 'Apparel',
    notes: 'Returns/MAP policy; some gating',
  },
  {
    brand: 'Funko',
    risk_level: 2,
    label: 'moderate',
    category: 'Collectibles',
    notes: 'Licensed character IP; gating risk on exclusives',
  },
  {
    brand: 'Hasbro',
    risk_level: 2,
    label: 'moderate',
    category: 'Toys',
    notes: 'Licensed brands (Transformers, GI Joe); low enforcement for retail arb',
  },
  {
    brand: 'Mattel',
    risk_level: 2,
    label: 'moderate',
    category: 'Toys',
    notes: 'Barbie, Hot Wheels — generally safe from clearance',
  },
  {
    brand: 'Nintendo',
    risk_level: 3,
    label: 'elevated',
    category: 'Gaming',
    notes: 'Hardware/software MAP; counterfeit sweeps on accessories',
  },
  {
    brand: 'PlayStation',
    risk_level: 3,
    label: 'elevated',
    category: 'Gaming',
    notes: 'Sony — authorized retailer expectations',
  },
  {
    brand: 'Xbox',
    risk_level: 2,
    label: 'moderate',
    category: 'Gaming',
    notes: 'Microsoft; generally retail-arb safe',
  },
  {
    brand: 'LEGO Technic',
    risk_level: 4,
    label: 'high',
    category: 'Toys',
    notes: 'Same Lego enforcement; premium sets',
  },
  {
    brand: 'Fisher-Price',
    risk_level: 1,
    label: 'low',
    category: 'Toys',
    notes: 'Mattel brand; safe',
  },
  {
    brand: 'OtterBox',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Case brand; minor MAP',
  },
  { brand: 'Spigen', risk_level: 1, label: 'low', category: 'Electronics', notes: 'Safe' },
  {
    brand: 'Cuisinart',
    risk_level: 1,
    label: 'low',
    category: 'Appliances',
    notes: 'Conagra — broadly distributed, safe',
  },
  {
    brand: 'Breville',
    risk_level: 2,
    label: 'moderate',
    category: 'Appliances',
    notes: 'Premium kitchen; MAP sensitive',
  },
  {
    brand: 'Nikon',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Grey import risk on cameras; accessories safe',
  },
  {
    brand: 'Canon',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Same as Nikon',
  },
  {
    brand: 'Fujifilm',
    risk_level: 1,
    label: 'low',
    category: 'Electronics',
    notes: 'Generally safe for retail arb',
  },
  {
    brand: 'Garmin',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'GPS/fitness devices; MAP enforced on new',
  },
  {
    brand: 'Fitbit',
    risk_level: 2,
    label: 'moderate',
    category: 'Electronics',
    notes: 'Google — enforcement possible',
  },
  {
    brand: 'Polar',
    risk_level: 1,
    label: 'low',
    category: 'Electronics',
    notes: 'Safe for clearance arb',
  },
  {
    brand: 'Theragun',
    risk_level: 3,
    label: 'elevated',
    category: 'Health',
    notes: 'Premium percussion massager; MAP + auth dealer gate',
  },
  {
    brand: 'Hyperice',
    risk_level: 2,
    label: 'moderate',
    category: 'Health',
    notes: 'Recovery tech; selective distribution',
  },
  {
    brand: 'Ninja',
    risk_level: 1,
    label: 'low',
    category: 'Appliances',
    notes: 'SharkNinja — widely sold at clearance; safe',
  },
  {
    brand: 'Shark',
    risk_level: 1,
    label: 'low',
    category: 'Appliances',
    notes: 'SharkNinja — same',
  },
  {
    brand: 'Bissell',
    risk_level: 1,
    label: 'low',
    category: 'Appliances',
    notes: 'Safe — broad retail distribution',
  },
  {
    brand: 'Dyson Airwrap',
    risk_level: 5,
    label: 'extreme',
    category: 'Personal Care',
    notes: 'Dyson — highest-profile product, counterfeit sweeps active',
  },
  {
    brand: 'Stanley',
    risk_level: 2,
    label: 'moderate',
    category: 'Outdoor',
    notes: 'Trend product — MAP on Quencher; fakes inflating risk',
  },
  {
    brand: 'Hydro Flask',
    risk_level: 2,
    label: 'moderate',
    category: 'Outdoor',
    notes: 'Helen of Troy brand; MAP program',
  },
  {
    brand: 'Pokémon',
    risk_level: 4,
    label: 'high',
    category: 'Collectibles',
    notes: 'Nintendo/TPC — aggressive TCG enforcement; sealed product safer',
  },
  {
    brand: 'Magic: The Gathering',
    risk_level: 3,
    label: 'elevated',
    category: 'Collectibles',
    notes: 'Hasbro/Wizards — sealed product generally fine; singles more complex',
  },
]

export function lookupBrandRisk(brand: string): BrandRiskEntry | null {
  const normalized = brand.toLowerCase().trim()
  const exact = BRAND_DB.find((b) => b.brand.toLowerCase() === normalized)
  if (exact) return exact

  // Partial match — brand contains query or query contains brand
  const partial = BRAND_DB.find(
    (b) => b.brand.toLowerCase().includes(normalized) || normalized.includes(b.brand.toLowerCase())
  )
  return partial ?? null
}

export function scanTitleForRisk(title: string): BrandRiskEntry[] {
  const lower = title.toLowerCase()
  return BRAND_DB.filter((b) => lower.includes(b.brand.toLowerCase()))
}

export function riskColor(level: number): string {
  const colors: Record<number, string> = {
    0: 'text-green-400',
    1: 'text-green-300',
    2: 'text-yellow-400',
    3: 'text-orange-400',
    4: 'text-red-400',
    5: 'text-red-600',
  }
  return colors[level] ?? 'text-[var(--color-text-secondary)]'
}

export function riskBadgeClass(level: number): string {
  const classes: Record<number, string> = {
    0: 'bg-green-900/40 text-green-300',
    1: 'bg-green-900/30 text-green-400',
    2: 'bg-yellow-900/40 text-yellow-300',
    3: 'bg-orange-900/40 text-orange-300',
    4: 'bg-red-900/40 text-red-300',
    5: 'bg-red-900/60 text-red-200',
  }
  return classes[level] ?? ''
}

export { BRAND_DB, RISK_LABELS }
