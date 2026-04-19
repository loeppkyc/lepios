'use client'

import type { BsrPoint } from '@/lib/keepa/history'

interface Props {
  points: BsrPoint[]
}

const WIDTH = 200
const HEIGHT = 48

export function BsrSparkline({ points }: Props) {
  if (points.length === 0) return null

  const ranks = points.map((p) => p.rank)
  const times = points.map((p) => p.t)

  const minRank = Math.min(...ranks)
  const maxRank = Math.max(...ranks)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)

  const rankRange = maxRank - minRank
  const timeRange = maxT - minT

  function toX(t: number): number {
    return timeRange === 0 ? WIDTH / 2 : ((t - minT) / timeRange) * WIDTH
  }

  function toY(rank: number): number {
    // Y-axis inverted: lower rank (better seller) renders higher on chart
    return rankRange === 0 ? HEIGHT / 2 : (1 - (rank - minRank) / rankRange) * HEIGHT
  }

  const pointsAttr = points.map((p) => `${toX(p.t).toFixed(1)},${toY(p.rank).toFixed(1)}`).join(' ')

  const last = points[points.length - 1]
  const dotX = toX(last.t)
  const dotY = toY(last.rank)

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      <polyline
        points={pointsAttr}
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx={dotX} cy={dotY} r={3} fill="var(--color-accent-gold)" />
    </svg>
  )
}
