# PolyEdge — Deployment Guide

Prediction market +EV scanner. Polymarket vs Metaculus/Betfair sharp reference.
Built with Next.js. Deployable to Vercel in ~5 minutes.

---

## Prerequisites

- Node.js 18+ (download from https://nodejs.org)
- A Vercel account (free at https://vercel.com)
- Betfair Exchange API key (optional but recommended — https://developer.betfair.com)

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env.local

# 3. Add your Betfair key to .env.local (optional)
# BETFAIR_API_KEY=your_key_here
# BETFAIR_APP_KEY=your_app_key_here

# 4. Run locally
npm run dev
# → opens at http://localhost:3000
```

---

## Deploy to Vercel (production)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Deploy (follow prompts — all defaults are fine)
vercel

# 3. Add environment variables via Vercel dashboard OR CLI:
vercel env add BETFAIR_API_KEY
vercel env add BETFAIR_APP_KEY

# 4. Redeploy with env vars active
vercel --prod
```

Your app will be live at: `https://polyedge-[random].vercel.app`

You can set a custom domain in Vercel dashboard → Domains.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BETFAIR_API_KEY` | Optional | Betfair Exchange API key from developer.betfair.com |
| `BETFAIR_APP_KEY` | Optional | Betfair App key (issued alongside API key) |
| `CACHE_TTL` | Optional | Cache TTL in seconds (default: 300) |
| `CRON_SECRET` | Optional | Secret for cron job auth (any random string) |

---

## API routes

| Route | Description |
|---|---|
| `GET /api/polymarket` | Fetches live Polymarket markets, cached 5 min |
| `GET /api/metaculus?q=...` | Looks up Metaculus forecast for a question |
| `GET /api/betfair?query=...` | Gets Betfair Exchange implied probability |
| `GET /api/refresh-cache` | Called by Vercel cron every 5 min |

---

## Architecture

```
Browser (React dashboard)
    ↓ fetch("/api/...")
Next.js API routes (server-side)
    ↓ fetch with no CORS issues
Polymarket Gamma API    → market prices
Metaculus API           → sharp reference probabilities  
Betfair Exchange API    → sharp reference for sports
```

The API key never touches the browser. It lives in Vercel's encrypted env vars
and is only used server-side in /api/betfair.js.

---

## Updating

```bash
# Pull latest, redeploy
vercel --prod
```

---

## Cost

- Vercel free tier: covers all usage for a solo operator
- Polymarket API: free, no key needed
- Metaculus API: free, no key needed  
- Betfair API: free (requires funded account, min £10 deposit)
- Total monthly cost: £0
