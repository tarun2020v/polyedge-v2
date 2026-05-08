export const MIN_EDGE_THRESHOLD = 1;
export const POLY_FEE = 0.02;
export const MIN_VOLUME = 5000;
export const STEAM_THRESHOLD = 3;
export const CONSENSUS_THRESHOLD = 2;

export function americanToImplied(american) {
  if (!american && american !== 0) return null;
  if (american > 0) return parseFloat((100 / (american + 100) * 100).toFixed(2));
  return parseFloat((Math.abs(american) / (Math.abs(american) + 100) * 100).toFixed(2));
}

export function calcEdge(sharpProb, polyProb) {
  return parseFloat((sharpProb - polyProb).toFixed(2));
}

export function calcEdgeAfterFees(sharpProb, polyProb) {
  const raw = sharpProb - polyProb;
  const winProb = polyProb / 100;
  const feeImpact = winProb * POLY_FEE * 100;
  return parseFloat((raw - feeImpact).toFixed(2));
}

export function calcConsensus(probs) {
  const SHARP_BOOKS = ["pinnacle","kalshi","novig","circa","westgate","wynn","south_point","betonline"];
  const available = SHARP_BOOKS
    .filter(b => probs[b] != null)
    .map(b => ({ name: b, prob: probs[b] }));
  if (available.length < CONSENSUS_THRESHOLD) return null;
  const avg = available.reduce((s, b) => s + b.prob, 0) / available.length;
  return {
    prob: parseFloat(avg.toFixed(2)),
    bookCount: available.length,
    books: available.map(b => b.name),
  };
}

export function annualisedEdge(edgePct, daysToResolve) {
  const dte = Math.max(0.04, daysToResolve);
  return parseFloat(((edgePct / 100) * (365 / dte) * 100).toFixed(1));
}

export function liquidityScore(volume24hr, spread, daysToResolve) {
  const volScore    = Math.min(1, (volume24hr || 0) / 100000);
  const spreadScore = Math.max(0, 1 - (spread || 0.05) * 10);
  const timeScore   = Math.max(0, 1 - (daysToResolve || 30) / 60);
  return parseFloat((volScore * 0.4 + spreadScore * 0.4 + timeScore * 0.2).toFixed(3));
}

export function compositeScore(edge, liqScore) {
  return parseFloat((edge * liqScore).toFixed(2));
}

export function calcSignalType({ edge, steamDetected, consensusCount, fadeSignal, hasRef }) {
  if (!hasRef) return "NO REF";
  if (edge < MIN_EDGE_THRESHOLD) return "SKIP";
  if (steamDetected) return "STEAM";
  if (consensusCount >= 2 && edge >= 3) return "CONSENSUS";
  if (fadeSignal && edge >= 2) return "FADE";
  if (edge >= 2) return "VALUE";
  return "MARGINAL";
}

export function exitSignal(entryPrice, currentPrice, sharpRef, entryEdge) {
  const currentEdge = sharpRef - currentPrice * 100;
  const priceMove   = ((currentPrice - entryPrice) / entryPrice) * 100;
  if (currentEdge < -2)
    return { action: "EXIT NOW",    reason: "Edge flipped negative vs sharp ref", color: "#ff4444", priority: 1 };
  if (priceMove >= 40)
    return { action: "TAKE PROFIT", reason: `+${priceMove.toFixed(0)}% price move`,  color: "#00e676", priority: 2 };
  if (currentEdge < entryEdge * 0.5)
    return { action: "REVIEW",      reason: "Edge has halved since entry",           color: "#ffab40", priority: 3 };
  return   { action: "HOLD",        reason: "Still +EV vs sharp ref",                color: "#484f58", priority: 4 };
}
