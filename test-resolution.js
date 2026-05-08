const https = require('https');

// Fetch via event slug - this is how we originally get markets
https.get(`https://gamma-api.polymarket.com/events?slug=highest-temperature-in-dallas-on-march-25-2026&closed=true`, 
  {headers:{'User-Agent':'PolyEdge/1.0'}}, res => {
    let d=''; 
    res.on('data',c=>d+=c); 
    res.on('end',()=>{
      const events=JSON.parse(d);
      const event = Array.isArray(events) ? events[0] : events;
      if (!event) { console.log('No event found'); return; }
      console.log('event closed:', event.closed);
      const markets = event.markets || [];
      console.log('markets count:', markets.length);
      if (markets[0]) {
        console.log('market id:', markets[0].id);
        console.log('conditionId:', markets[0].conditionId);
        console.log('closed:', markets[0].closed);
        console.log('outcomePrices:', markets[0].outcomePrices);
        console.log('question:', markets[0].question);
      }
    });
}).on('error',console.error);
