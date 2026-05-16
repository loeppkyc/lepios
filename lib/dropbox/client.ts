// Dropbox HTTP client for LepiOS.
// Wraps the Dropbox v2 API via the arms-legs httpRequest() layer.
// No Python SDK dependency — pure HTTP with typed responses.
//
// Auth: OAuth2 short-lived access tokens derived from a stored refresh token.
// Refresh token lives in harness_config key 'DROPBOX_REFRESH_TOKEN'.
// App key/secret live in harness_config keys 'DROPBOX_APP_KEY' / 'DROPBOX_APP_SECRET'.
//
// Two capabilities required (both registered in migration 0170):
//   net.outbound.dropbox         → api.dropboxapi.com  (metadata + auth)
//   net.outbound.dropbox.content → content.dropboxapi.com (file download/upload)

import { httpRequest } from '@/lib/harness/arms-legs/http'
import { createServiceClient } from '@/lib/supabase/service'
import { dropboxBreaker } from '@/lib/circuit-breaker'
import type {
  DeleteResult,
  DropboxEntry,
  DropboxTokenResponse,
  ListFolderResult,
  SharedLink,
  SharedLinksResult,
  SpaceUsage,
  UploadMode,
  UploadResult,
} from './types'

const API_BASE = 'https://api.dropboxapi.com/2'
const CONTENT_BASE = 'https://content.dropboxapi.com/2'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const CAP_API = 'net.outbound.dropbox'
const CAP_CONTENT = 'net.outbound.dropbox.content'
const AGENT_ID = 'lepios.dropbox'

// ── Token management ─────────────────────────────────────────────────────────

// Module-level cache: access token + expiry. Avoids re-fetching on every call.
let cachedToken: string | null = null
let tokenExpiresAt = 0

async function getHarnessConfig(key: string): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data } = await db.from('harness_config').select('value').eq('key', key).maybeSingle()
    const v = (data as { value?: string } | null)?.value
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/**
 * Return a valid Dropbox access token.
 * Exchanges the stored refresh token for a new access token when the cached one
 * has less than 60 seconds remaining.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken
  }

  const [refreshToken, appKey, appSecret] = await Promise.all([
    getHarnessConfig('DROPBOX_REFRESH_TOKEN'),
    getHarnessConfig('DROPBOX_APP_KEY'),
    getHarnessConfig('DROPBOX_APP_SECRET'),
  ])

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error(
      'Dropbox credentials missing from harness_config. Set DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET.'
    )
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey,
    client_secret: appSecret,
  })

  const result = await httpRequest({
    url: TOKEN_URL,
    method: 'POST',
    capability: CAP_API,
    agentId: AGENT_ID,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!result.ok) {
    throw new Error(`Dropbox token refresh failed: ${result.status} ${result.body.slice(0, 200)}`)
  }

  const json = JSON.parse(result.body) as DropboxTokenResponse
  cachedToken = json.access_token
  tokenExpiresAt = Date.now() + json.expires_in * 1000
  return cachedToken
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken()
  const result = await dropboxBreaker.call(() => httpRequest({
    url: `${API_BASE}${path}`,
    method: 'POST',
    capability: CAP_API,
    agentId: AGENT_ID,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  }))
  if (!result.ok) {
    throw new Error(`Dropbox API ${path} failed: ${result.status} ${result.body.slice(0, 300)}`)
  }
  return JSON.parse(result.body) as T
}

// ── File metadata operations ─────────────────────────────────────────────────

/**
 * List folder contents. Pass path='' for root.
 * Use recursive=true for full tree listing (archiver use case).
 */
export async function listFolder(path: string, recursive = false): Promise<ListFolderResult> {
  return apiPost<ListFolderResult>('/files/list_folder', {
    path,
    recursive,
    include_media_info: false,
    include_deleted: false,
    include_has_explicit_shared_members: false,
  })
}

/** Continue a paginated listing using the cursor from a previous listFolder call. */
export async function listFolderContinue(cursor: string): Promise<ListFolderResult> {
  return apiPost<ListFolderResult>('/files/list_folder/continue', { cursor })
}

