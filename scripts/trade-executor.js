// scripts/trade-executor.js
// Executes trades on Polymarket CLOB API
// LIVE_TRADING=true to enable real trading, otherwise paper mode

const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const { kellyStake } = require("./kelly");

const LIVE_TRADING    = process.env.LIVE_TRADING === "true";
const PRIVATE_KEY     = process.env.POLYMARKET_PRIVATE_KEY;
const SCANNER_URL     = process.env.SCANNER_URL || "https://polyedge-woad.vercel.app/api/weather";
const BANKROLL        = parseFloat(process.env.BANKROLL || "200");
const MIN_EDGE        = parseFloat(process.env.MIN_EDGE || "15");
const MIN_VOLUME      = parseFloat(process.env.MIN_VOLUME || "5000");
const MIN_HOUR        = parseInt(process.env.MIN_HOUR || "13");
const MAX_DAILY_SPEND = parseFloat(process.env.MAX_DAILY_SPEND || "50");
const CLOB_HOST       = "https://clob.polymarket.com";
const CHAIN_ID        = 137;

const POSITIONS_DIR = path.join(__dirname, "../data/positions");
const OPEN_FILE     = path.join(POSITIONS_DIR, "open.json");
const CLOSED_FILE   = path.join(POSITIONS_DIR, "closed.json");

function ensureDirs() {
  if (!fs.existsSync(POSITIONS_DIR)) fs.mkdirSync(POSITIONS_DIR, { recursive: true });
  if (!fs.existsSync(OPEN_FILE))     fs.writeFileSync(OPEN_FILE,   "[]");
  if (!fs.existsSync(CLOSED_FILE))   fs.writeFileSync(CLOSED_FILE, "[]");
}

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
        catch(e) { reject(new Error(`Parse: ${data.slice(0,100)}`)); }
      });
    }).on("error", reject);
  });
}

function getTodaySpend() {
  const today  = new Date().toISOString().slice(0,10);
  const open   = loadOpen().filter(p => p.openedAt?.slice(0,10) === today);
  const closed = loadClosed().filter(p => p.openedAt?.slice(0,10) === today);
  return [...open, ...closed].reduce((sum, p) => sum + (p.stake || 0), 0);
}

async function getMarketInfo(marketId, signal) {
  try {
    const city   = (signal.city || "").toLowerCase().replace(/ /g, "-");
    const date   = signal.date || "";
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const d      = new Date(date);
    const slug   = `highest-temperature-in-${city}-on-${months[d.getMonth()]}-${d.getDate()}-${d.getFullYear()}`;
    const events = await fetchUrl(`https://gamma-api.polymarket.com/events?slug=${slug}&closed=false`);
    if (!Array.isArray(events) || !events.length) return null;
    const markets = events[0].markets || [];
    const market  = markets.find(m =>
      m.conditionId === marketId ||
      m.id == marketId ||
      m.question === signal.question?.split(": ")[1]
    );
    if (!market) return null;
    const tokens = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : null;
    if (!tokens || tokens.length < 2) return null;
    return {
      yesTokenId: tokens[0],
      noTokenId:  tokens[1],
      negRisk:    market.negRisk || false,
      tickSize:   parseFloat(market.minTickSize || "0.01"),
    };
  } catch(e) {
    console.error("  getMarketInfo error:", e.message);
    return null;
  }
}

async function getBestAsk(tokenId) {
  try {
    const book = await fetchUrl(`${CLOB_HOST}/book?token_id=${tokenId}`);
    const asks  = book.asks || [];
    return asks.length ? parseFloat(asks[0].price) : null;
  } catch { return null; }
}

async function getBestBid(tokenId) {
  try {
    const book = await fetchUrl(`${CLOB_HOST}/book?token_id=${tokenId}`);
    const bids  = book.bids || [];
    return bids.length ? parseFloat(bids[0].price) : null;
  } catch { return null; }
}

