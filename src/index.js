const TROY_OZ_TO_GRAMS = 31.1034768;
const CACHE_TTL_SECONDS = 60;
// Aligns raw international XAU/USD * USD/INR parity with Indian MCX/IBJA bullion rates (excl. 3% GST)
const INDIA_LANDED_MULTIPLIER = 1.155;

function computeKarat(rate24kPerGram, karat) {
  const per1g = rate24kPerGram * (karat / 24);
  return {
    per_1g: Number(per1g.toFixed(2)),
    per_10g: Number((per1g * 10).toFixed(2)),
  };
}

async function fetchDynamicUsdInr() {
  const sources = [
    async () => {
      const res = await fetch(
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
        { cf: { cacheTtl: 60 } }
      );
      if (!res.ok) throw new Error("Primary FX feed failed");
      const data = await res.json();
      return { rate: Number(data?.usd?.inr), source: "intraday-fx" };
    },
    async () => {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", {
        cf: { cacheTtl: 60 },
      });
      if (!res.ok) throw new Error("ER-API feed failed");
      const data = await res.json();
      return { rate: Number(data?.rates?.INR), source: "open-er" };
    },
    async () => {
      const res = await fetch("https://api.frankfurter.dev/v2/rate/usd/inr", {
        cf: { cacheTtl: 60 },
      });
      if (!res.ok) throw new Error("Frankfurter feed failed");
      const data = await res.json();
      return { rate: Number(data?.rate), source: "frankfurter-v2" };
    },
  ];

  for (const getRate of sources) {
    try {
      const result = await getRate();
      if (Number.isFinite(result.rate) && result.rate > 0) {
        return result;
      }
    } catch (_) {
      // Try next provider in cascade
    }
  }

  throw new Error("All USD/INR exchange rate feeds failed");
}

async function fetchLiveGoldRates() {
  const [goldRes, fxResult] = await Promise.all([
    fetch("https://api.gold-api.com/price/XAU", {
      headers: { "User-Agent": "goldpriceindia.live" },
      cf: { cacheTtl: 30 },
    }),
    fetchDynamicUsdInr(),
  ]);

  if (!goldRes.ok) {
    throw new Error("Upstream gold XAU/USD API failed");
  }

  const goldData = await goldRes.json();
  const xauUsd = Number(goldData?.price);
  const usdInr = fxResult.rate;

  if (!Number.isFinite(xauUsd) || xauUsd <= 0 || !Number.isFinite(usdInr) || usdInr <= 0) {
    throw new Error("Invalid numeric price or exchange rate returned");
  }

  const rawSpot24kPerGram = (xauUsd / TROY_OZ_TO_GRAMS) * usdInr;
  const indiaBullion24kPerGram = rawSpot24kPerGram * INDIA_LANDED_MULTIPLIER;

  return {
    updated_at: new Date().toISOString(),
    cache_ttl_seconds: CACHE_TTL_SECONDS,
    fx_source: fxResult.source,
    spot_usd_oz: Number(xauUsd.toFixed(2)),
    usd_inr: Number(usdInr.toFixed(4)),
    india_multiplier: INDIA_LANDED_MULTIPLIER,
    raw_spot_24k_10g: Number((rawSpot24kPerGram * 10).toFixed(2)),
    raw_spot_inr: {
      "24K": computeKarat(rawSpot24kPerGram, 24),
      "22K": computeKarat(rawSpot24kPerGram, 22),
      "20K": computeKarat(rawSpot24kPerGram, 20),
      "18K": computeKarat(rawSpot24kPerGram, 18),
    },
    rates_inr: {
      "24K": computeKarat(indiaBullion24kPerGram, 24),
      "22K": computeKarat(indiaBullion24kPerGram, 22),
      "20K": computeKarat(indiaBullion24kPerGram, 20),
      "18K": computeKarat(indiaBullion24kPerGram, 18),
    },
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/rates") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const cache = caches.default;
      const cacheKey = new Request(url.toString(), { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }

      try {
        const payload = await fetchLiveGoldRates();
        const response = new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
            "Access-Control-Allow-Origin": "*",
          },
        });

        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: "Unable to fetch real-time gold rates",
            details: err instanceof Error ? err.message : "Unknown error",
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store",
            },
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};