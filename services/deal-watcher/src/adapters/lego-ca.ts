// LEGO.ca adapter — uses the GraphQL endpoint that lego.com's own frontend calls.
// ~10x faster than HTML scraping; stock signal is authoritative (Apollo cache source).
// Endpoint: POST https://www.lego.com/api/graphql
// Auth: none — x-locale header is the only required non-standard header.

import type { SiteAdapter, StockResult, WatchTarget } from './types.js'

const GQL_ENDPOINT = 'https://www.lego.com/api/graphql'

const STOCK_QUERY = `
  query StockCheck($slug: String!) {
    product(slug: $slug) {
      __typename
      ... on SingleVariantProduct {
        productCode
        variant {
          attributes {
            availabilityStatus
            canAddToBag
          }
        }
      }
    }
  }
`

interface GqlResponse {
  data?: {
    product?: {
      __typename: string
      variant?: {
        attributes?: {
          availabilityStatus?: string
          canAddToBag?: boolean
        }
      }
    }
  }
  errors?: Array<{ message: string }>
}

function slugFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? url
  } catch {
    // Fall back to treating the input as a slug directly
    return url.split('/').filter(Boolean).pop() ?? url
  }
}

export const legoCaAdapter: SiteAdapter = {
  async check(target: WatchTarget): Promise<StockResult> {
    if (!target.url) throw new Error('lego-ca target missing url')
    const slug = slugFromUrl(target.url)

    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-locale': 'en-CA',
        Origin: 'https://www.lego.com',
        'User-Agent': 'Mozilla/5.0 (compatible; LepiOS-WatchBot/1.0)',
      },
      body: JSON.stringify({ query: STOCK_QUERY, variables: { slug } }),
    })
    if (!res.ok) throw new Error(`LEGO GraphQL HTTP ${res.status}`)

    const body = (await res.json()) as GqlResponse
    if (body.errors?.length) throw new Error(`LEGO GraphQL: ${body.errors[0].message}`)

    const attrs = body.data?.product?.variant?.attributes
    if (!attrs) {
      // Product not found or wrong type — treat as unavailable
      return { in_stock: false, raw_status: 'E_NOT_FOUND' }
    }

    const in_stock = attrs.availabilityStatus === 'E_AVAILABLE' && attrs.canAddToBag === true
    return { in_stock, raw_status: attrs.availabilityStatus ?? 'unknown' }
  },

  cartUrl(target: WatchTarget): string | null {
    return target.url
  },
}