// Validate orderbook stability — fetch twice 2s apart
// Inspired by WS warmup best practices: reject stale/jumpy prices
async function validateOrderbook(tokenId) {
  try {
    const book1 = await fetchUrl(`${CLOB_HOST}/book?token_id=${tokenId}`);
    await new Promise(r => setTimeout(r, 2000));
    const book2 = await fetchUrl(`${CLOB_HOST}/book?token_id=${tokenId}`);

    const ask1 = book1.asks?.[0] ? parseFloat(book1.asks[0].price) : null;
    const ask2 = book2.asks?.[0] ? parseFloat(book2.asks[0].price) : null;
    const bid1 = book1.bids?.[0] ? parseFloat(book1.bids[0].price) : null;
    const bid2 = book2.bids?.[0] ? parseFloat(book2.bids[0].price) : null;

    if (!ask1 || !ask2 || !bid1 || !bid2) return { valid: false, reason: "No liquidity" };

    // Spread check
    const spread = ask2 - bid2;
    if (spread > 0.20) return { valid: false, reason: `Spread too wide (${spread.toFixed(2)})` };

    // Stability check — price should not jump >5c between fetches
    const askDelta = Math.abs(ask2 - ask1);
    const bidDelta = Math.abs(bid2 - bid1);
    if (askDelta > 0.05) return { valid: false, reason: `Unstable ask (jumped ${askDelta.toFixed(2)})` };
    if (bidDelta > 0.05) return { valid: false, reason: `Unstable bid (jumped ${bidDelta.toFixed(2)})` };

    return { valid: true, ask: ask2, bid: bid2, spread };
  } catch(e) {
    return { valid: false, reason: e.message };
  }
}

async function placeOrder(tokenId, price, size, negRisk, tickSize) {
  if (!LIVE_TRADING) {
    console.log(`  [PAPER] BUY ${size} shares @ ${price} (token: ${tokenId.slice(0,12)}...)`);
    return { orderID: `paper-${Date.now()}`, status: "paper" };
  }

  if (!PRIVATE_KEY) throw new Error("POLYMARKET_PRIVATE_KEY not set");

  // Try Rust CLI first
  const { execSync } = require("child_process");
  try {
    const result = execSync(
      `polymarket clob create-order --token ${tokenId} --side buy --price ${price} --size ${size}`,
      { env: { ...process.env, POLYMARKET_PRIVATE_KEY: PRIVATE_KEY }, timeout: 30000 }
    ).toString();
    console.log("  CLI output:", result.trim());
    const match = result.match(/order[_\s]?id[:\s]+([a-zA-Z0-9-]+)/i);
    return { orderID: match?.[1] || `live-${Date.now()}`, status: "live" };
  } catch {
    // Fallback to JS SDK
    const { ClobClient, Side, OrderType } = require("@polymarket/clob-client");
    const { Wallet } = require("ethers");
    const signer     = new Wallet(PRIVATE_KEY);
    const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
    const apiCreds   = await tempClient.createOrDeriveApiKey();
    const client     = new ClobClient(CLOB_HOST, CHAIN_ID, signer, apiCreds, 0, signer.address);
    return await client.createAndPostOrder(
      { tokenID: tokenId, price, size, side: Side.BUY },
      { tickSize: tickSize.toString(), negRisk },
      OrderType.GTC,
    );
  }
}

