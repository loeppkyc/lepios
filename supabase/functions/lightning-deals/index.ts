import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const KEEPA_EPOCH_MS = 1_293_840_000_000;
const PRICE_TYPE_AMAZON = 0;
const PRICE_TYPE_MARKETPLACE_NEW = 1;
const PRICE_TYPE_BUY_BOX_NEW = 11;
const MAX_ALERTS_PER_RUN = 3;
const MIN_DISCOUNT_PCT = 25;
const DOMAIN = 6; // Amazon.ca

// Fee constants (Amazon.ca 2025)
const REFERRAL_FEE_PCT = 0.15;   // 15% — Toys & Games category
const INBOUND_SHIP_FLAT = 2.00;  // per-unit estimate: prep + ship to FC

const BRAND_ALLOWLIST = [
  'lego', 'hot wheels', 'hasbro', 'mattel', 'nintendo', 'sony',
  'funko', 'fisher-price', 'melissa & doug', 'spin master',
  'ravensburger', 'clue', 'monopoly', 'jenga', 'play-doh',
];

// ── Amazon.ca FBA fulfillment fee lookup (2025 estimates) ─────────────────────
// Keepa packageLength/Width/Height are in mm; packageWeight in grams.
// Dims sorted longest→shortest for tier matching.
function getFbaFee(mmL: number, mmW: number, mmH: number, grams: number): { tier: string; fee: number } {
  const dims = [mmL / 10, mmW / 10, mmH / 10].filter((d) => d > 0).sort((a, b) => b - a);
  const longest = dims[0] ?? 0;
  const median = dims[1] ?? 0;
  const shortest = dims[2] ?? 0;

  // Small standard: ≤ 28 × 14 × 4.5 cm, ≤ 400 g
  if (longest <= 28 && median <= 14 && shortest <= 4.5 && grams <= 400) {
    return { tier: 'Sm Std', fee: grams <= 200 ? 3.60 : 3.90 };
  }

  // Large standard: ≤ 45 × 34 × 26 cm, ≤ 12 kg
  if (longest <= 45 && median <= 34 && shortest <= 26 && grams <= 12_000) {
    const tiers: [number, number][] = [
      [500, 4.60], [1_000, 5.10], [1_500, 5.70], [2_000, 6.20],
      [3_000, 7.20], [4_000, 8.20], [5_000, 9.20], [9_000, 10.50], [12_000, 11.50],
    ];
    for (const [maxG, fee] of tiers) {
      if (grams <= maxG) return { tier: 'Lg Std', fee };
    }
    return { tier: 'Lg Std', fee: 11.50 };
  }

  // Small oversize: ≤ 76 × 38 × 30 cm, ≤ 14.9 kg
  if (longest <= 76 && median <= 38 && shortest <= 30 && grams <= 14_900) {
    const extra = Math.max(0, Math.ceil((grams - 2_000) / 100));
    return { tier: 'Sm Oversize', fee: +(12.00 + extra * 0.40).toFixed(2) };
  }

  // Medium oversize: ≤ 165 × 97 × 46 cm, ≤ 22.7 kg
  if (longest <= 165 && median <= 97 && shortest <= 46 && grams <= 22_700) {
    const extra = Math.max(0, Math.ceil((grams - 2_000) / 100));
    return { tier: 'Med Oversize', fee: +(18.00 + extra * 0.40).toFixed(2) };
  }

  return { tier: 'Lg Oversize', fee: 35.00 };
}

function validPrice(val: number | undefined): number | null {
  return val != null && val > 0 ? val : null;
}

function extractCurrentPrice(current: number[] | undefined): number | null {
  if (!Array.isArray(current)) return null;
  return validPrice(current[PRICE_TYPE_AMAZON]) ?? validPrice(current[PRICE_TYPE_MARKETPLACE_NEW]) ?? null;
}

