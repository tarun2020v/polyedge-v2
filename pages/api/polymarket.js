// pages/api/polymarket.js
// Calls Owls Insight directly and formats for the frontend

import { cacheGet, cacheSet } from "../../lib/cache";

const API_KEY = process.env.OWLS_API_KEY;
const BASE = "https://api.owlsinsight.com/api/v1";
const SPORTS = ["nba", "nfl", "nhl", "mlb", "ncaab", "ncaaf", "soccer", "tennis"];

function americanToImplied(american) {
  if (!american && american !== 0) return null;
  if (american > 0) return parseFloat((100 / (american + 100) * 100).toFixed(1));
  return parseFloat((Math.abs(american) / (Math.abs(american) + 100) * 100).toFixed(1));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  if (!API_KEY) {
    return res.status(200).json({ source: "no-key", data: [] });
  }

const cacheKey = "owls_polymarket_v2";
  if (req.query.bust) cacheClear();
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json({ source: "cache", data: cached });

  try {
    const allMarkets = [];

    await Promise.all(SPORTS.map(async (sp) => {
      try {
        const url = new URL(`${BASE}/${sp}/odds`);
        url.searchParams.set("books", "pinnacle,polymarket,kalshi");

        const r = await fetch(url.toString(), {
          headers: { "Authorization": `Bearer ${API_KEY}` },
          signal: AbortSignal.timeout(10000),
        });

        if (!r.ok) return;
        const json = await r.json();
        if (!json.success) return;

        const data = json.data || {};

        // Build sharp ref maps by event id
        const pinnacleMap = {};
        const kalshiMap = {};

        for (const ev of (data.pinnacle || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (h2h) {
            pinnacleMap[ev.id] = h2h.outcomes.map(o => ({
              name: o.name,
              price: o.price,
              impliedProb: americanToImplied(o.price),
            }));
          }
        }

        for (const ev of (data.kalshi || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (h2h) {
            kalshiMap[ev.id] = h2h.outcomes.map(o => ({
              name: o.name,
              price: o.price,
              impliedProb: americanToImplied(o.price),
            }));
          }
        }

        // Process each Polymarket event
        for (const ev of (data.polymarket || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          const polyOutcomes = h2h.outcomes.map(o => ({
            name: o.name,
            price: o.price,
            impliedProb: americanToImplied(o.price),
          }));

          if (!polyOutcomes.length) continue;

          const homeTeam = ev.home_team || "";
          const lastWord = homeTeam.toLowerCase().split(" ").slice(-1)[0];

          // Get Polymarket home team probability
          const polyHomeOutcome = polyOutcomes.find(o =>
            lastWord && o.name?.toLowerCase().includes(lastWord)
          ) || polyOutcomes[0];

          const polyProb = polyHomeOutcome?.impliedProb;
          if (!polyProb || polyProb <= 5 || polyProb >= 95) continue;

          // Get sharp reference — prefer Kalshi, then Pinnacle
          const sharpOutcomes = kalshiMap[ev.id] || pinnacleMap[ev.id] || null;
          const sharpSource = kalshiMap[ev.id] ? "kalshi" : pinnacleMap[ev.id] ? "pinnacle" : "no-ref";

          const sharpHomeOutcome = sharpOutcomes ? (
            sharpOutcomes.find(o =>
              lastWord && o.name?.toLowerCase().includes(lastWord)
            ) || sharpOutcomes[0]
          ) : null;

          const sharpProb = sharpHomeOutcome?.impliedProb || null;

          allMarkets.push({
            id: ev.id,
            question: `${ev.away_team} vs ${ev.home_team}`,
            category: "Sports",
            sport: sp,
            league: ev.league || null,
            slug: ev.id,
            endDate: ev.commence_time,
            volume24hr: 10000,
            yesPrice: polyProb / 100,
            noPrice: (100 - polyProb) / 100,
            bestBid: polyProb / 100,
            bestAsk: polyProb / 100,
            spread: 0.02,
            url: `https://polymarket.com`,
            home_team: ev.home_team,
            away_team: ev.away_team,
            sharpProbDirect: sharpProb,
            sharpSourceDirect: sharpSource,
            pinnacleOutcomes: sharpSource === "pinnacle" ? sharpOutcomes : null,
            kalshiOutcomes: sharpSource === "kalshi" ? sharpOutcomes : null,
          });
        }

      } catch (e) {
        console.error(`Owls error for ${sp}:`, e.message);
      }
    }));

    cacheSet(cacheKey, allMarkets);
    return res.status(200).json({ source: "live", data: allMarkets });

  } catch (err) {
    console.error("Polymarket proxy error:", err.message);
    return res.status(502).json({ error: err.message, data: [] });
  }
}
