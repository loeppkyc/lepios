import { runAction } from './dispatch'
import type {
  BrowserNavigatePayload,
  BrowserNavigateResult,
  BrowserScreenshotPayload,
  BrowserScreenshotResult,
  BrowserClickPayload,
  BrowserClickResult,
  BrowserFillPayload,
  BrowserFillResult,
} from './browser-handlers'

export async function browserNavigate(
  url: string,
  agentId: string,
  opts?: {
    waitUntil?: BrowserNavigatePayload['waitUntil']
    taskId?: string
    timeoutMs?: number
  }
): Promise<BrowserNavigateResult> {
  const result = await runAction<BrowserNavigatePayload, BrowserNavigateResult>({
    capability: 'browser.navigate',
    payload: { url, waitUntil: opts?.waitUntil },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`browser.navigate failed [${result.error.code}]: ${result.error.message}`)
  return result.data
}

export async function browserScreenshot(
  url: string,
  agentId: string,
  opts?: { selector?: string; taskId?: string; timeoutMs?: number }
): Promise<string> {
  const result = await runAction<BrowserScreenshotPayload, BrowserScreenshotResult>({
    capability: 'browser.screenshot',
    payload: { url, selector: opts?.selector },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`browser.screenshot failed [${result.error.code}]: ${result.error.message}`)
  return result.data.base64
}

export async function browserClick(
  url: string,
  selector: string,
  agentId: string,
  opts?: { taskId?: string; timeoutMs?: number }
): Promise<void> {
  const result = await runAction<BrowserClickPayload, BrowserClickResult>({
    capability: 'browser.click',
    payload: { url, selector },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`browser.click failed [${result.error.code}]: ${result.error.message}`)
}

export async function browserFill(
  url: string,
  selector: string,
  value: string,
  agentId: string,
  opts?: { taskId?: string; timeoutMs?: number }
): Promise<void> {
  const result = await runAction<BrowserFillPayload, BrowserFillResult>({
    capability: 'browser.fill',
    payload: { url, selector, value },
    caller: { agent: agentId, taskId: opts?.taskId },
    timeoutMs: opts?.timeoutMs,
  })
  if (!result.ok)
    throw new Error(`browser.fill failed [${result.error.code}]: ${result.error.message}`)
}
