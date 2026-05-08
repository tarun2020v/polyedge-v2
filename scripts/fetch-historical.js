// fetch-historical.js
// Run locally: node scripts/fetch-historical.js
// Fetches 90 days of hourly observations per station from Weather.com API
// Outputs data/historical/{STATION}.json

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const WU_API_KEY = "e1f10a1e78da46f5b10a1e78da96f525";

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

const DAYS_BACK   = 90;
const DELAY_MS    = 800; // be polite to the API
const OUTPUT_DIR  = path.join(__dirname, "../data/historical");

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "Accept":          "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer":         "https://www.wunderground.com/",
        "Origin":          "https://www.wunderground.com",
      }
    };
    https.get(url, options, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function getDateStrings(daysBack) {
  const dates = [];
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push({ dateStr: `${y}${m}${day}`, date: d });
  }
  return dates;
}

// From a list of observations for one day, compute:
// For each hour that had an observation:
//   - M_t: max temp seen up to and including that hour
//   - final_max: max temp for the whole day
//   - delta: final_max - M_t
//   - local_hour
function computeDeltasForDay(observations, utcOffset, isMetric) {
  if (!observations || observations.length < 3) return [];

  // Sort by time
  const sorted = [...observations].sort((a, b) => a.valid_time_gmt - b.valid_time_gmt);

  // Get final max for the day
  const allTemps = sorted.map(o => o.temp).filter(t => t != null);
  if (!allTemps.length) return [];
  const finalMax = Math.max(...allTemps);

  const deltas = [];
  let runningMax = -999;

  for (const obs of sorted) {
    if (obs.temp == null) continue;

    // Local hour
    const utcHour  = new Date(obs.valid_time_gmt * 1000).getUTCHours();
    const localHour = (utcHour + utcOffset + 24) % 24;

    // Only care about daytime hours (6am-8pm local)
    if (localHour < 6 || localHour > 20) continue;

    runningMax = Math.max(runningMax, obs.temp);
    const delta = finalMax - runningMax;

    deltas.push({
      localHour,
      runningMax: parseFloat(runningMax.toFixed(1)),
      finalMax:   parseFloat(finalMax.toFixed(1)),
      delta:      parseFloat(delta.toFixed(1)),
    });
  }

  return deltas;
}

async function fetchStation(stationCfg) {
  const { station, country, units, utcOffset, name } = stationCfg;
  const dates   = getDateStrings(DAYS_BACK);
  const allRows = []; // { date, month, localHour, runningMax, finalMax, delta }

  console.log(`\n[${station}] ${name} — fetching ${DAYS_BACK} days...`);

  for (const { dateStr, date } of dates) {
    const url = `https://api.weather.com/v1/location/${station}:9:${country}/observations/historical.json?apiKey=${WU_API_KEY}&units=${units}&startDate=${dateStr}`;

    try {
      const data = await fetchUrl(url);
      const obs  = data.observations || [];

      if (!obs.length) {
        console.log(`  ${dateStr}: no data`);
        await sleep(DELAY_MS);
        continue;
      }

      const deltas = computeDeltasForDay(obs, utcOffset, units === "m");

      for (const row of deltas) {
        allRows.push({
          date:       dateStr,
          month:      date.getMonth() + 1, // 1-12
          localHour:  row.localHour,
          runningMax: row.runningMax,
          finalMax:   row.finalMax,
          delta:      row.delta,
        });
      }

      const dayFinal = deltas.length ? deltas[deltas.length - 1].finalMax : "?";
      console.log(`  ${dateStr}: ${obs.length} obs, finalMax=${dayFinal}, ${deltas.length} delta rows`);

    } catch (e) {
      console.error(`  ${dateStr}: ERROR — ${e.message}`);
    }

    await sleep(DELAY_MS);
  }

  // Save
  const outPath = path.join(OUTPUT_DIR, `${station}.json`);
  const output  = {
    station,
    name,
    units,
    utcOffset,
    fetchedAt: new Date().toISOString(),
    days:      DAYS_BACK,
    rows:      allRows,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`[${station}] Done — ${allRows.length} rows saved to ${outPath}`);

  return allRows.length;
}

async function main() {
  // Create output dir
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Fetching ${DAYS_BACK} days × ${STATIONS.length} stations`);
  console.log(`Estimated time: ~${Math.ceil(DAYS_BACK * STATIONS.length * DELAY_MS / 60000)} minutes\n`);

  for (const s of STATIONS) {
    await fetchStation(s);
    await sleep(2000); // pause between stations
  }

  console.log("\nAll done.");
}

main().catch(console.error);