// Deal endpoint avg[] has only 4 elements (all typically -1 for CA) — not useful.
// This function handles the PRODUCT endpoint stats avg arrays (36 types).
function extractStatAvg(avg: number[] | undefined): number | null {
  if (!Array.isArray(avg)) return null;
  return (
    validPrice(avg[PRICE_TYPE_AMAZON])
    ?? validPrice(avg[PRICE_TYPE_MARKETPLACE_NEW])
    ?? validPrice(avg[PRICE_TYPE_BUY_BOX_NEW])
    ?? null
  );
}

function currentTypeIdx(current: number[] | undefined): number {
  if (Array.isArray(current) && validPrice(current[PRICE_TYPE_AMAZON]) != null) return PRICE_TYPE_AMAZON;
  return PRICE_TYPE_MARKETPLACE_NEW;
}

function toDateIso(mins: number | undefined): string | null {
  if (!mins || mins <= 0) return null;
  return new Date(mins * 60_000 + KEEPA_EPOCH_MS).toISOString();
}

Deno.serve(async (req: Request) => {
  const started = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const { data: secretRow } = await db
      .from('harness_config').select('value').eq('key', 'CRON_SECRET').maybeSingle();
    if (!secretRow || bearer !== secretRow.value.trim()) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const cronSecret = secretRow.value.trim();

    const { data: configRows } = await db
      .from('harness_config').select('key, value').in('key', ['KEEPA_API_KEY', 'LEPIOS_BASE_URL']);
    const cfg: Record<string, string> = {};
    for (const row of configRows ?? []) cfg[row.key] = row.value;
    if (!cfg['KEEPA_API_KEY']) return new Response(JSON.stringify({ error: 'KEEPA_API_KEY missing' }), { status: 503 });
    if (!cfg['LEPIOS_BASE_URL']) return new Response(JSON.stringify({ error: 'LEPIOS_BASE_URL missing' }), { status: 503 });

    // ── 1. Fetch deals from Keepa deal endpoint ───────────────────────────────
    const selection = {
      domainId: DOMAIN,
      deltaPercentRange: [-100, -MIN_DISCOUNT_PCT],
      priceTypes: 1,
      page: 0,
      perPage: 100,
      isFilterEnabled: true,
    };
    const keepaUrl = `https://api.keepa.com/deal?key=${cfg['KEEPA_API_KEY']}&selection=${encodeURIComponent(JSON.stringify(selection))}`;
    const keepaRes = await fetch(keepaUrl, { signal: AbortSignal.timeout(20_000) });
    if (!keepaRes.ok) {
      return new Response(JSON.stringify({ error: `Keepa deal ${keepaRes.status}` }), { status: 502 });
    }
    const keepaJson = await keepaRes.json() as Record<string, unknown>;
    const tokensLeft: number | null = (keepaJson.tokensLeft as number) ?? null;
    const rawDeals = ((keepaJson.deals as Record<string, unknown>)?.dr as unknown[]) ?? [];

    if (tokensLeft != null && tokensLeft < 100) {
      console.warn(`[lightning-deals] Keepa tokens low: ${tokensLeft}`);
    }

    const now = new Date();
    const scanned = rawDeals.length;

    // ── 2. Parse and upsert deals ─────────────────────────────────────────────
    // orig_price stays null — filled by product API below.
    const rows = rawDeals
      .map((d) => {
        const deal = d as Record<string, unknown>;
        const current = deal.current as number[] | undefined;
        const rawCurrent = extractCurrentPrice(current);
        const dealPrice = rawCurrent != null ? rawCurrent / 100 : null;
        return {
          asin: (deal.asin as string) ?? '',
          title: (deal.title as string) ?? null,
          deal_price: dealPrice,
          orig_price: null as number | null,
          discount_pct: null as number | null,
          deal_type: ((deal.lightningStart as number) > 0) ? 'lightning' : 'best',
          starts_at: toDateIso(deal.lightningStart as number),
          ends_at: toDateIso(deal.lightningEnd as number),
          domain: DOMAIN,
          alerted: false,
          found_at: now.toISOString(),
        };
      })
      .filter((r) => r.asin.length > 0);

    if (rows.length === 0) {
      await logEvent(db, { scanned: 0, alerted: 0, tokensLeft, started });
      return new Response(JSON.stringify({ ok: true, scanned: 0, alerted: 0 }), { status: 200 });
    }

    const { error: upsertErr } = await db
      .from('keepa_lightning_deals')
      .upsert(rows, { onConflict: 'asin,domain', ignoreDuplicates: false });
    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }), { status: 500 });
    }

    // ── 3. Find unalerted brand items ─────────────────────────────────────────
    const { data: pending } = await db
      .from('keepa_lightning_deals')
      .select('id, asin, title, deal_price, orig_price, discount_pct, deal_type, ends_at')
      .eq('alerted', false)
      .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
      .order('discount_pct', { ascending: false });

    const brandFiltered = (pending ?? [])
      .filter((row) => {
        // First 30 chars only — brand names lead toy titles; avoids Sony-webcam false positives.
        const titleStart = ((row.title as string | null) ?? '').toLowerCase().slice(0, 30);
        return BRAND_ALLOWLIST.some((b) => titleStart.includes(b));
      })
      .filter((row) => row.deal_price != null);

    // ── 4. Product API lookup: avg prices + dimensions for fee calculation ────
    // Cost: ~0.5 tokens/ASIN (history=0 is half price).
    // Returns: stats.avg/avg90/avg180/avg365 (36-type arrays) + package dimensions.
    const needsLookup = brandFiltered
      .filter((row) => row.orig_price == null)
      .map((row) => row.asin as string);

    // feeData maps ASIN → { tier, fbaFee } computed from product dimensions
    const feeData = new Map<string, { tier: string; fbaFee: number }>();

    if (needsLookup.length > 0) {
      const productUrl = [
        `https://api.keepa.com/product`,
        `?key=${cfg['KEEPA_API_KEY']}`,
        `&domain=${DOMAIN}`,
        `&asin=${needsLookup.join(',')}`,
        `&stats=365`,
        `&history=0`,
      ].join('');

      const productRes = await fetch(productUrl, { signal: AbortSignal.timeout(15_000) })
        .catch(() => null);

      if (productRes?.ok) {
        interface KeepaStats {
          avg?: number[];
          avg90?: number[];
          avg180?: number[];
          avg365?: number[];
        }
        interface KeepaProduct {
          asin?: string;
          stats?: KeepaStats;
          // Dimensions in mm, weight in grams
          packageLength?: number;
          packageWidth?: number;
          packageHeight?: number;
          packageWeight?: number;
        }
        const productJson = await productRes.json() as { products?: KeepaProduct[] };

        for (const product of productJson.products ?? []) {
          if (!product.asin) continue;

          // Dimensions → FBA tier (store even when avg is missing — we always show fees)
          const mmL = product.packageLength ?? 0;
          const mmW = product.packageWidth ?? 0;
          const mmH = product.packageHeight ?? 0;
          const grams = product.packageWeight ?? 0;
          if (mmL > 0 && mmW > 0 && mmH > 0 && grams > 0) {
            const { tier, fee: fbaFee } = getFbaFee(mmL, mmW, mmH, grams);
            feeData.set(product.asin, { tier, fbaFee });
          }

          // Avg price from stats
          if (!product.stats) continue;
          const s = product.stats;
          const origHundredths =
            extractStatAvg(s.avg)
            ?? extractStatAvg(s.avg90)
            ?? extractStatAvg(s.avg180)
            ?? extractStatAvg(s.avg365)
            ?? null;

          if (origHundredths != null) {
            const origPrice = origHundredths / 100;
            const row = brandFiltered.find((r) => r.asin === product.asin);
            if (row) {
              const dealPrice = row.deal_price as number;
              const discountPct = origPrice > dealPrice
                ? Math.max(0, (origPrice - dealPrice) / origPrice * 100)
                : null;
              await db
                .from('keepa_lightning_deals')
                .update({ orig_price: origPrice, discount_pct: discountPct })
                .eq('asin', product.asin)
                .eq('domain', DOMAIN);
              row.orig_price = origPrice;
              row.discount_pct = discountPct;
            }
          }
        }
      }
    }

    // Re-sort after enrichment
    brandFiltered.sort((a, b) =>
      ((b.discount_pct as number | null) ?? 0) - ((a.discount_pct as number | null) ?? 0)
    );

    // ── 5. Send up to MAX_ALERTS_PER_RUN notifications ────────────────────────
    const toAlert = brandFiltered.slice(0, MAX_ALERTS_PER_RUN);
    let alerted = 0;

    for (const row of toAlert) {
      const dealPrice = row.deal_price as number;
      const origPrice = row.orig_price as number | null;
      const title = (row.title as string | null) ?? (row.asin as string);

      let profitLine: string;
      let feeLine: string | null = null;

      if (origPrice != null) {
        const referral = origPrice * REFERRAL_FEE_PCT;
        const fee = feeData.get(row.asin as string);
        const fbaFee = fee?.fbaFee ?? 4.50; // flat estimate when dimensions unavailable
        const fbaLabel = fee?.tier ?? '~Std';
        const totalFees = referral + fbaFee + INBOUND_SHIP_FLAT;
        const net = origPrice - dealPrice - totalFees;
        const netRoi = (net / dealPrice) * 100;

        if (origPrice > dealPrice) {
          profitLine = `Buy $${dealPrice.toFixed(2)} → Sell ~$${origPrice.toFixed(2)} | Net ~$${net.toFixed(2)} (${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(0)}% ROI)`;
          feeLine = `Fees: $${referral.toFixed(2)} ref + $${fbaFee.toFixed(2)} FBA (${fbaLabel}) + $${INBOUND_SHIP_FLAT.toFixed(2)} ship`;
        } else {
          profitLine = `Buy $${dealPrice.toFixed(2)} → Avg $${origPrice.toFixed(2)} (deal ≥ avg)`;
        }
      } else {
        profitLine = `Buy $${dealPrice.toFixed(2)} | No price history on Keepa`;
      }

      const typeLabel = row.deal_type === 'lightning' ? 'Lightning Deal' : 'Best Deal';
      const endsStr = row.ends_at != null
        ? `Ends: ${new Date(row.ends_at as string).toLocaleString('en-CA', {
            timeZone: 'America/Edmonton', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}`
        : null;

      const lines = [
        `${typeLabel} — Amazon.ca`,
        title,
        profitLine,
        feeLine,
        endsStr,
        `amazon.ca/dp/${row.asin as string}`,
      ].filter((l): l is string => l != null);

      await db.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text: lines.join('\n') },
      });
      await db.from('keepa_lightning_deals').update({ alerted: true }).eq('id', row.id);
      alerted++;
    }

    if (alerted > 0) {
      await fetch(`${cfg['LEPIOS_BASE_URL']}/api/harness/notifications-drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cronSecret}` },
        body: '{}',
      }).catch((e) => console.error('[lightning-deals] drain failed:', e));
    }

    await logEvent(db, { scanned, alerted, tokensLeft, started });
    return new Response(
      JSON.stringify({ ok: true, scanned, alerted, brand_matched: brandFiltered.length }),
      { status: 200 },
    );

  } catch (err) {
    console.error('[lightning-deals]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

async function logEvent(
  db: ReturnType<typeof createClient>,
  { scanned, alerted, tokensLeft, started }: { scanned: number; alerted: number; tokensLeft?: number | null; started: number },
) {
  await db.from('agent_events').insert({
    domain: 'keepa',
    action: 'lightning_deals_scan',
    actor: 'edge_fn_lightning_deals',
    status: 'success',
    duration_ms: Date.now() - started,
    output_summary: `scanned=${scanned} alerted=${alerted}`,
    meta: { scanned, alerted, tokensLeft, source: 'edge_function' },
  });
}
