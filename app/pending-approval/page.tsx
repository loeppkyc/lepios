'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PendingApprovalPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
    router.push('/login')
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-10"
      style={{ background: 'var(--color-base)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="mb-4 text-4xl">⏳</div>
        <h1
          className="mb-3 text-xl font-bold tracking-wide uppercase"
          style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-accent-gold)' }}
        >
          Pending Approval
        </h1>
        <p
          className="mb-2 text-sm"
          style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-primary)' }}
        >
          Your account is created but not yet activated.
        </p>
        <p
          className="mb-6 text-sm"
          style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
        >
          Colin has been notified and will assign your access level. Check back shortly.
        </p>

        {email && (
          <p
            className="mb-6 rounded-lg px-3 py-2 text-xs"
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              background: 'var(--color-surface-2)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            Signed in as {email}
          </p>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full rounded-xl py-2.5 text-sm font-semibold tracking-wide"
          style={{
            fontFamily: 'var(--font-ui)',
            background: 'var(--color-surface-2)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            cursor: signingOut ? 'not-allowed' : 'pointer',
            opacity: signingOut ? 0.6 : 1,
          }}
        >
          {signingOut ? '…' : 'Sign Out'}
        </button>
      </div>
    </div>
  )
}
