const fs   = require("fs");
const path = require("path");

const TRADES_DIR = path.join(__dirname, "data/trades");
const files = fs.readdirSync(TRADES_DIR)
  .filter(f => f.endsWith(".json") && !f.startsWith("forecast-"));

for (const file of files) {
  const fp     = path.join(TRADES_DIR, file);
  const trades = JSON.parse(fs.readFileSync(fp, "utf8"));
  
  const observed = trades.filter(t => t.forecastMethod === "observed");
  const forecast = trades.filter(t => t.forecastMethod === "forecast" && t.signalType === "CONSENSUS");
  const other    = trades.filter(t => t.forecastMethod === "forecast" && t.signalType !== "CONSENSUS");

  // Save observed only back to original file
  fs.writeFileSync(fp, JSON.stringify(observed, null, 2));

  // Move forecast-CONSENSUS to forecast file
  if (forecast.length) {
    const fcFp = path.join(TRADES_DIR, `forecast-${file}`);
    const fcEx = fs.existsSync(fcFp) ? JSON.parse(fs.readFileSync(fcFp, "utf8")) : [];
    const fcIds = new Set(fcEx.map(t => t.id));
    const toAdd = forecast.filter(t => !fcIds.has(t.id));
    fs.writeFileSync(fcFp, JSON.stringify([...fcEx, ...toAdd], null, 2));
    console.log(`${file}: moved ${toAdd.length} forecast-CONSENSUS trades`);
  }

  console.log(`${file}: kept ${observed.length} observed, discarded ${other.length} forecast-VALUE`);
}
console.log("Done.");
