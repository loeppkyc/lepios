export interface DropboxAuditRun {
  id: string
  user_id: string
  cutoff_days: number
  used_gb: number | null
  quota_gb: number | null
  pct_used: number | null
  archiveable_total: number | null
  already_local: number | null
  need_download: number | null
  need_download_gb: number | null
  ran_at: string
}

export interface DropboxArchiverResponse {
  latest: DropboxAuditRun | null
}
