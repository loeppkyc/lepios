/**
 * Verbatim port of UNCERTAINTY_MARKERS from streamlit_app/utils/local_ai.py:106-115.
 * Do NOT modify this list without syncing it back to the Streamlit source.
 */

const UNCERTAINTY_MARKERS = [
  "i don't know",
  'i dont know',
  "i'm not sure",
  'im not sure',
  "i don't have",
  'i dont have',
  'i cannot',
  "i can't provide",
  'i cant provide',
  'no information',
  'outside my knowledge',
  'i lack',
  'unable to answer',
  "don't have enough context",
  "i'm unable",
  'im unable',
  'beyond my',
  'not enough information',
  'i do not have',
  'i am not sure',
  'i am unable',
  "retrieved context doesn't contain",
  "context doesn't contain",
  'no data available',
  "don't have access to",
] as const

export function isUncertain(answer: string): boolean {
  const lower = answer.toLowerCase()
  return UNCERTAINTY_MARKERS.some((m) => lower.includes(m))
}
