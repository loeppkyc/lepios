export const VOICE_FILLER_PHRASES = [
  'great question',
  'certainly!',
  'certainly,',
  "i'd be happy",
  'i would be happy',
  'of course,',
  'of course!',
  'absolutely!',
  'absolutely,',
  'sure thing',
  'happy to help',
  'excellent question',
]

export function hasFillerPhrase(text: string): string | null {
  const lower = text.toLowerCase().trimStart()
  for (const phrase of VOICE_FILLER_PHRASES) {
    if (lower.startsWith(phrase)) return phrase
  }
  return null
}
