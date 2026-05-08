#!/bin/bash
# PolyEdge VPS Setup Script
# Run as root on fresh Ubuntu 24.04

set -e

echo "=== PolyEdge VPS Setup ==="

# 1. Update system
apt-get update && apt-get upgrade -y

# 2. Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs git curl

# 3. Install Polymarket Rust CLI
curl -sSL https://raw.githubusercontent.com/Polymarket/polymarket-cli/main/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# 4. Clone repo
git clone https://github.com/tarun2020v/polyedge.git /opt/polyedge
cd /opt/polyedge
npm install

# 5. Create env file (fill in values after)
cat > /opt/polyedge/.env << 'EOF'
LIVE_TRADING=false
POLYMARKET_PRIVATE_KEY=
BANKROLL=200
MIN_EDGE=15
MIN_VOLUME=5000
MIN_HOUR=13
MAX_DAILY_SPEND=50
SCANNER_URL=https://polyedge-woad.vercel.app/api/weather
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF

chmod 600 /opt/polyedge/.env

# 6. Create run script
cat > /opt/polyedge/run.sh << 'EOF'
#!/bin/bash
cd /opt/polyedge
# Pull latest code and data
git pull origin main --rebase 2>/dev/null || true
# Load env
export $(cat .env | grep -v '^#' | xargs)
# Fetch live weather data
node scripts/fetch-live.js
# Run trade executor
node scripts/trade-executor.js
# Monitor positions
node scripts/position-monitor.js
# Log paper trades
node scripts/paper-trade.js
# Push updated data back to repo
git add data/live data/positions data/trades
git diff --staged --quiet || git commit -m "VPS update [skip ci]"
git push origin main 2>/dev/null || true
EOF

chmod +x /opt/polyedge/run.sh

# 7. Set up cron job every 20 minutes
(crontab -l 2>/dev/null; echo "*/20 * * * * /opt/polyedge/run.sh >> /var/log/polyedge.log 2>&1") | crontab -

# 8. Set up daily historical update at 1am
(crontab -l 2>/dev/null; echo "0 1 * * * cd /opt/polyedge && node scripts/update-historical.js >> /var/log/polyedge-hist.log 2>&1") | crontab -

# 9. Set up git identity
git config --global user.email "tarun.vathenen@gmail.com"
git config --global user.name "PolyEdge VPS"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Edit /opt/polyedge/.env and add your keys"
echo "2. Set up SSH key for git: ssh-keygen -t ed25519 && cat ~/.ssh/id_ed25519.pub"
echo "3. Add that SSH key to GitHub"
echo "4. Test: /opt/polyedge/run.sh"
echo "5. When ready for live trading: set LIVE_TRADING=true in .env"
echo ""
echo "Logs: tail -f /var/log/polyedge.log"