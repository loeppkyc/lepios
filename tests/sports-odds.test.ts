import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  americanToImpliedProb,
  formatAmerican,
  oddsToPayout,
  filterFavorites,
  ALBERTA_SPORTS,
  getTodaysGames,
  type Game,
} from '@/lib/sports/odds'

// ── Odds math ─────────────────────────────────────────────────────────────────

describe('americanToImpliedProb', () => {
  it('converts negative odds correctly', () => {
    expect(americanToImpliedProb(-150)).toBeCloseTo(0.6, 4)
  })

  it('converts positive odds correctly', () => {
    expect(americanToImpliedProb(200)).toBeCloseTo(0.3333, 4)
  })

  it('returns 0.5 for +100', () => {
    expect(americanToImpliedProb(100)).toBeCloseTo(0.5, 4)
  })

  it('handles -200 (heavy favorite)', () => {
    expect(americanToImpliedProb(-200)).toBeCloseTo(0.6667, 4)
  })
})

describe('formatAmerican', () => {
  it('prepends + for positive', () => {
    expect(formatAmerican(140)).toBe('+140')
  })

  it('keeps - for negative', () => {
    expect(formatAmerican(-165)).toBe('-165')
  })

  it('handles -100', () => {
    expect(formatAmerican(-100)).toBe('-100')
  })
})

describe('oddsToPayout', () => {
  it('calculates profit for favorites', () => {
    expect(oddsToPayout(-150, 150)).toBeCloseTo(100, 1)
  })

  it('calculates profit for underdogs', () => {
    expect(oddsToPayout(200, 100)).toBeCloseTo(200, 1)
  })

  it('handles even odds', () => {
    expect(oddsToPayout(100, 100)).toBeCloseTo(100, 1)
  })
})

// ── League map ────────────────────────────────────────────────────────────────

describe('ALBERTA_SPORTS', () => {
  it('contains NHL', () => {
    expect(ALBERTA_SPORTS['icehockey_nhl']).toBe('NHL')
  })

  it('contains CFL', () => {
    expect(ALBERTA_SPORTS['americanfootball_cfl']).toBe('CFL')
  })

  it('has at least 10 sports', () => {
    expect(Object.keys(ALBERTA_SPORTS).length).toBeGreaterThanOrEqual(10)
  })
})

// ── filterFavorites ───────────────────────────────────────────────────────────

function makeGame(favOdds: number): Game {
  return {
    sport_key: 'icehockey_nhl',
    league: 'NHL',
    game_id: `g${favOdds}`,
    home: 'A',
    away: 'B',
    favorite: 'A',
    fav_odds: favOdds,
    dog_odds: 140,
    home_odds: favOdds,
    away_odds: 140,
    implied_prob: Math.round(americanToImpliedProb(favOdds) * 1000) / 10,
    commence_iso: new Date().toISOString(),
    commence_str: 'Today',
    num_books: 8,
  }
}

describe('filterFavorites', () => {
  const games = [makeGame(-120), makeGame(-150), makeGame(-180), makeGame(-200), makeGame(-100)]

  it('filters to -150 or shorter by default', () => {
    const result = filterFavorites(games)
    expect(result.every((g) => g.fav_odds <= -150)).toBe(true)
  })

  it('returns 3 games at -150 threshold from sample', () => {
    expect(filterFavorites(games).length).toBe(3)
  })

  it('respects custom maxOdds', () => {
    expect(filterFavorites(games, -180).length).toBe(2)
  })

  it('returns empty when no games qualify', () => {
    expect(filterFavorites([makeGame(120), makeGame(-100)]).length).toBe(0)
  })

  it('returns all when threshold is 0', () => {
    expect(filterFavorites(games, 0).length).toBe(games.filter((g) => g.fav_odds <= 0).length)
  })
})

// ── Mock fallback ─────────────────────────────────────────────────────────────

describe('getTodaysGames (mock fallback)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('returns mock games when no API key', async () => {
    const games = await getTodaysGames('')
    expect(games.length).toBeGreaterThan(0)
    expect(games[0]).toHaveProperty('game_id')
    expect(games[0].is_demo).toBe(true)
  })

  it('mock games all have required fields', async () => {
    const games = await getTodaysGames('')
    for (const g of games) {
      expect(g.sport_key).toBeTruthy()
      expect(g.league).toBeTruthy()
      expect(g.favorite).toBeTruthy()
      expect(typeof g.fav_odds).toBe('number')
      expect(typeof g.implied_prob).toBe('number')
    }
  })

  it('mock includes NHL oilers game', async () => {
    const games = await getTodaysGames('')
    expect(games.some((g) => g.home.includes('Edmonton') || g.away.includes('Edmonton'))).toBe(true)
  })
})
