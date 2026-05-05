'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai'
import type { UIMessage } from 'ai'
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { MarkdownMessage } from '@/components/orb/MarkdownMessage'
import {
  ALLOWED_EXTENSIONS,
  combineTextAndFiles,
  validateAndProcessText,
  type AttachedFile,
} from '@/lib/orb/file-upload'

const CHAT_MODEL = process.env.NEXT_PUBLIC_OLLAMA_CHAT_MODEL ?? 'qwen2.5-coder:3b'

const FILE_ACCEPT_ATTR = ALLOWED_EXTENSIONS.join(',')

export type ConversationSummary = {
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
      }) as unknown as UIMessage
  )
}

class ChatErrorBoundary extends Component<
  { children: ReactNode; resetKey: number },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey: number }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[chat-render-error]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 py-10 font-[family-name:var(--font-mono)] text-sm text-[var(--color-text)]">
          <div className="max-w-xl rounded-[var(--radius-md)] border border-[var(--color-critical)] bg-[var(--color-surface)] p-4">
            <div className="mb-2 font-semibold text-[var(--color-critical)]">
              Chat render crashed
            </div>
            <pre className="mb-3 max-h-48 overflow-auto text-[length:var(--text-nano)] whitespace-pre-wrap text-[var(--color-text-muted)]">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack ?? ''}
            </pre>
            <p className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
              Pick another conversation or start a new chat. Full error in browser console.
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function ConvRow({
  conv,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  conv: ConversationSummary
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setDraft(conv.title ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== (conv.title ?? '')) onRename(trimmed)
  }

  return (
    <div className="group relative mb-0.5">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="block w-full rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 font-[family-name:var(--font-ui)] text-xs text-[var(--color-text)] ring-1 ring-[var(--color-accent)] outline-none"
          maxLength={100}
          autoFocus
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={startEdit}
            className={`block w-full rounded-[var(--radius-sm)] px-3 py-2 pr-7 text-left font-[family-name:var(--font-ui)] text-xs transition-colors ${
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
          <button
            type="button"
            title="Delete conversation"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded px-1 py-0.5 text-[length:var(--text-nano)] text-[var(--color-text-disabled)] transition-colors group-hover:block hover:text-[var(--color-critical)]"
          >
            &#x2715;
          </button>
        </>
      )}
    </div>
  )
}

function isPendingApproval(output: unknown): output is { preview: Record<string, unknown> } {
  if (output === null || typeof output !== 'object') return false
  const o = output as Record<string, unknown>
  return (
    'preview' in o &&
    o.preview !== null &&
    typeof o.preview === 'object' &&
    (o.written === false || o.sent === false || o.queued === false)
  )
}

function ToolCallCard({
  toolName,
  state,
  output,
  onApprove,
}: {
  toolName: string
  state: string
  output?: unknown
  onApprove?: () => void
}) {
  const [dismissed, setDismissed] = useState(false)

  if (state === 'input-streaming' || state === 'input-available') {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]">
        <span className="animate-pulse">&#x23F3;</span>
        <span>{toolName}</span>
      </div>
    )
  }

  // Pending approval: dry-run result with preview — show approve/cancel card
  if (!dismissed && isPendingApproval(output) && onApprove) {
    const previewStr = JSON.stringify(output.preview, null, 2)
    const previewTruncated = previewStr.length > 400 ? previewStr.slice(0, 400) + '…' : previewStr
    return (
      <div className="rounded-sm border border-[var(--color-accent)] px-3 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)]">
        <div className="mb-2 font-semibold text-[var(--color-accent)]">
          &#x26A1; {toolName} — preview
        </div>
        <pre className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap text-[var(--color-text)]">
          {previewTruncated}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-[var(--color-base)]"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]"
          >
            Cancel
          </button>
        </div>
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
  const outputTruncated = outputStr.length > 400 ? outputStr.slice(0, 400) + '…' : outputStr

  return (
    <details className="rounded-sm border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)]">
      <summary className="cursor-pointer text-[var(--color-text-muted)]">
        &#x2713; {toolName}
      </summary>
      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[var(--color-text)]">
        {outputTruncated}
      </pre>
    </details>
  )
}

export function ChatClient({
  initialConversations,
}: {
  initialConversations: ConversationSummary[]
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [chatKey, setChatKey] = useState(0)
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([])
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations')
    if (res.ok) setConversations(await res.json())
  }, [])

  async function selectConversation(id: string) {
    if (id === activeId) return
    const res = await fetch(`/api/chat/conversations/${id}/messages`)
    const initial: UIMessage[] = res.ok ? dbMessagesToUIMessages(await res.json()) : []
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
      {/* mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* sidebar */}
      <aside
        className={`${mobileSidebarOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-base)] md:relative md:flex`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1.5 font-[family-name:var(--font-ui)] text-xs font-semibold tracking-wider text-[var(--color-text-muted)] uppercase transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
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
          {conversations.map((conv) => (
            <ConvRow
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeId}
              onSelect={() => selectConversation(conv.id)}
              onDelete={async () => {
                await fetch(`/api/chat/conversations/${conv.id}`, { method: 'DELETE' })
                if (conv.id === activeId) startNewChat()
                loadConversations()
              }}
              onRename={async (title) => {
                await fetch(`/api/chat/conversations/${conv.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title }),
                })
                loadConversations()
              }}
            />
          ))}
        </div>
      </aside>

      {/* main pane (key remount on conversation switch) */}
      <ChatErrorBoundary resetKey={chatKey}>
        <ActiveChat
          key={chatKey}
          conversationId={activeId}
          initialMessages={initialMessages}
          onConversationCreated={handleConversationCreated}
          onMenuClick={() => setMobileSidebarOpen((v) => !v)}
        />
      </ChatErrorBoundary>
    </div>
  )
}

