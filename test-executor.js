const https = require("https");
https.get("https://polyedge-woad.vercel.app/api/weather", 
  {headers:{"User-Agent":"PolyEdge/1.0"}}, res => {
    let d=""; 
    res.on("data",c=>d+=c); 
    res.on("end",()=>{
      const r=JSON.parse(d);
      r.data.forEach(s=>console.log(
        s.city, 
        'hour:'+s.localHour, 
        'hrs:'+s.hoursToResolve, 
        'edge:'+s.absEdge, 
        'vol:'+s.volume24hr
      ));
    });
}).on('error',console.error);
