export function normalizeIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, '')
}

export function isIsbn(code: string): boolean {
  const s = normalizeIsbn(code)
  return s.length === 10 || s.length === 13
}

// Port of amazon.py:_isbn13_to_isbn10
export function isbn13ToIsbn10(isbn13: string): string | null {
  const s = normalizeIsbn(isbn13)
  if (!(s.startsWith('978') && s.length === 13 && /^\d+$/.test(s))) return null
  const core = s.slice(3, 12)
  let total = 0
  for (let i = 0; i < 9; i++) total += (10 - i) * parseInt(core[i], 10)
  const check = (11 - (total % 11)) % 11
  return core + (check === 10 ? 'X' : String(check))
}
