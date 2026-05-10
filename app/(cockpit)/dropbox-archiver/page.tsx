// F18: bench=dropbox_api_latency<5s; surface=dropbox_audit_runs latest row
// module_metric: dropbox_audit_runs (ran_at, used_gb, quota_gb, pct_used)
import { DropboxArchiverPage } from './_components/DropboxArchiverPage'

export const metadata = { title: 'Dropbox Archiver — LepiOS' }
export default function Page() {
  return <DropboxArchiverPage />
}
