export interface BookData {
  isbn: string
  title: string
  author: string
  category: string
  coverUrl: string
}

export async function lookupIsbn(rawIsbn: string): Promise<BookData | null> {
  const isbn = rawIsbn.trim().replace(/[-\s]/g, '')
  if (!isbn) return null

  const url =
    `https://openlibrary.org/api/books` +
    `?bibkeys=ISBN:${isbn}&format=json&jscmd=data`

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return null

    const data = (await res.json()) as Record<string, unknown>
    const key = `ISBN:${isbn}`
    const book = data[key] as Record<string, unknown> | undefined
    if (!book) return null

    const title = (book['title'] as string | undefined) ?? 'Unknown Title'
    const authors = ((book['authors'] as Array<{ name?: string }>) ?? []).map(
      (a) => a.name ?? ''
    )
    const subjects = ((book['subjects'] as Array<{ name?: string }>) ?? []).map(
      (s) => s.name ?? ''
    )

    return {
      isbn,
      title,
      author: authors.filter(Boolean).join(', ') || 'Unknown',
      category: subjects[0] ?? '',
      coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    }
  } catch {
    return null
  }
}
