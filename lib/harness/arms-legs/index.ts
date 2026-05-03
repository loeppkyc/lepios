export { httpRequest } from './http'
export type { HttpRequestArgs, HttpResult } from './http'

export { telegram } from './telegram'
export type { TelegramBot, TelegramOptions, TelegramResult } from './telegram'

export { registerHandler, runAction } from './dispatch'
export type {
  ActionEnvelope,
  DispatchResult,
  HandlerContext,
  ArmsLegsHandler,
  Capability,
} from './types'

export { fsRead, fsWrite, fsExists, fsDelete } from './fs'
export type { FsReadPayload, FsWritePayload, FsDeletePayload } from './fs-handlers'

export { shellRun } from './shell'
export type { ShellRunPayload, ShellRunResult } from './shell-handlers'

export { browserNavigate, browserScreenshot, browserClick, browserFill } from './browser'
export type {
  BrowserNavigatePayload,
  BrowserNavigateResult,
  BrowserScreenshotPayload,
  BrowserScreenshotResult,
  BrowserClickPayload,
  BrowserClickResult,
  BrowserFillPayload,
  BrowserFillResult,
} from './browser-handlers'

// Side-effect imports — handler registrations happen at module load
import './http-handlers'
import './fs-handlers'
import './shell-handlers'
import './browser-handlers'
