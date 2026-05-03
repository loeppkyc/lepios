import { runAction } from './dispatch'
import type { FsReadPayload, FsWritePayload, FsDeletePayload } from './fs-handlers'

export async function fsRead(
  filePath: string,
  agentId: string,
  opts?: { encoding?: BufferEncoding; taskId?: string }
): Promise<string> {
  const result = await runAction<FsReadPayload, { content: string }>({
    capability: 'fs.read',
    payload: { filePath, encoding: opts?.encoding ?? 'utf-8' },
    caller: { agent: agentId, taskId: opts?.taskId },
  })
  if (!result.ok) throw new Error(`fs.read failed [${result.error.code}]: ${result.error.message}`)
  return result.data.content
}

export async function fsWrite(
  filePath: string,
  content: string,
  agentId: string,
  opts?: { encoding?: BufferEncoding; taskId?: string }
): Promise<void> {
  const result = await runAction<FsWritePayload, { written: true }>({
    capability: 'fs.write',
    payload: { filePath, content, encoding: opts?.encoding ?? 'utf-8' },
    caller: { agent: agentId, taskId: opts?.taskId },
  })
  if (!result.ok) throw new Error(`fs.write failed [${result.error.code}]: ${result.error.message}`)
}

// Uses fs.read capability — existence check is a read-scope operation.
// Returns true if the file exists, false if the handler returns handler_error (ENOENT).
export async function fsExists(filePath: string, agentId: string): Promise<boolean> {
  const result = await runAction<FsReadPayload, { content: string }>({
    capability: 'fs.read',
    payload: { filePath },
    caller: { agent: agentId },
  })
  return result.ok
}

export async function fsDelete(
  filePath: string,
  agentId: string,
  opts?: { taskId?: string }
): Promise<void> {
  const result = await runAction<FsDeletePayload, { deleted: true }>({
    capability: 'fs.delete',
    payload: { filePath },
    caller: { agent: agentId, taskId: opts?.taskId },
  })
  if (!result.ok)
    throw new Error(`fs.delete failed [${result.error.code}]: ${result.error.message}`)
}