/**
 * List ALL entries in a folder, following cursors automatically.
 * Use for folders expected to have >2000 entries (Dropbox page size).
 */
export async function listFolderAll(path: string, recursive = false): Promise<DropboxEntry[]> {
  const entries: DropboxEntry[] = []
  let result = await listFolder(path, recursive)
  entries.push(...result.entries)

  while (result.has_more) {
    result = await listFolderContinue(result.cursor)
    entries.push(...result.entries)
  }

  return entries
}

/** Delete a file or folder. Returns metadata of the deleted item. */
export async function deleteFile(path: string): Promise<DeleteResult> {
  return apiPost<DeleteResult>('/files/delete_v2', { path })
}

/** Get storage quota usage. */
export async function getSpaceUsage(): Promise<SpaceUsage> {
  return apiPost<SpaceUsage>('/users/get_space_usage', {})
}

// ── File content operations (content.dropboxapi.com) ────────────────────────

/**
 * Download a file and return its content as a string.
 * For binary files (PDF, XLSX) the caller should handle the raw bytes — this
 * returns the body as-is from the HTTP response.
 * Max file size: 150MB (Dropbox API limit).
 */
export async function downloadFile(path: string): Promise<string> {
  const token = await getAccessToken()
  const result = await dropboxBreaker.call(() => httpRequest({
    url: `${CONTENT_BASE}/files/download`,
    method: 'POST',
    capability: CAP_CONTENT,
    agentId: AGENT_ID,
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
    // No body — Dropbox download uses header-encoded arg
    body: null,
  }))
  if (!result.ok) {
    throw new Error(
      `Dropbox download failed for ${path}: ${result.status} ${result.body.slice(0, 200)}`
    )
  }
  return result.body
}

/**
 * Upload file content to Dropbox.
 * mode: 'add' (fail if exists), 'overwrite' (replace), 'update' (requires rev).
 */
export async function uploadFile(
  path: string,
  content: string,
  mode: UploadMode = 'overwrite'
): Promise<UploadResult> {
  const token = await getAccessToken()
  const result = await dropboxBreaker.call(() => httpRequest({
    url: `${CONTENT_BASE}/files/upload`,
    method: 'POST',
    capability: CAP_CONTENT,
    agentId: AGENT_ID,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode,
        autorename: false,
        mute: true,
        strict_conflict: false,
      }),
    },
    body: content,
  }))
  if (!result.ok) {
    throw new Error(
      `Dropbox upload failed for ${path}: ${result.status} ${result.body.slice(0, 200)}`
    )
  }
  return JSON.parse(result.body) as UploadResult
}

// ── Sharing operations ───────────────────────────────────────────────────────

/**
 * Create a public shared link for a file.
 * Returns the URL. Throws if the file doesn't exist or sharing is restricted.
 */
export async function createSharedLink(path: string): Promise<string> {
  const result = await apiPost<{ url: string }>('/sharing/create_shared_link_with_settings', {
    path,
    settings: {
      requested_visibility: { '.tag': 'public' },
    },
  })
  return result.url
}

/**
 * List existing shared links for a path.
 * Returns an empty array if no links exist — does not throw on 404.
 */
export async function listSharedLinks(path: string): Promise<SharedLink[]> {
  try {
    const result = await apiPost<SharedLinksResult>('/sharing/list_shared_links', {
      path,
      direct_only: true,
    })
    return result.links
  } catch (err) {
    // Dropbox returns a 409 with error_summary 'path/not_found/..' when there are no links
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('404') || msg.includes('path/not_found') || msg.includes('409')) return []
    throw err
  }
}

/**
 * Get or create a shared link for a path.
 * Returns an existing link URL if one exists, otherwise creates a new one.
 */
export async function getOrCreateSharedLink(path: string): Promise<string> {
  const existing = await listSharedLinks(path)
  if (existing.length > 0) return existing[0].url
  return createSharedLink(path)
}
