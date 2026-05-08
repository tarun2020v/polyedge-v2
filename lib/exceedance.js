// lib/exceedance.js
// Remaining-upside model for intraday temperature markets.
// Target: P(finalMax - currentObservedMax >= gap), not generic full-day forecast odds.

const fs = require("fs");
const path = require("path");

const cache = new Map();
const MIN_ANALOGUES = parseInt(process.env.MIN_ANALOGUES || "40", 10);
const SHRINK_K = parseFloat(process.env.SHRINK_K || "5");

function loadStation(station) {
  if (cache.has(station)) return cache.get(station);
  const fp = path.join(process.cwd(), "data/historical", `${station}.json`);
  if (!fs.existsSync(fp)) return null;
  const data = JSON.parse(fs.readFileSync(fp, "utf8"));
  const rows = Array.isArray(data.rows) ? data.rows.filter(r =>
    Number.isFinite(r.localHour) && Number.isFinite(r.month) &&
    Number.isFinite(r.runningMax) && Number.isFinite(r.finalMax) && Number.isFinite(r.delta)
  ) : [];
  cache.set(station, rows);
  return rows;
}
function monthDistance(a, b) { const d = Math.abs(a - b); return Math.min(d, 12 - d); }
function quantile(sorted, q) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1)))); return sorted[i]; }
function subset(rows, hour, month, hourWindow, monthWindow) { return rows.filter(r => Math.abs(r.localHour - hour) <= hourWindow && monthDistance(r.month, month) <= monthWindow); }
function analogueSet(rows, hour, month, observedMax) {
  const ladders = [
    { hw: 0, mw: 1, rw: 0.5 }, { hw: 1, mw: 1, rw: 1.0 }, { hw: 1, mw: 2, rw: 1.5 },
    { hw: 2, mw: 2, rw: 2.0 }, { hw: 2, mw: 3, rw: 3.0 }, { hw: 3, mw: 3, rw: 4.0 },
  ];
  for (const l of ladders) {
    const base = subset(rows, hour, month, l.hw, l.mw);
    const filtered = Number.isFinite(observedMax) ? base.filter(r => Math.abs(r.runningMax - observedMax) <= l.rw) : base;
    if (filtered.length >= MIN_ANALOGUES) return { rows: filtered, mode: `h±${l.hw}/m±${l.mw}/run±${l.rw}`, n: filtered.length };
  }
  const broad = subset(rows, hour, month, 4, 4);
  if (broad.length >= MIN_ANALOGUES) return { rows: broad, mode: "broad-hour-month", n: broad.length };
  if (rows.length >= MIN_ANALOGUES) return { rows, mode: "all-station-data", n: rows.length };
  return null;
}
function priorExceedance(rows, hour, month, gap) { const src = subset(rows, hour, month, 3, 3); const base = src.length >= MIN_ANALOGUES ? src : rows; if (!base.length) return null; return base.filter(r => r.delta >= gap).length / base.length; }
function empiricalExceedance(deltas, gap) { if (gap <= 0) return 1; return deltas.filter(d => d >= gap).length / deltas.length; }
function remainingUpside(station, hour, month, observedMax, gaps) {
  const rows = loadStation(station); if (!rows?.length) return null;
  const result = analogueSet(rows, hour, month, observedMax); if (!result) return null;
  const deltas = result.rows.map(r => Math.max(0, r.delta)).sort((a,b) => a-b);
  const out = {};
  for (const gap of gaps) { const raw = empiricalExceedance(deltas, gap); const prior = priorExceedance(rows, hour, month, gap); const p = prior == null ? raw : ((raw * result.n) + (prior * SHRINK_K)) / (result.n + SHRINK_K); out[String(gap)] = Math.max(0, Math.min(1, Number(p.toFixed(4)))); }
  return { station, n: result.n, mode: result.mode, p: out, stats: { meanDelta: Number((deltas.reduce((a,b)=>a+b,0) / deltas.length).toFixed(2)), pZero: Number((deltas.filter(d => d === 0).length / deltas.length).toFixed(3)), p50: quantile(deltas, 0.50), p75: quantile(deltas, 0.75), p90: quantile(deltas, 0.90), p95: quantile(deltas, 0.95), max: deltas[deltas.length - 1] } };
}
function rangeProbFromRemaining(station, hour, month, observedMax, low, high) {
  const gapLow = Math.max(0, low - observedMax);
  const gapHigh = high === Infinity ? Infinity : Math.max(0, high + 1 - observedMax);
  if (high !== Infinity && observedMax > high) return { prob: 0, reason: "already-above-range", gapLow, gapHigh, model: null };
  if (low <= -999 || low === -Infinity) { const model = remainingUpside(station, hour, month, observedMax, [gapHigh]); if (!model) return null; const pHigh = gapHigh <= 0 ? 1 : model.p[String(gapHigh)] ?? 0; return { prob: Math.max(0, 1 - pHigh), reason: "below-range", gapLow, gapHigh, model }; }
  if (high === Infinity || high >= 999) { const model = remainingUpside(station, hour, month, observedMax, [gapLow]); if (!model) return null; return { prob: model.p[String(gapLow)] ?? 0, reason: "or-higher", gapLow, gapHigh, model }; }
  const model = remainingUpside(station, hour, month, observedMax, [gapLow, gapHigh]); if (!model) return null;
  const pLow = gapLow <= 0 ? 1 : (model.p[String(gapLow)] ?? 0); const pHigh = gapHigh <= 0 ? 1 : (model.p[String(gapHigh)] ?? 0);
  return { prob: Number(Math.max(0, pLow - pHigh).toFixed(4)), reason: "bounded-range", gapLow, gapHigh, model, pLow, pHigh };
}
function deltaStats(station, hour, month, observedMax) { const rows = loadStation(station); if (!rows) return null; const result = analogueSet(rows, hour, month, observedMax); if (!result) return null; const deltas = result.rows.map(r => Math.max(0, r.delta)).sort((a,b)=>a-b); return { n: result.n, mode: result.mode, mean: Number((deltas.reduce((a,b)=>a+b,0)/deltas.length).toFixed(2)), p50: quantile(deltas, 0.50), p75: quantile(deltas, 0.75), p90: quantile(deltas, 0.90), p95: quantile(deltas, 0.95), pZero: Number((deltas.filter(d=>d===0).length/deltas.length).toFixed(2)), min: deltas[0], max: deltas[deltas.length-1] }; }
module.exports = { loadStation, remainingUpside, rangeProbFromRemaining, deltaStats, MIN_ANALOGUES };
