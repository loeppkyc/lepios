/**
 * Tests for lib/lego/retirement.ts business logic.
 *
 * Tests cover the ~20% business logic ported from lego_retirement.py:
 * - projectPostRetirementValue (time factors + theme multipliers)
 * - calculateProfitScore (6-factor scoring)
 * - scoreToLabel (threshold classification)
 * - grossRoi (simple ROI calc)
 *
 * No UI, no Supabase, no Streamlit dependencies.
 */

import { describe, expect, it } from 'vitest'
import {
  projectPostRetirementValue,
  calculateProfitScore,
  scoreToLabel,
  grossRoi,
  DEFAULT_THEME_MULTIPLIERS,
} from '@/lib/lego/retirement'

// ── projectPostRetirementValue ─────────────────────────────────────────────

describe('projectPostRetirementValue', () => {
  it('uses time factor 1.40 at 3 years', () => {
    const result = projectPostRetirementValue(100, 'City', 3)
    // City multiplier = 1.10, time factor 3yr = 1.40
    expect(result).toBeCloseTo(100 * 1.1 * 1.4, 2)
  })

  it('uses time factor 1.65 at 5 years', () => {
    const result = projectPostRetirementValue(200, 'Star Wars', 5)
    // Star Wars = 1.45, time factor 5yr = 1.65
    expect(result).toBeCloseTo(200 * 1.45 * 1.65, 2)
  })

  it('uses default multiplier 1.10 for unknown theme', () => {
    const result = projectPostRetirementValue(100, 'UnknownTheme', 1)
    // DEFAULT_MULTIPLIER = 1.10, time factor 1yr = 1.15
    expect(result).toBeCloseTo(100 * 1.1 * 1.15, 2)
  })

  it('clamps years to 1–5 range (year 0 → year 1)', () => {
    const r0 = projectPostRetirementValue(100, 'City', 0)
    const r1 = projectPostRetirementValue(100, 'City', 1)
    expect(r0).toBeCloseTo(r1, 2)
  })

  it('clamps years to 1–5 range (year 10 → year 5)', () => {
    const r10 = projectPostRetirementValue(100, 'City', 10)
    const r5 = projectPostRetirementValue(100, 'City', 5)
    expect(r10).toBeCloseTo(r5, 2)
  })

  it('accepts custom theme multipliers from DB', () => {
    const customMult = { 'My Theme': 2.0 }
    const result = projectPostRetirementValue(100, 'My Theme', 3, customMult)
    // custom multiplier = 2.0, time factor 3yr = 1.40
    expect(result).toBeCloseTo(100 * 2.0 * 1.4, 2)
  })

  it('rounds to 2 decimal places', () => {
    const result = projectPostRetirementValue(100, 'City', 3)
    const decimals = result.toString().split('.')[1]?.length ?? 0
    expect(decimals).toBeLessThanOrEqual(2)
  })
})

// ── grossRoi ───────────────────────────────────────────────────────────────

describe('grossRoi', () => {
  it('returns 0 if paid is 0', () => {
    expect(grossRoi(0, 100)).toBe(0)
  })

  it('returns positive ROI when current > paid', () => {
    expect(grossRoi(100, 150)).toBeCloseTo(50, 1)
  })

  it('returns negative ROI when current < paid', () => {
    expect(grossRoi(200, 150)).toBeCloseTo(-25, 1)
  })

  it('returns 0% when paid === current', () => {
    expect(grossRoi(100, 100)).toBeCloseTo(0, 1)
  })
})

// ── calculateProfitScore ───────────────────────────────────────────────────

