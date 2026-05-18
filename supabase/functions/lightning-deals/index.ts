import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const KEEPA_EPOCH_MS = 1_293_840_000_000;
const PRICE_TYPE_AMAZON = 0;
const PRICE_TYPE_MARKETPLACE_NEW = 1;
const MAX_ALERTS_PER_RUN = 3;
const MIN_DISCOUNT_PCT = 25;
const DOMAIN = 6; // Amazon.ca

// Hardcoded brand allowlist — source: Trusted Brands sheet 2026-05-18
const BRAND_ALLOWLIST = [
  'lego', 'hot wheels', 'hasbro', 'mattel', 'nintendo', 'sony',
  'funko', 'fisher-price', 'melissa & doug', 'spin master',
  'ravensburger', 'clue', 'monopoly', 'jenga', 'play-doh',
];

function validPrice(val: number | undefined): number | null {
  return val != null && val > 0 ? val : null;
}

function extractCurrentPrice(current: number[] | undefined): number | null {
  if (!Array.isArray(current)) return null;
  return validPrice(current[PRICE_TYPE_AMAZON]) ?? validPrice(current[PRICE_TYPE_MARKETPLACE_NEW]) ?? null;
}

function extractAvgPrice(avg: number[] | undefined, typeIdx: number): number | null {
  if (!Array.isArray(avg)) return null;
  // 30d avg at typeIdx, fallback to 90d avg
  return validPrice(avg[typeIdx]) ?? validPrice(avg[36 + typeIdx]) ?? null;
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

    // Auth: Bearer token must match CRON_SECRET in harness_config
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const { data: secretRow } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'CRON_SECRET')
      .maybeSingle();
    if (!secretRow || bearer !== secretRow.value.trim()) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Read API keys from harness_config
    const { data: configRows } = await db
      .from('harness_config')
      .select('key, value')
      .in('key', ['KEEPA_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);

    const cfg: Record<string, string> = {};
    for (const row of configRows ?? []) cfg[row.key] = row.value;

    if (!cfg['KEEPA_API_KEY']) {
      return new Response(JSON.stringify({ error: 'KEEPA_API_KEY missing from harness_config' }), { status: 503 });
    }
    if (!cfg['TELEGRAM_BOT_TOKEN']) {
      return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN missing from harness_config' }), { status: 503 });
    }

    // Fetch deals from Keepa
    // deltaPercentRange: negative = price drop. [-100, -25] = 25%+ below reference price.
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
      console.error(`[lightning-deals] Keepa ${keepaRes.status}`);
      return new Response(JSON.stringify({ error: `Keepa ${keepaRes.status}` }), { status: 502 });
    }
    const keepaJson = await keepaRes.json() as Record<string, unknown>;
    const tokensLeft: number | null = (keepaJson.tokensLeft as number) ?? null;
    const rawDeals = ((keepaJson.deals as Record<string, unknown>)?.dr as unknown[]) ?? [];

    if (tokensLeft != null && tokensLeft < 100) {
      console.warn(`[lightning-deals] Keepa tokens low: ${tokensLeft}`);
    }

    const now = new Date();
    const scanned = rawDeals.length;

    // Parse deals using verified correct Keepa field structure (confirmed via API probe 2026-05-18)
    // Fields: current[36] (price by type), avg[144] (4 intervals × 36 types), lightningStart/End
    const rows = rawDeals
      .map((d) => {
        const deal = d as Record<string, unknown>;
        const current = deal.current as number[] | undefined;
        const avg = deal.avg as number[] | undefined;
        const typeIdx = currentTypeIdx(current);
        const rawCurrent = extractCurrentPrice(current);
        const rawAvg = extractAvgPrice(avg, typeIdx);
        const dealPrice = rawCurrent != null ? rawCurrent / 100 : null;
        const origPrice = rawAvg != null ? rawAvg / 100 : null;
        let discountPct: number | null = null;
        if (dealPrice != null && origPrice != null && origPrice > 0) {
          discountPct = Math.max(0, ((origPrice - dealPrice) / origPrice) * 100);
        }
        return {
          asin: (deal.asin as string) ?? '',
          title: (deal.title as string) ?? null,
          deal_price: dealPrice,
          orig_price: origPrice,
          discount_pct: discountPct,
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

    // DO UPDATE so correct prices overwrite any stale null-price rows from old Vercel cron
    const { error: upsertErr } = await db
      .from('keepa_lightning_deals')
      .upsert(rows, { onConflict: 'asin,domain', ignoreDuplicates: false });
    if (upsertErr) {
      console.error('[lightning-deals] upsert:', upsertErr.message);
      return new Response(JSON.stringify({ error: upsertErr.message }), { status: 500 });
    }

    // Query unalerted brand-matching non-expired rows
    const { data: pending } = await db
      .from('keepa_lightning_deals')
      .select('id, asin, title, deal_price, orig_price, discount_pct, deal_type, ends_at')
      .eq('alerted', false)
      .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
      .order('discount_pct', { ascending: false });

    const brandFiltered = (pending ?? []).filter((row) => {
      const t = ((row.title as string | null) ?? '').toLowerCase();
      return BRAND_ALLOWLIST.some((b) => t.includes(b));
    });

    // Hard cap: MAX_ALERTS_PER_RUN per tick until verified working
    const toAlert = brandFiltered.slice(0, MAX_ALERTS_PER_RUN);
    let alerted = 0;

    for (const row of toAlert) {
      const priceStr = row.deal_price != null ? `$${(row.deal_price as number).toFixed(2)}` : 'N/A';
      const origStr  = row.orig_price  != null ? `$${(row.orig_price  as number).toFixed(2)}` : 'N/A';
      const pctStr   = row.discount_pct != null ? ` (-${(row.discount_pct as number).toFixed(0)}%)` : '';
      const endsStr  = row.ends_at != null
        ? new Date(row.ends_at as string).toLocaleString('en-CA', {
            timeZone: 'America/Edmonton', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })
        : 'No expiry';
      const typeLabel = row.deal_type === 'lightning' ? '⚡ Lightning Deal' : '⭐ Best Deal';
      const text = [
        `${typeLabel} — Amazon.ca`,
        `[${row.asin as string}] ${(row.title as string | null) ?? row.asin}`,
        `${priceStr} → was ${origStr}${pctStr}`,
        `Ends: ${endsStr}`,
        `https://www.amazon.ca/dp/${row.asin as string}`,
      ].join('\n');

      await fetch(
        `https://api.telegram.org/bot${cfg['TELEGRAM_BOT_TOKEN']}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cfg['TELEGRAM_CHAT_ID'], text }),
        },
      );

      await db.from('keepa_lightning_deals').update({ alerted: true }).eq('id', row.id);
      alerted++;
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
