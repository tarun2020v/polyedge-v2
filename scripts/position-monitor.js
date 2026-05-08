// scripts/position-monitor.js
// Monitors open positions every 20 min
// Recalculates model probability and exits if optimal

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const LIVE_TRADING = process.env.LIVE_TRADING === "true";
const PRIVATE_KEY  = process.env.POLYMARKET_PRIVATE_KEY;
const CLOB_HOST    = "https://clob.polymarket.com";
const CHAIN_ID     = 137;

const POSITIONS_DIR = path.join(__dirname, "../data/positions");
const OPEN_FILE     = path.join(POSITIONS_DIR, "open.json");
const CLOSED_FILE   = path.join(POSITIONS_DIR, "closed.json");
const HIST_DIR      = path.join(__dirname, "../data/historical");
const LIVE_DIR      = path.join(__dirname, "../data/live");

function loadOpen()    { return JSON.parse(fs.readFileSync(OPEN_FILE,   "utf8")); }
function loadClosed()  { return JSON.parse(fs.readFileSync(CLOSED_FILE, "utf8")); }
function saveOpen(p)   { fs.writeFileSync(OPEN_FILE,   JSON.stringify(p, null, 2)); }
function saveClosed(p) { fs.writeFileSync(CLOSED_FILE, JSON.stringify(p, null, 2)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "PolyEdge/1.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(data.slice(0,100))); }
      });
    }).on("error", reject);
  });
}

// Get current market price
async function getCurrentPrice(tokenId) {
  try {
    const book = await fetchUrl(`${CLOB_HOST}/book?token_id=${tokenId}`);
    const bids  = book.bids || [];
    const asks  = book.asks || [];
    const bid   = bids.length ? parseFloat(bids[0].price) : null;
    const ask   = asks.length ? parseFloat(asks[0].price) : null;
    const mid   = bid && ask ? (bid + ask) / 2 : (bid || ask);
    return { bid, ask, mid };
  } catch { return null; }
}

// Recalculate model probability for a position
function recalcModelProb(position) {
  try {
    const livePath = path.join(LIVE_DIR, `${position.station}.json`);
    if (!fs.existsSync(livePath)) return null;

    const live    = JSON.parse(fs.readFileSync(livePath, "utf8"));
    const today   = new Date().toISOString().slice(0,10);
    if (live.date !== today) return null;

    const histPath = path.join(HIST_DIR, `${position.station}.json`);
    if (!fs.existsSync(histPath)) return null;

    const rows    = JSON.parse(fs.readFileSync(histPath, "utf8")).rows;
    const month   = new Date().getMonth() + 1;
    const hour    = live.localHour;
    const isUS    = position.station.startsWith("K");
    const obsTemp = isUS ? live.observedMax : live.observedMax;

    // Parse bucket from question
    const rangeF  = position.question.match(/(\d+)-(\d+)°F/);
    const singleC = position.question.match(/(\d+)°C(?!\s*or)/);
    const higherC = position.question.match(/(\d+)°C or higher/i);
    const belowC  = position.question.match(/(\d+)°C or below/i);

    let low, high;
    if (rangeF)  { low = parseInt(rangeF[1]);  high = parseInt(rangeF[2]); }
    else if (higherC) { low = parseInt(higherC[1]); high = 999; }
    else if (belowC)  { low = -999; high = parseInt(belowC[1]); }
    else if (singleC) { low = parseInt(singleC[1]); high = parseInt(singleC[1]); }
    else return null;

    const mDist  = (a,b) => { const d=Math.abs(a-b); return Math.min(d,12-d); };
    const subset = rows.filter(r =>
      Math.abs(r.localHour - hour) <= 1 &&
      mDist(r.month, month) <= 1
    );

    if (subset.length < 10) return null;

    const deltas  = subset.map(r => r.delta).sort((a,b) => a-b);
    const n       = deltas.length;
    const gapLow  = low  === -999 ? -999 : low  - obsTemp;
    const gapHigh = high === 999  ? 999  : high - obsTemp + 1;

    const S = (g) => {
      if (g <= 0) return 1.0;
      const zeros   = deltas.filter(d => d === 0).length;
      const p0      = zeros / n;
      const nonZero = deltas.filter(d => d > 0);
      if (nonZero.length < 3) return deltas.filter(d => d >= g).length / n;
      const mean = nonZero.reduce((a,b)=>a+b,0)/nonZero.length;
      const std  = Math.sqrt(nonZero.reduce((a,b)=>a+(b-mean)**2,0)/(nonZero.length-1));
      const sorted = [...nonZero].sort((a,b)=>a-b);
      const q1 = sorted[Math.floor(nonZero.length*0.25)];
      const q3 = sorted[Math.floor(nonZero.length*0.75)];
      const iqr = Math.max(q3-q1, 0.5);
      const h   = Math.max(0.3, 1.06 * Math.min(std, iqr/1.34) * Math.pow(nonZero.length, -0.2));
      const nCDF = (z) => {
        const s=z<0?-1:1, x=Math.abs(z)/Math.sqrt(2);
        const t=1/(1+0.3275911*x);
        const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
        return 0.5*(1+s*y);
      };
      const sPlus = nonZero.reduce((sum,d)=>sum+(1-nCDF((g-d)/h)),0)/nonZero.length;
      return (1-p0)*sPlus;
    };

    let sLow  = gapLow  <= 0 ? 1.0 : S(Math.max(0, gapLow));
    let sHigh = gapHigh <= 0 ? 1.0 : S(Math.max(0, gapHigh));
    if (sLow < sHigh) sLow = sHigh;

    const wide  = rows.filter(r => Math.abs(r.localHour-hour)<=3 && mDist(r.month,month)<=2);
    const prior = wide.length > 5 ? wide.filter(r=>r.delta>=Math.max(0.5,gapLow)).length/wide.length : 0.1;
    const k     = 15;
    let prob    = ((sLow-sHigh)*n + prior*k) / (n+k);
    prob        = Math.max(0, Math.min(1, prob));

    return parseFloat((prob * 100).toFixed(1));
  } catch(e) {
    return null;
  }
}

