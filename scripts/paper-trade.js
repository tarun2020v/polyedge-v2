// scripts/paper-trade.js
// Logs signals for paper trading and checks resolution
// Observed signals -> data/trades/YYYY-MM-DD.json
// Forecast-CONSENSUS signals -> data/trades/forecast-YYYY-MM-DD.json

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const TRADES_DIR = path.join(__dirname, "../data/trades");
const MIN_EDGE   = parseFloat(process.env.MIN_EDGE || "12");

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : require("http");
    mod.get(url, { headers: { "User-Agent": "PolyEdge/1.0" } }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse error: ${data.slice(0,100)}`)); }
      });
    }).on("error", reject);
  });
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function loadFile(fp) {
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

function saveFile(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

function buildTrade(s) {
  return {
    id:             s.id,
    loggedAt:       new Date().toISOString(),
    question:       s.question,
    city:           s.city,
    date:           s.date,
    station:        s.station,
    forecastMethod: s.forecastMethod,
    signalType:     s.signalType,
    side:           s.side,
    polyProb:       s.polyProb,
    forecastProb:   s.forecastProb,
    adjEdge:        s.adjEdge,
    absEdge:        s.absEdge,
    observedMaxF:   s.observedMaxF,
    observedMaxC:   s.observedMaxC,
    localHour:      s.localHour,
    hoursToResolve: s.hoursToResolve,
    url:            s.url,
    paperStake:     2,
    paperSide:      s.side,
    paperEntry:     (s.executablePrice != null ? s.executablePrice : s.polyProb / 100),
    executablePrice:s.executablePrice,
    spreadCents:    s.spreadCents,
    topBookSize:    s.topBookSize,
    modelN:         s.modelN,
    modelMode:      s.modelMode,
    modelReason:    s.modelReason,
    gapLow:         s.gapLow,
    gapHigh:        s.gapHigh,
    resolved:       false,
    resolvedPrice:  null,
    resolvedAt:     null,
    outcome:        null,
    paperPnl:       null,
  };
}

// Log new signals from scanner
async function logSignals() {
  const scannerUrl = process.env.SCANNER_URL || "https://polyedge-woad.vercel.app/api/weather";
  console.log("Fetching scanner...");

  let scannerData;
  try {
    scannerData = await fetchUrl(scannerUrl);
  } catch(e) {
    console.error("Scanner fetch failed:", e.message);
    return;
  }

  const today = todayStr();

  // Observed signals — primary
  const observed = (scannerData.data || []).filter(s =>
    s.absEdge >= MIN_EDGE &&
    s.forecastMethod === "observed"
  );

  const obsFp       = path.join(TRADES_DIR, `${today}.json`);
  const obsExisting = loadFile(obsFp);
  const obsIds      = new Set(obsExisting.map(t => t.id));
  let obsAdded      = 0;

  for (const s of observed) {
    if (obsIds.has(s.id)) continue;
    obsExisting.push(buildTrade(s));
    obsIds.add(s.id);
    obsAdded++;
  }
  saveFile(obsFp, obsExisting);
  console.log(`Observed: logged ${obsAdded} new signals (${obsExisting.length} total today)`);

  // Forecast-CONSENSUS signals — secondary tracking only
  const forecast = (scannerData.data || []).filter(s =>
    s.absEdge >= MIN_EDGE &&
    s.forecastMethod === "forecast" &&
    s.signalType === "CONSENSUS"
  );

  if (forecast.length) {
    const fcFp       = path.join(TRADES_DIR, `forecast-${today}.json`);
    const fcExisting = loadFile(fcFp);
    const fcIds      = new Set(fcExisting.map(t => t.id));
    let fcAdded      = 0;

    for (const s of forecast) {
      if (fcIds.has(s.id)) continue;
      fcExisting.push(buildTrade(s));
      fcIds.add(s.id);
      fcAdded++;
    }
    saveFile(fcFp, fcExisting);
    console.log(`Forecast-CONSENSUS: logged ${fcAdded} new signals (${fcExisting.length} total today)`);
  }
}

// Resolve a single trade against Polymarket
async function resolveTrade(trade) {
  try {
    const city  = (trade.city || "").toLowerCase().replace(/ /g, "-");
    const d     = new Date(trade.date);
    const slug  = `highest-temperature-in-${city}-on-${MONTHS[d.getMonth()]}-${d.getDate()}-${d.getFullYear()}`;
    const events = await fetchUrl(`https://gamma-api.polymarket.com/events?slug=${slug}&closed=true`);

    if (!Array.isArray(events) || !events.length) return null;

    const markets = events[0].markets || [];
    const market  = markets.find(m =>
      m.conditionId === trade.id ||
      m.id == trade.id ||
      m.question === trade.question?.split(": ")[1]
    );

    if (!market || !market.closed) return null;

    let resolvedPrice = null;
    try {
      const prices = JSON.parse(market.outcomePrices || "[null,null]");
      resolvedPrice = parseFloat(prices[0]);
    } catch {}

    if (resolvedPrice === null || isNaN(resolvedPrice)) return null;

    const wonYes = resolvedPrice >= 0.99;
    const wonNo  = resolvedPrice <= 0.01;

    let outcome = "PUSH";
    let pnl     = 0;

    if (trade.paperSide === "YES") {
      if (wonYes)      { outcome = "WIN";  pnl =  trade.paperStake * (1 - trade.paperEntry) / trade.paperEntry; }
      else if (wonNo)  { outcome = "LOSS"; pnl = -trade.paperStake; }
    } else {
      if (wonNo)       { outcome = "WIN";  pnl =  trade.paperStake * trade.paperEntry / (1 - trade.paperEntry); }
      else if (wonYes) { outcome = "LOSS"; pnl = -trade.paperStake; }
    }

    return {
      resolvedPrice,
      resolvedAt: new Date().toISOString(),
      outcome,
      pnl: parseFloat(pnl.toFixed(2)),
    };
  } catch(e) {
    return null;
  }
}

