export type SafetySeverity = 'low' | 'medium' | 'high' | 'critical'

export type SafetyCategory =
  | 'schema_validation'   // missing Zod validation on API input
  | 'destructive_operation' // DROP TABLE, TRUNCATE, DELETE without WHERE, etc.
  | 'scope_creep'         // files outside the declared scope of the current step
  | 'missing_test'        // new lib/ or app/api/ file without a corresponding test
  | 'missing_rollback'    // migration with no documented rollback path
  | 'secret_leak'         // hardcoded API key / token / connection string in diff

export interface SafetyCheck {
  id: string                // e.g. "destructive_sql_drop_table"
  severity: SafetySeverity
  category: SafetyCategory
  message: string           // human-readable description of the problem
  suggestion: string        // one-sentence fix recommendation
  file?: string             // which file triggered this check
  excerpt?: string          // short excerpt from the diff that triggered it
}

export interface SafetyReport {
  passed: boolean           // true if no critical or high checks fired
  blocking: boolean         // true if any critical check fired — agent must halt
  checks: SafetyCheck[]     // all fired checks; empty = clean
  metadata: {
    checked_at: string      // ISO 8601
    files_changed: number
    migrations_proposed: number
    routes_proposed: number
    scope_declared: boolean // whether a declaredScope was provided
  }
}

export interface ProposedFileChange {
  path: string
  diff: string              // unified diff or full file content
  isNew: boolean            // true = new file, false = modification
}

export interface ProposedMigration {
  name: string
  sql: string
  hasRollback: boolean      // caller attests this — checker also scans SQL
}

export interface SafetyCheckInput {
  scopeDescription: string              // plain-English description of what this step does
  fileChanges: ProposedFileChange[]
  migrations?: ProposedMigration[]
  newApiRoutes?: string[]               // paths of new route files (e.g. 'app/api/foo/route.ts')
  declaredScope?: string[]              // glob-style prefixes for in-scope paths
}
