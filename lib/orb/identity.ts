import fs from 'fs'
import path from 'path'

export const LEPIOS_SYSTEM_PROMPT = fs
  .readFileSync(path.join(process.cwd(), 'lib/llm/prompts/lepios.md'), 'utf-8')
  .trim()
