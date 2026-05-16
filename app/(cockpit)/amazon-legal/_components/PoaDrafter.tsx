'use client'

import { useState } from 'react'
import { logEvent } from '@/lib/knowledge/client'

// F18: clipboard copy events logged to agent_events (draft_acceptance signal)

interface DraftResponse {
  draft: string
  suspensionType: string
  durationMs: number
}

export function PoaDrafter() {
  const [noticeText, setNoticeText] = useState('')
  const [draft, setDraft] = useState('')
  const [editedDraft, setEditedDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [suspensionType, setSuspensionType] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)

  async function handleDraftPoA() {
    if (!noticeText.trim()) return
    setLoading(true)
    setError(null)
    setDraft('')
    setEditedDraft('')
    setCopied(false)
    setSuspensionType(null)
    setDurationMs(null)

    try {
      const response = await fetch('/api/amazon/draft-poa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeText }),
      })

      const data = (await response.json()) as {
        draft?: string
        suspensionType?: string
        durationMs?: number
        error?: string
      }

      if (!response.ok) {
        setError(data.error ?? `Request failed (${response.status})`)
        return
      }

      const result = data as DraftResponse
      setDraft(result.draft)
      setEditedDraft(result.draft)
      setSuspensionType(result.suspensionType)
      setDurationMs(result.durationMs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopyToClipboard() {
    if (!editedDraft) return
    try {
      await navigator.clipboard.writeText(editedDraft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)

      // F18: log clipboard copy (draft acceptance signal)
      void logEvent('amazon_legal', 'poa_clipboard_copy', {
        actor: 'colin', // SPRINT5-GATE
        status: 'success',
        meta: {
          suspension_type: suspensionType,
          draft_length: editedDraft.length,
          was_edited: editedDraft !== draft,
        },
      })
    } catch {
      setError('Clipboard copy failed — please select all text and copy manually.')
    }
  }

  return (
    <div
      style={{
        maxWidth: 860,
        margin: '0 auto',
      }}
    >
      {/* Input section */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '20px 24px',
          marginBottom: 20,
        }}
      >
        <label
          htmlFor="notice-text"
          style={{
            display: 'block',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 8,
            letterSpacing: '0.02em',
          }}
        >
          Paste Suspension Notice
        </label>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-nano)',
            color: 'var(--color-text-muted)',
            margin: '0 0 12px',
          }}
        >
          Paste the full Amazon suspension or policy warning notice below. The more context you
          provide, the more specific the Plan of Action.
        </p>
        <textarea
          id="notice-text"
          value={noticeText}
          onChange={(e) => setNoticeText(e.target.value)}
          placeholder="We are writing to let you know that your selling account has been deactivated..."
          rows={8}
          style={{
            width: '100%',
            backgroundColor: 'var(--color-base)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-small)',
            padding: '10px 12px',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 12,
          }}
        >
          <button
            onClick={handleDraftPoA}
            disabled={loading || !noticeText.trim()}
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-small)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              padding: '8px 20px',
              backgroundColor:
                loading || !noticeText.trim()
                  ? 'var(--color-surface-2)'
                  : 'var(--color-accent-gold)',
              color:
                loading || !noticeText.trim() ? 'var(--color-text-disabled)' : 'var(--color-base)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: loading || !noticeText.trim() ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s ease',
            }}
          >
            {loading ? 'Drafting…' : 'Draft PoA'}
          </button>

          {loading && (
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-muted)',
              }}
            >
              Contacting Claude — typically 3–8 seconds
            </span>
          )}

          {durationMs !== null && !loading && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-nano)',
                color: 'var(--color-text-disabled)',
              }}
            >
              {durationMs.toLocaleString()}ms
              {suspensionType ? ` · ${suspensionType.replace(/_/g, ' ')}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-critical)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 18px',
            marginBottom: 20,
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-critical)',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Draft output */}
      {editedDraft && (
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '20px 24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <label
              htmlFor="draft-output"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-small)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                letterSpacing: '0.02em',
              }}
            >
              Drafted Plan of Action
            </label>
            <button
              onClick={handleCopyToClipboard}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                padding: '5px 14px',
                backgroundColor: copied ? 'var(--color-positive)' : 'var(--color-surface-2)',
                color: copied ? 'var(--color-base)' : 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease, color 0.15s ease',
              }}
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>

          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              color: 'var(--color-text-muted)',
              margin: '0 0 10px',
            }}
          >
            Edit the draft below before submitting to Amazon. The draft is not saved — copy to
            clipboard before navigating away.
          </p>

          <textarea
            id="draft-output"
            value={editedDraft}
            onChange={(e) => setEditedDraft(e.target.value)}
            rows={20}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-base)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-small)',
              lineHeight: 1.6,
              padding: '10px 12px',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}
    </div>
  )
}
