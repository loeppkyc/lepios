import { spFetch } from './client'
import { normalizeIsbn, isbn13ToIsbn10 } from './isbn'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'

type SearchResponse = {
  items?: Array<{
    asin: string
    summaries?: Array<{ itemName?: string }>
    identifiers?: Array<{ identifiers: Array<{ identifier: string }> }>
  }>
}

// Port of amazon.py:get_asin_from_isbn — CA-first EAN→ISBN-10→ISBN retry loop
export async function findAsin(isbn: string): Promise<string | null> {
  const s = normalizeIsbn(isbn)
  const isbn10 = isbn13ToIsbn10(s)

  const attempts: Array<[string, string]> = [
    [s, 'EAN'],
    ...(isbn10
      ? ([
          [isbn10, 'EAN'],
          [isbn10, 'ISBN'],
        ] as Array<[string, string]>)
      : []),
    [s, 'ISBN'],
  ]

  let lastError: unknown
  for (const [id, idType] of attempts) {
    try {
      const data = await spFetch<SearchResponse>('/catalog/2022-04-01/items', {
        params: {
          identifiers: id,
          identifiersType: idType,
          marketplaceIds: MARKETPLACE_CA,
          includedData: 'summaries',
        },
      })
      const asin = data.items?.[0]?.asin
      if (asin) return asin
    } catch (e) {
      lastError = e
    }
  }
  if (lastError) console.error('[findAsin] all attempts failed, last error:', lastError)
  return null
}

export type CatalogData = {
  title: string
  imageUrl: string
  bsr: number
  bsrCategory: string
}

type CatalogItemResponse = {
  summaries?: Array<{ itemName?: string }>
  images?: Array<{ images: Array<{ variant: string; link: string }> }>
  salesRanks?: Array<{
    classificationRanks?: Array<{ title: string; rank: number }>
    displayGroupRanks?: Array<{ title: string; rank: number }>
  }>
}

// Port of amazon.py:get_catalog_data
export async function getCatalogData(asin: string): Promise<CatalogData> {
  const empty: CatalogData = { title: '', imageUrl: '', bsr: 0, bsrCategory: '' }
  try {
    const data = await spFetch<CatalogItemResponse>(`/catalog/2022-04-01/items/${asin}`, {
      params: {
        marketplaceIds: MARKETPLACE_CA,
        includedData: 'summaries,salesRanks,images',
      },
    })

    const title = data.summaries?.[0]?.itemName ?? ''

    const imgs = data.images?.[0]?.images ?? []
    const main = imgs.find((i) => i.variant === 'MAIN')
    const imageUrl = main?.link ?? imgs[0]?.link ?? ''

    let bsr = 0
    let bsrCategory = ''
    for (const entry of data.salesRanks ?? []) {
      for (const rank of entry.classificationRanks ?? []) {
        const isBook = rank.title.toLowerCase().includes('book')
        if (rank.rank > 0 && (bsr === 0 || isBook)) {
          bsr = rank.rank
          bsrCategory = rank.title
          if (isBook) break
        }
      }
      if (bsr === 0) {
        for (const rank of entry.displayGroupRanks ?? []) {
          if (rank.rank > 0) {
            bsr = rank.rank
            bsrCategory = rank.title
            break
          }
        }
      }
    }

    return { title, imageUrl, bsr, bsrCategory }
  } catch {
    return empty
  }
}