// Cancel order and close position
async function exitPosition(position, currentPrice, reason) {
  console.log(`  Exiting: ${reason}`);
  console.log(`  Entry: ${position.entryPrice} | Current: ${currentPrice}`);

  if (LIVE_TRADING && PRIVATE_KEY) {
    try {
      const { ClobClient } = require("@polymarket/clob-client");
      const { Wallet }     = require("ethers");
      const signer         = new Wallet(PRIVATE_KEY);
      const tempClient     = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
      const apiCreds       = await tempClient.createOrDeriveApiKey();
      const client         = new ClobClient(CLOB_HOST, CHAIN_ID, signer, apiCreds, 0, signer.address);

      // Place sell order at current bid
      await client.createAndPostOrder(
        { tokenID: position.tokenId, price: currentPrice, size: position.size, side: "SELL" },
        { tickSize: "0.01", negRisk: false }
      );
    } catch(e) {
      console.error(`  Exit order failed: ${e.message}`);
    }
  } else {
    console.log(`  [PAPER] Would sell ${position.size} shares at ${currentPrice}`);
  }

  // Calculate P&L
  const pnl = position.side === "YES"
    ? (currentPrice - position.entryPrice) * position.size
    : (position.entryPrice - currentPrice) * position.size;

  return {
    ...position,
    exitPrice:  currentPrice,
    exitReason: reason,
    closedAt:   new Date().toISOString(),
    pnl:        parseFloat(pnl.toFixed(2)),
    status:     "closed",
  };
}

