/**
 * Client-side file upload helpers for the orb chat.
 *
 * Spec: docs/specs/orb-a4-file-upload.md (v1: text/code only — no images,
 * no PDFs, no binary). Files become inline text appended to the user
 * message before sendMessage.
 */

export const MAX_FILES = 5
export const MAX_FILE_SIZE = 32 * 1024 // 32 KB per file
export const MAX_TOTAL_SIZE = 128 * 1024 // 128 KB total per message

export const ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.csv',
  '.html',
  '.htm',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.sql',
  '.sh',
  '.ps1',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
] as const

export interface AttachedFile {
  name: string
  size: number
  content: string
  truncated: boolean
}

export type ValidationResult =
  | { ok: true; file: AttachedFile }
  | { ok: false; error: string }

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

export function isAllowedExtension(name: string): boolean {
  const ext = getExtension(name)
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Strip <script> and <style> blocks + tags from HTML content. Used only for
 * .html / .htm uploads so the model doesn't see executable script bodies.
 */
export function stripHtml(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function validateAndProcessText(
  name: string,
  rawContent: string,
  currentTotalBytes: number,
  currentFileCount: number,
): ValidationResult {
  if (!isAllowedExtension(name)) {
    return { ok: false, error: `Unsupported file type: ${getExtension(name) || '(none)'}` }
  }
  if (currentFileCount >= MAX_FILES) {
    return { ok: false, error: `Maximum ${MAX_FILES} files per message` }
  }

  const ext = getExtension(name)
  const processed = ext === '.html' || ext === '.htm' ? stripHtml(rawContent) : rawContent

  const truncated = processed.length > MAX_FILE_SIZE
  const content = truncated
    ? `${processed.slice(0, MAX_FILE_SIZE)}\n\n[truncated — original ${processed.length} bytes, kept first ${MAX_FILE_SIZE}]`
    : processed

  const sizeBytes = new Blob([content]).size
  if (currentTotalBytes + sizeBytes > MAX_TOTAL_SIZE) {
    return {
      ok: false,
      error: `Total upload size would exceed ${MAX_TOTAL_SIZE} bytes (current ${currentTotalBytes}, this file ${sizeBytes})`,
    }
  }

  return {
    ok: true,
    file: { name, size: sizeBytes, content, truncated },
  }
}

/**
 * Build the attachment block appended to the user's text. One block per file,
 * delimited by a header line. Returns empty string if no files.
 */
export function buildAttachmentsText(files: AttachedFile[]): string {
  if (files.length === 0) return ''
  return files
    .map((f) => {
      const sizeNote = f.truncated ? ` (truncated)` : ''
      return `\n\n--- attached: ${f.name}${sizeNote} ---\n${f.content}`
    })
    .join('')
}

/**
 * Combine the user's text with attachment blocks. If text is empty, only
 * attachments are sent — same model semantics as sending text-only.
 */
export function combineTextAndFiles(text: string, files: AttachedFile[]): string {
  const attachments = buildAttachmentsText(files)
  if (!attachments) return text
  if (!text) return attachments.trimStart()
  return `${text}${attachments}`
}
