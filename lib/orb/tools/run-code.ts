/**
 * runCode — chat_ui action tool.
 *
 * Executes a JavaScript snippet in a sandboxed V8 context (Node.js vm module).
 * No filesystem, no network, no require, no process — only safe built-ins.
 * console.log/error/warn output is captured and returned.
 * The value of the last expression is returned as a string.
 *
 * Sandboxing notes:
 * - vm.createContext() isolates the script from the host JS environment.
 * - Only explicitly whitelisted globals are available.
 * - timeout enforced via vm.Script.runInContext({ timeout }) — halts on infinite loops.
 * - Does NOT prevent CPU-intensive but finite operations within the timeout window.
 */

import { z } from 'zod'
import vm from 'vm'
import type { ChatTool } from './registry'

const MAX_TIMEOUT_MS = 10_000
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_CODE_CHARS = 8_000

type Input = {
  code: string
  timeoutMs?: number
}

type Output =
  | { success: true; result: string; stdout: string[]; durationMs: number }
  | { success: false; error: string; stdout: string[]; durationMs: number }

export const runCodeTool: ChatTool<Input, Output> = {
  name: 'runCode',
  description:
    'Execute a JavaScript snippet in a sandboxed V8 context. No filesystem, no network, no require. console.log output is captured. The value of the last expression is returned. Use for calculations, data transforms, or logic tests.',
  parameters: z.object({
    code: z.string().min(1).max(MAX_CODE_CHARS).describe('JavaScript code to execute (max 8000 chars)'),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(MAX_TIMEOUT_MS)
      .optional()
      .describe(`Execution timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
  }),
  capability: 'tool.chat_ui.action.run_code',
  execute: async ({ code, timeoutMs }) => {
    const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const stdout: string[] = []
    const started = Date.now()

    const sandbox = vm.createContext({
      console: {
        log: (...args: unknown[]) => stdout.push(args.map(safeStr).join(' ')),
        error: (...args: unknown[]) => stdout.push('[err] ' + args.map(safeStr).join(' ')),
        warn: (...args: unknown[]) => stdout.push('[warn] ' + args.map(safeStr).join(' ')),
        info: (...args: unknown[]) => stdout.push(args.map(safeStr).join(' ')),
      },
      Math,
      JSON,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      Promise,
      Infinity,
      NaN,
      undefined,
    })

    try {
      const script = new vm.Script(code, { filename: 'lepios-sandbox.js' })
      const rawResult = script.runInContext(sandbox, { timeout })
      return {
        success: true,
        result: formatResult(rawResult),
        stdout,
        durationMs: Date.now() - started,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        stdout,
        durationMs: Date.now() - started,
      }
    }
  },
}

function safeStr(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return '[Object]'
    }
  }
  return String(v)
}

function formatResult(v: unknown): string {
  if (v === undefined) return '(no return value)'
  if (v === null) return 'null'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v, null, 2)
    } catch {
      return '[Object]'
    }
  }
  return String(v)
}
