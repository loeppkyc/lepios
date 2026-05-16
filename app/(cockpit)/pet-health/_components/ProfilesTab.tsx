'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PetRow } from '../_lib/queries'
import {
  buttonPrimary,
  cardStyle,
  captionStyle,
  Disclosure,
  EmptyState,
  inputStyle,
  labelStyle,
  sectionTitle,
  StatusLine,
} from './PetCommon'

const today = () => new Date().toISOString().slice(0, 10)

const SPECIES_OPTIONS = ['cat', 'dog', 'other'] as const
const FIXED_OPTIONS = ['yes', 'no', 'unknown'] as const

export function ProfilesTab({ pets }: { pets: PetRow[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<'cat' | 'dog' | 'other'>('dog')
  const [breed, setBreed] = useState('')
  const [dob, setDob] = useState('')
  const [weightLbs, setWeightLbs] = useState('')
  const [colour, setColour] = useState('')
  const [microchip, setMicrochip] = useState('')
  const [fixed, setFixed] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setStatus({ tone: 'error', message: 'Enter a pet name' })
      return
    }
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await fetch('/api/pet/pets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          species,
          breed,
          dob: dob || null,
          weight_lbs: weightLbs ? parseFloat(weightLbs) : null,
          colour,
          microchip,
          fixed,
          notes,
        }),
      })
      const body = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !body.ok) {
        setStatus({ tone: 'error', message: body.error ?? `HTTP ${res.status}` })
      } else {
        setName('')
        setBreed('')
        setDob('')
        setWeightLbs('')
        setColour('')
        setMicrochip('')
        setNotes('')
        setStatus({ tone: 'ok', message: 'Saved.' })
        router.refresh()
      }
    } catch (err) {
      setStatus({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Disclosure title="+ Add Pet">
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Pet Name</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Max, Luna"
                style={inputStyle}
                required
              />
            </label>
            <label>
              <div style={labelStyle}>Species</div>
              <select
                value={species}
                onChange={(e) => setSpecies(e.target.value as 'cat' | 'dog' | 'other')}
                style={inputStyle}
              >
                {SPECIES_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <div style={labelStyle}>Breed</div>
              <input
                type="text"
                value={breed}
                onChange={(e) => setBreed(e.target.value)}
                placeholder="e.g. Golden Retriever"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Date of Birth</div>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Weight (lbs)</div>
              <input
                type="number"
                min="0"
                step="0.1"
                value={weightLbs}
                onChange={(e) => setWeightLbs(e.target.value)}
                placeholder="e.g. 12.5"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Colour / Markings</div>
              <input
                type="text"
                value={colour}
                onChange={(e) => setColour(e.target.value)}
                placeholder="e.g. Black & white"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Fixed?</div>
              <select
                value={fixed}
                onChange={(e) => setFixed(e.target.value as 'yes' | 'no' | 'unknown')}
                style={inputStyle}
              >
                {FIXED_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <div style={labelStyle}>Microchip # (optional)</div>
              <input
                type="text"
                value={microchip}
                onChange={(e) => setMicrochip(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label>
              <div style={labelStyle}>Notes</div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Allergies, special needs, etc."
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={submitting} style={buttonPrimary}>
              {submitting ? 'Saving…' : 'Add Pet'}
            </button>
            <StatusLine status={status} />
          </div>
        </form>
      </Disclosure>

      {pets.length === 0 ? (
        <EmptyState message="No pets added yet. Use the form above to add your first pet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pets.map((pet) => (
            <div key={pet.id} style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span style={sectionTitle}>{pet.name}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-disabled)',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px 8px',
                  }}
                >
                  {pet.species}
                </span>
                {pet.breed && (
                  <span
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {pet.breed}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 8,
                }}
              >
                {pet.dob && (
                  <div>
                    <div style={captionStyle}>Date of Birth</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {pet.dob}
                    </div>
                  </div>
                )}
                {pet.weight_lbs != null && (
                  <div>
                    <div style={captionStyle}>Weight</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {pet.weight_lbs} lbs
                    </div>
                  </div>
                )}
                <div>
                  <div style={captionStyle}>Fixed</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-small)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {pet.fixed.charAt(0).toUpperCase() + pet.fixed.slice(1)}
                  </div>
                </div>
                {pet.colour && (
                  <div>
                    <div style={captionStyle}>Colour</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {pet.colour}
                    </div>
                  </div>
                )}
                {pet.microchip && (
                  <div>
                    <div style={captionStyle}>Microchip</div>
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-small)',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {pet.microchip}
                    </div>
                  </div>
                )}
              </div>
              {pet.notes && (
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-nano)',
                    color: 'var(--color-text-disabled)',
                  }}
                >
                  {pet.notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
