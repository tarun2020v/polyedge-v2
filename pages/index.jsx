import { useState, useEffect, useCallback, useRef } from "react";
import { exitSignal } from "../lib/calc";

const T = {
  bg0:"#0d1117", bg1:"#161b22", bg2:"#1c2128", bg3:"#21262d",
  border:"#30363d", border2:"#21262d",
  text0:"#ffffff", text1:"#c9d1d9", text2:"#8b949e", text3:"#484f58",
  green:"#00e676", blue:"#29b6f6", orange:"#ff9100", red:"#ff4444",
  purple:"#ce93d8", yellow:"#ffeb3b", teal:"#26c6da",
};

const FLAT_STAKE_PCT  = 0.02;
const AUTO_REFRESH_MS = 20 * 60 * 1000;

function flatStake(bankroll) { return parseFloat((bankroll * FLAT_STAKE_PCT).toFixed(2)); }

async function loadMarkets(bankroll) {
  const r = await fetch("/api/scanner");
  if (!r.ok) throw new Error(`Scanner API: ${r.status}`);
  const json = await r.json();
  if (json.error) throw new Error(json.error);
  return {
    markets: (json.data || []).map(m => ({ ...m, stake: m.effectiveEdge >= 1 ? flatStake(bankroll) : 0, category: "sports" })),
    meta: json.meta || {}, source: json.source || "live",
  };
}

async function loadWeather() {
  const r = await fetch("/api/weather");
  if (!r.ok) throw new Error(`Weather API: ${r.status}`);
  const json = await r.json();
  return (json.data || []).map(m => ({ ...m, category: "weather", signalType: m.signalType || "VALUE" }));
}

const SIGNAL_CFG = {
  STEAM:     { bg:"#ff4444", color:"#fff", glow:"0 0 12px #ff444470", label:"⚡ STEAM" },
  CONSENSUS: { bg:"#00e676", color:"#000", glow:"0 0 10px #00e67660", label:"✓ CONSENSUS" },
  FADE:      { bg:"#ce93d8", color:"#000", label:"↩ FADE" },
  VALUE:     { bg:"#ff9100", color:"#000", label:"VALUE" },
  MARGINAL:  { bg:"#29b6f6", color:"#000", label:"MARGINAL" },
  "NO REF":  { bg:"#30363d", color:"#8b949e", label:"NO REF" },
};

const Signal = ({ s }) => {
  const c = SIGNAL_CFG[s] || SIGNAL_CFG.MARGINAL;
  return <span style={{ background:c.bg, color:c.color, boxShadow:c.glow||"none", fontSize:"9px", fontWeight:700, padding:"3px 8px", borderRadius:"3px", fontFamily:"monospace", whiteSpace:"nowrap" }}>{c.label}</span>;
};

const Badge = ({ label, color }) => (
  <span style={{ background:`${color}20`, color, border:`1px solid ${color}50`, fontSize:"9px", fontWeight:700, padding:"3px 8px", borderRadius:"3px", fontFamily:"monospace", whiteSpace:"nowrap" }}>{label}</span>
);

