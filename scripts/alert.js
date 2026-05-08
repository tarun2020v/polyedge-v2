const https = require('https');

function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        console.log('Telegram response:', JSON.stringify(parsed));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchScanner(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const scannerUrl = process.env.SCANNER_URL;
  const bankroll = parseFloat(process.env.BANKROLL || '200');

  console.log('Fetching sports scanner...');
  const result = await fetchScanner(scannerUrl);
  const markets = result.data || [];

  // Also fetch weather scanner
  console.log('Fetching weather scanner...');
  const weatherUrl = scannerUrl.replace('/api/scanner', '/api/weather');
  const weatherResult = await fetchScanner(weatherUrl).catch(() => ({ data: [] }));
  const weatherMarkets = (weatherResult.data || []).map(m => ({
    ...m,
    signalType:    m.signalType || 'VALUE',
    effectiveEdge: m.absEdge,
    sharpProb:     m.forecastProb,
    consensusCount: m.sourceCount,
    consensusBooks: m.forecastSources || [],
    question:      m.question,
    sport:         'weather',
  }));
  console.log('Weather signals:', weatherMarkets.length);

  const allMarkets = [...markets, ...weatherMarkets];

  console.log('Total markets:', markets.length);
  const signalTypes = [...new Set(markets.map(m => m.signalType))];
  console.log('Signal types:', signalTypes.join(', '));

 const signals = allMarkets.filter(m =>
    (m.signalType === 'CONSENSUS' || m.signalType === 'STEAM') &&
    m.hoursToResolve <= 24 &&
    m.hoursToResolve >= 1
  );

  console.log('Actionable signals (24h):', signals.length);

  if (signals.length === 0) {
    console.log('No actionable signals right now.');
    return;
  }

  for (const m of signals.slice(0, 5)) {
    const isWeather = m.sport === 'weather';
    const booksStr = isWeather
      ? (m.forecastSources || m.consensusBooks || []).join(' / ') || 'forecast'
      : (m.consensusBooks || []).slice(0, 3).map(b => b.toUpperCase().slice(0, 3)).join(' / ') || m.sharpSource || 'unknown';

    const annEdgeStr = m.annEdge > 9999 ? '9999%+' : m.annEdge.toFixed(0) + '%';
    const stake = (bankroll * 0.02).toFixed(2);
    const polyUrl = 'https://polymarket.com/event/' + m.id;

        const lines = [
        '<b>' + (isWeather ? '🌤 WEATHER' : '⚽ SPORTS') + ' ' + m.signalType + ' SIGNAL</b>',

      '',
      '<b>' + m.question + '</b>',
      'BET ' + m.side,
      '',
      'Poly: <b>' + m.polyProb + '%</b>  vs  Sharp: <b>' + m.sharpProb + '%</b>',
      'Edge: <b>+' + m.effectiveEdge + '%</b> (fee-adj)',
      'Ann. Edge: <b>' + annEdgeStr + '</b>',
      'Books: <b>' + m.consensusCount + '/8</b> (' + booksStr + ')',
      'Resolves in: <b>' + m.hoursToResolve + 'h</b>',
      'Stake: <b>GBP ' + stake + '</b>',
      '',
      '<a href="' + polyUrl + '">Open Polymarket</a>',
    ];

    const text = lines.join('\n');
    console.log('Sending alert for:', m.question);
    await sendTelegram(token, chatId, text);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
