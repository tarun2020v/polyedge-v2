// pages/api/betfair.js — Owls Insight proxy, returns enriched markets with sharp refs embedded

import { cacheGet, cacheSet } from "../../lib/cache";

const API_KEY = process.env.OWLS_API_KEY;
const BASE = "https://api.owlsinsight.com/api/v1";

const SPORTS = ["nba", "nfl", "nhl", "mlb", "ncaab", "soccer", "tennis"];

function americanToImplied(american) {
  if (!american && american !== 0) return null;
  if (american > 0) return parseFloat((100 / (american + 100) * 100).toFixed(1));
  return parseFloat((Math.abs(american) / (Math.abs(american) + 100) * 100).toFixed(1));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  if (!API_KEY) {
    return res.status(200).json({ available: false, message: "OWLS_API_KEY not configured" });
  }

  const { sport, query } = req.query;
  const sportsToFetch = sport ? [sport] : SPORTS;

  const cacheKey = `owls_enriched_${sportsToFetch.join("_")}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json({ source: "cache", available: true, data: cached });

  try {
    const allEnriched = [];

    await Promise.all(sportsToFetch.map(async (sp) => {
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

        // Build maps: eventId → outcomes for each sharp book
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

        // Process Polymarket events
        for (const ev of (data.polymarket || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          const polyOutcomes = h2h.outcomes.map(o => ({
            name: o.name,
            price: o.price,
            impliedProb: americanToImplied(o.price),
          }));

          if (!polyOutcomes.length) continue;

          // Get sharp reference — prefer Kalshi, fallback Pinnacle
          const sharpOutcomes = kalshiMap[ev.id] || pinnacleMap[ev.id] || null;
          const sharpSource = kalshiMap[ev.id] ? "kalshi" : pinnacleMap[ev.id] ? "pinnacle" : "no-ref";

          // Match home team outcome from Polymarket vs sharp ref
          const homeTeam = ev.home_team || "";
          const polyHomeOutcome = polyOutcomes.find(o =>
            homeTeam && o.name?.toLowerCase().includes(homeTeam.toLowerCase().split(" ").slice(-1)[0])
          ) || polyOutcomes[0];

          const sharpHomeOutcome = sharpOutcomes ? (
            sharpOutcomes.find(o =>
              homeTeam && o.name?.toLowerCase().includes(homeTeam.toLowerCase().split(" ").slice(-1)[0])
            ) || sharpOutcomes[0]
          ) : null;

          const polyProb = polyHomeOutcome?.impliedProb;
          const sharpProb = sharpHomeOutcome?.impliedProb;

          if (!polyProb) continue;

          allEnriched.push({
            id: ev.id,
            question: `${ev.away_team} vs ${ev.home_team}`,
            home_team: ev.home_team,
            away_team: ev.away_team,
            sport: sp,
            league: ev.league || null,
            commence_time: ev.commence_time,
            polyProb,
            sharpProb: sharpProb || null,
            sharpSource,
            polyOutcomes,
            sharpOutcomes,
          });
        }

      } catch (e) {
        console.error(`Owls error for ${sp}:`, e.message);
      }
    }));

    cacheSet(cacheKey, allEnriched);
    return res.status(200).json({ source: "live", available: true, data: allEnriched });

  } catch (err) {
    console.error("Owls API error:", err.message);
    return res.status(502).json({ available: true, error: err.message });
  }
}
