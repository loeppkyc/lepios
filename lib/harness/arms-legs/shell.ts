import { runAction } from './dispatch'
import type { ShellRunPayload, ShellRunResult } from './shell-handlers'

export async function shellRun(
  command: string,
  agentId: string,
  opts?: { timeoutMs?: number; cwd?: string; taskId?: string }
): Promise<string> {
  const result = await runAction<ShellRunPayload, ShellRunResult>({
    capability: 'shell.run',
    payload: { command, timeoutMs: opts?.timeoutMs, cwd: opts?.cwd },
    caller: { agent: agentId, taskId: opts?.taskId },
  })
  if (!result.ok)
    throw new Error(`shell.run failed [${result.error.code}]: ${result.error.message}`)
  return result.data.stdout
}