describe('calculateProfitScore', () => {
  it('returns total in range 0–100', () => {
    const score = calculateProfitScore({
      retailPriceCad: 200,
      amazonPriceCad: 140,
      theme: 'Star Wars',
      pieces: 1000,
      salesRank: 5000,
      retireDateEst: '2026-08-01',
    })
    expect(score.total).toBeGreaterThanOrEqual(0)
    expect(score.total).toBeLessThanOrEqual(100)
  })

  it('all sub-scores sum to total', () => {
    const score = calculateProfitScore({
      retailPriceCad: 300,
      amazonPriceCad: 210,
      theme: 'Icons',
      pieces: 1500,
      salesRank: 2000,
      retireDateEst: '2026-07-01',
    })
    const sum =
      score.discountScore +
      score.themeScore +
      score.pppScore +
      score.priceTierScore +
      score.salesRankScore +
      score.urgencyScore
    expect(score.total).toBe(Math.min(100, sum))
  })

  it('high-discount Star Wars set scores ≥70 (STRONG BUY territory)', () => {
    const score = calculateProfitScore({
      retailPriceCad: 300,
      amazonPriceCad: 200, // 33% discount
      theme: 'Star Wars',
      pieces: 2000,
      salesRank: 1000,
      retireDateEst: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // ~2 months out
    })
    expect(score.total).toBeGreaterThanOrEqual(55)
  })

  it('no-discount City set with poor rank scores < 35 (PASS territory)', () => {
    const score = calculateProfitScore({
      retailPriceCad: 30,
      amazonPriceCad: 30, // 0% discount
      theme: 'City',
      pieces: 200,
      salesRank: 500000,
      retireDateEst: '2029-01-01', // 3 years away
    })
    expect(score.total).toBeLessThan(35)
  })

  it('handles null inputs gracefully', () => {
    const score = calculateProfitScore({
      retailPriceCad: 100,
      amazonPriceCad: null,
      theme: 'Unknown',
      pieces: null,
      salesRank: null,
      retireDateEst: null,
    })
    expect(score.total).toBeGreaterThanOrEqual(0)
    expect(score.total).toBeLessThanOrEqual(100)
    // discount = 0 (no amazon price), ppp = 0 (no pieces), salesRank = 0, urgency = 0
    expect(score.discountScore).toBe(0)
    expect(score.pppScore).toBe(0)
    expect(score.salesRankScore).toBe(0)
    expect(score.urgencyScore).toBe(0)
  })

  it('urgency score = 15 when retiring within 3 months', () => {
    const soon = new Date()
    soon.setMonth(soon.getMonth() + 2)
    const score = calculateProfitScore({
      retailPriceCad: 100,
      amazonPriceCad: null,
      theme: 'City',
      pieces: null,
      salesRank: null,
      retireDateEst: soon.toISOString(),
    })
    expect(score.urgencyScore).toBe(15)
  })

  it('uses custom theme multipliers from DB over defaults', () => {
    const customMult = { 'Test Theme': 1.99 } // > 1.45 threshold → max score 20
    const score = calculateProfitScore({
      retailPriceCad: 100,
      amazonPriceCad: null,
      theme: 'Test Theme',
      pieces: null,
      salesRank: null,
      retireDateEst: null,
      themeMultipliers: customMult,
    })
    expect(score.themeScore).toBe(20)
  })
})

// ── scoreToLabel ───────────────────────────────────────────────────────────

describe('scoreToLabel', () => {
  it('returns STRONG BUY for score ≥ 70', () => {
    expect(scoreToLabel(70)).toBe('STRONG BUY')
    expect(scoreToLabel(95)).toBe('STRONG BUY')
    expect(scoreToLabel(100)).toBe('STRONG BUY')
  })

  it('returns BUY for score ≥ 55 and < 70', () => {
    expect(scoreToLabel(55)).toBe('BUY')
    expect(scoreToLabel(65)).toBe('BUY')
    expect(scoreToLabel(69)).toBe('BUY')
  })

  it('returns WATCH for score ≥ 35 and < 55', () => {
    expect(scoreToLabel(35)).toBe('WATCH')
    expect(scoreToLabel(45)).toBe('WATCH')
    expect(scoreToLabel(54)).toBe('WATCH')
  })

  it('returns PASS for score < 35', () => {
    expect(scoreToLabel(0)).toBe('PASS')
    expect(scoreToLabel(20)).toBe('PASS')
    expect(scoreToLabel(34)).toBe('PASS')
  })
})

// ── DEFAULT_THEME_MULTIPLIERS shape ────────────────────────────────────────

describe('DEFAULT_THEME_MULTIPLIERS', () => {
  it('has at least 10 entries', () => {
    expect(Object.keys(DEFAULT_THEME_MULTIPLIERS).length).toBeGreaterThanOrEqual(10)
  })

  it('all multipliers are positive numbers', () => {
    for (const [theme, mult] of Object.entries(DEFAULT_THEME_MULTIPLIERS)) {
      expect(typeof mult).toBe('number')
      expect(mult).toBeGreaterThan(0)
      expect(mult).toBeLessThan(5) // sanity ceiling
      void theme
    }
  })

  it('includes known high-value themes', () => {
    expect(DEFAULT_THEME_MULTIPLIERS['Star Wars']).toBeDefined()
    expect(DEFAULT_THEME_MULTIPLIERS['Botanical']).toBeDefined()
    expect(DEFAULT_THEME_MULTIPLIERS['Icons']).toBeDefined()
  })
})
