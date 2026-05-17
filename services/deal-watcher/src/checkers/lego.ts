// LEGO.ca availability checker
// Fetches the product page HTML and looks for "Add to Bag" (in stock) vs "Sold Out" / "Notify Me"
// No puppeteer — plain HTTP GET + regex on HTML.

export interface LegoStatus {
  in_stock: boolean
  price_cad: number | null
  raw_status: string
}

export async function checkLego(url: string): Promise<LegoStatus> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`LEGO HTTP ${res.status}`)
  const html = await res.text()

  // LEGO.ca shows "Add to Bag" when in stock, "Notify Me" or "Sold Out" when not
  const in_stock = /add to bag/i.test(html) && !/sold out/i.test(html)
  const raw_status = in_stock ? 'in_stock' : 'out_of_stock'

  // Try to extract price from JSON-LD or meta tags
  const priceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/)
  const price_cad = priceMatch ? parseFloat(priceMatch[1]) : null

  return { in_stock, price_cad, raw_status }
}
