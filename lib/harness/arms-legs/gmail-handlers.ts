// gmail-handlers.ts — wires Gmail API into the dispatch registry.
//
// Import for side effects only:
//   import '@/lib/harness/arms-legs/gmail-handlers'
//
// Each handler calls createGmailService() to get a fresh OAuth2 client,
// performs one API operation, and returns.
//
// Capabilities: gmail.search, gmail.get
// Both are log_only and non-destructive.

import { createGmailService } from '@/lib/gmail/client'
import { registerHandler } from './dispatch'

// ── Payload / result types ────────────────────────────────────────────────────

export interface GmailSearchPayload {
  query: string
  maxResults?: number
  pageToken?: string
}

export interface GmailMessageStub {
  id: string
  threadId?: string
}

export interface GmailSearchResult {
  messages: GmailMessageStub[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export interface GmailGetPayload {
  messageId: string
  format?: 'minimal' | 'full' | 'raw' | 'metadata'
  metadataHeaders?: string[]
}

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  parts?: GmailPart[]
}

export interface GmailGetResult {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    mimeType?: string
    headers?: GmailHeader[]
    parts?: GmailPart[]
  }
}

// ── Handler registrations ─────────────────────────────────────────────────────

registerHandler<GmailSearchPayload, GmailSearchResult>('gmail.search', async (payload) => {
  const service = await createGmailService()
  const resp = await service.users.messages.list({
    userId: 'me',
    q: payload.query,
    maxResults: payload.maxResults ?? 100,
    pageToken: payload.pageToken,
  })
  return {
    messages: (resp.data.messages ?? []).map((m) => ({
      id: m.id ?? '',
      threadId: m.threadId ?? undefined,
    })),
    nextPageToken: resp.data.nextPageToken ?? undefined,
    resultSizeEstimate: resp.data.resultSizeEstimate ?? undefined,
  }
})

registerHandler<GmailGetPayload, GmailGetResult>('gmail.get', async (payload) => {
  const service = await createGmailService()
  const resp = await service.users.messages.get({
    userId: 'me',
    id: payload.messageId,
    format: payload.format ?? 'metadata',
    metadataHeaders: payload.metadataHeaders,
  })
  const data = resp.data
  return {
    id: data.id ?? payload.messageId,
    threadId: data.threadId ?? undefined,
    labelIds: data.labelIds ?? undefined,
    snippet: data.snippet ?? undefined,
    payload: data.payload
      ? {
          mimeType: data.payload.mimeType ?? undefined,
          headers: (data.payload.headers ?? [])
            .filter((h): h is { name: string; value: string } => !!h.name && !!h.value)
            .map((h) => ({ name: h.name, value: h.value })),
          parts: (data.payload.parts ?? []).map((p) => ({
            mimeType: p.mimeType ?? undefined,
            filename: p.filename ?? undefined,
          })),
        }
      : undefined,
  }
})