const ProbBar = ({ poly, sharp, sharpSource }) => {
  const srcColor = (sharpSource||"").includes("book") ? T.green : sharpSource==="kalshi" ? T.teal : sharpSource==="pinnacle" ? T.green : T.purple;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"4px", minWidth:"115px" }}>
      {[[parseFloat(poly),"POLY",T.orange],[parseFloat(sharp||poly),(sharpSource||"ref").toUpperCase().slice(0,4),srcColor]].map(([val,lbl,col]) => (
        <div key={lbl} style={{ display:"flex", alignItems:"center", gap:"5px" }}>
          <span style={{ fontSize:"8px", color:T.text3, width:"30px" }}>{lbl}</span>
          <div style={{ flex:1, height:"5px", background:T.bg0, borderRadius:"3px" }}>
            <div style={{ width:`${Math.min(100,val)}%`, height:"100%", background:col, borderRadius:"3px" }} />
          </div>
          <span style={{ fontSize:"10px", color:col, width:"34px", textAlign:"right", fontWeight:600 }}>{val.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
};

const StatCard = ({ label, value, accent, sub }) => (
  <div style={{ flex:1, minWidth:"110px", background:T.bg1, border:`1px solid ${T.border}`, borderTop:`3px solid ${accent}`, padding:"14px 16px", borderRadius:"6px" }}>
    <div style={{ fontSize:"9px", color:T.text3, letterSpacing:"0.12em", marginBottom:"6px", fontFamily:"monospace" }}>{label}</div>
    <div style={{ fontSize:"22px", fontFamily:"Georgia, serif", fontWeight:700, color:T.text0, lineHeight:1 }}>{value}</div>
    {sub && <div style={{ fontSize:"9px", color:T.text3, marginTop:"4px", fontFamily:"monospace" }}>{sub}</div>}
  </div>
);

const Tab = ({ label, active, onClick, badge }) => (
  <button onClick={onClick} style={{ background:"none", border:"none", borderBottom:`2px solid ${active?T.green:"transparent"}`, color:active?T.text0:T.text3, fontFamily:"monospace", fontSize:"10px", letterSpacing:"0.1em", padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:"7px" }}>
    {label}
    {badge !== undefined && <span style={{ background:active?`${T.green}20`:T.bg2, color:active?T.green:T.text3, fontSize:"8px", padding:"1px 6px", borderRadius:"10px", fontWeight:700 }}>{badge}</span>}
  </button>
);

const BookPill = ({ label, prob, color }) => (
  <div style={{ background:prob?T.bg2:T.bg1, border:`1px solid ${prob?T.border:T.border2}`, padding:"8px 12px", borderRadius:"5px", opacity:prob?1:0.35, minWidth:"75px" }}>
    <div style={{ fontSize:"8px", color:T.text3, marginBottom:"3px", fontFamily:"monospace" }}>{label}</div>
    <div style={{ fontSize:"15px", fontFamily:"Georgia, serif", fontWeight:700, color:prob?color:T.text3 }}>{prob?`${prob}%`:"—"}</div>
  </div>
);

const MetricBox = ({ label, value, color }) => (
  <div style={{ background:T.bg2, padding:"10px 12px", borderRadius:"5px", flex:1, minWidth:"90px" }}>
    <div style={{ fontSize:"8px", color:T.text3, marginBottom:"4px", fontFamily:"monospace", letterSpacing:"0.1em" }}>{label}</div>
    <div style={{ fontSize:"15px", fontFamily:"Georgia, serif", fontWeight:700, color:color||T.text0 }}>{value}</div>
  </div>
);

const FilterBtn = ({ label, active, onClick, color }) => (
  <button onClick={onClick} style={{ background:active?(color?`${color}20`:T.bg3):"transparent", border:`1px solid ${active?(color||T.border):T.border2}`, color:active?(color||T.text0):T.text3, fontFamily:"monospace", fontSize:"9px", padding:"5px 11px", borderRadius:"4px", letterSpacing:"0.08em", fontWeight:active?700:400 }}>{label}</button>
);

export default function PolyEdge() {
  const [markets, setMarkets]           = useState([]);
  const [positions, setPositions]       = useState([]);
  const [tab, setTab]                   = useState("scanner");
  const [bankroll, setBankroll]         = useState(200);
  const [editBankroll, setEditBankroll] = useState(false);
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL"); // ALL | SPORTS | WEATHER
  const [selected, setSelected]         = useState(null);
  const [loading, setLoading]           = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [error, setError]               = useState(null);
  const [source, setSource]             = useState("idle");
  const [lastRefresh, setLastRefresh]   = useState("");
  const [meta, setMeta]                 = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [minEdge, setMinEdge]           = useState(1);
  const [minProb, setMinProb]           = useState(5);
  const [maxProb, setMaxProb]           = useState(95);
  const [nextRefresh, setNextRefresh]   = useState(AUTO_REFRESH_MS / 1000);
  const timerRef    = useRef(null);
  const countdownRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNextRefresh(AUTO_REFRESH_MS / 1000);
    try {
      const { markets: sports, meta: mt, source: src } = await loadMarkets(bankroll);
      // Also fetch weather
      setWeatherLoading(true);
      const weather = await loadWeather().catch(() => []);
      setWeatherLoading(false);
      setMarkets([...sports, ...weather]);
      setMeta(mt);
      setSource(src);
      setLastRefresh(new Date().toLocaleTimeString());
      setPositions(prev => prev.map(p => ({ ...p, currentPrice: Math.max(0.01, Math.min(0.99, p.currentPrice + (Math.random()-0.48)*0.03)) })));
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [bankroll]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, []); // eslint-disable-line

  useEffect(() => {
    countdownRef.current = setInterval(() => setNextRefresh(p => p <= 1 ? AUTO_REFRESH_MS/1000 : p-1), 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  useEffect(() => {
    setMarkets(prev => prev.map(m => ({ ...m, stake: (m.effectiveEdge||0) >= 1 ? flatStake(bankroll) : 0 })));
  }, [bankroll]);

  function addPosition(market) {
    if (positions.find(p => p.id === market.id)) return;
    setPositions(prev => [...prev, {
      id:market.id, question:market.question, sport:market.sport||market.category,
      side:market.side, entryPrice:(market.polyProb||50)/100,
      currentPrice:(market.polyProb||50)/100,
      sharpRef:market.sharpProb||market.forecastProb||market.polyProb||50,
      stake:market.stake||flatStake(bankroll),
      entryEdge:market.effectiveEdge||market.absEdge||0,
      annEdge:market.annEdge||0, signalType:market.signalType,
      entryDate:new Date().toLocaleDateString("en-GB"),
      hoursToResolve:market.hoursToResolve||24,
      url:market.url, sharpSource:market.sharpSource||"forecast",
      category:market.category||"sports",
    }]);
    setTab("positions");
  }

  const allFiltered = markets.filter(m => {
    const prob = m.polyProb || 50;
    if (prob < minProb || prob > maxProb) return false;
    const edge = m.effectiveEdge || m.absEdge || 0;
    if (edge < minEdge) return false;
    if (categoryFilter !== "ALL" && m.category !== categoryFilter.toLowerCase()) return false;
    if (signalFilter === "ALL") return true;
    if (signalFilter === "ACTIONABLE") return ["STEAM","CONSENSUS","FADE"].includes(m.signalType);
    return m.signalType === signalFilter;
  });

  const sportsMarkets  = markets.filter(m => m.category === "sports");
  const weatherMarkets = markets.filter(m => m.category === "weather");
  const steamCount     = sportsMarkets.filter(m => m.signalType === "STEAM").length;
  const consensusCount = markets.filter(m => m.signalType === "CONSENSUS").length;
  const fadeCount      = sportsMarkets.filter(m => m.signalType === "FADE").length;
  const weatherCount   = weatherMarkets.filter(m => m.absEdge >= 5).length;
  const exitAlerts     = positions.filter(p => exitSignal(p.entryPrice, p.currentPrice, p.sharpRef, p.entryEdge).priority <= 2).length;
  const totalDeployed  = positions.reduce((s,p) => s+p.stake, 0);
  const unrealisedPnL  = positions.reduce((s,p) => s+(p.currentPrice-p.entryPrice)*p.stake*100, 0);
  const sel            = selected ? markets.find(m => m.id === selected) : null;
  const bestAnn        = markets.length > 0 ? Math.max(...markets.map(m => m.annEdge||0)) : 0;
  const srcColor       = source==="live" ? T.green : source==="cache" ? T.yellow : T.text3;
  const fmtCD          = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  return (
    <div style={{ minHeight:"100vh", background:T.bg0, color:T.text1, fontFamily:"'Inter','Segoe UI',monospace" }}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:${T.bg0}; }
        ::-webkit-scrollbar-thumb { background:${T.border}; border-radius:2px; }
        button { transition:all 0.15s; cursor:pointer; }
        button:hover { opacity:0.82; }
        a { text-decoration:none; }
        input[type=range] { accent-color:${T.green}; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", background:T.bg1, position:"sticky", top:0, zIndex:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
          <div style={{ fontFamily:"Georgia, serif", fontWeight:700, fontSize:"18px" }}>
            <span style={{ color:T.green }}>POLY</span><span style={{ color:T.text0 }}>EDGE</span>
          </div>
          <span style={{ fontSize:"9px", color:T.text3, border:`1px solid ${T.border}`, padding:"3px 8px", borderRadius:"4px", fontFamily:"monospace" }}>8 SHARP BOOKS + WEATHER</span>
          <span style={{ fontSize:"9px", color:srcColor, background:`${srcColor}15`, border:`1px solid ${srcColor}40`, padding:"3px 8px", borderRadius:"4px", fontFamily:"monospace", fontWeight:700 }}>{source.toUpperCase()}</span>
          {steamCount > 0 && <span style={{ fontSize:"9px", color:T.red, background:`${T.red}15`, border:`1px solid ${T.red}50`, padding:"3px 10px", borderRadius:"4px", fontWeight:700, fontFamily:"monospace" }}>⚡ {steamCount} STEAM</span>}
          {error && <span style={{ fontSize:"9px", color:T.orange, fontFamily:"monospace" }}>⚠ {error}</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"14px" }}>
          <span style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>↺ {fmtCD(nextRefresh)}</span>
          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
            <span style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>BANKROLL</span>
            {editBankroll ? (
              <input autoFocus type="number" defaultValue={bankroll}
                onBlur={e => { setBankroll(parseFloat(e.target.value)||bankroll); setEditBankroll(false); }}
                onKeyDown={e => e.key==="Enter" && (setBankroll(parseFloat(e.target.value)||bankroll), setEditBankroll(false))}
                style={{ background:T.bg0, border:`1px solid ${T.green}`, color:T.green, fontFamily:"monospace", fontSize:"13px", padding:"3px 8px", borderRadius:"4px", width:"80px", outline:"none" }}
              />
            ) : (
              <span onClick={() => setEditBankroll(true)} style={{ color:T.green, fontSize:"14px", fontWeight:700, cursor:"pointer", fontFamily:"monospace", borderBottom:`1px dashed ${T.green}50` }}>
                £{bankroll.toLocaleString()}
              </span>
            )}
          </div>
          <span style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>{lastRefresh}</span>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:loading?T.yellow:T.green, boxShadow:`0 0 8px ${loading?T.yellow:T.green}` }} />
          <button onClick={refresh} disabled={loading} style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1, fontFamily:"monospace", fontSize:"9px", padding:"5px 12px", borderRadius:"4px", fontWeight:600 }}>
            {loading ? "..." : "↺ REFRESH"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:"0 24px", display:"flex", background:T.bg1 }}>
        <Tab label="SCANNER"          active={tab==="scanner"}   onClick={() => setTab("scanner")}   badge={allFiltered.length} />
        <Tab label="ACTIVE POSITIONS" active={tab==="positions"} onClick={() => setTab("positions")} badge={positions.length} />
        <Tab label="EXIT ALERTS"      active={tab==="exits"}     onClick={() => setTab("exits")}     badge={exitAlerts} />
        <Tab label="RISK"             active={tab==="risk"}      onClick={() => setTab("risk")} />
      </div>

      <div style={{ padding:"20px 24px" }}>

        {/* Stat cards */}
        <div style={{ display:"flex", gap:"10px", marginBottom:"20px", flexWrap:"wrap" }}>
          <StatCard label="⚡ Steam"       value={steamCount}     accent={T.red}    sub="Pinnacle 3pp+ move" />
          <StatCard label="✓ Consensus"    value={consensusCount} accent={T.green}  sub="2+ sources agree" />
          <StatCard label="↩ Fade"         value={fadeCount}      accent={T.purple} sub="vs public money" />
          <StatCard label="🌤 Weather"      value={weatherCount}   accent={T.blue}   sub="forecast vs poly" />
          <StatCard label="Best Ann. Edge" value={bestAnn>9999?">9999%":`${bestAnn.toFixed(0)}%`} accent={T.yellow} sub="top opportunity" />
          <StatCard label="Stake / Trade"  value={`£${flatStake(bankroll).toFixed(2)}`} accent={T.text3} sub="2% flat" />
        </div>

        {/* SCANNER TAB */}
        {tab === "scanner" && (
          <>
            {/* Filter bar */}
            <div style={{ display:"flex", gap:"6px", marginBottom:"10px", flexWrap:"wrap", alignItems:"center" }}>
              {/* Category filters */}
              <div style={{ display:"flex", gap:"4px", padding:"4px", background:T.bg1, borderRadius:"5px", border:`1px solid ${T.border}` }}>
                <FilterBtn label="⚽ + 🌤 ALL"   active={categoryFilter==="ALL"}     onClick={() => setCategoryFilter("ALL")} />
                <FilterBtn label="⚽ SPORTS"      active={categoryFilter==="SPORTS"}  onClick={() => setCategoryFilter("SPORTS")}  color={T.green} />
                <FilterBtn label="🌤 WEATHER"     active={categoryFilter==="WEATHER"} onClick={() => setCategoryFilter("WEATHER")} color={T.blue} />
              </div>

              <div style={{ width:"1px", height:"24px", background:T.border }} />

              {/* Signal filters */}
              {["ALL","ACTIONABLE","STEAM","CONSENSUS","FADE","VALUE","MARGINAL"].map(f => (
                <FilterBtn key={f} label={f} active={signalFilter===f} onClick={() => setSignalFilter(f)} />
              ))}

              <button onClick={() => setShowSettings(s => !s)} style={{ background:showSettings?T.bg3:"transparent", border:`1px solid ${T.border}`, color:T.text2, fontFamily:"monospace", fontSize:"9px", padding:"5px 11px", borderRadius:"4px", marginLeft:"auto" }}>⚙ FILTERS</button>
              <span style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>{allFiltered.length} markets</span>
            </div>

            {/* Settings panel */}
            {showSettings && (
              <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderRadius:"6px", padding:"16px 20px", marginBottom:"14px", display:"flex", gap:"28px", flexWrap:"wrap", alignItems:"flex-end" }}>
                {[["Min Edge (pp)",minEdge,setMinEdge,0,15,0.5],["Min Prob (%)",minProb,setMinProb,1,49,1],["Max Prob (%)",maxProb,setMaxProb,51,99,1]].map(([label,val,setter,min,max,step]) => (
                  <div key={label} style={{ display:"flex", flexDirection:"column", gap:"7px" }}>
                    <span style={{ fontSize:"9px", color:T.text2, fontFamily:"monospace", letterSpacing:"0.1em" }}>{label}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                      <input type="range" min={min} max={max} step={step} value={val} onChange={e => setter(parseFloat(e.target.value))} style={{ width:"130px" }} />
                      <span style={{ fontSize:"14px", fontFamily:"Georgia, serif", fontWeight:700, color:T.green, minWidth:"36px" }}>{val}</span>
                    </div>
                  </div>
                ))}
                <button onClick={() => { setMinEdge(1); setMinProb(5); setMaxProb(95); }} style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.text2, fontFamily:"monospace", fontSize:"9px", padding:"5px 11px", borderRadius:"4px", alignSelf:"flex-end" }}>RESET</button>
              </div>
            )}

            {(loading || weatherLoading) && markets.length === 0 && (
              <div style={{ padding:"60px", textAlign:"center", color:T.text3, fontSize:"11px", fontFamily:"monospace" }}>Scanning sports + weather...</div>
            )}
            {allFiltered.length === 0 && !loading && !weatherLoading && (
              <div style={{ padding:"60px", textAlign:"center", color:T.text3, fontSize:"11px", fontFamily:"monospace" }}>No markets match filters.</div>
            )}

            {allFiltered.length > 0 && (
              <div style={{ border:`1px solid ${T.border}`, borderRadius:"6px", overflow:"hidden" }}>
                <div style={{ display:"grid", gridTemplateColumns:"36px 3fr 65px 55px 120px 65px 60px 60px 95px 70px 110px", padding:"9px 16px", background:T.bg1, borderBottom:`1px solid ${T.border}`, fontSize:"9px", color:T.text3, letterSpacing:"0.1em", gap:"8px", fontFamily:"monospace", fontWeight:600 }}>
                  <span>#</span><span>MARKET</span><span>TYPE</span><span>SIDE</span><span>PROBABILITY</span><span>EDGE</span><span>BOOKS</span><span>TIME</span><span>ANN.EDGE</span><span>STAKE</span><span>SIGNAL</span>
                </div>
                {allFiltered.map((m, i) => {
                  const isWeather  = m.category === "weather";
                  const isSelected = selected === m.id;
                  const alreadyIn  = positions.some(p => p.id === m.id);
                  const hrs        = parseFloat(m.hoursToResolve || 24);
                  const timeLabel  = hrs < 1 ? `${Math.round(hrs*60)}m` : hrs < 24 ? `${hrs.toFixed(1)}h` : `${Math.ceil(hrs/24)}d`;
                  const timeColor  = hrs < 3 ? T.red : hrs < 24 ? T.yellow : T.text2;
                  const edge       = m.effectiveEdge || m.absEdge || 0;
                  const edgeColor  = edge > 10 ? T.green : edge > 5 ? T.yellow : T.text2;
                  const sigCfg     = SIGNAL_CFG[m.signalType] || SIGNAL_CFG.MARGINAL;
                  const polyProb   = m.polyProb || 50;
                  const sharpProb  = m.sharpProb || m.forecastProb || polyProb;
                  const annEdge    = m.annEdge || 0;
                  return (
                    <div key={m.id} onClick={() => setSelected(isSelected ? null : m.id)} style={{
                      display:"grid", gridTemplateColumns:"36px 3fr 65px 55px 120px 65px 60px 60px 95px 70px 110px",
                      padding:"12px 16px", borderBottom:`1px solid ${T.border2}`,
                      background:isSelected?"#1f2937":alreadyIn?"#162416":i%2===0?T.bg2:T.bg0,
                      cursor:"pointer", gap:"8px", alignItems:"center",
                      borderLeft:`3px solid ${isWeather ? T.blue : sigCfg.bg}`,
                    }}>
                      <span style={{ fontFamily:"Georgia, serif", fontWeight:700, fontSize:"14px", color:i<3?T.green:T.text3 }}>#{i+1}</span>
                      <div>
                        <div style={{ fontSize:"11px", color:T.text0, lineHeight:1.4, marginBottom:"2px", fontWeight:500, display:"flex", alignItems:"center", gap:"6px" }}>
                          {(m.question||"").length>58?(m.question||"").slice(0,58)+"…":(m.question||"")}
                          {m.steamDetected && <span style={{ fontSize:"9px", color:T.red, fontWeight:700, background:`${T.red}15`, padding:"1px 4px", borderRadius:"3px" }}>⚡{m.pinnacleMove>0?"+":""}{m.pinnacleMove}pp</span>}
                          {m.hasInjuryFlag && <span style={{ fontSize:"9px" }}>🚑</span>}
                        </div>
                        <div style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>
                        {isWeather
  ? m.forecastMethod === "observed"
    ? `📍 Observed: ${m.observedMax}°C @ ${m.localHour}:00 · exceed: ${m.exceedProb}%`
    : `📡 Forecast: ${m.consensusTempMax}°C · ${(m.forecastSources||[]).join(", ")}`
  : `${m.league||m.sport?.toUpperCase()} · ${m.sharpSource}`}
                          {m.fadeSignal && <span style={{ color:T.purple, marginLeft:"6px" }}>↩ {m.publicHandle}% public</span>}
                        </div>
                      </div>
                      <span style={{ fontSize:"9px", color:isWeather?T.blue:T.text2, background:T.bg3, padding:"3px 6px", borderRadius:"3px", fontFamily:"monospace", fontWeight:600, textAlign:"center" }}>
                        {isWeather ? "🌤 WX" : (m.sport||"").toUpperCase()}
                      </span>
                      <span style={{ fontSize:"11px", fontWeight:700, color:m.side==="YES"?T.green:T.orange, background:m.side==="YES"?`${T.green}15`:`${T.orange}15`, padding:"3px 8px", borderRadius:"3px", textAlign:"center", fontFamily:"monospace" }}>{m.side}</span>
                      <ProbBar poly={polyProb} sharp={sharpProb} sharpSource={isWeather?"forecast":(m.sharpSource||"ref")} />
                      <div>
                        <div style={{ fontSize:"13px", fontWeight:700, fontFamily:"Georgia, serif", color:edgeColor }}>{edge.toFixed(1)}%</div>
                        <div style={{ fontSize:"8px", color:T.text3, fontFamily:"monospace" }}>fee-adj</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:"2px" }}>
                        {isWeather ? (
                          <span style={{ fontSize:"12px", color:T.blue, fontFamily:"Georgia, serif", fontWeight:700 }}>{(m.sourceCount||0)}/4</span>
                        ) : (
                          <>
                            <span style={{ fontSize:"12px", color:(m.consensusCount||0)>=3?T.green:(m.consensusCount||0)>=2?T.yellow:T.text2, fontFamily:"Georgia, serif", fontWeight:700 }}>{m.consensusCount||0}/8</span>
                            <span style={{ fontSize:"8px", color:T.text3, fontFamily:"monospace" }}>{(m.consensusBooks||[]).slice(0,2).map(b=>b.slice(0,3).toUpperCase()).join(" ")||"—"}</span>
                          </>
                        )}
                      </div>
                      <span style={{ fontSize:"12px", fontWeight:700, color:timeColor, fontFamily:"Georgia, serif" }}>{timeLabel}</span>
                      <div>
                        <div style={{ fontSize:"13px", fontWeight:700, fontFamily:"Georgia, serif", color:annEdge>500?T.red:annEdge>100?T.green:T.yellow }}>
                          {annEdge>9999?">9999%":`${annEdge.toFixed(0)}%`}
                        </div>
                        <div style={{ fontSize:"8px", color:T.text3, fontFamily:"monospace" }}>ann.</div>
                      </div>
                      <div>
                        <div style={{ fontSize:"12px", fontFamily:"Georgia, serif", fontWeight:700, color:T.text0 }}>£{(m.stake||flatStake(bankroll)).toFixed(2)}</div>
                        <div style={{ fontSize:"8px", color:T.text3, fontFamily:"monospace" }}>2% flat</div>
                      </div>
                      <Signal s={m.signalType} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Detail panel */}
            {sel && (() => {
              const isWeather = sel.category === "weather";
              const edge = sel.effectiveEdge || sel.absEdge || 0;
              const polyProb = sel.polyProb || 50;
              const sharpProb = sel.sharpProb || sel.forecastProb || polyProb;
              const annEdge = sel.annEdge || 0;
              return (
                <div style={{ marginTop:"12px", background:T.bg1, border:`1px solid ${T.border}`, borderTop:`3px solid ${isWeather?T.blue:(SIGNAL_CFG[sel.signalType]||SIGNAL_CFG.MARGINAL).bg}`, borderRadius:"6px", padding:"20px 22px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"16px", gap:"16px", flexWrap:"wrap" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"Georgia, serif", fontWeight:700, fontSize:"18px", color:T.text0, marginBottom:"5px" }}>{sel.question}</div>
                      <div style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>
                        {isWeather
                          ? `🌤 Weather · ${sel.city} · ${sel.date} · ${sel.hoursToResolve}h · ${sel.sourceCount} forecast source${sel.sourceCount>1?"s":""} · consensus: ${sel.consensusTempMax}°C`
                          : `${sel.sport?.toUpperCase()} · ${sel.hoursToResolve}h · ${sel.sharpSource} · ${sel.consensusCount}/8 books${sel.league?` · ${sel.league}`:""}`
                        }
                      </div>
                      {sel.hasInjuryFlag && <div style={{ fontSize:"10px", color:T.yellow, marginTop:"5px" }}>🚑 {sel.injuredPlayers?.map(p=>`${p.player} (${p.status})`).join(", ")}</div>}
                    </div>
                    <div style={{ display:"flex", gap:"8px", alignItems:"flex-start" }}>
                      <Badge label={`BET ${sel.side}`} color={sel.side==="YES"?T.green:T.orange} />
                      <Signal s={sel.signalType} />
                    </div>
                  </div>

                  <div style={{ display:"flex", gap:"8px", marginBottom:"14px", flexWrap:"wrap" }}>
                    <MetricBox label="Poly Price"   value={`${polyProb}%`}  color={T.orange} />
                    <MetricBox label={isWeather?"Forecast":"Consensus"} value={`${sharpProb}%`} color={T.green} />
                    <MetricBox label="Fee-Adj Edge" value={`${sel.adjEdge>=0?"+":""}${sel.adjEdge||edge.toFixed(1)}%`} color={(sel.adjEdge||edge)>=0?T.green:T.red} />
                    <MetricBox label="Ann. Edge"    value={annEdge>9999?">9999%":`${annEdge.toFixed(0)}%`} color={T.red} />
                    <MetricBox label={isWeather?"Sources":"Books"} value={isWeather?`${sel.sourceCount}/4`:`${sel.consensusCount}/8`} color={(isWeather?sel.sourceCount>=2:sel.consensusCount>=3)?T.green:T.yellow} />
                    <MetricBox label="Time"         value={`${sel.hoursToResolve}h`} color={T.yellow} />
                    <MetricBox label="Stake"        value={`£${(sel.stake||flatStake(bankroll)).toFixed(2)}`} color={T.text0} />
                  </div>

                  {isWeather ? (
                    <div style={{ display:"flex", gap:"8px", marginBottom:"14px", flexWrap:"wrap" }}>
                      {(sel.forecastSources||[]).map(s => (
                        <div key={s} style={{ background:T.bg2, border:`1px solid ${T.border}`, padding:"8px 12px", borderRadius:"5px", minWidth:"100px" }}>
                          <div style={{ fontSize:"8px", color:T.text3, marginBottom:"3px", fontFamily:"monospace" }}>{s.toUpperCase()}</div>
                          <div style={{ fontSize:"13px", fontFamily:"Georgia, serif", fontWeight:700, color:T.blue }}>{sel.consensusTempMax}°C</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display:"flex", gap:"8px", marginBottom:"14px", flexWrap:"wrap" }}>
                      {[["PINNACLE",sel.pinnacleProb,T.green],["KALSHI",sel.kalshiProb,T.teal],["NOVIG",sel.novigProb,T.purple],["CIRCA",sel.circaProb,T.yellow],["WESTGATE",sel.westgateProb,T.orange],["WYNN",sel.wynnProb,T.red],["S.POINT",sel.southPointProb,T.blue],["BETONLINE",sel.betonlineProb,T.text2]].map(([book,prob,color]) => (
                        <BookPill key={book} label={book} prob={prob} color={color} />
                      ))}
                      {sel.steamDetected && (
                        <div style={{ background:`${T.red}15`, border:`1px solid ${T.red}40`, padding:"8px 12px", borderRadius:"5px", minWidth:"80px" }}>
                          <div style={{ fontSize:"8px", color:T.red, marginBottom:"3px", fontFamily:"monospace" }}>STEAM MOVE</div>
                          <div style={{ fontSize:"15px", fontFamily:"Georgia, serif", fontWeight:700, color:T.red }}>{sel.pinnacleMove>0?"+":""}{sel.pinnacleMove}pp</div>
                        </div>
                      )}
                      {sel.fadeSignal && (
                        <div style={{ background:`${T.purple}15`, border:`1px solid ${T.purple}40`, padding:"8px 12px", borderRadius:"5px", minWidth:"80px" }}>
                          <div style={{ fontSize:"8px", color:T.purple, marginBottom:"3px", fontFamily:"monospace" }}>PUBLIC HANDLE</div>
                          <div style={{ fontSize:"15px", fontFamily:"Georgia, serif", fontWeight:700, color:T.purple }}>{sel.publicHandle}%</div>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ background:T.bg2, borderLeft:`3px solid ${sel.side==="YES"?T.green:T.orange}`, padding:"12px 16px", fontSize:"10px", color:T.text2, lineHeight:2, marginBottom:"14px", borderRadius:"0 5px 5px 0" }}>
                    <strong style={{ color:T.text0 }}>ACTION: </strong>
                    {sel.side==="YES"
                      ? <>Buy <strong style={{ color:T.green }}>YES</strong> at <strong style={{ color:T.orange }}>{polyProb}¢</strong>. {isWeather?`${sel.sourceCount} forecasts`:`${sel.consensusCount} books`} at <strong style={{ color:T.green }}>{sharpProb}%</strong>. Fee-adj edge <strong style={{ color:T.green }}>{sel.adjEdge>=0?"+":""}{sel.adjEdge||edge.toFixed(1)}%</strong> · Ann. <strong style={{ color:T.yellow }}>{annEdge>9999?">9999%":`${annEdge.toFixed(0)}%`}</strong>. Stake <strong style={{ color:T.green }}>£{(sel.stake||flatStake(bankroll)).toFixed(2)}</strong>.</>
                      : <>Buy <strong style={{ color:T.orange }}>NO</strong> at <strong style={{ color:T.orange }}>{(100-polyProb).toFixed(0)}¢</strong>. {isWeather?`${sel.sourceCount} forecasts`:`${sel.consensusCount} books`} say YES only <strong style={{ color:T.green }}>{sharpProb}%</strong>. Fee-adj edge <strong style={{ color:T.green }}>{sel.adjEdge>=0?"+":""}{sel.adjEdge||edge.toFixed(1)}%</strong> · Ann. <strong style={{ color:T.yellow }}>{annEdge>9999?">9999%":`${annEdge.toFixed(0)}%`}</strong>. Stake <strong style={{ color:T.green }}>£{(sel.stake||flatStake(bankroll)).toFixed(2)}</strong>.</>
                    }
                  </div>

                  <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
                    <button onClick={() => { addPosition(sel); setSelected(null); }}
                      disabled={positions.some(p=>p.id===sel.id)}
                      style={{ background:positions.some(p=>p.id===sel.id)?T.bg2:`${T.green}20`, border:`1px solid ${positions.some(p=>p.id===sel.id)?T.border:T.green}`, color:positions.some(p=>p.id===sel.id)?T.text3:T.green, fontFamily:"monospace", fontSize:"9px", padding:"8px 18px", borderRadius:"4px", fontWeight:700 }}>
                      {positions.some(p=>p.id===sel.id)?"✓ IN POSITIONS":"ENTER POSITION →"}
                    </button>
                    <a href={sel.url} target="_blank" rel="noopener noreferrer"
                      style={{ background:`${T.orange}15`, border:`1px solid ${T.orange}50`, color:T.orange, fontFamily:"monospace", fontSize:"9px", padding:"8px 18px", borderRadius:"4px", display:"inline-flex", alignItems:"center", fontWeight:700 }}>
                      OPEN POLYMARKET ↗
                    </a>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* POSITIONS TAB */}
        {tab === "positions" && (
          <>
            {positions.length === 0 && <div style={{ padding:"60px", textAlign:"center", color:T.text3, fontSize:"11px", fontFamily:"monospace" }}>No positions yet.</div>}
            {positions.length > 0 && (
              <div style={{ border:`1px solid ${T.border}`, borderRadius:"6px", overflow:"hidden" }}>
                <div style={{ display:"grid", gridTemplateColumns:"3fr 55px 75px 75px 75px 75px 75px 95px 120px", padding:"9px 16px", background:T.bg1, borderBottom:`1px solid ${T.border}`, fontSize:"9px", color:T.text3, letterSpacing:"0.1em", gap:"8px", fontFamily:"monospace", fontWeight:600 }}>
                  <span>MARKET</span><span>SIDE</span><span>ENTRY</span><span>CURRENT</span><span>REF</span><span>MOVE</span><span>STAKE</span><span>UNREAL P&L</span><span>STATUS</span>
                </div>
                {positions.map((p, i) => {
                  const move   = ((p.currentPrice-p.entryPrice)/p.entryPrice*100);
                  const unreal = (p.currentPrice-p.entryPrice)*p.stake*100;
                  const exit   = exitSignal(p.entryPrice, p.currentPrice, p.sharpRef, p.entryEdge);
                  return (
                    <div key={p.id} style={{ display:"grid", gridTemplateColumns:"3fr 55px 75px 75px 75px 75px 75px 95px 120px", padding:"14px 16px", borderBottom:`1px solid ${T.border2}`, background:i%2===0?T.bg2:T.bg0, gap:"8px", alignItems:"center", borderLeft:`3px solid ${exit.color}` }}>
                      <div>
                        <div style={{ fontSize:"11px", color:T.text0, marginBottom:"2px", fontWeight:500 }}>{(p.question||"").length>60?(p.question||"").slice(0,60)+"…":(p.question||"")}</div>
                        <div style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>{p.category==="weather"?"🌤 Weather":p.sport?.toUpperCase()} · {p.entryDate}</div>
                      </div>
                      <span style={{ fontSize:"10px", fontWeight:700, color:p.side==="YES"?T.green:T.orange, fontFamily:"monospace" }}>{p.side}</span>
                      <span style={{ fontSize:"12px", color:T.text2, fontFamily:"Georgia, serif" }}>{(p.entryPrice*100).toFixed(0)}¢</span>
                      <span style={{ fontSize:"13px", fontWeight:700, color:p.currentPrice>p.entryPrice?T.green:T.red, fontFamily:"Georgia, serif" }}>{(p.currentPrice*100).toFixed(0)}¢</span>
                      <span style={{ fontSize:"11px", color:T.green, fontFamily:"Georgia, serif" }}>{p.sharpRef?.toFixed?.(0)}¢</span>
                      <span style={{ fontSize:"12px", fontWeight:700, color:move>=0?T.green:T.red, fontFamily:"Georgia, serif" }}>{move>=0?"+":""}{move.toFixed(1)}%</span>
                      <span style={{ fontSize:"11px", color:T.text2, fontFamily:"Georgia, serif" }}>£{p.stake.toFixed(2)}</span>
                      <span style={{ fontSize:"13px", fontWeight:700, fontFamily:"Georgia, serif", color:unreal>=0?T.green:T.red }}>{unreal>=0?"+":""}£{unreal.toFixed(2)}</span>
                      <div style={{ display:"flex", flexDirection:"column", gap:"3px" }}>
                        <Badge label={exit.action} color={exit.color} />
                        <span style={{ fontSize:"8px", color:T.text3, fontFamily:"monospace" }}>{exit.reason}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* EXITS TAB */}
        {tab === "exits" && (
          <>
            <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.red}`, padding:"10px 16px", marginBottom:"16px", fontSize:"10px", color:T.text2, lineHeight:1.8, borderRadius:"0 5px 5px 0" }}>
              <strong style={{ color:T.text0 }}>EXIT LOGIC: </strong>EXIT NOW = edge flipped · TAKE PROFIT = +40% move · REVIEW = edge halved · HOLD = still +EV
            </div>
            {positions.length === 0 && <div style={{ padding:"60px", textAlign:"center", color:T.text3, fontSize:"11px", fontFamily:"monospace" }}>No positions to monitor.</div>}
            {positions.map(p => {
              const exit   = exitSignal(p.entryPrice, p.currentPrice, p.sharpRef, p.entryEdge);
              const unreal = (p.currentPrice-p.entryPrice)*p.stake*100;
              return (
                <div key={p.id} style={{ background:T.bg1, border:`1px solid ${T.border}`, borderLeft:`4px solid ${exit.color}`, borderRadius:"6px", padding:"18px 20px", marginBottom:"10px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"14px", gap:"14px" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:"12px", color:T.text0, marginBottom:"3px", fontWeight:500 }}>{p.question}</div>
                      <div style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace" }}>{p.hoursToResolve}h remaining · entered {p.side} @ {(p.entryPrice*100).toFixed(0)}¢</div>
                    </div>
                    <Badge label={exit.action} color={exit.color} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px", marginBottom:"12px" }}>
                    {[["Entry",`${(p.entryPrice*100).toFixed(0)}¢`,T.text2],["Current",`${(p.currentPrice*100).toFixed(0)}¢`,p.currentPrice>p.entryPrice?T.green:T.red],["Sharp Ref",`${p.sharpRef?.toFixed?.(0)}¢`,T.green],["P&L",`${unreal>=0?"+":""}£${unreal.toFixed(2)}`,unreal>=0?T.green:T.red]].map(([label,val,color]) => (
                      <MetricBox key={label} label={label} value={val} color={color} />
                    ))}
                  </div>
                  <div style={{ fontSize:"10px", color:exit.priority<=2?T.text1:T.text3, background:T.bg2, padding:"10px 14px", borderRadius:"4px", marginBottom:exit.priority<=2?"12px":"0" }}>
                    <strong style={{ color:exit.color }}>REASON: </strong>{exit.reason}
                  </div>
                  {exit.priority <= 2 && (
                    <button onClick={() => setPositions(prev=>prev.filter(pos=>pos.id!==p.id))}
                      style={{ background:`${exit.color}15`, border:`1px solid ${exit.color}50`, color:exit.color, fontFamily:"monospace", fontSize:"9px", padding:"7px 16px", borderRadius:"4px", fontWeight:700 }}>
                      MARK AS EXITED →
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* RISK TAB */}
        {tab === "risk" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px" }}>
            <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderTop:`3px solid ${T.yellow}`, padding:"20px", borderRadius:"6px" }}>
              <div style={{ fontSize:"10px", color:T.text3, letterSpacing:"0.12em", marginBottom:"14px", fontFamily:"monospace", fontWeight:700 }}>STAKING SCHEDULE</div>
              {[200,500,1000,2500,5000].map(br => (
                <div key={br} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border2}`, fontSize:"10px" }}>
                  <span style={{ color:T.text2 }}>£{br.toLocaleString()} bankroll</span>
                  <span style={{ color:T.yellow, fontWeight:700 }}>→ £{(br*0.02).toFixed(2)} / trade</span>
                </div>
              ))}
            </div>
            <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderTop:`3px solid ${T.green}`, padding:"20px", borderRadius:"6px" }}>
              <div style={{ fontSize:"10px", color:T.text3, letterSpacing:"0.12em", marginBottom:"14px", fontFamily:"monospace", fontWeight:700 }}>SIGNAL GUIDE</div>
              {[
                ["⚡ STEAM",    T.red,    "Pinnacle moved 3pp+ in 20min, Poly lagging"],
                ["✓ CONSENSUS", T.green,  "2+ of 8 sharp books agree vs Poly"],
                ["↩ FADE",      T.purple, "Sharp books vs heavy public money (65%+)"],
                ["🌤 WEATHER",  T.blue,   "Forecast consensus vs Polymarket price"],
                ["VALUE",       T.orange, "1 sharp ref, fee-adj edge ≥2pp"],
                ["MARGINAL",    T.teal,   "Weak edge ≥1pp — low confidence"],
              ].map(([sig,color,desc]) => (
                <div key={sig} style={{ padding:"8px 0", borderBottom:`1px solid ${T.border2}` }}>
                  <div style={{ fontSize:"10px", fontWeight:700, color, marginBottom:"2px", fontFamily:"monospace" }}>{sig}</div>
                  <div style={{ fontSize:"9px", color:T.text3 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderTop:`3px solid ${T.blue}`, padding:"20px", borderRadius:"6px", gridColumn:"1/-1" }}>
              <div style={{ fontSize:"10px", color:T.text3, letterSpacing:"0.12em", marginBottom:"12px", fontFamily:"monospace", fontWeight:700 }}>PORTFOLIO EXPOSURE</div>
              <div style={{ display:"flex", gap:"12px", alignItems:"center", marginBottom:"10px" }}>
                <div style={{ flex:1, height:"10px", background:T.bg0, borderRadius:"5px", overflow:"hidden" }}>
                  <div style={{ width:`${Math.min(100,totalDeployed/bankroll*100)}%`, height:"100%", background:totalDeployed/bankroll>0.25?T.red:T.green, borderRadius:"5px" }} />
                </div>
                <span style={{ fontSize:"14px", color:totalDeployed/bankroll>0.25?T.red:T.green, fontFamily:"Georgia, serif", fontWeight:700, minWidth:"50px" }}>{(totalDeployed/bankroll*100).toFixed(1)}%</span>
              </div>
              <div style={{ fontSize:"10px", color:T.text3, marginBottom:"14px" }}>£{totalDeployed.toFixed(2)} of £{bankroll.toLocaleString()} · Max recommended 20%</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px" }}>
                {[["Poly Fee","2% on wins",T.orange],["Min Vol Sports","$5k/24h",T.green],["Steam Threshold","3pp/20min",T.red],["Weather Sources","4 APIs",T.blue]].map(([label,val,color]) => (
                  <div key={label} style={{ background:T.bg2, padding:"10px 12px", borderRadius:"4px" }}>
                    <div style={{ fontSize:"9px", color:T.text3, fontFamily:"monospace", marginBottom:"3px" }}>{label}</div>
                    <div style={{ fontSize:"12px", color, fontWeight:700, fontFamily:"monospace" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
