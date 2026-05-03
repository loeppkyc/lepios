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

// http-handlers is imported for side effects only — registrations happen at module load
import './http-handlers'
