import { describe, it, expect } from 'vitest'
// @ts-expect-error — pure JS module without types
import { validate } from '../../scripts/check-vercel-cron-count.mjs'

describe('check-vercel-cron-count: count ceiling', () => {
  it('passes with 18 daily-cadence crons (proven Hobby ceiling)', () => {
    const crons = Array.from({ length: 18 }, (_, i) => ({
      path: '/c' + i,
      schedule: '0 ' + (i % 24) + ' * * *',
    }))
    expect(validate({ crons })).toEqual([])
  })

  it('blocks 19 daily-cadence crons', () => {
    const crons = Array.from({ length: 19 }, (_, i) => ({
      path: '/c' + i,
      schedule: '0 ' + (i % 24) + ' * * *',
    }))
    const errors = validate({ crons })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('19 crons')
    expect(errors[0]).toContain('ceiling is 18')
  })

  it('passes when crons array is missing', () => {
    expect(validate({})).toEqual([])
  })
})

describe('check-vercel-cron-count: sub-hourly cadence', () => {
  it('blocks star-slash schedules', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '*/30 * * * *' }],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('sub-hourly')
    expect(errors[0]).toContain('/a')
  })

  it('blocks comma-list minute schedules', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '0,30 * * * *' }],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('0,30')
  })

  it('blocks "every minute" schedules', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '* * * * *' }],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('* * * * *')
  })

  it('blocks range minute schedules without step', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '0-30 * * * *' }],
    })
    expect(errors).toHaveLength(1)
  })

  it('allows hourly cadence (single integer minute)', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '0 * * * *' }],
    })
    expect(errors).toEqual([])
  })

  it('allows daily cadence', () => {
    const errors = validate({
      crons: [{ path: '/a', schedule: '0 4 * * *' }],
    })
    expect(errors).toEqual([])
  })

  it('groups multiple sub-hourly violations into one error', () => {
    const errors = validate({
      crons: [
        { path: '/a', schedule: '*/15 * * * *' },
        { path: '/b', schedule: '0,30 * * * *' },
      ],
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('/a')
    expect(errors[0]).toContain('/b')
  })

  it('strictSubHourly=false skips the cadence check', () => {
    const errors = validate(
      { crons: [{ path: '/a', schedule: '*/15 * * * *' }] },
      { strictSubHourly: false }
    )
    expect(errors).toEqual([])
  })
})

describe('check-vercel-cron-count: combined failures', () => {
  it('reports both count and sub-hourly violations together', () => {
    const big = Array.from({ length: 18 }, (_, i) => ({
      path: '/c' + i,
      schedule: '0 ' + (i % 24) + ' * * *',
    }))
    const errors = validate({
      crons: [...big, { path: '/sub', schedule: '*/30 * * * *' }],
    })
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('19 crons')
    expect(errors[1]).toContain('sub-hourly')
  })
})
