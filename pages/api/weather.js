const fs = require("fs");
const path = require("path");
const { rangeProbFromRemaining, MIN_ANALOGUES } = require("../../lib/exceedance");
const { CITIES, MONTHS } = require("../../lib/markets");
const CLOB_HOST = "https://clob.polymarket.com";
const MIN_EDGE = parseFloat(process.env.MIN_EDGE || "12");
const MIN_NET_EDGE = parseFloat(process.env.MIN_NET_EDGE || "10");
const MAX_SPREAD_CENTS = parseFloat(process.env.MAX_SPREAD_CENTS || "4");
const MIN_BOOK_SIZE = parseFloat(process.env.MIN_BOOK_SIZE || "1");
const MIN_LOCAL_HOUR = parseInt(process.env.MIN_LOCAL_HOUR || "8", 10);
const MAX_LOCAL_HOUR = parseInt(process.env.MAX_LOCAL_HOUR || "19", 10);
const DISABLED_CITIES = (process.env.DISABLED_CITIES || "miami").split(",").map(s => s.trim()).filter(Boolean);
function dateSlug(date){return `${MONTHS[date.getUTCMonth()]}-${date.getUTCDate()}-${date.getUTCFullYear()}`;}
function parseTempFromTitle(title=""){
  const rangeF=title.match(/(-?\d+)\s*-\s*(-?\d+)\s*°?F/i); if(rangeF)return{low:+rangeF[1],high:+rangeF[2],unit:"F"};
  const higherF=title.match(/(-?\d+)\s*°?F\s*or higher/i); if(higherF)return{low:+higherF[1],high:Infinity,unit:"F"};
  const belowF=title.match(/(-?\d+)\s*°?F\s*or below/i); if(belowF)return{low:-Infinity,high:+belowF[1],unit:"F"};
  const singleF=title.match(/(-?\d+)\s*°?F/i); if(singleF)return{low:+singleF[1],high:+singleF[1],unit:"F"};
  const rangeC=title.match(/(-?\d+)\s*-\s*(-?\d+)\s*°?C/i); if(rangeC)return{low:+rangeC[1],high:+rangeC[2],unit:"C"};
  const higherC=title.match(/(-?\d+)\s*°?C\s*or higher/i); if(higherC)return{low:+higherC[1],high:Infinity,unit:"C"};
  const belowC=title.match(/(-?\d+)\s*°?C\s*or below/i); if(belowC)return{low:-Infinity,high:+belowC[1],unit:"C"};
  const singleC=title.match(/(-?\d+)\s*°?C/i); if(singleC)return{low:+singleC[1],high:+singleC[1],unit:"C"};
  return null;
}
function readLiveData(station){try{const fp=path.join(process.cwd(),"data/live",`${station}.json`); if(!fs.existsSync(fp))return{ok:false,reason:"missing-live-file"}; const d=JSON.parse(fs.readFileSync(fp,"utf8")); const today=new Date().toISOString().slice(0,10); if(d.date!==today)return{ok:false,reason:`stale-date-${d.date}`}; const lastObs=new Date(d.lastObsTime||d.fetchedAt).getTime(); const ageMin=(Date.now()-lastObs)/60000; if(!Number.isFinite(ageMin)||ageMin>90)return{ok:false,reason:`stale-obs-${Math.round(ageMin)}m`}; const isUS=station.startsWith("K"); return{ok:true,observedMaxNative:d.observedMax,observedMaxF:isUS?d.observedMax:+(((d.observedMax*9/5)+32).toFixed(1)),observedMaxC:isUS?+(((d.observedMax-32)*5/9).toFixed(1)):d.observedMax,localHour:d.localHour,hoursObserved:d.obsCount,lastObsTime:d.lastObsTime,ageMin:+ageMin.toFixed(1),source:`wunderground-${station}`};}catch(e){return{ok:false,reason:e.message};}}
async function fetchJson(url,timeoutMs=12000){const r=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{"User-Agent":"PolyEdge/2.0"}}); if(!r.ok)throw new Error(`HTTP ${r.status}`); return r.json();}
async function fetchEvent(citySlug,ds){const slug=`highest-temperature-in-${citySlug}-on-${ds}`; const data=await fetchJson(`https://gamma-api.polymarket.com/events?slug=${slug}&closed=false`,15000).catch(()=>null); return Array.isArray(data)&&data.length?data[0]:null;}
function parseOutcomePrices(market){try{const p=JSON.parse(market.outcomePrices||"[]").map(Number);return{yes:p[0],no:p[1]};}catch{return{yes:null,no:null};}}
function tokenIds(market){try{return JSON.parse(market.clobTokenIds||"[]");}catch{return[];}}
function normaliseBookSide(arr,side){const levels=(arr||[]).map(x=>({price:Number(x.price),size:Number(x.size||x.original_size||0)})).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size)); return side==="asks"?levels.sort((a,b)=>a.price-b.price):levels.sort((a,b)=>b.price-a.price);}
async function fetchBook(tokenId){if(!tokenId)return null; const book=await fetchJson(`${CLOB_HOST}/book?token_id=${tokenId}`,10000).catch(()=>null); if(!book)return null; const asks=normaliseBookSide(book.asks,"asks"); const bids=normaliseBookSide(book.bids,"bids"); if(!asks.length||!bids.length)return null; return{ask:asks[0].price,askSize:asks[0].size,bid:bids[0].price,bidSize:bids[0].size,spread:asks[0].price-bids[0].price};}
function executablePrice(side,yesBook,noBook,fallbackYes){if(side==="YES"){if(yesBook?.ask)return{price:yesBook.ask,size:yesBook.askSize,spread:yesBook.spread,source:"yes-book"}; return{price:fallbackYes,size:0,spread:null,source:"fallback"};} if(noBook?.ask)return{price:noBook.ask,size:noBook.askSize,spread:noBook.spread,source:"no-book"}; if(Number.isFinite(fallbackYes))return{price:1-fallbackYes,size:0,spread:null,source:"fallback"}; return{price:null,size:0,spread:null,source:"none"};}
function rejection(stage,detail){return{stage,detail};}
export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).end(); const started=Date.now(); const today=new Date(); const todayStr=today.toISOString().slice(0,10); const month=today.getUTCMonth()+1; const results=[]; const rejected=[];
 for(const city of CITIES){
  if(DISABLED_CITIES.includes(city.name)){rejected.push({city:city.name,reason:"city-disabled"});continue;}
  const live=readLiveData(city.wuStation); if(!live.ok){rejected.push({city:city.name,station:city.wuStation,reason:live.reason});continue;}
  if(live.localHour<MIN_LOCAL_HOUR||live.localHour>MAX_LOCAL_HOUR){rejected.push({city:city.name,station:city.wuStation,reason:`hour-filter-${live.localHour}`});continue;}
  const event=await fetchEvent(city.slug,dateSlug(today)); if(!event?.markets?.length){rejected.push({city:city.name,reason:"no-live-event"});continue;}
  const observedNative=city.units==="e"?live.observedMaxF:live.observedMaxC; const hoursToResolve=Math.max(0,23.99-live.localHour);
  for(const market of event.markets){
   const temp=parseTempFromTitle(market.question||market.groupItemTitle||""); if(!temp){rejected.push({city:city.name,market:market.id,reason:"parse-temp-failed"});continue;}
   if((city.units==="e"&&temp.unit!=="F")||(city.units==="m"&&temp.unit!=="C")){rejected.push({city:city.name,market:market.id,reason:"unit-mismatch"});continue;}
   const model=rangeProbFromRemaining(city.wuStation,live.localHour,month,observedNative,temp.low,temp.high); if(!model?.model){rejected.push({city:city.name,market:market.id,reason:model?.reason||"no-model"});continue;}
   const tokens=tokenIds(market); const [yesBook,noBook]=await Promise.all([fetchBook(tokens[0]),fetchBook(tokens[1])]); const fallback=parseOutcomePrices(market).yes;
   const fairYes=model.prob, fairNo=1-fairYes; const yesExec=executablePrice("YES",yesBook,noBook,fallback); const noExec=executablePrice("NO",yesBook,noBook,fallback);
   const yesNetEdge=+(((fairYes-(yesExec.price??NaN))*100).toFixed(2)); const noNetEdge=+(((fairNo-(noExec.price??NaN))*100).toFixed(2)); const side=yesNetEdge>=noNetEdge?"YES":"NO"; const exec=side==="YES"?yesExec:noExec; const fair=side==="YES"?fairYes:fairNo; const rawMarketProb=side==="YES"?fallback:(Number.isFinite(fallback)?1-fallback:exec.price); const netEdge=side==="YES"?yesNetEdge:noNetEdge; const absEdge=Math.abs(netEdge);
   const rejectReasons=[]; if(!Number.isFinite(exec.price))rejectReasons.push(rejection("no-price",exec.source)); if(exec.spread!=null&&exec.spread*100>MAX_SPREAD_CENTS)rejectReasons.push(rejection("wide-spread",`${(exec.spread*100).toFixed(1)}c`)); if((exec.size||0)<MIN_BOOK_SIZE)rejectReasons.push(rejection("thin-top-book",exec.size||0)); if(netEdge<MIN_NET_EDGE)rejectReasons.push(rejection("low-net-edge",`${netEdge}%`)); if(absEdge<MIN_EDGE)rejectReasons.push(rejection("low-abs-edge",`${absEdge}%`)); if(model.reason==="bounded-range"&&Math.abs((model.pLow??0)-(model.pHigh??0))<0.12)rejectReasons.push(rejection("fragile-bucket","pLow-pHigh<12c"));
   const row={id:market.conditionId||market.id,marketId:market.id,question:market.question||market.groupItemTitle,city:city.name,date:todayStr,station:city.wuStation,url:`https://polymarket.com/event/highest-temperature-in-${city.slug}-on-${dateSlug(today)}`,side,signalType:rejectReasons.length?"REJECT":"OBSERVED_REMAINING_UPSIDE",forecastMethod:"observed",polyProb:+(((rawMarketProb??exec.price??0)*100).toFixed(2)),executablePrice:+((exec.price??0).toFixed(4)),forecastProb:+((fair*100).toFixed(2)),adjEdge:netEdge,absEdge,spreadCents:exec.spread==null?null:+((exec.spread*100).toFixed(2)),topBookSize:exec.size||0,observedMaxF:live.observedMaxF,observedMaxC:live.observedMaxC,observedMaxNative:observedNative,localHour:live.localHour,hoursToResolve,volume24hr:Number(market.volume24hr||market.volume||0),liquidity:Number(market.liquidity||0),modelN:model.model.n,modelMode:model.model.mode,modelReason:model.reason,gapLow:model.gapLow,gapHigh:model.gapHigh===Infinity?"Infinity":model.gapHigh,modelStats:model.model.stats,source:live.source,lastObsTime:live.lastObsTime,rejects:rejectReasons};
   if(rejectReasons.length)rejected.push({city:city.name,market:market.id,question:row.question,rejects:rejectReasons}); else results.push(row);
  }
 }
 results.sort((a,b)=>b.adjEdge-a.adjEdge); res.status(200).json({ok:true,data:results,meta:{scanner:"remaining-upside-v2",date:todayStr,generatedAt:new Date().toISOString(),runtimeMs:Date.now()-started,minEdge:MIN_EDGE,minNetEdge:MIN_NET_EDGE,maxSpreadCents:MAX_SPREAD_CENTS,minAnalogues:MIN_ANALOGUES,accepted:results.length,rejected:rejected.length,rejectedSample:rejected.slice(0,50)}});
}
