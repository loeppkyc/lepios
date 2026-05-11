import { spFetch } from '@/lib/amazon/client'

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
const LISTINGS_VERSION = '2021-08-01'

export type ConditionCode = 'like_new' | 'very_good' | 'used_good' | 'acceptable'

export interface ListingResult {
  sku: string
  status: 'ACCEPTED' | 'VALID' | 'INVALID' | 'ERROR'
  issues: unknown[]
}

// generateSku: "BK-" + YYYYMMDDHHMMSS (UTC). Unique per listing.
export function generateSku(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const mi = String(now.getUTCMinutes()).padStart(2, '0')
  const s = String(now.getUTCSeconds()).padStart(2, '0')
  return `BK-${y}${mo}${d}${h}${mi}${s}`
}

export function sellerConfigured(): boolean {
  return Boolean(process.env.AMAZON_SELLER_ID)
}

interface PutResponse {
  sku?: string
  submissionResponse?: {
    status?: string
    issues?: unknown[]
  }
  status?: string
  issues?: unknown[]
  errors?: unknown[]
}

export async function createAmazonListing(
  asin: string,
  conditionCode: ConditionCode,
  conditionNote: string,
  listPriceCad: number
): Promise<ListingResult> {
  const sellerId = process.env.AMAZON_SELLER_ID!
  const sku = generateSku()

  const putPath = `/listings/${LISTINGS_VERSION}/items/${sellerId}/${sku}`
  const queryParams: Record<string, string> = {
    marketplaceIds: MARKETPLACE_CA,
    issueLocale: 'en_CA',
  }

  const putBody = {
    productType: 'PRODUCT',
    requirements: 'LISTING_OFFER_ONLY',
    attributes: {
      condition_type: [{ value: conditionCode, marketplace_id: MARKETPLACE_CA }],
      condition_note: [{ value: conditionNote, marketplace_id: MARKETPLACE_CA }],
      list_price: [{ value: listPriceCad, currency: 'CAD', marketplace_id: MARKETPLACE_CA }],
      fulfillment_availability: [
        {
          fulfillment_channel_code: 'AMAZON_NA',
          quantity: 1,
          marketplace_id: MARKETPLACE_CA,
        },
      ],
      purchasable_offer: [
        {
          marketplace_id: MARKETPLACE_CA,
          our_price: [{ schedule: [{ value_with_tax: listPriceCad }] }],
        },
      ],
    },
  }

  let putResponse: PutResponse
  try {
    putResponse = await spFetch<PutResponse>(putPath, {
      method: 'PUT',
      params: queryParams,
      body: putBody,
    })
  } catch (err) {
    return {
      sku,
      status: 'ERROR',
      issues: [{ message: err instanceof Error ? err.message : String(err) }],
    }
  }

  // Read status from submissionResponse (SP-API v2021-08-01 shape)
  const submissionStatus = putResponse?.submissionResponse?.status ?? putResponse?.status ?? 'ERROR'
  const submissionIssues: unknown[] =
    putResponse?.submissionResponse?.issues ?? putResponse?.issues ?? putResponse?.errors ?? []

  if (submissionStatus === 'INVALID') {
    return { sku, status: 'INVALID', issues: submissionIssues }
  }

  // PATCH immediately after PUT to ensure price is applied — Amazon sometimes ignores
  // price on initial PUT for offer-only listings.
  const patchBody = {
    productType: 'PRODUCT',
    patches: [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: [
          {
            marketplace_id: MARKETPLACE_CA,
            our_price: [{ schedule: [{ value_with_tax: listPriceCad }] }],
          },
        ],
      },
    ],
  }

  try {
    await spFetch<PutResponse>(putPath, {
      method: 'PATCH',
      params: queryParams,
      body: patchBody,
    })
  } catch {
    // PATCH result is informational; don't fail the listing if PATCH returns an error
  }

  const finalStatus =
    submissionStatus === 'ACCEPTED' || submissionStatus === 'VALID'
      ? (submissionStatus as 'ACCEPTED' | 'VALID')
      : 'ERROR'

  return { sku, status: finalStatus, issues: submissionIssues }
}
