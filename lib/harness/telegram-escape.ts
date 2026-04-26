/**
 * Escapes all MarkdownV2 special characters so strings can be safely sent
 * with parse_mode: 'MarkdownV2'.
 *
 * Prefer omitting parse_mode entirely for plain-text messages — only use
 * this when rich formatting is genuinely needed.
 *
 * MarkdownV2 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}
