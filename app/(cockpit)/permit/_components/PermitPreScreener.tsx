'use client'

import { useState } from 'react'

interface PropertyResult {
  house_number: string | null
  street_name: string | null
  neighbourhood: string | null
  tax_class: string | null
  assessed_value: string | null
  latitude: string | null
  longitude: string | null
}

const RESIDENTIAL_PERMITS = [
  { type: 'Deck / Patio', threshold: 'Required if deck is > 0.6 m above grade or attached to dwelling' },
  { type: 'Garage / Carport', threshold: 'Required for all new detached garages' },
  { type: 'Basement Development', threshold: 'Required for any developed basement space' },
  { type: 'Secondary Suite', threshold: 'Development + Building permit required; zoning must allow' },
  { type: 'Fence', threshold: 'No permit if ≤ 1.85 m; permit required if taller' },
  { type: 'Hot Tub / Pool', threshold: 'Required for any in-ground pool; hot tubs ≥ 600 L need safety barrier' },
  { type: 'Shed / Accessory Building', threshold: 'No permit if ≤ 10 m² and single storey; permit required if larger' },
  { type: 'Addition / Extension', threshold: 'Always required for structural additions' },
]

const NON_RESIDENTIAL_PERMITS = [
  { type: 'Change of Use', threshold: 'Required when business use category changes' },
  { type: 'Interior Renovation', threshold: 'Required for structural, mechanical, or electrical changes' },
  { type: 'Signage', threshold: 'Development permit required for all exterior signs' },
  { type: 'Exterior Alterations', threshold: 'Required for facade or structural changes' },
  { type: 'New Construction', threshold: 'Both Development and Building permits required' },
]

function fmt(val: string | null): string {
  return val ?? '—'
}

function fmtDollars(val: string | null): string {
  if (!val) return '—'
  const n = Number(val)
  if (isNaN(n)) return val
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n)
}

export function PermitPreScreener() {
  const [house, setHouse] = useState('')
  const [street, setStreet] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PropertyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!house.trim() || !street.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch(
        `/api/permit/lookup?house=${encodeURIComponent(house.trim())}&street=${encodeURIComponent(street.trim())}`
      )
      if (res.status === 404) {
        setError('Address not found in Edmonton property database. Check house number and street name.')
        return
      }
      if (!res.ok) {
        setError('Edmonton Open Data is unavailable. Try again in a moment.')
        return
      }
      const data: PropertyResult = await res.json()
      setResult(data)
    } catch {
      setError('Network error. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const isResidential = result?.tax_class?.toLowerCase().includes('residential')
  const permits = isResidential ? RESIDENTIAL_PERMITS : NON_RESIDENTIAL_PERMITS

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <form onSubmit={handleLookup} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            House Number
          </label>
          <input
            type="text"
            value={house}
            onChange={(e) => setHouse(e.target.value)}
            placeholder="e.g. 8304"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-[var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-gold)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            Street Name
          </label>
          <input
            type="text"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="e.g. 187 Street NW"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-[var(--font-mono)] text-[length:var(--text-small)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-gold)]"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !house.trim() || !street.trim()}
          className="self-start rounded border border-[var(--color-accent-gold)] px-5 py-2 font-[var(--font-ui)] text-[length:var(--text-small)] font-semibold tracking-wider text-[var(--color-accent-gold)] transition-colors hover:bg-[var(--color-accent-gold)] hover:text-[var(--color-base)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Looking up…' : 'Look Up Property'}
        </button>
      </form>

      {error && (
        <p className="font-[var(--font-ui)] text-[length:var(--text-small)] text-red-400">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-3 font-[var(--font-ui)] text-[length:var(--text-small)] font-semibold tracking-wider text-[var(--color-text-primary)]">
              Property Record
            </h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2">
              {[
                ['Address', `${fmt(result.house_number)} ${fmt(result.street_name)}`],
                ['Neighbourhood', fmt(result.neighbourhood)],
                ['Tax Class', fmt(result.tax_class)],
                ['Assessed Value', fmtDollars(result.assessed_value)],
              ].map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
                    {label}
                  </dt>
                  <dd className="font-[var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-primary)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-1 font-[var(--font-ui)] text-[length:var(--text-small)] font-semibold tracking-wider text-[var(--color-text-primary)]">
              Permit Guidance — {result.tax_class ?? 'Unknown'} Property
            </h2>
            <p className="mb-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
              Common permit thresholds for Edmonton. Always confirm with{' '}
              <span className="text-[var(--color-accent-gold)]">Edmonton.ca Development + Building permits</span>{' '}
              before starting work.
            </p>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {['Project Type', 'Permit Required When'].map((h) => (
                    <th
                      key={h}
                      className="pb-2 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] font-semibold tracking-widest text-[var(--color-text-muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permits.map((p) => (
                  <tr
                    key={p.type}
                    className="border-b border-[var(--color-border)] border-opacity-40"
                  >
                    <td className="py-2 pr-4 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-primary)] whitespace-nowrap">
                      {p.type}
                    </td>
                    <td className="py-2 font-[var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-text-secondary)]">
                      {p.threshold}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
