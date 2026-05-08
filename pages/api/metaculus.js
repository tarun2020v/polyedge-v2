// pages/api/metaculus.js — Manifold with similarity check to avoid false matches

import { cacheGet, cacheSet } from "../../lib/cache";

// Simple word overlap similarity score
function similarity(a, b) {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(w => w.length > 3));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const { q: query } = req.query;
  if (!query) return res.status(400).json({ error: "query param required" });

  const cacheKey = `manifold_v2_${query.slice(0, 60)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json({ source: "cache", ...cached });

  try {
    const url = new URL("https://api.manifold.markets/v0/search-markets");
    url.searchParams.set("term", query.slice(0, 100));
    url.searchParams.set("limit", "5");
    url.searchParams.set("filter", "open");
    url.searchParams.set("sort", "liquidity");

    const response = await fetch(url.toString(), {
      headers: { "Accept": "application/json", "User-Agent": "PolyEdge/1.0" },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) throw new Error(`Manifold responded ${response.status}`);

    const markets = await response.json();

    // Only use match if similarity score is above threshold
    const SIMILARITY_THRESHOLD = 0.25;

    const best = markets.find(m => {
      if (m.outcomeType !== "BINARY") return false;
      if (typeof m.probability !== "number") return false;
      const score = similarity(query, m.question);
      return score >= SIMILARITY_THRESHOLD;
    });

    const result = best ? {
      found: true,
      title: best.question,
      probability: parseFloat((best.probability * 100).toFixed(1)),
      similarityScore: similarity(query, best.question).toFixed(2),
      url: best.url,
      source: "manifold",
    } : { found: false, probability: null, source: "manifold" };

    cacheSet(cacheKey, result);
    return res.status(200).json({ source: "live", ...result });

  } catch (err) {
    console.error("Manifold API error:", err.message);
    return res.status(502).json({ error: err.message, found: false });
  }
}
