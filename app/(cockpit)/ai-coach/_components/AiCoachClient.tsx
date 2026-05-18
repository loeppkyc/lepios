'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface Session {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

interface AiCoachClientProps {
  initialSessions: Session[]
}

export function AiCoachClient({ initialSessions }: AiCoachClientProps) {
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessions[0]?.id ?? null
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function loadSession(id: string) {
    setLoadingMessages(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-coach/sessions/${id}`)
      const json = (await res.json()) as { session?: { messages: Message[] }; error?: string }
      if (json.error) throw new Error(json.error)
      setMessages(Array.isArray(json.session?.messages) ? json.session.messages : [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingMessages(false)
    }
  }

  useEffect(() => {
    if (activeSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch triggers setState in callback, not synchronously
      loadSession(activeSessionId)
    }
  }, [activeSessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function createSession() {
    setError(null)
    try {
      const res = await fetch('/api/ai-coach/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New session' }),
      })
      const json = (await res.json()) as { session?: Session; error?: string }
      if (json.error) throw new Error(json.error)
      if (json.session) {
        setSessions((prev) => [json.session!, ...prev])
        setActiveSessionId(json.session.id)
        setMessages([])
      }
    } catch (e) {
      setError(String(e))
    }
  }

  async function deleteSession(id: string) {
    try {
      await fetch(`/api/ai-coach/sessions/${id}`, { method: 'DELETE' })
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        setActiveSessionId(remaining[0]?.id ?? null)
        setMessages([])
      }
    } catch (e) {
      setError(String(e))
    }
  }

  async function sendMessage() {
    if (!inputValue.trim() || !activeSessionId || sending) return
    const text = inputValue.trim()
    setInputValue('')
    setSending(true)
    setError(null)

    // Optimistic user message
    const optimisticMsg: Message = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      const res = await fetch('/api/ai-coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSessionId, message: text }),
      })
      const json = (await res.json()) as { message?: string; title?: string; error?: string }
      if (json.error) throw new Error(json.error)

      const assistantMsg: Message = {
        role: 'assistant',
        content: json.message ?? '',
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])

      // Update session title if returned
      if (json.title) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, title: json.title!, updated_at: new Date().toISOString() }
              : s
          )
        )
      }
    } catch (e) {
      setError(String(e))
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m !== optimisticMsg))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-160px)] gap-4">
      {/* Session sidebar */}
      <div className="flex w-56 flex-shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <Button onClick={createSession} className="w-full text-xs" variant="outline">
          + New Session
        </Button>
        {sessions.length === 0 && (
          <p className="mt-4 text-center text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex cursor-pointer items-start justify-between gap-1 rounded px-2 py-2 text-xs transition-colors ${
              s.id === activeSessionId
                ? 'bg-[var(--color-rail)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-border)]'
            }`}
            onClick={() => setActiveSessionId(s.id)}
          >
            <span className="line-clamp-2 flex-1 leading-tight">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(s.id)
              }}
              className="hidden text-xs leading-none text-[var(--color-text-disabled)] group-hover:block hover:text-red-400"
              title="Delete session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Messages */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {loadingMessages && (
            <p className="text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
              Loading…
            </p>
          )}
          {!activeSessionId && !loadingMessages && (
            <p className="mt-8 text-center text-[length:var(--text-small)] text-[var(--color-text-muted)]">
              Select or create a session to start coaching.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--color-rail)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-border)] text-[var(--color-text-primary)]'
                }`}
              >
                <p className="m-0 whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && <div className="mx-4 mb-2 text-xs text-red-400">{error}</div>}

        {/* Input */}
        <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={
              activeSessionId ? 'Message your coach… (Enter to send)' : 'Create a session first'
            }
            disabled={!activeSessionId || sending}
            className="flex-1 resize-none rounded border border-[var(--color-border)] bg-[var(--color-base)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] focus:ring-1 focus:ring-[var(--color-rail)] focus:outline-none disabled:opacity-50"
            rows={2}
          />
          <Button
            onClick={sendMessage}
            disabled={!activeSessionId || !inputValue.trim() || sending}
            className="self-end"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
