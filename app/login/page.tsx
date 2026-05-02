'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MODULES = [
  { emoji: '📊', label: 'BUSINESS' },
  { emoji: '📈', label: 'TRADING' },
  { emoji: '🧱', label: 'LEGO' },
  { emoji: '🏒', label: 'SPORTS' },
  { emoji: '💰', label: 'CASHBACK' },
  { emoji: '🖨️', label: '3D PRINT' },
  { emoji: '💪', label: 'HEALTH' },
]

type Mode = 'signin' | 'signup' | 'forgot'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)
  const [loading, setLoading] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setMessage(null)
    setPassword('')
    setConfirmPassword('')
    setShowPassword(false)
  }

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
        router.push('/business-review')
      }
    } else if (mode === 'signup') {
      if (password !== confirmPassword) {
        setMessage({ type: 'error', text: 'Passwords do not match.' })
        setLoading(false)
        return
      }
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setMessage({ type: 'error', text: error.message })
        setLoading(false)
      } else {
        setMessage({
          type: 'info',
          text: 'Check your email for a confirmation link, then sign in.',
        })
        switchMode('signin')
        setLoading(false)
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      })
      setLoading(false)
      if (error) {
        setMessage({ type: 'error', text: error.message })
      } else {
        setMessage({
          type: 'info',
          text: 'If that email is registered, a reset link has been sent.',
        })
      }
    }
  }

  const inputCls = 'w-full rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1'

  const labelCls = 'block text-xs font-semibold tracking-widest uppercase mb-1.5'

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-10"
      style={{ background: 'var(--color-base)' }}
    >
      {/* ── Header ── */}
      <div className="mb-6 text-center select-none">
        <h1
          className="mb-1 font-black tracking-[0.18em] uppercase"
          style={{
            fontFamily: 'var(--font-display, var(--font-ui))',
            fontSize: 'clamp(2.5rem, 8vw, 5rem)',
            color: 'var(--color-accent-gold)',
            textShadow: '0 0 60px rgba(212,175,55,0.25)',
          }}
        >
          LOEPPKY
        </h1>
        <p
          className="mb-0.5 text-xs tracking-[0.28em] uppercase"
          style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
        >
          Life &amp; Business Command Centre
        </p>
        <p
          className="text-xs tracking-[0.22em] uppercase"
          style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-disabled, #555)' }}
        >
          Edmonton · Alberta · Canada
        </p>
      </div>

      {/* ── Module icons ── */}
      <div className="mb-10 flex flex-wrap justify-center gap-5">
        {MODULES.map(({ emoji, label }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span className="text-2xl leading-none">{emoji}</span>
            <span
              className="tracking-widest uppercase"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.55rem',
                color: 'var(--color-text-disabled, #555)',
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Card ── */}
      <div
        className="w-full max-w-sm rounded-2xl p-7"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Tabs — hidden in forgot mode */}
        {mode !== 'forgot' && (
          <div className="mb-6 flex gap-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
            {(['signin', 'signup'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchMode(tab)}
                className="relative pb-3 text-sm font-semibold tracking-wide"
                style={{
                  fontFamily: 'var(--font-ui)',
                  color: mode === tab ? 'var(--color-accent-gold)' : 'var(--color-text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {tab === 'signin' ? 'Sign In' : 'Create Account'}
                {mode === tab && (
                  <span
                    className="absolute right-0 bottom-0 left-0 h-0.5 rounded-full"
                    style={{ background: 'var(--color-accent-gold)' }}
                  />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Forgot password header */}
        {mode === 'forgot' && (
          <div className="mb-5">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="mb-4 flex items-center gap-1 text-xs"
              style={{
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ← Back to Sign In
            </button>
            <p
              className="mb-1 text-base font-semibold"
              style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-primary)' }}
            >
              Reset Password
            </p>
            <p
              className="text-xs"
              style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
            >
              Enter your email and we&apos;ll send a reset link.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email */}
          <div>
            <label
              className={labelCls}
              style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              className={inputCls}
              style={{
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Password */}
          {mode !== 'forgot' && (
            <div>
              <label
                className={labelCls}
                style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className={`${inputCls} pr-10`}
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    fontFamily: 'var(--font-ui)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-base leading-none"
                  style={{
                    color: 'var(--color-text-muted)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          )}

          {/* Confirm Password — signup only */}
          {mode === 'signup' && (
            <div>
              <label
                className={labelCls}
                style={{ fontFamily: 'var(--font-ui)', color: 'var(--color-text-muted)' }}
              >
                Confirm Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={inputCls}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'var(--font-ui)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          )}

          {/* Message banner */}
          {message && (
            <div
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{
                fontFamily: 'var(--font-ui)',
                color: message.type === 'error' ? 'var(--color-critical)' : 'var(--color-positive)',
                background:
                  message.type === 'error' ? 'var(--color-critical-dim)' : 'var(--color-surface-2)',
                border: `1px solid ${
                  message.type === 'error' ? 'var(--color-critical)' : 'var(--color-border)'
                }`,
              }}
            >
              {message.text}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded-xl py-3 text-sm font-semibold tracking-wide transition-opacity"
            style={{
              fontFamily: 'var(--font-ui)',
              background: loading
                ? 'var(--color-surface-2)'
                : 'linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%)',
              color: loading ? 'var(--color-text-disabled)' : '#fff',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? '…'
              : mode === 'signin'
                ? 'Sign In'
                : mode === 'signup'
                  ? 'Create Account'
                  : 'Send Reset Link'}
          </button>

          {/* Forgot password link — sign in mode only */}
          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="mt-0.5 text-center text-xs"
              style={{
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Forgot password?
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
