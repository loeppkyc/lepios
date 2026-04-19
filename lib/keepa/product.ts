import { keepaConfigured, keepaFetch } from './client'

export type VelocityBadge = 'Hot' | 'Warm' | 'Slow' | 'Unknown'

export interface KeepaProduct {
  bsr: number | null
  avgRank90d: number | null
  rankDrops30: number | null
  monthlySold: number | null
  velocityBadge: VelocityBadge
  tokensLeft: number | null
}

// TODO: tune thresholds against real sell-through data (Sprint 3+).
// The 8/4/1 cutoffs are a reasonable start but unverified against Colin's actual sourcing.
function getVelocityBadge(rankDrops30: number | null, monthlySold: number | null): VelocityBadge {
  if (rankDrops30 !== null) {
    if (rankDrops30 >= 8) return 'Hot'
    if (rankDrops30 >= 4) return 'Warm'
    return 'Slow'
  }
  if (monthlySold !== null && monthlySold >= 30) return 'Warm'
  if (monthlySold !== null && monthlySold >= 1) return 'Slow'
  return 'Unknown'
}

function safePositiveInt(arr: number[] | undefined, idx: number): number | null {
  const v = arr?.[idx]
  return typeof v === 'number' && v > 0 ? v : null
}

export async function getKeepaProduct(asin: string): Promise<KeepaProduct | null> {
  if (!keepaConfigured()) return null

  const { product, tokensLeft } = await keepaFetch(asin)
  if (!product) return null

  const stats = product.stats
  const bsr = safePositiveInt(stats?.current, 3)
  const avgRank90d = safePositiveInt(stats?.avg, 3)

  const rawDrops = stats?.salesRankDrops30
  const rankDrops30 = typeof rawDrops === 'number' ? rawDrops : null

  const rawSold = product.monthlySold
  const monthlySold = typeof rawSold === 'number' && rawSold >= 0 ? rawSold : null

  return {
    bsr,
    avgRank90d,
    rankDrops30,
    monthlySold,
    velocityBadge: getVelocityBadge(rankDrops30, monthlySold),
    tokensLeft,
  }
}
