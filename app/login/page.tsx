'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    setLoading(true)
    const supabase = createClient()

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        setLoading(false)
      } else {
        router.refresh()
        router.push('/scan')
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        setLoading(false)
      } else {
        setMessage({ type: 'info', text: 'Check your email for a confirmation link, then sign in.' })
        setMode('signin')
        setLoading(false)
      }
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-body)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  }

  const labelStyle = {
    display: 'block',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-nano)',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--color-text-muted)',
    marginBottom: 6,
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--color-base)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
      }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}>
            Lepios
          </h1>
          <p style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
          }}>
            {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              style={inputStyle}
            />
          </div>

          {message && (
            <div style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: message.type === 'error' ? 'var(--color-critical)' : 'var(--color-positive)',
              background: message.type === 'error' ? 'var(--color-critical-dim)' : 'var(--color-surface-2)',
              border: `1px solid ${message.type === 'error' ? 'var(--color-critical)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
            }}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-body)',
              fontWeight: 600,
              padding: '10px 24px',
              background: loading ? 'var(--color-surface-2)' : 'var(--color-accent-gold)',
              color: loading ? 'var(--color-text-disabled)' : 'var(--color-base)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 4,
            }}
          >
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{
          marginTop: 20,
          paddingTop: 20,
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
        }}>
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null) }}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              color: 'var(--color-text-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
