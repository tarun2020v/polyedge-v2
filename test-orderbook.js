const https = require("https");

// Get Dallas March 29 token IDs first
https.get("https://gamma-api.polymarket.com/events?slug=highest-temperature-in-dallas-on-march-29-2026&closed=false",
  {headers:{"User-Agent":"PolyEdge/1.0"}}, res => {
    let d="";
    res.on("data",c=>d+=c);
    res.on("end",()=>{
      const events = JSON.parse(d);
      const market = events[0]?.markets?.[0];
      if (!market) { console.log("no market"); return; }
      const tokens = JSON.parse(market.clobTokenIds || "[]");
      console.log("question:", market.question);
      console.log("YES token:", tokens[0]?.slice(0,20));

      const https2 = require("https");
      https2.get(`https://clob.polymarket.com/book?token_id=${tokens[0]}`,
        {headers:{"User-Agent":"PolyEdge/1.0"}}, res2 => {
          let d2="";
          res2.on("data",c=>d2+=c);
          res2.on("end",()=>{
            const b=JSON.parse(d2);
            console.log("bids:", JSON.stringify(b.bids?.slice(0,3)));
            console.log("asks:", JSON.stringify(b.asks?.slice(0,3)));
          });
        }).on("error",console.error);
    });
}).on("error",console.error);
