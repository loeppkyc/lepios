// Dropbox API response types used by lib/dropbox/client.ts.
// Covers only the subset of the Dropbox API actually used in LepiOS.

export interface DropboxFile {
  '.tag': 'file'
  name: string
  path_lower: string
  path_display: string
  id: string
  client_modified: string // ISO-8601
  server_modified: string // ISO-8601
  size: number
  content_hash?: string
}

export interface DropboxFolder {
  '.tag': 'folder'
  name: string
  path_lower: string
  path_display: string
  id: string
}

export type DropboxEntry = DropboxFile | DropboxFolder

export interface ListFolderResult {
  entries: DropboxEntry[]
  cursor: string
  has_more: boolean
}

export interface UploadResult {
  '.tag': 'file'
  name: string
  path_lower: string
  path_display: string
  id: string
  size: number
  server_modified: string
}

export interface DeleteResult {
  metadata: DropboxEntry
}

export interface SharedLink {
  url: string
  name: string
  path_lower: string
  '.tag': 'file' | 'folder'
}

export interface SharedLinksResult {
  links: SharedLink[]
  has_more: boolean
  cursor?: string
}

export interface SpaceUsage {
  used: number // bytes
  allocation: {
    '.tag': 'individual' | 'team'
    allocated?: number // bytes (individual)
  }
}

export interface DropboxTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  uid: string
  account_id: string
}

export type UploadMode = 'add' | 'overwrite' | 'update'
