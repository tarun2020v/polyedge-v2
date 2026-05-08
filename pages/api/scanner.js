import {
  americanToImplied, calcEdge, calcEdgeAfterFees,
  calcConsensus, annualisedEdge, liquidityScore,
  compositeScore, calcSignalType, MIN_VOLUME, STEAM_THRESHOLD
} from "../../lib/calc";

const API_KEY      = process.env.OWLS_API_KEY;
const BASE         = "https://api.owlsinsight.com/api/v1";
const SPORTS       = ["nba","nfl","nhl","mlb","ncaab","ncaaf","soccer","tennis"];
const SPLIT_SPORTS = ["nba","nfl","nhl","mlb","ncaab"];
const ALL_BOOKS    = "pinnacle,polymarket,kalshi,novig,circa,westgate,wynn,south_point,betonline";

const steamHistory = {};

function normaliseTeamKey(home, away, commenceTime) {
  const date = commenceTime ? commenceTime.slice(0, 10) : "";
  const h = (home || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  const a = (away || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  return `${date}_${[h, a].sort().join("_")}`;
}

function lastWord(str) {
  return (str || "").toLowerCase().split(" ").filter(w => w.length > 2).slice(-1)[0] || "";
}

function findOutcome(outcomes, teamName) {
  if (!outcomes?.length) return null;
  const lw = lastWord(teamName);
  return outcomes.find(o => o.name?.toLowerCase().includes(lw)) || outcomes[0];
}

function buildMap(events) {
  const map = {};
  for (const ev of (events || [])) {
    const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
    if (!h2h) continue;
    map[ev.id] = h2h.outcomes;
    if (ev.home_team && ev.away_team) {
      const teamKey = normaliseTeamKey(ev.home_team, ev.away_team, ev.commence_time);
      map[teamKey] = h2h.outcomes;
    }
  }
  return map;
}

function getProb(map, evId, homeTeam, awayTeam, commenceTime) {
  let outcomes = map[evId];
  if (!outcomes && homeTeam && awayTeam) {
    const teamKey = normaliseTeamKey(homeTeam, awayTeam, commenceTime);
    outcomes = map[teamKey];
  }
  if (!outcomes) return null;
  const o = findOutcome(outcomes, homeTeam);
  return o?.price ? americanToImplied(o.price) : null;
}

async function fetchOdds(sport) {
  try {
    const url = new URL(`${BASE}/${sport}/odds`);
    url.searchParams.set("books", ALL_BOOKS);
    const r = await fetch(url.toString(), {
      headers: { "Authorization": `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const json = await r.json();
    return json.success ? json.data : null;
  } catch { return null; }
}

async function fetchSplits(sport) {
  try {
    const r = await fetch(`${BASE}/${sport}/splits`, {
      headers: { "Authorization": `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return {};
    const json = await r.json();
    const map = {};
    for (const game of (json.data || [])) map[game.event_id] = game.splits;
    return map;
  } catch { return {}; }
}

async function fetchInjuries(sport) {
  try {
    const r = await fetch(`${BASE}/${sport}/injuries`, {
      headers: { "Authorization": `Bearer ${API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return {};
    const json = await r.json();
    const map = {};
    for (const inj of (json.data || [])) {
      const team = inj.team?.toLowerCase();
      if (team) {
        if (!map[team]) map[team] = [];
        map[team].push({ player: inj.player, status: inj.status });
      }
    }
    return map;
  } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!API_KEY) return res.status(200).json({ data: [], error: "OWLS_API_KEY not set" });

  try {
    const now = Date.now();
    const allMarkets = [];

    const splitsMap = {};
    await Promise.all(SPLIT_SPORTS.map(async sp => { splitsMap[sp] = await fetchSplits(sp); }));

    const injuryMap = {};
    await Promise.all(["nba","nfl","nhl","mlb"].map(async sp => { injuryMap[sp] = await fetchInjuries(sp); }));

    await Promise.all(SPORTS.map(async (sport) => {
      try {
        const data = await fetchOdds(sport);
        if (!data) return;

        // Build pinnacle map with both ID and team key
        const pinnacleMap = {};
        for (const ev of (data.pinnacle || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;
          const entry = { outcomes: h2h.outcomes, commence_time: ev.commence_time, league: ev.league };
          pinnacleMap[ev.id] = entry;
          if (ev.home_team && ev.away_team) {
            pinnacleMap[normaliseTeamKey(ev.home_team, ev.away_team, ev.commence_time)] = entry;
          }
        }

        const kalshiMap     = buildMap(data.kalshi);
        const novigMap      = buildMap(data.novig);
        const circaMap      = buildMap(data.circa);
        const westgateMap   = buildMap(data.westgate);
        const wynnMap       = buildMap(data.wynn);
        const southPointMap = buildMap(data.south_point);
        const betonlineMap  = buildMap(data.betonline);

        for (const ev of (data.polymarket || [])) {
          const h2h = ev.bookmakers?.[0]?.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          const homeTeam = ev.home_team || "";
          const awayTeam = ev.away_team || "";
          const ct       = ev.commence_time;

          const polyOutcome = findOutcome(h2h.outcomes, homeTeam);
          const polyProb    = polyOutcome?.price ? americanToImplied(polyOutcome.price) : null;
          if (!polyProb) continue;

          const volume = ev.volume24hr || 0;
          if (volume > 0 && volume < MIN_VOLUME) continue;

          // Get sharp probs — try event ID then team key
          const teamKey = normaliseTeamKey(homeTeam, awayTeam, ct);
          const pinnacleEntry = pinnacleMap[ev.id] || pinnacleMap[teamKey];
          const pinnacleProb  = pinnacleEntry ? (findOutcome(pinnacleEntry.outcomes, homeTeam)?.price ? americanToImplied(findOutcome(pinnacleEntry.outcomes, homeTeam).price) : null) : null;

          const kalshiProb     = getProb(kalshiMap,     ev.id, homeTeam, awayTeam, ct);
          const novigProb      = getProb(novigMap,      ev.id, homeTeam, awayTeam, ct);
          const circaProb      = getProb(circaMap,      ev.id, homeTeam, awayTeam, ct);
          const westgateProb   = getProb(westgateMap,   ev.id, homeTeam, awayTeam, ct);
          const wynnProb       = getProb(wynnMap,       ev.id, homeTeam, awayTeam, ct);
          const southPointProb = getProb(southPointMap, ev.id, homeTeam, awayTeam, ct);
          const betonlineProb  = getProb(betonlineMap,  ev.id, homeTeam, awayTeam, ct);

          const consensus = calcConsensus({
            pinnacle: pinnacleProb, kalshi: kalshiProb, novig: novigProb,
            circa: circaProb, westgate: westgateProb, wynn: wynnProb,
            south_point: southPointProb, betonline: betonlineProb,
          });

          const sharpProb = consensus ? consensus.prob : (
            pinnacleProb || kalshiProb || novigProb || circaProb ||
            westgateProb || wynnProb || southPointProb || betonlineProb || null
          );
          const hasRef      = sharpProb !== null;
          const bookCount   = consensus ? consensus.bookCount : hasRef ? 1 : 0;
          const sharpSource = consensus ? `${consensus.bookCount} books` :
            pinnacleProb ? "pinnacle" : kalshiProb ? "kalshi" : novigProb ? "novig" :
            circaProb ? "circa" : westgateProb ? "westgate" : wynnProb ? "wynn" :
            southPointProb ? "south_point" : betonlineProb ? "betonline" : "no-ref";

          const rawEdge       = hasRef ? calcEdge(sharpProb, polyProb) : 0;
          const adjEdge       = hasRef ? calcEdgeAfterFees(sharpProb, polyProb) : 0;
          const side          = rawEdge >= 0 ? "YES" : "NO";
          const effectiveEdge = Math.abs(adjEdge);

          // Steam detection
          const steamKey = `${ev.id}_pinnacle`;
          let steamDetected = false;
          let pinnacleMove  = 0;
          if (pinnacleProb !== null) {
            const prev = steamHistory[steamKey];
            if (prev) {
              pinnacleMove = parseFloat((pinnacleProb - prev.prob).toFixed(1));
              const ageMin = (now - prev.recordedAt) / 60000;
              if (Math.abs(pinnacleMove) >= STEAM_THRESHOLD && ageMin <= 20) steamDetected = true;
            }
            steamHistory[steamKey] = { prob: pinnacleProb, recordedAt: now };
          }

          // Public fade
          const splits = splitsMap[sport]?.[ev.id] || null;
          let fadeSignal = false, publicHandle = null, publicBets = null;
          if (splits?.length > 0) {
            const circa = splits.find(s => s.book === "circa") || splits[0];
            if (circa?.moneyline) {
              publicHandle = side === "YES" ? circa.moneyline.home_handle_pct : circa.moneyline.away_handle_pct;
              publicBets   = side === "YES" ? circa.moneyline.home_bets_pct   : circa.moneyline.away_bets_pct;
              const publicOnOtherSide = side === "YES"
                ? circa.moneyline.away_handle_pct > 65
                : circa.moneyline.home_handle_pct > 65;
              fadeSignal = publicOnOtherSide && hasRef && effectiveEdge >= 2;
            }
          }

          // Injuries
          const sportInjuries  = injuryMap[sport] || {};
          const injuredPlayers = [
            ...(sportInjuries[homeTeam.toLowerCase()] || []),
            ...(sportInjuries[awayTeam.toLowerCase()] || []),
          ].filter(i => ["out","doubtful","questionable"].includes(i.status?.toLowerCase()));

          // Time
          const end            = ct ? new Date(ct) : null;
          const hoursToResolve = end ? Math.max(0.1, (end - new Date()) / 3600000) : 168;
          const daysToResolve  = hoursToResolve / 24;

          const liqScore  = liquidityScore(volume || 10000, 0.02, daysToResolve);
          const compScore = compositeScore(effectiveEdge, liqScore);
          const annEdge   = annualisedEdge(effectiveEdge, daysToResolve);

          const signalType = calcSignalType({
            edge: effectiveEdge, steamDetected,
            consensusCount: bookCount, fadeSignal, hasRef,
          });

          if (signalType === "SKIP" || signalType === "NO REF") continue;

          allMarkets.push({
            id: ev.id,
            question:       `${awayTeam} vs ${homeTeam}`,
            sport,
            league:         ev.league || pinnacleEntry?.league || null,
            home_team:      homeTeam,
            away_team:      awayTeam,
            url:            ev.slug ? `https://polymarket.com/event/${ev.slug}` : "https://polymarket.com",
            endDate:        ct,
            volume24hr:     volume || 10000,
            polyProb:       parseFloat(polyProb.toFixed(1)),
            sharpProb:      hasRef ? parseFloat(sharpProb.toFixed(1)) : null,
            pinnacleProb:   pinnacleProb   ? parseFloat(pinnacleProb.toFixed(1))   : null,
            kalshiProb:     kalshiProb     ? parseFloat(kalshiProb.toFixed(1))     : null,
            novigProb:      novigProb      ? parseFloat(novigProb.toFixed(1))      : null,
            circaProb:      circaProb      ? parseFloat(circaProb.toFixed(1))      : null,
            westgateProb:   westgateProb   ? parseFloat(westgateProb.toFixed(1))   : null,
            wynnProb:       wynnProb       ? parseFloat(wynnProb.toFixed(1))       : null,
            southPointProb: southPointProb ? parseFloat(southPointProb.toFixed(1)) : null,
            betonlineProb:  betonlineProb  ? parseFloat(betonlineProb.toFixed(1))  : null,
            sharpSource,
            consensusCount: bookCount,
            consensusBooks: consensus ? consensus.books : [],
            rawEdge:        parseFloat(rawEdge.toFixed(1)),
            adjEdge:        parseFloat(adjEdge.toFixed(1)),
            effectiveEdge:  parseFloat(effectiveEdge.toFixed(1)),
            side,
            steamDetected,
            pinnacleMove:   parseFloat(pinnacleMove.toFixed(1)),
            fadeSignal,
            publicHandle,
            publicBets,
            hasInjuryFlag:  injuredPlayers.length > 0,
            injuredPlayers: injuredPlayers.slice(0, 3),
            liqScore:       parseFloat((liqScore * 100).toFixed(0)),
            compScore:      parseFloat(compScore.toFixed(1)),
            annEdge,
            signalType,
            hoursToResolve: parseFloat(hoursToResolve.toFixed(1)),
            daysToResolve:  Math.ceil(daysToResolve),
          });
        }
      } catch (e) { console.error(`Scanner error ${sport}:`, e.message); }
    }));

    allMarkets.sort((a, b) => {
      const o = { STEAM: 0, CONSENSUS: 1, FADE: 2, VALUE: 3, MARGINAL: 4 };
      const diff = (o[a.signalType] ?? 5) - (o[b.signalType] ?? 5);
      return diff !== 0 ? diff : b.annEdge - a.annEdge;
    });

    return res.status(200).json({
      source: "live",
      data: allMarkets,
      meta: {
        timestamp:  new Date().toISOString(),
        total:      allMarkets.length,
        steam:      allMarkets.filter(m => m.signalType === "STEAM").length,
        consensus:  allMarkets.filter(m => m.signalType === "CONSENSUS").length,
        fade:       allMarkets.filter(m => m.signalType === "FADE").length,
      }
    });

  } catch (err) {
    console.error("Scanner fatal:", err.message);
    return res.status(502).json({ error: err.message, data: [] });
  }
}
