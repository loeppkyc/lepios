'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownMessage } from '@/components/orb/MarkdownMessage'

const CHAT_MODEL = process.env.NEXT_PUBLIC_OLLAMA_CHAT_MODEL ?? 'qwen2.5-coder:3b'

type Conversation = {
  id: string
  title: string | null
  message_count: number
  updated_at: string
}

type DBMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: Array<{ type: string; text?: string }>
  created_at: string
}

function dbMessagesToUIMessages(rows: DBMessage[]): UIMessage[] {
  return rows.map(
    (m) =>
      ({
        id: m.id,
        role: m.role,
        parts: m.content,
      }) as unknown as UIMessage,
  )
}

function ToolCallCard({
  toolName,
  state,
  output,
}: {
  toolName: string
  state: string
  output?: unknown
}) {
  if (state === 'input-streaming' || state === 'input-available') {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
        <span className="animate-pulse">&#x23F3;</span>
        <span>{toolName}</span>
      </div>
    )
  }

  // output-available, output-error, output-denied, or any terminal state
  const outputStr =
    output === null || output === undefined
      ? '(no result)'
      : typeof output === 'string'
        ? output
        : JSON.stringify(output, null, 2)
  const preview = outputStr.length > 400 ? outputStr.slice(0, 400) + '…' : outputStr

  return (
    <details className="rounded-sm border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)]">
      <summary className="cursor-pointer text-[var(--color-text-muted)]">
        &#x2713; {toolName}
      </summary>
      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[var(--color-text)]">
        {preview}
      </pre>
    </details>
  )
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [chatKey, setChatKey] = useState(0)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations')
    if (res.ok) setConversations(await res.json())
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  async function selectConversation(id: string) {
    if (id === activeId) return
    const res = await fetch(`/api/chat/conversations/${id}/messages`)
    const initial: UIMessage[] = res.ok
      ? dbMessagesToUIMessages(await res.json())
      : []
    setInitialMessages(initial)
    setActiveId(id)
    setChatKey((k) => k + 1)
  }

  function startNewChat() {
    setActiveId(null)
    setInitialMessages([])
    setChatKey((k) => k + 1)
  }

  function handleConversationCreated(id: string) {
    setActiveId(id)
    loadConversations()
  }

  return (
    <div className="flex h-[calc(100vh-48px)] bg-[var(--color-base)]">
      {/* sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--color-border)] md:flex">
        <div className="p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-ui)] text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {conversations.length === 0 && (
            <p className="px-3 py-2 font-[family-name:var(--font-ui)] text-xs text-[var(--color-text-disabled)]">
              No conversations yet.
            </p>
          )}
          {conversations.map((conv) => {
            const isActive = conv.id === activeId
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => selectConversation(conv.id)}
                className={`mb-0.5 block w-full rounded-[var(--radius-sm)] px-3 py-2 text-left font-[family-name:var(--font-ui)] text-xs transition-colors ${
                  isActive
                    ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
                }`}
              >
                <span className="block truncate">{conv.title ?? 'Untitled'}</span>
                <span className="mt-0.5 block text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
                  {conv.message_count} {conv.message_count === 1 ? 'msg' : 'msgs'}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* main pane (key remount on conversation switch) */}
      <ActiveChat
        key={chatKey}
        conversationId={activeId}
        initialMessages={initialMessages}
        onConversationCreated={handleConversationCreated}
      />
    </div>
  )
}

function ActiveChat({
  conversationId,
  initialMessages,
  onConversationCreated,
}: {
  conversationId: string | null
  initialMessages: UIMessage[]
  onConversationCreated: (id: string) => void
}) {
  const conversationIdRef = useRef<string | null>(conversationId)
  const onCreatedRef = useRef(onConversationCreated)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onCreatedRef.current = onConversationCreated
  }, [onConversationCreated])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({ conversationId: conversationIdRef.current }),
        fetch: async (url, options) => {
          const res = await fetch(url as RequestInfo, options as RequestInit)
          const newId = res.headers.get('x-conversation-id')
          if (newId && !conversationIdRef.current) {
            conversationIdRef.current = newId
            onCreatedRef.current(newId)
          }
          return res
        },
      }),
    [],
  )

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  })

  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages)
    }
    // intentionally only on mount — initialMessages is captured via the parent's key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isStreaming = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    sendMessage({ text })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* identity strip */}
      <div className="flex items-baseline gap-3 border-b border-[var(--color-border)] bg-[var(--color-base)] px-4 py-3">
        <span className="font-[family-name:var(--font-ui)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-text)]">
          LEPIOS
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
          running on {CHAT_MODEL}
        </span>
      </div>

      {/* message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.length === 0 && (
            <p className="text-center font-[family-name:var(--font-ui)] text-sm text-[var(--color-text-disabled)]">
              Say something to start a conversation.
            </p>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === 'user'
            const isLast = msg === messages[messages.length - 1]
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-[var(--radius-md)] px-4 py-2 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-[var(--color-accent)] text-[var(--color-base)]'
                      : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]'
                  }`}
                >
                  {msg.parts.map((part, i) => {
                    if (isToolUIPart(part)) {
                      const name = getToolName(part)
                      return (
                        <ToolCallCard
                          key={i}
                          toolName={name}
                          state={part.state}
                          output={'output' in part ? part.output : undefined}
                        />
                      )
                    }
                    if (part.type !== 'text') return null
                    if (isUser) {
                      return (
                        <span key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </span>
                      )
                    }
                    return <MarkdownMessage key={i} content={part.text} />
                  })}
                  {/* streaming cursor on the last assistant message, after markdown render */}
                  {!isUser && isLast && isStreaming && (
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-[var(--color-text-muted)] align-text-bottom" />
                  )}
                </div>
              </div>
            )
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* input bar */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-base)] px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message LEPIOS… (Ctrl+Enter to send)"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-[family-name:var(--font-ui)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 font-[family-name:var(--font-ui)] text-sm font-semibold text-[var(--color-base)] transition-opacity disabled:opacity-40"
          >
            {isStreaming ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
