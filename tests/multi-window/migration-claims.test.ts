import { describe, expect, it } from 'vitest'

const lib = await import('../../scripts/lib/migration-claims.mjs')

describe('computeNextNumber', () => {
  it('returns next_available when no claims exist', () => {
    expect(lib.computeNextNumber({ claimed: {}, next_available: 100 })).toBe(100)
  })

  it('returns next_available when it exceeds max claimed', () => {
    expect(
      lib.computeNextNumber({
        claimed: { '50': {}, '51': {} },
        next_available: 100,
      })
    ).toBe(100)
  })

  it('returns max claimed + 1 when next_available is stale', () => {
    expect(
      lib.computeNextNumber({
        claimed: { '50': {}, '142': {} },
        next_available: 50,
      })
    ).toBe(143)
  })

  it('handles missing next_available', () => {
    expect(lib.computeNextNumber({ claimed: { '0142': {} } })).toBe(143)
  })

  it('parses zero-padded keys correctly', () => {
    expect(
      lib.computeNextNumber({
        claimed: { '0099': {}, '0100': {}, '0142': {} },
        next_available: 143,
      })
    ).toBe(143)
  })

  it('returns 1 from empty/initial state', () => {
    expect(lib.computeNextNumber({ claimed: {}, next_available: 1 })).toBe(1)
  })
})

describe('padNumber', () => {
  it('pads to 4 digits', () => {
    expect(lib.padNumber(1)).toBe('0001')
    expect(lib.padNumber(42)).toBe('0042')
    expect(lib.padNumber(142)).toBe('0142')
    expect(lib.padNumber(9999)).toBe('9999')
  })

  it('does not truncate already-4-digit numbers', () => {
    expect(lib.padNumber(10000)).toBe('10000')
  })
})

describe('compareClaims', () => {
  it('returns inSync when origin is null', () => {
    expect(lib.compareClaims({ claimed: { '142': {} } }, null)).toEqual({ inSync: true })
  })

  it('returns inSync when local matches origin', () => {
    const claims = { claimed: { '141': {}, '142': {} }, next_available: 143 }
    expect(lib.compareClaims(claims, claims)).toEqual({ inSync: true })
  })

  it('detects behind (origin has claims local does not)', () => {
    const local = { claimed: { '141': {} }, next_available: 142 }
    const origin = { claimed: { '141': {}, '142': {}, '143': {} }, next_available: 144 }
    const result = lib.compareClaims(local, origin)
    expect(result.inSync).toBe(false)
    expect(result.behind).toEqual(expect.arrayContaining(['142', '143']))
    expect(result.ahead).toEqual([])
  })

  it('detects ahead (local has claims origin does not)', () => {
    const local = { claimed: { '141': {}, '142': {}, '143': {} }, next_available: 144 }
    const origin = { claimed: { '141': {} }, next_available: 142 }
    const result = lib.compareClaims(local, origin)
    expect(result.inSync).toBe(false)
    expect(result.ahead).toEqual(expect.arrayContaining(['142', '143']))
    expect(result.behind).toEqual([])
  })

  it('detects both behind and ahead simultaneously', () => {
    const local = { claimed: { '141': {}, '142': {} }, next_available: 143 }
    const origin = { claimed: { '141': {}, '143': {} }, next_available: 144 }
    const result = lib.compareClaims(local, origin)
    expect(result.inSync).toBe(false)
    expect(result.ahead).toEqual(['142'])
    expect(result.behind).toEqual(['143'])
  })
})
