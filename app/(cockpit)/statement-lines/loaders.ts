// F18 metrics capture: logs statement-import events to agent_events on each CSV import.
// Surfacing: account coverage chips on /statement-lines show imported vs missing.
// Bench: expected 7 accounts (see ACCOUNTS list in StatementLinesClient); imported / expected = coverage %.
import { createServiceClient } from '@/lib/supabase/service'

export async function logStatementImport(opts: {
  account: string
  source_file: string
  rows_total: number
  import_id: string
}) {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'bookkeeping',
      action: 'statement.import',
      actor: 'user',
      status: 'success',
      task_type: 'statement_import',
      output_summary: `Imported ${opts.rows_total} lines from ${opts.account} (${opts.source_file})`,
      meta: {
        import_id: opts.import_id,
        account: opts.account,
        source_file: opts.source_file,
        rows_total: opts.rows_total,
      },
      tags: ['statement-import', 'bookkeeping'],
    })
  } catch {
    // non-fatal
  }
}