// Check resolution of past trades
async function checkResolution() {
  // Get all trade files (observed + forecast)
  const allFiles = fs.readdirSync(TRADES_DIR)
    .filter(f => f.endsWith(".json") && f.match(/\d{4}-\d{2}-\d{2}/))
    .sort()
    .reverse()
    .slice(0, 14); // last 14 days

  for (const file of allFiles) {
    const fp     = path.join(TRADES_DIR, file);
    const trades = loadFile(fp);
    const unresolved = trades.filter(t => !t.resolved);
    if (!unresolved.length) continue;

    const label = file.startsWith("forecast-") ? "forecast" : "observed";
    console.log(`Checking ${unresolved.length} unresolved ${label} trades from ${file}...`);

    let changed = false;
    for (const trade of unresolved) {
      const result = await resolveTrade(trade);
      if (!result) continue;

      trade.resolved      = true;
      trade.resolvedPrice = result.resolvedPrice;
      trade.resolvedAt    = result.resolvedAt;
      trade.outcome       = result.outcome;
      trade.paperPnl      = result.pnl;
      changed             = true;

      console.log(`  ${trade.question?.slice(0,55)} → ${trade.outcome} £${trade.paperPnl}`);
      await new Promise(r => setTimeout(r, 300));
    }

    if (changed) saveFile(fp, trades);
  }
}

// Print summary stats
function printSummary() {
  console.log("\n=== PAPER TRADE SUMMARY ===");

  const allFiles = fs.readdirSync(TRADES_DIR).filter(f => f.endsWith(".json"));

  // Observed
  const obsFiles = allFiles.filter(f => !f.startsWith("forecast-"));
  const obsTrades = [];
  for (const f of obsFiles) {
    obsTrades.push(...loadFile(path.join(TRADES_DIR, f)));
  }
  const obsResolved = obsTrades.filter(t => t.resolved && t.outcome !== "PUSH");

  if (obsResolved.length) {
    const wins = obsResolved.filter(t => t.outcome === "WIN").length;
    const losses = obsResolved.filter(t => t.outcome === "LOSS").length;
    const pnl  = obsResolved.reduce((a,t) => a+(t.paperPnl||0), 0);
    console.log(`\nObserved signals:`);
    console.log(`  Resolved: ${obsResolved.length} | Wins: ${wins} | Losses: ${losses} | WR: ${(wins/obsResolved.length*100).toFixed(1)}%`);
    console.log(`  Total P&L: £${pnl.toFixed(2)}`);

    // By hour
    const byHour = {};
    for (const t of obsResolved) {
      const h = t.localHour || "?";
      if (!byHour[h]) byHour[h] = { wins:0, losses:0, pnl:0, n:0 };
      byHour[h].n++;
      byHour[h].pnl += t.paperPnl || 0;
      if (t.outcome === "WIN") byHour[h].wins++;
      else byHour[h].losses++;
    }
    console.log(`  By hour:`);
    for (const [h, v] of Object.entries(byHour).sort()) {
      console.log(`    Hour ${h}: ${v.wins}W/${v.losses}L | P&L: £${v.pnl.toFixed(2)} | n=${v.n}`);
    }
  } else {
    console.log("\nObserved signals: No resolved trades yet.");
  }

  // Forecast-CONSENSUS
  const fcFiles  = allFiles.filter(f => f.startsWith("forecast-"));
  const fcTrades = [];
  for (const f of fcFiles) {
    fcTrades.push(...loadFile(path.join(TRADES_DIR, f)));
  }
  const fcResolved = fcTrades.filter(t => t.resolved && t.outcome !== "PUSH");

  if (fcResolved.length) {
    const wins = fcResolved.filter(t => t.outcome === "WIN").length;
    const losses = fcResolved.filter(t => t.outcome === "LOSS").length;
    const pnl  = fcResolved.reduce((a,t) => a+(t.paperPnl||0), 0);
    console.log(`\nForecast-CONSENSUS (tracking only):`);
    console.log(`  Resolved: ${fcResolved.length} | Wins: ${wins} | Losses: ${losses} | WR: ${(wins/fcResolved.length*100).toFixed(1)}%`);
    console.log(`  Total P&L: £${pnl.toFixed(2)}`);

    // By city
    const byCity = {};
    for (const t of fcResolved) {
      const c = t.city || "?";
      if (!byCity[c]) byCity[c] = { wins:0, losses:0, pnl:0, n:0 };
      byCity[c].n++;
      byCity[c].pnl += t.paperPnl || 0;
      if (t.outcome === "WIN") byCity[c].wins++;
      else byCity[c].losses++;
    }
    console.log(`  By city:`);
    for (const [c, v] of Object.entries(byCity).sort((a,b) => b[1].pnl - a[1].pnl)) {
      console.log(`    ${c}: ${v.wins}W/${v.losses}L | P&L: £${v.pnl.toFixed(2)} | n=${v.n}`);
    }
  } else {
    console.log("\nForecast-CONSENSUS: No resolved trades yet.");
  }
}

async function main() {
  if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });
  await logSignals();
  await checkResolution();
  printSummary();
}

main().catch(console.error);
