// scripts/update-historical.js
// Runs daily at 1am UTC via GitHub Actions
// Fetches yesterday's complete hourly data for all stations
// Appends to historical JSON files (rolling 365-day window)

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const WU_API_KEY = process.env.WEATHERCOM_API_KEY || "e1f10a1e78da46f5b10a1e78da96f525";

const STATIONS = [
  { station: "KORD", country: "US", units: "e", utcOffset: -5, name: "Chicago"    },
  { station: "KLGA", country: "US", units: "e", utcOffset: -4, name: "NYC"        },
  { station: "KMIA", country: "US", units: "e", utcOffset: -4, name: "Miami"      },
  { station: "KATL", country: "US", units: "e", utcOffset: -4, name: "Atlanta"    },
  { station: "KDAL", country: "US", units: "e", utcOffset: -5, name: "Dallas"     },
  { station: "EGLC", country: "GB", units: "m", utcOffset: 1,  name: "London"     },
  { station: "LFPG", country: "FR", units: "m", utcOffset: 2,  name: "Paris"      },
  { station: "RKSI", country: "KR", units: "m", utcOffset: 9,  name: "Seoul"      },
  { station: "VHHH", country: "HK", units: "m", utcOffset: 8,  name: "Hong Kong"  },
  { station: "RJTT", country: "JP", units: "m", utcOffset: 9,  name: "Tokyo"      },
  { station: "NZWN", country: "NZ", units: "m", utcOffset: 13, name: "Wellington" },
];

const ROLLING_DAYS = 365;
const HIST_DIR     = path.join(__dirname, "../data/historical");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":    "https://www.wunderground.com/",
        "Origin":     "https://www.wunderground.com",
      }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Parse: ${data.slice(0,100)}`)); }
      });
    }).on("error", reject);
  });
}

function getYesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { dateStr: `${y}${m}${dd}`, date: d };
}

function computeDeltas(observations, utcOffset) {
  if (!observations || observations.length < 3) return [];
  const sorted = [...observations].sort((a, b) => a.valid_time_gmt - b.valid_time_gmt);
  const allTemps = sorted.map(o => o.temp).filter(t => t != null);
  if (!allTemps.length) return [];
  const finalMax = Math.max(...allTemps);
  const deltas = [];
  let runningMax = -999;
  for (const obs of sorted) {
    if (obs.temp == null) continue;
    const utcHour   = new Date(obs.valid_time_gmt * 1000).getUTCHours();
    const localHour = (utcHour + utcOffset + 24) % 24;
    if (localHour < 6 || localHour > 20) continue;
    runningMax = Math.max(runningMax, obs.temp);
    deltas.push({
      localHour,
      runningMax: parseFloat(runningMax.toFixed(1)),
      finalMax:   parseFloat(finalMax.toFixed(1)),
      delta:      parseFloat((finalMax - runningMax).toFixed(1)),
    });
  }
  return deltas;
}

async function updateStation(s) {
  const { dateStr, date } = getYesterday();
  const month = date.getUTCMonth() + 1;

  // Load existing historical data
  const fp = path.join(HIST_DIR, `${s.station}.json`);
  if (!fs.existsSync(fp)) {
    console.log(`  ${s.station}: no historical file found, skipping`);
    return;
  }
  const existing = JSON.parse(fs.readFileSync(fp, "utf8"));
  const rows = existing.rows || [];

  // Check if yesterday already exists
  const alreadyExists = rows.some(r => r.date === dateStr);
  if (alreadyExists) {
    console.log(`  ${s.station}: ${dateStr} already in historical data`);
    return;
  }

  // Fetch yesterday's data
  const url = `https://api.weather.com/v1/location/${s.station}:9:${s.country}/observations/historical.json?apiKey=${WU_API_KEY}&units=${s.units}&startDate=${dateStr}`;
  
  try {
    const data = await fetchUrl(url);
    const obs  = data.observations || [];
    if (!obs.length) {
      console.log(`  ${s.station}: no observations for ${dateStr}`);
      return;
    }

    const deltas = computeDeltas(obs, s.utcOffset);
    const newRows = deltas.map(d => ({
      date:       dateStr,
      month,
      localHour:  d.localHour,
      runningMax: d.runningMax,
      finalMax:   d.finalMax,
      delta:      d.delta,
    }));

    // Append new rows
    const updated = [...rows, ...newRows];

    // Drop rows older than ROLLING_DAYS
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - ROLLING_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0,10).replace(/-/g, "");
    const trimmed = updated.filter(r => r.date >= cutoffStr);

    existing.rows     = trimmed;
    existing.fetchedAt = new Date().toISOString();

    fs.writeFileSync(fp, JSON.stringify(existing, null, 2));
    console.log(`  ${s.station}: added ${newRows.length} rows for ${dateStr}, total=${trimmed.length}`);

  } catch(e) {
    console.error(`  ${s.station}: ERROR — ${e.message}`);
  }
}

async function main() {
  console.log(`Updating historical data with yesterday's observations...`);
  for (const s of STATIONS) {
    await updateStation(s);
    await sleep(600);
  }
  console.log("Done.");
}

main().catch(console.error);
