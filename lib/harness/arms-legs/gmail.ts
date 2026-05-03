import { runAction } from './dispatch'
import type {
  GmailSearchPayload,
  GmailSearchResult,
  GmailGetPayload,
  GmailGetResult,
} from './gmail-handlers'

export async function gmailSearch(
  query: string,
  agentId: string,
  opts?: {
    maxResults?: number
    pageToken?: string
    taskId?: string
    timeoutMs?: number
  }
): Promise<GmailSearchResult> {
  const result = await runAction<GmailSearchPayload, GmailSearchResult>({
    capability: 'gmail.search',
    payload: { query, maxResults: opts?.maxResults, pageToken: opts?.pageToken },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`gmail.search failed [${result.error.code}]: ${result.error.message}`)
  return result.data
}

export async function gmailGet(
  messageId: string,
  agentId: string,
  opts?: {
    format?: GmailGetPayload['format']
    metadataHeaders?: string[]
    taskId?: string
    timeoutMs?: number
  }
): Promise<GmailGetResult> {
  const result = await runAction<GmailGetPayload, GmailGetResult>({
    capability: 'gmail.get',
    payload: { messageId, format: opts?.format, metadataHeaders: opts?.metadataHeaders },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`gmail.get failed [${result.error.code}]: ${result.error.message}`)
  return result.data
}
