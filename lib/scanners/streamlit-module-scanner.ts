import { readdirSync, readFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import { categorize } from './streamlit-categories'

export interface ModuleCandidate {
  filename: string         // "60_Amazon_Orders.py" or "tax_centre" (subdir)
  page_number: number | null
  title: string            // derived from filename or st.title() call
  category: string
  confidence: number
  complexity: 'small' | 'medium' | 'large'
  external_apis: string[]
  dependencies: string[]   // from utils.X imports
  line_count: number
  tab_count: number        // count of st.tabs( calls — UI complexity signal
  import_count: number
  gotchas: string[]        // dead references detected at scan time — BLOCKER-severity for ports
}

const EXTERNAL_API_PATTERNS: [RegExp, string][] = [
  [/\bsp_api\b|from sp_api/i, 'sp_api'],
  [/\bkeepa\b/i, 'keepa'],
  [/gspread|from utils\.sheets|import sheets/i, 'sheets'],
  [/googleapiclient|from utils\.gmail/i, 'gmail'],
  [/\banthropics?\b|import claude/i, 'anthropic'],
  [/\bollama\b/i, 'ollama'],
  [/\bchromadb\b/i, 'chromadb'],
  [/\btelegram\b/i, 'telegram'],
  [/\bsqlite3\b/i, 'sqlite'],
  [/\bdropbox\b/i, 'dropbox'],
  [/\bebay\b/i, 'ebay'],
]

const IMPORT_PATTERN = /(?:from utils\.(\w+)|from pages\.(\w+)|import utils\.(\w+))/g

// Dead references: function calls whose definition or required import is absent in the file.
// These are BLOCKER-severity for any LepiOS port. importGuard, if present, suppresses the flag.
const DEAD_REFERENCE_PATTERNS: Array<{
  callPattern: RegExp
  importGuard?: RegExp
  label: string
}> = [
  {
    callPattern: /\bshow_load_time\s*\(/,
    label: 'show_load_time called but not imported/defined',
  },
  {
    callPattern: /\bdev_section\s*\(/,
    label: 'dev_section called but not imported/defined',
  },
  {
    callPattern: /\bget_sheet\s*\(/,
    importGuard: /gspread|from utils\.sheets|import sheets/,
    label: 'get_sheet called but sheets not imported',
  },
]

function extractTitle(filename: string, content: string): string {
  // Try st.title("...") first
  const titleMatch = content.match(/st\.title\(\s*["']([^"']+)["']/)
  if (titleMatch) return titleMatch[1]
  // Fall back to filename: "60_Amazon_Orders.py" → "Amazon Orders"
  return basename(filename, '.py')
    .replace(/^\d+_/, '')
    .replace(/_/g, ' ')
}

function extractPageNumber(filename: string): number | null {
  const m = basename(filename).match(/^(\d+)_/)
  return m ? parseInt(m[1], 10) : null
}

function detectExternalApis(content: string): string[] {
  const apis: string[] = []
  for (const [pat, name] of EXTERNAL_API_PATTERNS) {
    if (pat.test(content) && !apis.includes(name)) apis.push(name)
  }
  return apis
}

function detectDependencies(content: string): string[] {
  const deps: string[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const dep = match[1] ?? match[2] ?? match[3]
    if (dep && !deps.includes(dep)) deps.push(dep)
  }
  return deps
}

function detectDeadReferences(content: string): string[] {
  const found: string[] = []
  for (const { callPattern, importGuard, label } of DEAD_REFERENCE_PATTERNS) {
    if (!callPattern.test(content)) continue
    if (importGuard && importGuard.test(content)) continue
    found.push(label)
  }
  return found
}

function complexity(lineCount: number, importCount: number, tabCount: number): 'small' | 'medium' | 'large' {
  const score = lineCount + importCount * 10 + tabCount * 50
  if (score < 350) return 'small'
  if (score < 1000) return 'medium'
  return 'large'
}

export function scanStreamlitModules(rootPath: string): ModuleCandidate[] {
  const pagesDir = join(rootPath, 'pages')

  let entries: string[]
  try {
    entries = readdirSync(pagesDir)
  } catch (err) {
    throw new Error(
      `scanStreamlitModules: cannot read pages/ at "${pagesDir}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const candidates: ModuleCandidate[] = []

  for (const entry of entries) {
    if (entry.startsWith('_') || entry.startsWith('.')) continue
    const fullPath = join(pagesDir, entry)

    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    // Part A — subdir detection: stub __init__.py packages (e.g. pages/tax_centre/)
    if (stat.isDirectory()) {
      const initPath = join(fullPath, '__init__.py')
      let initContent: string
      try {
        initContent = readFileSync(initPath, 'utf-8')
      } catch {
        continue // no __init__.py → not a Streamlit package, skip
      }
      if (initContent.split('\n').length >= 10) continue // non-stub package, skip

      // Stub fallthrough: use the largest non-underscore .py file in the subdir
      let subEntries: string[]
      try {
        subEntries = readdirSync(fullPath)
      } catch {
        continue
      }
      const ranked = subEntries
        .filter((f) => f.endsWith('.py') && !f.startsWith('_') && f !== '__init__.py')
        .map((f) => {
          try { return { f, size: statSync(join(fullPath, f)).size } } catch { return null }
        })
        .filter((x): x is { f: string; size: number } => x !== null)
        .sort((a, b) => b.size - a.size)

      if (ranked.length === 0) continue
      const largestFile = ranked[0].f
      const content = readFileSync(join(fullPath, largestFile), 'utf-8')
      const lines = content.split('\n')
      const lineCount = lines.length
      const importCount = lines.filter((l) => l.trim().startsWith('import ') || l.trim().startsWith('from ')).length
      const tabCount = (content.match(/st\.tabs\s*\(/g) ?? []).length
      const { category, confidence } = categorize(entry, content)

      candidates.push({
        filename: entry, // directory name, e.g. 'tax_centre'
        page_number: extractPageNumber(entry),
        title: extractTitle(entry, content),
        category,
        confidence,
        complexity: complexity(lineCount, importCount, tabCount),
        external_apis: detectExternalApis(content),
        dependencies: detectDependencies(content),
        line_count: lineCount,
        tab_count: tabCount,
        import_count: importCount,
        gotchas: detectDeadReferences(content),
      })
      continue
    }

    if (!entry.endsWith('.py')) continue

    const content = readFileSync(fullPath, 'utf-8')
    const lines = content.split('\n')
    const lineCount = lines.length
    const importCount = lines.filter((l) => l.trim().startsWith('import ') || l.trim().startsWith('from ')).length
    const tabCount = (content.match(/st\.tabs\s*\(/g) ?? []).length
    const { category, confidence } = categorize(entry, content)

    candidates.push({
      filename: entry,
      page_number: extractPageNumber(entry),
      title: extractTitle(entry, content),
      category,
      confidence,
      complexity: complexity(lineCount, importCount, tabCount),
      external_apis: detectExternalApis(content),
      dependencies: detectDependencies(content),
      line_count: lineCount,
      tab_count: tabCount,
      import_count: importCount,
      gotchas: detectDeadReferences(content),
    })
  }

  return candidates.sort((a, b) => (a.page_number ?? 999) - (b.page_number ?? 999))
}
