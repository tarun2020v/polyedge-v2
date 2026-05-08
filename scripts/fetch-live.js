// scripts/fetch-live.js
// Run locally every 20 min (or manually)
// Fetches current observed max for all stations from Weather.com
// Saves to data/live/{STATION}.json
// Then commits and pushes so Vercel picks it up

const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const { execSync } = require("child_process");

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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "Accept":          "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer":         "https://www.wunderground.com/",
        "Origin":          "https://www.wunderground.com",
      }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0,100)}`)); }
      });
    }).on("error", reject);
  });
}

async function fetchStationLive(s) {
  const now     = new Date();
  const y       = now.getUTCFullYear();
  const m       = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d       = String(now.getUTCDate()).padStart(2, "0");
  const dateStr = `${y}${m}${d}`;

  const url = `https://api.weather.com/v1/location/${s.station}:9:${s.country}/observations/historical.json?apiKey=${WU_API_KEY}&units=${s.units}&startDate=${dateStr}`;

  const data = await fetchUrl(url);
  const obs  = data.observations || [];

  if (!obs.length) throw new Error("No observations");

  const nowUtc  = Date.now();
  const pastObs = obs
    .filter(o => o.valid_time_gmt * 1000 <= nowUtc && o.temp != null)
    .sort((a, b) => a.valid_time_gmt - b.valid_time_gmt);

  if (!pastObs.length) throw new Error("No past observations");

  const maxTemp    = Math.max(...pastObs.map(o => o.temp));
  const lastObs    = pastObs[pastObs.length - 1];
  const utcHour    = new Date(lastObs.valid_time_gmt * 1000).getUTCHours();
  const localHour  = (utcHour + s.utcOffset + 24) % 24;

  const result = {
    station:      s.station,
    name:         s.name,
    units:        s.units,
    date:         `${y}-${m}-${d}`,
    fetchedAt:    now.toISOString(),
    localHour,
    observedMax:  maxTemp,  // integer °F for US, °C for intl
    obsCount:     pastObs.length,
    lastObsTime:  new Date(lastObs.valid_time_gmt * 1000).toISOString(),
  };

  return result;
}

async function main() {
  const outDir = path.join(__dirname, "../data/live");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Fetching live data for ${STATIONS.length} stations...`);

  for (const s of STATIONS) {
    try {
      const result = await fetchStationLive(s);
      const fp     = path.join(outDir, `${s.station}.json`);
      fs.writeFileSync(fp, JSON.stringify(result, null, 2));
      console.log(`✓ ${s.name} (${s.station}): max=${result.observedMax}${s.units === "e" ? "°F" : "°C"} at local hour ${result.localHour}`);
    } catch (e) {
      console.error(`✗ ${s.name} (${s.station}): ${e.message}`);
    }
  }

  // Commit and push so Vercel picks up the new data
    if (!process.env.SKIP_GIT_PUSH) {
    try {
      execSync("git add data/live", { cwd: path.join(__dirname, "..") });
      execSync('git commit -m "Update live weather data"', { cwd: path.join(__dirname, "..") });
      execSync("git push origin main", { cwd: path.join(__dirname, "..") });
      console.log("\n✓ Pushed to repo");
    } catch (e) {
      console.log("\n⚠ Git push failed:", e.message.slice(0, 100));
    }
  }
  console.log("\nDone.");
}

main().catch(console.error);