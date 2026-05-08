const fs   = require('fs');
const path = require('path');

const all = [];
for (let i = 0; i <= 7; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const fp = 'data/trades/' + d.toISOString().slice(0,10) + '.json';
  try { all.push(...JSON.parse(fs.readFileSync(fp, 'utf8'))); } catch {}
}

const resolved = all.filter(t => t.resolved && t.outcome !== 'PUSH');
console.log('\n=== OBSERVED SIGNAL ANALYSIS ===');
resolved.forEach(t => {
  console.log(`${t.outcome} | ${t.paperSide} | Model:${t.forecastProb}% Market:${t.polyProb}% | Hour:${t.localHour} | ${t.question?.slice(0,50)}`);
});