async function main() {
  ensureDirs();

  console.log(`\n=== PolyEdge Trade Executor ===`);
  console.log(`Mode: ${LIVE_TRADING ? "🔴 LIVE" : "📄 PAPER"}`);
  console.log(`Bankroll: £${BANKROLL} | Max daily: £${MAX_DAILY_SPEND}`);

  const todaySpend = getTodaySpend();
  console.log(`Today's spend: £${todaySpend.toFixed(2)} / £${MAX_DAILY_SPEND}`);
  if (todaySpend >= MAX_DAILY_SPEND) {
    console.log("Daily spend limit reached.");
    return;
  }

  console.log("Fetching signals...");
  let signals;
  try {
    const result = await fetchUrl(SCANNER_URL);
    signals = (result.data || []).filter(s =>
      s.forecastMethod === "observed" &&
      s.signalType     !== "REJECT"   &&
      s.adjEdge        >= MIN_EDGE    &&
      (s.volume24hr || 0) >= MIN_VOLUME  &&
      s.localHour      >= MIN_HOUR    &&
      s.hoursToResolve <= 24
    );
  } catch(e) {
    console.error("Scanner fetch failed:", e.message);
    return;
  }

  console.log(`Raw signals: ${signals.length}`);

  // Deduplicate: one trade per city+date
  const eventMap = new Map();
  for (const s of signals) {
    const key = `${s.city}-${s.date}`;
    if (!eventMap.has(key) || s.absEdge > eventMap.get(key).absEdge) {
      eventMap.set(key, s);
    }
  }
  const deduped = [...eventMap.values()].sort((a,b) => b.absEdge - a.absEdge);
  console.log(`After dedup (one per city/day): ${deduped.length}`);

  const openPositions = loadOpen();
  const today         = new Date().toISOString().slice(0,10);
  const closedToday   = loadClosed().filter(p => p.openedAt?.slice(0,10) === today);

  // Track already-traded events — include today's closed positions
  const openEvents = new Set([
    ...openPositions.map(p => p.eventKey),
    ...closedToday.map(p => p.eventKey),
  ]);

  for (const signal of deduped) {
    const eventKey = `${signal.city}-${signal.date}`;

    if (openEvents.has(eventKey)) {
      console.log(`  Already traded today: ${signal.city} ${signal.date}`);
      continue;
    }

    const remaining = MAX_DAILY_SPEND - getTodaySpend();
    if (remaining < 2) {
      console.log("Daily limit reached, stopping.");
      break;
    }

    const stake = Math.min(
      kellyStake(signal.forecastProb, signal.polyProb, BANKROLL, signal.side),
      remaining
    );

    if (stake < 2) {
      console.log(`  Stake too small (£${stake}), skipping.`);
      continue;
    }

    console.log(`\n  ${signal.question.slice(0,65)}`);
    console.log(`  ${signal.side} | Model: ${signal.forecastProb}% | Market: ${signal.polyProb}% | Edge: ${signal.adjEdge}% | Stake: £${stake}`);

    try {
      const info = await getMarketInfo(signal.id, signal);
      if (!info) {
        console.log("  Could not get market info, skipping.");
        continue;
      }

      // Validate orderbook stability before entering
      console.log(`  Validating orderbook...`);
      const ob = await validateOrderbook(signal.side === "YES" ? info.yesTokenId : info.noTokenId);
      if (!ob.valid) {
        console.log(`  Orderbook invalid: ${ob.reason}, skipping.`);
        continue;
      }
      console.log(`  Orderbook OK — spread: ${ob.spread.toFixed(3)} | ask: ${ob.ask} | bid: ${ob.bid}`);

      let tokenId, entryPrice;
      if (signal.side === "YES") {
        tokenId    = info.yesTokenId;
        entryPrice = Math.min(0.99, parseFloat((ob.ask + info.tickSize).toFixed(2)));
      } else {
        tokenId    = info.noTokenId;
        entryPrice = Math.min(0.99, parseFloat((ob.ask + info.tickSize).toFixed(2)));
      }

      const size = parseFloat((stake / entryPrice).toFixed(1));
      if (size < 1) { console.log("  Size too small, skipping."); continue; }

      console.log(`  Token: ${tokenId.slice(0,12)}... | Price: ${entryPrice} | Size: ${size}`);

      const order = await placeOrder(tokenId, entryPrice, size, info.negRisk, info.tickSize);
      console.log(`  Order: ${order.status} | ID: ${order.orderID}`);

      openPositions.push({
        marketId:        signal.id,
        eventKey,
        city:            signal.city,
        date:            signal.date,
        station:         signal.station,
        orderId:         order.orderID,
        question:        signal.question,
        side:            signal.side,
        tokenId,
        negRisk:         info.negRisk,
        entryPrice,
        size,
        stake,
        modelProbEntry:  signal.forecastProb,
        marketProbEntry: signal.polyProb,
        adjEdgeEntry:    signal.adjEdge,
        localHour:       signal.localHour,
        openedAt:        new Date().toISOString(),
        status:          order.status === "paper" ? "paper" : "open",
        exitPrice:       null,
        exitReason:      null,
        closedAt:        null,
        pnl:             null,
      });

      saveOpen(openPositions);
      openEvents.add(eventKey);
      console.log(`  ✓ Position opened`);

    } catch(e) {
      console.error(`  Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const closedAll = loadClosed();
  const todayPnl  = closedAll
    .filter(p => p.closedAt?.slice(0,10) === today)
    .reduce((s,p) => s+(p.pnl||0), 0);

  console.log(`\nOpen: ${loadOpen().length} | Spend: £${getTodaySpend().toFixed(2)} | P&L: £${todayPnl.toFixed(2)}`);
  console.log("Done.");
}

main().catch(console.error); 