function ActiveChat({
  conversationId,
  initialMessages,
  onConversationCreated,
  onMenuClick,
}: {
  conversationId: string | null
  initialMessages: UIMessage[]
  onConversationCreated: (id: string) => void
  onMenuClick?: () => void
}) {
  const conversationIdRef = useRef<string | null>(conversationId)
  const onCreatedRef = useRef(onConversationCreated)
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onCreatedRef.current = onConversationCreated
  }, [onConversationCreated])

  // useChat's internal chatRef captures the transport on first render only —
  // later transport instances are dropped — so memoizing here is unnecessary.
  // Re-creating per render is cheap (just closures + an object literal).
  // body() and the fetch wrapper run when the chat machinery posts a request,
  // not during render, so the .current access inside them is deferred and
  // safe; react-hooks/refs flags it transitively, hence the one targeted
  // disable.
  // eslint-disable-next-line react-hooks/refs
  const transport = new DefaultChatTransport({
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
  })

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
  })

  const isStreaming = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if ((!text && files.length === 0) || isStreaming) return
    const combined = combineTextAndFiles(text, files)
    setInput('')
    setFiles([])
    setUploadError(null)
    sendMessage({ text: combined })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? [])
    if (incoming.length === 0) return

    let totalBytes = files.reduce((sum, f) => sum + f.size, 0)
    let count = files.length
    const accepted: AttachedFile[] = []
    let firstError: string | null = null

    for (const file of incoming) {
      const text = await file.text()
      const result = validateAndProcessText(file.name, text, totalBytes, count)
      if (result.ok) {
        accepted.push(result.file)
        totalBytes += result.file.size
        count += 1
      } else if (!firstError) {
        firstError = result.error
      }
    }

    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted])
    }
    setUploadError(firstError)
    // Reset the input so the same file can be re-selected if removed.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setUploadError(null)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* identity strip */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-base)] px-4 py-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="mr-1 flex-shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)] md:hidden"
            aria-label="Toggle sidebar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="2" y="4" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="2" y="8.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="2" y="12.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
            </svg>
          </button>
        )}
        <span className="font-[family-name:var(--font-ui)] text-sm font-bold tracking-[0.12em] text-[var(--color-text)] uppercase">
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
              <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
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
                          onApprove={() =>
                            sendMessage({ text: 'Approved. Please execute now (dryRun: false).' })
                          }
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
        <div className="mx-auto max-w-2xl">
          {(files.length > 0 || uploadError) && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-[family-name:var(--font-mono)] text-[length:var(--text-nano)] text-[var(--color-text-muted)]"
                >
                  <span>{f.name}</span>
                  <span className="text-[var(--color-text-disabled)]">
                    {f.size}B{f.truncated ? ' (trunc)' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${f.name}`}
                    className="ml-0.5 text-[var(--color-text-disabled)] hover:text-[var(--color-text)]"
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploadError && (
                <span className="font-[family-name:var(--font-ui)] text-[length:var(--text-nano)] text-[var(--color-error)]">
                  {uploadError}
                </span>
              )}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={FILE_ACCEPT_ATTR}
              onChange={handleFileChange}
              className="hidden"
              aria-hidden
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              aria-label="Attach files"
              title="Attach text or code files"
              className="flex-shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M11.5 6L6.5 11C5.7 11.8 4.4 11.8 3.6 11C2.8 10.2 2.8 8.9 3.6 8.1L9.1 2.6C9.6 2.1 10.4 2.1 10.9 2.6C11.4 3.1 11.4 3.9 10.9 4.4L5.4 9.9C5.2 10.1 4.9 10.1 4.7 9.9C4.5 9.7 4.5 9.4 4.7 9.2L9.5 4.4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
              disabled={(!input.trim() && files.length === 0) || isStreaming}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 font-[family-name:var(--font-ui)] text-sm font-semibold text-[var(--color-base)] transition-opacity disabled:opacity-40"
            >
              {isStreaming ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
