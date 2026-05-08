// scripts/kelly.js
const KELLY_FRACTION = 0.25;
const MAX_STAKE      = 20;
const MIN_STAKE      = 2;

function kellyStake(modelProb, marketProb, bankroll, side) {
  let p, price;
  if (side === "NO") {
    p     = (100 - modelProb)  / 100;
    price = (100 - marketProb) / 100;
  } else {
    p     = modelProb  / 100;
    price = marketProb / 100;
  }
  const q     = 1 - p;
  const b     = (1 - price) / price;
  const kelly = (p * b - q) / b;
  if (kelly <= 0) return 0;
  const raw = bankroll * kelly * KELLY_FRACTION;
  return Math.min(MAX_STAKE, Math.max(MIN_STAKE, parseFloat(raw.toFixed(2))));
}

module.exports = { kellyStake };
