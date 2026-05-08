// pages/api/refresh-cache.js
// Called by Vercel cron every 5 minutes to pre-warm the cache
// so dashboard loads instantly for the user

export default async function handler(req, res) {
  // Vercel cron sends Authorization header
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow direct refresh without auth in dev, require it in prod
    if (process.env.NODE_ENV === "production") {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const results = {};

  try {
    const polyRes = await fetch(`${base}/api/polymarket`);
    results.polymarket = polyRes.ok ? "refreshed" : `error ${polyRes.status}`;
  } catch (e) {
    results.polymarket = `failed: ${e.message}`;
  }

  return res.status(200).json({
    refreshed: new Date().toISOString(),
    results,
  });
}
