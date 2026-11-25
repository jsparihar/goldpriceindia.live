const TROY_OZ_TO_GRAMS = 31.1034768;
const CACHE_TTL_SECONDS = 60;

function computeKarat(rate24kPerGram, karat) {
  const per1g = rate24kPerGram * (karat / 24);
  return {
    per_1g: Number(per1g.toFixed(2)),
    per_10g: Number((per1g * 10).toFixed(2)),
  };
}

async function fetchLiveGoldRates() {
  const [goldRes, fxRes] = await Promise.all([
    fetch("https://api.gold-api.com/price/XAU", {
      headers: { "User-Agent": "goldpriceindia.live" },
    }),
    fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
      headers: { "User-Agent": "goldpriceindia.live" },
    }),
  ]);

  if (!goldRes.ok || !fxRes.ok) {
    throw new Error("Upstream gold or FX API failed");
  }

  const goldData = await goldRes.json();
  const fxData = await fxRes.json();

  const xauUsd = Number(goldData?.price);
  const usdInr = Number(fxData?.rates?.INR);

  if (!Number.isFinite(xauUsd) || xauUsd <= 0 || !Number.isFinite(usdInr) || usdInr <= 0) {
    throw new Error("Invalid numeric price or exchange rate returned");
  }

  const rate24kPerGram = (xauUsd / TROY_OZ_TO_GRAMS) * usdInr;

  return {
    updated_at: new Date().toISOString(),
    cache_ttl_seconds: CACHE_TTL_SECONDS,
    spot_usd_oz: Number(xauUsd.toFixed(2)),
    usd_inr: Number(usdInr.toFixed(4)),
    rates_inr: {
      "24K": computeKarat(rate24kPerGram, 24),
      "22K": computeKarat(rate24kPerGram, 22),
      "20K": computeKarat(rate24kPerGram, 20),
      "18K": computeKarat(rate24kPerGram, 18),
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
