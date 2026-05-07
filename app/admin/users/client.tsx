'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { UserProfile, UserRole } from '@/lib/auth/roles'

interface InviteCode {
  code: string
  max_uses: number
  uses_count: number
  expires_at: string | null
  created_at: string
  note: string | null
}

const ROLES: UserRole[] = ['admin', 'business', 'personal', 'accountant', 'pending']

interface Props {
  profiles: UserProfile[]
  invites: InviteCode[]
  currentUserId: string
}

export default function AdminUsersClient({ profiles, invites, currentUserId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [newCodeUses, setNewCodeUses] = useState(1)
  const [newCodeNote, setNewCodeNote] = useState('')

  async function changeRole(userId: string, role: UserRole) {
    setError(null)
    setInfo(null)
    const res = await fetch('/api/admin/users/role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to change role')
      return
    }
    setInfo('Role updated.')
    startTransition(() => router.refresh())
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: newCode.trim(),
        max_uses: newCodeUses,
        note: newCodeNote.trim() || null,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to create invite')
      return
    }
    setInfo('Invite code created.')
    setNewCode('')
    setNewCodeNote('')
    setNewCodeUses(1)
    startTransition(() => router.refresh())
  }

  async function deleteInvite(code: string) {
    setError(null)
    setInfo(null)
    const res = await fetch(`/api/admin/invites?code=${encodeURIComponent(code)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to delete invite')
      return
    }
    setInfo('Invite deleted.')
    startTransition(() => router.refresh())
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-bold tracking-wide text-[var(--color-accent-gold)] uppercase">
        Admin · Users
      </h1>
      <p className="mb-8 text-sm text-[var(--color-text-muted)]">
        Manage account roles and invite codes. New users start as <code>pending</code> and
        can&apos;t access anything until you assign a role here.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-critical)] bg-[var(--color-critical-dim)] px-3 py-2 text-sm text-[var(--color-critical)]">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-positive)]">
          {info}
        </div>
      )}

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
          Users ({profiles.length})
        </h2>
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Email</th>
                <th className="px-4 py-2 text-left font-semibold">Role</th>
                <th className="px-4 py-2 text-left font-semibold">Created</th>
                <th className="px-4 py-2 text-left font-semibold">Approved</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const isSelf = p.user_id === currentUserId
                return (
                  <tr
                    key={p.user_id}
                    className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{p.email}</td>
                    <td className="px-4 py-2">
                      <select
                        value={p.role}
                        disabled={isSelf || isPending}
                        onChange={(e) => changeRole(p.user_id, e.target.value as UserRole)}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {isSelf && (
                        <span className="ml-2 text-xs text-[var(--color-text-muted)]">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {p.approved_at ? new Date(p.approved_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
          Invite Codes ({invites.length})
        </h2>

        <form
          onSubmit={createInvite}
          className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <label className="min-w-[180px] flex-1 text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            Code
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)]"
              placeholder="megan-2026"
            />
          </label>
          <label className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            Max Uses
            <input
              type="number"
              min={1}
              value={newCodeUses}
              onChange={(e) => setNewCodeUses(Number(e.target.value))}
              required
              className="mt-1 block w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <label className="min-w-[160px] flex-1 text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
            Note
            <input
              type="text"
              value={newCodeNote}
              onChange={(e) => setNewCodeNote(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
              placeholder="for Megan"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-[var(--color-accent-gold)] px-4 py-1.5 text-sm font-semibold text-[var(--color-base)] disabled:opacity-50"
          >
            Create
          </button>
        </form>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Code</th>
                <th className="px-4 py-2 text-left font-semibold">Used</th>
                <th className="px-4 py-2 text-left font-semibold">Note</th>
                <th className="px-4 py-2 text-left font-semibold">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]"
                  >
                    No invite codes. Create one above to grant signup access.
                  </td>
                </tr>
              )}
              {invites.map((inv) => {
                const exhausted = inv.uses_count >= inv.max_uses
                return (
                  <tr
                    key={inv.code}
                    className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{inv.code}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={exhausted ? 'text-[var(--color-text-muted)]' : ''}>
                        {inv.uses_count} / {inv.max_uses}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {inv.note ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => deleteInvite(inv.code)}
                        className="text-xs text-[var(--color-critical)] hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