async function main() {
  console.log("\n=== Position Monitor ===");

  if (!fs.existsSync(OPEN_FILE)) {
    console.log("No positions file found.");
    return;
  }

  const openPositions  = loadOpen();
  const closedPositions = loadClosed();

  if (!openPositions.length) {
    console.log("No open positions.");
    return;
  }

  console.log(`Monitoring ${openPositions.length} open positions...`);

  const stillOpen = [];
  const now       = new Date();

  for (const pos of openPositions) {
    console.log(`\n  ${pos.question.slice(0,60)}`);
    console.log(`  Entry: ${pos.side} @ ${pos.entryPrice} | Size: ${pos.size} | Stake: £${pos.stake}`);

    // Get current market price
    const prices = await getCurrentPrice(pos.tokenId);
    if (!prices || !prices.mid) {
      console.log("  Could not get current price, holding.");
      stillOpen.push(pos);
      continue;
    }

    const currentPrice = pos.side === "YES" ? prices.ask || prices.mid : prices.bid || prices.mid;
    console.log(`  Current price: ${currentPrice?.toFixed(3)} (bid:${prices.bid} ask:${prices.ask})`);

    // Recalculate model probability
    const newModelProb = recalcModelProb(pos);
    console.log(`  Model prob: ${pos.modelProbEntry}% → ${newModelProb || "N/A"}%`);

    // Hours to resolution
    const resolveDate = new Date(pos.date + "T23:59:00Z");
    const hoursLeft   = (resolveDate - now) / 3600000;
    console.log(`  Hours to resolve: ${hoursLeft.toFixed(1)}`);

    // Current P&L
    if (currentPrice) {
      const unrealizedPnl = pos.side === "YES"
        ? (currentPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - currentPrice) * pos.size;
      console.log(`  Unrealized P&L: £${unrealizedPnl.toFixed(2)}`);
    }

    // Exit decision logic
    let shouldExit = false;
    let exitReason = "";

    // 1. Model probability has collapsed — edge gone
    if (newModelProb !== null) {
      const modelShift = Math.abs(newModelProb - pos.modelProbEntry);
      if (modelShift > 25) {
        shouldExit = true;
        exitReason = `Model shifted ${modelShift.toFixed(0)}pp (${pos.modelProbEntry}% → ${newModelProb}%)`;
      }
    }

    // 2. Already captured 80%+ of theoretical max profit
    if (!shouldExit && currentPrice) {
      const maxProfit = pos.side === "YES"
        ? (1 - pos.entryPrice) * pos.size
        : pos.entryPrice * pos.size;
      const currentProfit = pos.side === "YES"
        ? (currentPrice - pos.entryPrice) * pos.size
        : (pos.entryPrice - currentPrice) * pos.size;
      const profitCapture = maxProfit > 0 ? currentProfit / maxProfit : 0;

      if (profitCapture > 0.8 && hoursLeft > 2) {
        shouldExit = true;
        exitReason = `Captured ${(profitCapture*100).toFixed(0)}% of max profit early`;
      }
    }

    // 3. Market and model have converged — no more edge
    if (!shouldExit && newModelProb !== null && currentPrice) {
      const marketProb = pos.side === "YES" ? currentPrice * 100 : (1-currentPrice) * 100;
      const edgeNow    = Math.abs(newModelProb - marketProb);
      if (edgeNow < 3 && hoursLeft > 2) {
        shouldExit = true;
        exitReason = `Edge collapsed to ${edgeNow.toFixed(1)}%`;
      }
    }

    // 4. Close to resolution — just hold
    if (shouldExit && hoursLeft < 2) {
      shouldExit = false;
      exitReason = "";
      console.log("  Would exit but < 2h to resolve, holding.");
    }

    if (shouldExit && currentPrice) {
      const closed = await exitPosition(pos, currentPrice, exitReason);
      closedPositions.push(closed);
      console.log(`  ✓ Closed | P&L: £${closed.pnl}`);
    } else {
      stillOpen.push(pos);
      console.log("  Holding position.");
    }

    await new Promise(r => setTimeout(r, 300));
  }

  saveOpen(stillOpen);
  saveClosed(closedPositions);

  // Print summary
  const todayStr  = new Date().toISOString().slice(0,10);
  const todayPnl  = closedPositions
    .filter(p => p.closedAt?.slice(0,10) === todayStr)
    .reduce((sum, p) => sum + (p.pnl || 0), 0);

  console.log(`\nOpen: ${stillOpen.length} | Closed today: ${closedPositions.filter(p=>p.closedAt?.slice(0,10)===todayStr).length} | Today P&L: £${todayPnl.toFixed(2)}`);
}

main().catch(console.error);
