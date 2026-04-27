'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const NAV_LINKS = [
  { href: '/scan', label: 'Scan' },
  { href: '/hit-lists', label: 'Lists' },
  { href: '/autonomous', label: 'Autonomous' },
  { href: '/business-review', label: 'Business Review' },
  { href: '/utility', label: 'Utility' },
]

export function CockpitNav() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
    })
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSignOutError(error.message)
      setSigningOut(false)
      return
    }
    router.push('/login')
  }

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: '1px solid var(--color-border)',
        padding: '0 16px',
        background: 'var(--color-base)',
      }}
    >
      {NAV_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
            padding: '10px 14px',
            display: 'inline-block',
            transition: 'color var(--transition-fast)',
          }}
        >
          {label}
        </Link>
      ))}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {signOutError && (
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-critical)',
            }}
          >
            {signOutError}
          </span>
        )}
        {email && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-disabled)',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={email}
          >
            {email}
          </span>
        )}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            padding: '5px 10px',
            background: 'none',
            color: signingOut ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: signingOut ? 'not-allowed' : 'pointer',
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </nav>
  )
}
