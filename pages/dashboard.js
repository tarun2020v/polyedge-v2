import { useState, useEffect } from "react";
import Head from "next/head";

const fmt = (n, d=1) => n == null ? "—" : parseFloat(n).toFixed(d);
const pct = (n) => n == null ? "—" : `${parseFloat(n).toFixed(1)}%`;
const gbp = (n) => n == null ? "—" : `£${parseFloat(n).toFixed(2)}`;

function EdgeBar({ edge, max = 50 }) {
  const w = Math.min(100, (Math.abs(edge) / max) * 100);
  const color = edge >= 0 ? "#00ff87" : "#ff4d4d";
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 2, height: 4, width: "100%", marginTop: 4 }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
    </div>
  );
}

function SignalCard({ s }) {
  const isBuy = s.side === "YES";
  return (
    <div style={{
      background: "#111",
      border: `1px solid ${isBuy ? "#00ff8722" : "#ff4d4d22"}`,
      borderLeft: `3px solid ${isBuy ? "#00ff87" : "#ff4d4d"}`,
      borderRadius: 6,
      padding: "12px 14px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, marginRight: 8 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
            {s.question?.replace(/.*?: /, "")}
          </div>
          <div style={{ color: "#666", fontSize: 11, marginTop: 3 }}>
            {s.city} · Hour {s.localHour} · {fmt(s.hoursToResolve)}h left
          </div>
        </div>
        <div style={{
          background: isBuy ? "#00ff8722" : "#ff4d4d22",
          color: isBuy ? "#00ff87" : "#ff4d4d",
          padding: "4px 10px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}>
          {s.side}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Market</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{pct(s.polyProb)}</div>
        </div>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Model</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{pct(s.forecastProb)}</div>
        </div>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Edge</div>
          <div style={{ color: isBuy ? "#00ff87" : "#ff4d4d", fontSize: 16, fontWeight: 700 }}>
            {s.adjEdge >= 0 ? "+" : ""}{pct(s.adjEdge)}
          </div>
        </div>
      </div>

      <EdgeBar edge={s.adjEdge} />

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ color: "#555", fontSize: 11 }}>
          Obs: {s.observedMaxC != null ? `${s.observedMaxC}°C` : s.observedMaxF != null ? `${s.observedMaxF}°F` : "—"}
          {" · "}{s.station}
        </div>
        <div style={{ color: "#555", fontSize: 11 }}>
          Vol: ${(s.volume24hr/1000).toFixed(0)}k
        </div>
      </div>
    </div>
  );
}

function PositionCard({ p }) {
  const isWin  = p.pnl > 0;
  const closed = p.status === "closed";
  return (
    <div style={{
      background: "#111",
      border: "1px solid #222",
      borderLeft: `3px solid ${closed ? (isWin ? "#00ff87" : "#ff4d4d") : "#f5a623"}`,
      borderRadius: 6,
      padding: "12px 14px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, flex: 1, marginRight: 8 }}>
          {p.question?.replace(/.*?: /, "").slice(0, 60)}
        </div>
        <div style={{
          color: closed ? (isWin ? "#00ff87" : "#ff4d4d") : "#f5a623",
          fontSize: 12,
          fontWeight: 700,
        }}>
          {closed ? (isWin ? "WIN" : "LOSS") : "OPEN"}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Side</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{p.side}</div>
        </div>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Stake</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{gbp(p.stake)}</div>
        </div>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>Entry</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{fmt(p.entryPrice * 100)}¢</div>
        </div>
        <div>
          <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>P&L</div>
          <div style={{ color: p.pnl > 0 ? "#00ff87" : p.pnl < 0 ? "#ff4d4d" : "#666", fontSize: 14, fontWeight: 600 }}>
            {p.pnl != null ? gbp(p.pnl) : "—"}
          </div>
        </div>
      </div>
      {p.exitReason && (
        <div style={{ color: "#555", fontSize: 11, marginTop: 6 }}>Exit: {p.exitReason}</div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [signals,   setSignals]   = useState([]);
  const [open,      setOpen]      = useState([]);
  const [closed,    setClosed]    = useState([]);
  const [meta,      setMeta]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab,       setTab]       = useState("signals");

  async function refresh() {
    setLoading(true);
    try {
      const [wx, pos] = await Promise.all([
        fetch("/api/weather").then(r => r.json()),
        fetch("/api/positions").then(r => r.json()).catch(() => ({ open: [], closed: [] })),
      ]);
      setSignals(wx.data || []);
      setMeta(wx.meta || null);
      setOpen(pos.open || []);
      setClosed(pos.closed || []);
      setLastUpdate(new Date());
    } catch(e) {
      console.error(e);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2 * 60 * 1000); // refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayClosed = closed.filter(p => p.closedAt?.slice(0, 10) === todayStr);
  const totalPnl    = todayClosed.reduce((s, p) => s + (p.pnl || 0), 0);
  const wins        = todayClosed.filter(p => p.pnl > 0).length;
  const losses      = todayClosed.filter(p => p.pnl < 0).length;

  const tabs = ["signals", "open", "closed"];

  return (
    <>
      <Head>
        <title>PolyEdge</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#000000" />
      </Head>

      <div style={{
        background: "#000",
        minHeight: "100vh",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        color: "#fff",
        maxWidth: 480,
        margin: "0 auto",
        paddingBottom: 80,
      }}>

        {/* Header */}
        <div style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid #1a1a1a",
          position: "sticky",
          top: 0,
          background: "#000",
          zIndex: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
                POLY<span style={{ color: "#00ff87" }}>EDGE</span>
              </div>
              <div style={{ color: "#444", fontSize: 11, marginTop: 2 }}>
                {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : "Loading..."}
              </div>
            </div>
            <button
              onClick={refresh}
              style={{
                background: "#111",
                border: "1px solid #222",
                color: "#fff",
                padding: "6px 12px",
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {loading ? "⟳" : "Refresh"}
            </button>
          </div>

          {/* Stats bar */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 8,
            marginTop: 12,
          }}>
            {[
              { label: "Signals", value: signals.length },
              { label: "Open", value: open.length },
              { label: "W/L", value: `${wins}/${losses}` },
              { label: "P&L", value: gbp(totalPnl), color: totalPnl > 0 ? "#00ff87" : totalPnl < 0 ? "#ff4d4d" : "#666" },
            ].map(s => (
              <div key={s.label} style={{ background: "#0a0a0a", padding: "8px 10px", borderRadius: 4 }}>
                <div style={{ color: "#444", fontSize: 10, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
                <div style={{ color: s.color || "#fff", fontSize: 15, fontWeight: 700, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", padding: "0 16px" }}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: "none",
                border: "none",
                color: tab === t ? "#00ff87" : "#444",
                padding: "12px 16px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 1,
                borderBottom: tab === t ? "2px solid #00ff87" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {t} {t === "signals" ? `(${signals.length})` : t === "open" ? `(${open.length})` : `(${closed.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "12px 16px" }}>

          {tab === "signals" && (
            <>
              {signals.length === 0 ? (
                <div style={{ color: "#333", textAlign: "center", padding: "40px 0", fontSize: 13 }}>
                  No signals · Markets open after 1pm local time
                </div>
              ) : (
                signals.map(s => <SignalCard key={s.id} s={s} />)
              )}
            </>
          )}

          {tab === "open" && (
            <>
              {open.length === 0 ? (
                <div style={{ color: "#333", textAlign: "center", padding: "40px 0", fontSize: 13 }}>
                  No open positions
                </div>
              ) : (
                open.map((p, i) => <PositionCard key={i} p={p} />)
              )}
            </>
          )}

          {tab === "closed" && (
            <>
              {closed.length === 0 ? (
                <div style={{ color: "#333", textAlign: "center", padding: "40px 0", fontSize: 13 }}>
                  No closed positions yet
                </div>
              ) : (
                [...closed].reverse().map((p, i) => <PositionCard key={i} p={p} />)
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
