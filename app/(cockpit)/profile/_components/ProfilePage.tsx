'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ProfileResponse } from '@/lib/profile/types'

const ALL_MODULES = [
  'Amazon',
  'Bookkeeping',
  'Betting & Trading',
  'Personal Finance',
  'Health',
  'Family',
  'Deals & Savings',
  'System',
]

const inputCls =
  'w-full rounded-md border border-border bg-cockpit-surface px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-gold)]'

export function ProfilePage() {
  const [data, setData] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // display name form
  const [displayName, setDisplayName] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // password form
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // module prefs
  const [selectedMods, setSelectedMods] = useState<string[]>([])
  const [modSaving, setModSaving] = useState(false)
  const [modMsg, setModMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setDisplayName(d.profile?.display_name ?? '')
        setSelectedMods(d.profile?.module_prefs ?? [])
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load profile')
        setLoading(false)
      })
  }, [])

  async function saveName() {
    setNameSaving(true)
    setNameMsg(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName.trim() }),
    })
    setNameSaving(false)
    if (res.ok) setNameMsg({ ok: true, text: 'Display name updated.' })
    else {
      const e = await res.json()
      setNameMsg({ ok: false, text: e.error ?? 'Failed to save' })
    }
  }

  async function savePassword() {
    if (!newPw || newPw.length < 8) {
      setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' })
      return
    }
    if (newPw !== confirmPw) {
      setPwMsg({ ok: false, text: 'Passwords do not match.' })
      return
    }
    setPwSaving(true)
    setPwMsg(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPw }),
    })
    setPwSaving(false)
    if (res.ok) {
      setPwMsg({ ok: true, text: 'Password updated.' })
      setNewPw('')
      setConfirmPw('')
    } else {
      const e = await res.json()
      setPwMsg({ ok: false, text: e.error ?? 'Failed to update password' })
    }
  }

  async function saveModules() {
    setModSaving(true)
    setModMsg(null)
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_prefs: selectedMods }),
    })
    setModSaving(false)
    if (res.ok) setModMsg({ ok: true, text: 'Preferences saved.' })
    else {
      const e = await res.json()
      setModMsg({ ok: false, text: e.error ?? 'Failed to save' })
    }
  }

  function toggleModule(mod: string) {
    setSelectedMods((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]))
  }

  if (loading)
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-[var(--color-text-secondary)]">
        Loading…
      </div>
    )
  if (error) return <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-red-400">{error}</div>
  if (!data) return null

  const { profile, auth_email, auth_created_at } = data
  const displayLabel = profile.display_name || auth_email.split('@')[0]

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">My Profile</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Account info and preferences
        </p>
      </div>

      {/* Account Info */}
      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Account Info</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">Name</p>
            <p className="text-sm text-[var(--color-text-primary)]">{displayLabel}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">Role</p>
            <p className="text-sm text-[var(--color-text-primary)] capitalize">{profile.role}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">Email</p>
            <p className="text-sm text-[var(--color-text-primary)]">{auth_email}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">Member since</p>
            <p className="text-sm text-[var(--color-text-primary)]">
              {new Date(auth_created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </section>

      {/* Display Name */}
      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Display Name</h2>
        <input
          type="text"
          className={inputCls}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          maxLength={60}
        />
        {nameMsg && (
          <p className={`text-xs ${nameMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
            {nameMsg.text}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={saveName} disabled={nameSaving}>
          {nameSaving ? 'Saving…' : 'Update Name'}
        </Button>
      </section>

      {/* Change Password */}
      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Change Password</h2>
        <input
          type="password"
          className={inputCls}
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          placeholder="New password (min 8 chars)"
        />
        <input
          type="password"
          className={inputCls}
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          placeholder="Confirm new password"
        />
        {pwMsg && (
          <p className={`text-xs ${pwMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{pwMsg.text}</p>
        )}
        <Button size="sm" onClick={savePassword} disabled={pwSaving}>
          {pwSaving ? 'Updating…' : 'Update Password'}
        </Button>
      </section>

      {/* Module Preferences */}
      <section className="border-border space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Module Preferences
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Choose which categories appear in your sidebar.
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_MODULES.map((mod) => {
            const active = selectedMods.includes(mod)
            return (
              <button
                key={mod}
                onClick={() => toggleModule(mod)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[var(--color-accent-gold)] bg-[var(--color-accent-gold)]/10 text-[var(--color-accent-gold)]'
                    : 'border-border text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
                }`}
              >
                {mod}
              </button>
            )
          })}
        </div>
        {modMsg && (
          <p className={`text-xs ${modMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
            {modMsg.text}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={saveModules} disabled={modSaving}>
          {modSaving ? 'Saving…' : 'Save Preferences'}
        </Button>
      </section>
    </div>
  )
}
