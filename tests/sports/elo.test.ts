import { describe, it, expect } from 'vitest'
import {
  expectedScore,
  updateElo,
  eloToWinProb,
  eloEdge,
  ELO_K,
  ELO_HOME_ADV,
  ELO_START,
} from '@/lib/sports/elo'

// ── Constants ─────────────────────────────────────────────────────────────────

describe('ELO constants', () => {
  it('K factor is 20', () => {
    expect(ELO_K).toBe(20)
  })

  it('home advantage is 50 Elo points', () => {
    expect(ELO_HOME_ADV).toBe(50)
  })

  it('starting Elo is 1500', () => {
    expect(ELO_START).toBe(1500)
  })
})

// ── expectedScore ─────────────────────────────────────────────────────────────

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 4)
  })

  it('higher rated player has higher expected score', () => {
    const e = expectedScore(1600, 1400)
    expect(e).toBeGreaterThan(0.5)
    expect(e).toBeLessThan(1)
  })

  it('lower rated player has lower expected score', () => {
    const e = expectedScore(1400, 1600)
    expect(e).toBeLessThan(0.5)
    expect(e).toBeGreaterThan(0)
  })

  it('probabilities sum to 1 for symmetric matchup', () => {
    const eA = expectedScore(1600, 1400)
    const eB = expectedScore(1400, 1600)
    expect(eA + eB).toBeCloseTo(1, 4)
  })

  it('200 point difference gives ~76% expected score', () => {
    // 1 / (1 + 10^(-200/400)) = 1 / (1 + 10^-0.5) ≈ 0.7597
    expect(expectedScore(1600, 1400)).toBeCloseTo(0.7597, 2)
  })

  it('equal ratings, higher A by 50 (home adv) shifts probability', () => {
    const eHome = expectedScore(1500 + 50, 1500)
    expect(eHome).toBeGreaterThan(0.5)
  })
})

// ── updateElo ─────────────────────────────────────────────────────────────────

describe('updateElo', () => {
  it('winner gains Elo, loser loses Elo', () => {
    const { newWinner, newLoser } = updateElo(1500, 1500, true)
    expect(newWinner).toBeGreaterThan(1500)
    expect(newLoser).toBeLessThan(1500)
  })

  it('total Elo is approximately conserved', () => {
    const { newWinner, newLoser } = updateElo(1500, 1500, false)
    // sum changes by delta - delta = 0 in theory; check within floating point tolerance
    expect(newWinner + newLoser).toBeCloseTo(3000, 0)
  })

  it('heavy favorite gains less on expected win', () => {
    const { newWinner: favoriteWinDelta } = updateElo(1700, 1300, false)
    const { newWinner: upsetWinDelta } = updateElo(1300, 1700, false)
    // upset winner gains more
    expect(upsetWinDelta - 1300).toBeGreaterThan(favoriteWinDelta - 1700)
  })

  it('home win applies home advantage in expected calculation', () => {
    // Same ratings, home wins — home gains less than away winning would
    const { newWinner: homeWin } = updateElo(1500, 1500, true)
    const { newWinner: awayWin } = updateElo(1500, 1500, false)
    // Home team winning is "expected" due to home advantage, so gains less
    expect(homeWin).toBeLessThan(awayWin)
  })

  it('returns rounded values (2 decimal places)', () => {
    const { newWinner, newLoser } = updateElo(1500, 1500, true)
    expect(newWinner).toBe(Math.round(newWinner * 100) / 100)
    expect(newLoser).toBe(Math.round(newLoser * 100) / 100)
  })
})

// ── eloToWinProb ──────────────────────────────────────────────────────────────

describe('eloToWinProb', () => {
  it('returns value between 0 and 1', () => {
    const p = eloToWinProb(1500, 1500)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
  })

  it('home team with equal ratings has >50% due to home advantage', () => {
    expect(eloToWinProb(1500, 1500)).toBeGreaterThan(0.5)
  })

  it('home advantage adds ~7pp on equal ratings', () => {
    // With 50 pt home adv and 400 divisor: 1/(1+10^(-50/400)) ≈ 0.5714
    expect(eloToWinProb(1500, 1500)).toBeCloseTo(0.5714, 2)
  })

  it('superior home team has higher win probability', () => {
    expect(eloToWinProb(1700, 1500)).toBeGreaterThan(eloToWinProb(1500, 1500))
  })

  it('inferior home team can still win majority via home advantage', () => {
    // Home team 50 pts lower — advantage partially compensates
    const p = eloToWinProb(1450, 1500)
    expect(p).toBeGreaterThan(0.4)
  })
})

// ── eloEdge ───────────────────────────────────────────────────────────────────

describe('eloEdge', () => {
  it('positive edge when Elo says home is better than market implies', () => {
    // Market implies 55% for home, Elo says ~57%
    const edge = eloEdge(1500, 1500, 0.55)
    expect(edge).toBeGreaterThan(0)
  })

  it('negative edge when market over-values home team', () => {
    // Market implies 75% but equal teams → Elo says ~57%
    const edge = eloEdge(1500, 1500, 0.75)
    expect(edge).toBeLessThan(0)
  })

  it('zero edge when market implied prob equals Elo win prob', () => {
    const eloProb = eloToWinProb(1500, 1500)
    expect(eloEdge(1500, 1500, eloProb)).toBeCloseTo(0, 8)
  })

  it('edge is symmetric: flipping teams negates the value', () => {
    const edge1 = eloEdge(1600, 1400, 0.6)
    // Swap: now "home" is 1400, "away" is 1600 — market still at 60%
    const edge2 = eloEdge(1400, 1600, 0.6)
    // One should be positive, one negative (approximately)
    expect(Math.sign(edge1)).not.toBe(Math.sign(edge2))
  })
})
