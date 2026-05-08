// scripts/fetch-extended-historical.js
// Fetches 2023 and 2024 full year data for all stations
// Appends to existing historical files without duplicates
// Run once locally: node scripts/fetch-extended-historical.js
// Takes ~2 hours

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

const YEARS    = [2023, 2024];
const HIST_DIR = path.join(__dirname, "../data/historical");
const DELAY_MS = 800;

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

function getYearDates(year) {
  const dates = [];
  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const d = new Date(year, month, day);
      if (d.getMonth() !== month) break; // past end of month
      const y  = d.getFullYear();
      const m  = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      dates.push({ dateStr: `${y}${m}${dd}`, date: new Date(d) });
    }
  }
  return dates;
}

function computeDeltas(observations, utcOffset) {
  if (!observations || observations.length < 3) return [];
  const sorted   = [...observations].sort((a, b) => a.valid_time_gmt - b.valid_time_gmt);
  const allTemps = sorted.map(o => o.temp).filter(t => t != null);
  if (!allTemps.length) return [];
  const finalMax = Math.max(...allTemps);
  const deltas   = [];
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

async function fetchStation(s) {
  const fp = path.join(HIST_DIR, `${s.station}.json`);
  if (!fs.existsSync(fp)) {
    console.log(`  ${s.station}: no existing file, skipping`);
    return;
  }

  const existing    = JSON.parse(fs.readFileSync(fp, "utf8"));
  const existingSet = new Set(existing.rows.map(r => r.date));
  let added         = 0;
  let skipped       = 0;

  console.log(`\n[${s.station}] ${s.name} — fetching 2023/2024 (existing: ${existing.rows.length} rows)...`);

  for (const year of YEARS) {
    const dates = getYearDates(year);
    console.log(`  Year ${year}: ${dates.length} dates to check`);

    for (const { dateStr, date } of dates) {
      if (existingSet.has(dateStr)) {
        skipped++;
        continue;
      }

      const url = `https://api.weather.com/v1/location/${s.station}:9:${s.country}/observations/historical.json?apiKey=${WU_API_KEY}&units=${s.units}&startDate=${dateStr}`;

      try {
        const data   = await fetchUrl(url);
        const obs    = data.observations || [];
        if (!obs.length) { await sleep(DELAY_MS); continue; }

        const deltas = computeDeltas(obs, s.utcOffset);
        for (const row of deltas) {
          existing.rows.push({
            date:       dateStr,
            month:      date.getMonth() + 1,
            localHour:  row.localHour,
            runningMax: row.runningMax,
            finalMax:   row.finalMax,
            delta:      row.delta,
          });
        }
        existingSet.add(dateStr);
        added += deltas.length;
        process.stdout.write(`  ${dateStr}: +${deltas.length} rows (total added: ${added})\r`);
      } catch(e) {
        // silently skip failed dates
      }

      await sleep(DELAY_MS);
    }

    // Save after each year in case of interruption
    existing.fetchedAt = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(existing, null, 2));
    console.log(`\n  Year ${year} done — added ${added} rows, skipped ${skipped} existing`);
  }

  console.log(`[${s.station}] Complete — total rows now: ${existing.rows.length}`);
}

async function main() {
  console.log("Fetching 2023/2024 full year historical data for all stations...");
  console.log("Estimated time: ~2 hours\n");

  for (const s of STATIONS) {
    await fetchStation(s);
    await sleep(3000);
  }

  console.log("\n=== All done ===");
  console.log("Run node test-exceedance.js to verify model improvement.");
}

main().catch(console.error);
