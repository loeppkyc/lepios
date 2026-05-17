import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const GQL_ENDPOINT = 'https://www.lego.com/api/graphql'

const LOOKUP_QUERY = `
  query QuickAdd($productCode: String!) {
    product(productCode: $productCode) {
      __typename
      ... on SingleVariantProduct {
        productCode
        slug
        name
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

interface LegoProduct {
  __typename: string
  productCode: string
  slug: string
  name: string
  variant?: {
    attributes?: {
      availabilityStatus?: string
      canAddToBag?: boolean
    }
  }
}

interface GqlResponse {
  data?: { product?: LegoProduct }
  errors?: Array<{ message: string }>
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { product_code?: string }
  const productCode = body.product_code?.trim().replace(/\D/g, '')
  if (!productCode) {
    return NextResponse.json({ error: 'product_code required (numbers only)' }, { status: 400 })
  }

  // Look up the set on LEGO.ca
  let legoRes: Response
  try {
    legoRes = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-locale': 'en-CA',
        Origin: 'https://www.lego.com',
        'User-Agent': 'Mozilla/5.0 (compatible; LepiOS-WatchBot/1.0)',
      },
      body: JSON.stringify({ query: LOOKUP_QUERY, variables: { productCode } }),
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach LEGO.ca' }, { status: 502 })
  }

  if (!legoRes.ok) {
    return NextResponse.json({ error: `LEGO.ca returned ${legoRes.status}` }, { status: 502 })
  }

  const gql = (await legoRes.json()) as GqlResponse
  if (gql.errors?.length) {
    return NextResponse.json({ error: gql.errors[0].message }, { status: 502 })
  }

  const product = gql.data?.product
  if (!product || product.__typename !== 'SingleVariantProduct') {
    return NextResponse.json(
      { error: `Set ${productCode} not found on LEGO.ca — check the number and try again` },
      { status: 404 }
    )
  }

  const url = `https://www.lego.com/en-ca/product/${product.slug}`
  const name = `LEGO ${product.name} ${product.productCode}`
  const rawStatus = product.variant?.attributes?.availabilityStatus ?? null
  const inStock = rawStatus === 'E_AVAILABLE' && product.variant?.attributes?.canAddToBag === true

  // Insert into watch_targets — check for duplicate first
  const { data: existing } = await supabase
    .from('watch_targets')
    .select('id, name, is_active')
    .eq('type', 'lego-ca')
    .eq('url', url)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `Already watching "${existing.name}"${!existing.is_active ? ' (paused)' : ''}` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('watch_targets')
    .insert({
      name,
      type: 'lego-ca',
      url,
      alert_on: 'in_stock',
      check_interval_min: 1,
      check_interval_sec: 30,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    target: data,
    current_status: inStock ? 'in_stock' : (rawStatus ?? 'unknown'),
  })
}
