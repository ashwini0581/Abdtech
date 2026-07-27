import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine
} from "recharts";
import {
  LayoutDashboard, Bot, Wallet, FlaskConical, ScanSearch, BookOpen,
  ShieldAlert, Settings as SettingsIcon, Mic, MicOff, Send, Power,
  TrendingUp, TrendingDown, AlertTriangle, X, Plus, Layers
} from "lucide-react";
import TechnicalAnalysis from "./TechnicalAnalysis.jsx";

/* ---------------------------------------------------------
   Design tokens
   bg      #0A0E14  panel #0F1620  panel-2 #131B26
   border  #1C2733
   text hi #E8EEF4  text lo #7E8CA0
   bull    #2FD98A  bear #FF5D6C  amber (AI) #F2B441  blue (accent) #4C8DFF
--------------------------------------------------------- */

const CRYPTO_IDS = ["bitcoin", "ethereum", "solana", "ripple", "dogecoin", "cardano", "binancecoin", "chainlink"];
const CRYPTO_LABELS = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", ripple: "XRP", dogecoin: "DOGE", cardano: "ADA", binancecoin: "BNB", chainlink: "LINK" };

const DEFAULT_WATCH_SYMBOLS = {
  indices: ["SPX", "IXIC", "DJI", "NIFTY 50 (NSE)", "SENSEX (BSE)", "FTSE", "NIKKEI"],
  forex: ["EUR/USD", "GBP/USD", "USD/JPY", "USD/INR"],
  stocks_us: ["AAPL", "MSFT", "NVDA", "TSLA"],
  stocks_in: ["RELIANCE.NSE", "TCS.NSE", "HDFCBANK.NSE"],
  commodities: ["XAU/USD (Gold)", "XAG/USD (Silver)", "WTI/USD (Crude Oil)", "BRENT/USD (Brent Crude)", "NATGAS/USD (Nat Gas)", "COPPER/USD (Copper)", "XPT/USD (Platinum)", "XPD/USD (Palladium)"],
};

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function uid() { return Math.random().toString(36).slice(2, 10); }

/* ---------------------------------------------------------
   Synthetic OHLCV generator (for scanner + backtester)
   Clearly labeled to the user as simulated, not real history.
--------------------------------------------------------- */
function genSeries(n = 220, start = 100, vol = 0.018, seedTrend = 0.0006) {
  let price = start;
  const out = [];
  for (let i = 0; i < n; i++) {
    const drift = seedTrend + (Math.sin(i / 18) * 0.002);
    const change = drift + (Math.random() - 0.5) * vol;
    const open = price;
    const close = open * (1 + change);
    const wick = Math.abs(change) * (0.6 + Math.random() * 1.2);
    const high = Math.max(open, close) * (1 + wick * Math.random());
    const low = Math.min(open, close) * (1 - wick * Math.random());
    const baseVol = 1000 + Math.random() * 500;
    const spike = Math.random() > 0.92 ? baseVol * (2 + Math.random() * 3) : 0;
    out.push({ i, open, high, low, close, volume: Math.round(baseVol + spike) });
    price = close;
  }
  return out;
}

function sma(arr, period, idx) {
  if (idx < period - 1) return null;
  let s = 0;
  for (let k = idx - period + 1; k <= idx; k++) s += arr[k].close;
  return s / period;
}

/* ---------------------------------------------------------
   Real historical OHLCV via Twelve Data (used when a key is set)
--------------------------------------------------------- */
async function fetchRealSeries(symbol, tdKey, interval = "1day", outputsize = 300) {
  const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${tdKey}`);
  const data = await res.json();
  if (data.status === "error" || !data.values) throw new Error(data.message || "no data returned");
  const values = [...data.values].reverse();
  return values.map((v, i) => ({
    i,
    datetime: v.datetime,
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
    volume: Number(v.volume) || 0,
  }));
}


/* ---------------------------------------------------------
   Root App
--------------------------------------------------------- */
export default function TradingApp() {
  const [tab, setTab] = useState("dashboard");

  // Account / paper trading state
  const [account, setAccount] = useState({
    balance: 100000,
    startingBalance: 100000,
    dailyStartBalance: 100000,
    riskPerTradePct: 1,
    dailyLossLimitPct: 3,
  });
  const [positions, setPositions] = useState([]);
  const [closedTrades, setClosedTrades] = useState([]);
  const [killSwitch, setKillSwitch] = useState({ active: false, reason: "" });

  // Market data
  const [cryptoPrices, setCryptoPrices] = useState({});
  const [cryptoError, setCryptoError] = useState(null);
  const [tdKey, setTdKey] = useState("");
  const [tdPrices, setTdPrices] = useState({});
  const [tdError, setTdError] = useState(null);
  const [tdSymbolErrors, setTdSymbolErrors] = useState({});
  const [finnhubKey, setFinnhubKey] = useState("");

  // Forex — genuinely free, no key, no signup (Frankfurter / ECB daily reference rates)
  const [forexRates, setForexRates] = useState({});
  const [forexError, setForexError] = useState(null);
  const [watchSymbols, setWatchSymbols] = useState(
    [...DEFAULT_WATCH_SYMBOLS.indices, ...DEFAULT_WATCH_SYMBOLS.commodities, ...DEFAULT_WATCH_SYMBOLS.stocks_us, ...DEFAULT_WATCH_SYMBOLS.stocks_in]
  );

  // Live crypto polling
  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const ids = CRYPTO_IDS.join(",");
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
        if (!res.ok) throw new Error("status " + res.status);
        const data = await res.json();
        if (!stop) { setCryptoPrices(data); setCryptoError(null); }
      } catch (e) {
        if (!stop) setCryptoError("Live crypto feed unavailable right now (" + e.message + "). Retrying…");
      }
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Forex polling — Frankfurter (ECB), genuinely free, no key, no signup.
  // These are daily reference rates (updated once per weekday ~16:00 CET), not
  // tick-by-tick intraday quotes, so polling faster than every few minutes is pointless.
  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const [eur, gbp, usd] = await Promise.all([
          fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=USD").then(r => r.json()),
          fetch("https://api.frankfurter.dev/v1/latest?from=GBP&to=USD").then(r => r.json()),
          fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=JPY,INR").then(r => r.json()),
        ]);
        if (stop) return;
        setForexRates({
          "EUR/USD": { price: eur?.rates?.USD, date: eur?.date },
          "GBP/USD": { price: gbp?.rates?.USD, date: gbp?.date },
          "USD/JPY": { price: usd?.rates?.JPY, date: usd?.date },
          "USD/INR": { price: usd?.rates?.INR, date: usd?.date },
        });
        setForexError(null);
      } catch (e) {
        if (!stop) setForexError("Live forex feed unavailable right now (" + e.message + "). Retrying…");
      }
    }
    poll();
    const t = setInterval(poll, 300000); // 5 min — matches the data's actual update cadence
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Twelve Data polling (stocks/forex/indices/commodities) — only if key present.
  // Uses ONE batched request for all symbols (not one request per symbol) to stay
  // well under the free-tier rate limit (~8 requests/minute).
  useEffect(() => {
    if (!tdKey) { setTdPrices({}); setTdError(null); setTdSymbolErrors({}); return; }
    let stop = false;
    async function poll() {
      const cleanSymbols = watchSymbols.map(s => s.split(" ")[0].replace("(NSE)", ":NSE").replace("(BSE)", ":BSE"));
      try {
        const res = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(cleanSymbols.join(","))}&apikey=${tdKey}`);
        const data = await res.json();
        if (stop) return;

        // Single symbol -> Twelve Data returns one flat quote object.
        // Multiple symbols -> returns an object keyed by symbol.
        let bySymbol;
        if (cleanSymbols.length === 1) {
          bySymbol = { [cleanSymbols[0]]: data };
        } else {
          bySymbol = data;
        }

        if (data.status === "error" || data.code >= 400) {
          setTdPrices({});
          setTdError(`Twelve Data error: ${data.message || "request failed"} (code ${data.code || "?"}).`);
          return;
        }

        const next = {};
        const nextErrors = {};
        let anyOk = false;
        for (const sym of cleanSymbols) {
          const q = bySymbol?.[sym];
          if (q && q.status !== "error" && q.close !== undefined) {
            next[sym] = q;
            anyOk = true;
          } else {
            nextErrors[sym] = q?.message || "no data returned for this symbol";
          }
        }
        setTdPrices(next);
        setTdSymbolErrors(nextErrors);
        setTdError(anyOk ? null : `Couldn't get any live quotes. Check your API key, or see per-symbol reasons below.`);
      } catch (e) {
        if (!stop) { setTdPrices({}); setTdError(`Network error reaching Twelve Data (${e.message}).`); }
      }
    }
    poll();
    const t = setInterval(poll, 60000);
    return () => { stop = true; clearInterval(t); };
  }, [tdKey, watchSymbols]);

  // Daily loss kill switch check
  useEffect(() => {
    const lossLimit = account.dailyStartBalance * (account.dailyLossLimitPct / 100);
    const dailyPnl = account.balance - account.dailyStartBalance;
    if (dailyPnl <= -lossLimit && !killSwitch.active) {
      setKillSwitch({ active: true, reason: `Daily loss limit hit (-${fmt(account.dailyLossLimitPct)}% of day-start balance). New trades are blocked until you reset.` });
    }
  }, [account.balance, account.dailyStartBalance, account.dailyLossLimitPct]); // eslint-disable-line

  const openPosition = useCallback((pos) => {
    if (killSwitch.active) return;
    setPositions(p => [...p, { id: uid(), openedAt: Date.now(), ...pos }]);
  }, [killSwitch.active]);

  const closePosition = useCallback((id, exitPrice) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === id);
      if (!pos) return prev;
      const dir = pos.side === "long" ? 1 : -1;
      const pnl = (exitPrice - pos.entryPrice) * pos.qty * dir;
      const riskAmt = Math.abs(pos.entryPrice - pos.stopLoss) * pos.qty;
      const rMultiple = riskAmt > 0 ? pnl / riskAmt : 0;
      setClosedTrades(ct => [...ct, { ...pos, exitPrice, closedAt: Date.now(), pnl, rMultiple }]);
      setAccount(a => ({ ...a, balance: a.balance + pnl }));
      return prev.filter(p => p.id !== id);
    });
  }, []);

  const resetKillSwitch = () => {
    setKillSwitch({ active: false, reason: "" });
    setAccount(a => ({ ...a, dailyStartBalance: a.balance }));
  };

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "trade", label: "Paper Trading", icon: Wallet },
    { id: "assistant", label: "AI Assistant", icon: Bot },
    { id: "technical", label: "Technical AI", icon: Layers },
    { id: "strategy", label: "Strategy Builder", icon: FlaskConical },
    { id: "scanner", label: "Breakout Scanner", icon: ScanSearch },
    { id: "journal", label: "Journal", icon: BookOpen },
    { id: "risk", label: "Risk & Kill Switch", icon: ShieldAlert },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-[#0A0E14] text-[#E8EEF4] font-sans">
      <style>{`
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #1C2733; border-radius: 4px; }
        .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      `}</style>

      {/* Top bar */}
      <div className="border-b border-[#1C2733] bg-[#0F1620] sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#4C8DFF] flex items-center justify-center text-[#0A0E14] font-bold text-sm">Q</div>
            <span className="font-semibold tracking-tight">Quorum <span className="text-[#7E8CA0] font-normal">— AI Trading Desk</span></span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-[#7E8CA0] mono">
              <span>Balance</span>
              <span className="text-[#E8EEF4] text-sm font-semibold">${fmt(account.balance)}</span>
              <span className={account.balance >= account.startingBalance ? "text-[#2FD98A]" : "text-[#FF5D6C]"}>
                ({account.balance >= account.startingBalance ? "+" : ""}{fmt(((account.balance - account.startingBalance) / account.startingBalance) * 100)}%)
              </span>
            </div>
            <button
              onClick={killSwitch.active ? resetKillSwitch : () => setKillSwitch({ active: true, reason: "Manually engaged by trader." })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition ${
                killSwitch.active ? "bg-[#FF5D6C]/15 border-[#FF5D6C] text-[#FF5D6C]" : "border-[#1C2733] text-[#7E8CA0] hover:border-[#FF5D6C] hover:text-[#FF5D6C]"
              }`}
            >
              <Power size={13} /> {killSwitch.active ? "Kill Switch ON" : "Kill Switch"}
            </button>
          </div>
        </div>
        {killSwitch.active && (
          <div className="bg-[#FF5D6C]/10 border-t border-[#FF5D6C]/30 px-4 py-1.5 text-xs text-[#FF5D6C] flex items-center gap-2">
            <AlertTriangle size={13} /> {killSwitch.reason} <button onClick={resetKillSwitch} className="underline ml-1">Reset for new session</button>
          </div>
        )}
        <nav className="flex gap-1 px-3 overflow-x-auto pb-2">{NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition ${
                tab === n.id ? "bg-[#4C8DFF]/15 text-[#4C8DFF]" : "text-[#7E8CA0] hover:text-[#E8EEF4] hover:bg-[#131B26]"
              }`}
            >
              <n.icon size={14} /> {n.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 max-w-6xl mx-auto">
        {tab === "dashboard" && (
          <Dashboard
            cryptoPrices={cryptoPrices} cryptoError={cryptoError}
            tdPrices={tdPrices} tdError={tdError} tdSymbolErrors={tdSymbolErrors} tdKey={tdKey}
            watchSymbols={watchSymbols}
            account={account} positions={positions} closedTrades={closedTrades}
            finnhubKey={finnhubKey}
            forexRates={forexRates} forexError={forexError}
          />
        )}
        {tab === "trade" && (
          <PaperTrading
            cryptoPrices={cryptoPrices} tdKey={tdKey} tdPrices={tdPrices} watchSymbols={watchSymbols}
            forexRates={forexRates}
            account={account} positions={positions}
            openPosition={openPosition} closePosition={closePosition} killSwitch={killSwitch}
          />
        )}
        {tab === "assistant" && (
          <AIAssistant account={account} positions={positions} closedTrades={closedTrades} cryptoPrices={cryptoPrices} />
        )}
        {tab === "technical" && <TechnicalAnalysis tdKey={tdKey} />}
        {tab === "strategy" && <StrategyBuilder tdKey={tdKey} />}
        {tab === "scanner" && <BreakoutScanner tdKey={tdKey} />}
        {tab === "journal" && <Journal closedTrades={closedTrades} account={account} />}
        {tab === "risk" && (
          <RiskPanel account={account} setAccount={setAccount} killSwitch={killSwitch} resetKillSwitch={resetKillSwitch} positions={positions} />
        )}
        {tab === "settings" && (
          <SettingsPanel
            tdKey={tdKey} setTdKey={setTdKey}
            finnhubKey={finnhubKey} setFinnhubKey={setFinnhubKey}
            watchSymbols={watchSymbols} setWatchSymbols={setWatchSymbols}
          />
        )}
      </div>

      <footer className="max-w-6xl mx-auto px-4 pb-8 pt-4 text-[11px] text-[#7E8CA0] leading-relaxed border-t border-[#1C2733] mt-6">
        Paper-trading simulator for practice and analysis only — no real orders are placed and no broker is connected.
        Crypto prices are live (CoinGecko). Stocks/forex/indices are live only if you add a Twelve Data API key in Settings, otherwise shown as simulated.
        AI output is generated by a language model, can be wrong, and is not financial advice. Nothing here guarantees profit; trading carries risk of loss.
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------
   Panel wrapper
--------------------------------------------------------- */
function Panel({ title, right, children, className = "" }) {
  return (
    <div className={`bg-[#0F1620] border border-[#1C2733] rounded-lg ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C2733]">
          <h3 className="text-sm font-semibold">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------
   Dashboard
--------------------------------------------------------- */
function Dashboard({ cryptoPrices, cryptoError, tdPrices, tdError, tdSymbolErrors, tdKey, watchSymbols, account, positions, closedTrades, finnhubKey, forexRates, forexError }) {
  const equity = [{ x: 0, v: account.startingBalance }, ...closedTrades.map((t, i) => ({ x: i + 1, v: account.startingBalance + closedTrades.slice(0, i + 1).reduce((s, c) => s + c.pnl, 0) }))];
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;
  const openPnl = positions.reduce((s, p) => {
    const live = cryptoPrices[p.symbol]?.usd;
    if (!live) return s;
    const dir = p.side === "long" ? 1 : -1;
    return s + (live - p.entryPrice) * p.qty * dir;
  }, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Panel title="Portfolio" className="lg:col-span-2">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Balance" value={`$${fmt(account.balance)}`} />
          <Stat label="Open P&L (crypto)" value={`${openPnl >= 0 ? "+" : ""}$${fmt(openPnl)}`} tone={openPnl >= 0 ? "bull" : "bear"} />
          <Stat label="Win Rate" value={`${fmt(winRate, 0)}%`} />
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={equity}>
            <CartesianGrid stroke="#1C2733" vertical={false} />
            <XAxis dataKey="x" stroke="#7E8CA0" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#7E8CA0" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#131B26", border: "1px solid #1C2733", fontSize: 12 }} />
            <Line type="monotone" dataKey="v" stroke="#4C8DFF" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Risk Meter">
        <RiskMeterMini account={account} positions={positions} />
      </Panel>

      <Panel title="Crypto — live" className="lg:col-span-2" right={<LiveDot ok={!cryptoError} />}>
        {cryptoError && <div className="text-xs text-[#F2B441] mb-2">{cryptoError}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CRYPTO_IDS.map(id => {
            const d = cryptoPrices[id];
            const chg = d?.usd_24h_change;
            return (
              <div key={id} className="bg-[#131B26] rounded-md p-2.5">
                <div className="text-[11px] text-[#7E8CA0]">{CRYPTO_LABELS[id]}</div>
                <div className="mono text-sm font-semibold">{d ? `$${fmt(d.usd, d.usd < 5 ? 4 : 2)}` : "…"}</div>
                {chg !== undefined && (
                  <div className={`text-[11px] mono ${chg >= 0 ? "text-[#2FD98A]" : "text-[#FF5D6C]"}`}>{chg >= 0 ? "+" : ""}{fmt(chg)}%</div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Forex — live, free (ECB daily rates)" right={<LiveDot ok={!forexError} label={forexError ? undefined : "live"} />}>
        {forexError && <div className="text-xs text-[#F2B441] mb-2">{forexError}</div>}
        <div className="text-[11px] text-[#7E8CA0] mb-2">No API key needed — updates once per weekday, not intraday tick data.</div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(forexRates).map(([pair, r]) => (
            <div key={pair} className="bg-[#131B26] rounded-md p-2.5">
              <div className="text-[11px] text-[#7E8CA0]">{pair}</div>
              <div className="mono text-sm font-semibold">{r.price !== undefined ? fmt(r.price, r.price < 5 ? 4 : 2) : "…"}</div>
              {r.date && <div className="text-[10px] text-[#7E8CA0] mono">{r.date}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Watchlist — indices / commodities / stocks" right={<LiveDot ok={!!tdKey && !tdError} label={tdKey ? undefined : "simulated"} />}>
        {!tdKey && <div className="text-xs text-[#7E8CA0] mb-2">Add a Twelve Data key in Settings for live quotes. Showing simulated placeholders.</div>}
        {tdError && <div className="text-xs text-[#F2B441] mb-2">{tdError}</div>}
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
          {watchSymbols.map(sym => {
            const key = sym.split(" ")[0].replace("(NSE)", ":NSE").replace("(BSE)", ":BSE");
            const q = tdKey ? tdPrices?.[key] : null;
            const symErr = tdKey ? tdSymbolErrors?.[key] : null;
            const price = tdKey ? (q ? Number(q.close) : null) : (100 + Math.abs(Math.sin(sym.length)) * 400);
            const changePct = tdKey ? (q ? Number(q.percent_change) : null) : (Math.sin(sym.length * 7) * 2);
            return (
              <div key={sym} className="flex items-center justify-between text-xs bg-[#131B26] rounded px-2.5 py-1.5">
                <span className="text-[#E8EEF4]">{sym}</span>
                {price !== null ? (
                  <span className="flex items-center gap-2 mono">
                    <span>${fmt(price, price < 5 ? 4 : 2)}</span>
                    {changePct !== null && (
                      <span className={changePct >= 0 ? "text-[#2FD98A]" : "text-[#FF5D6C]"}>
                        {changePct >= 0 ? "+" : ""}{fmt(changePct)}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[#F2B441] text-[10px] text-right max-w-[55%]">{symErr || "no data"}</span>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="News Feed & AI Impact Analysis" className="lg:col-span-3">
        <NewsFeed finnhubKey={finnhubKey} />
      </Panel>

      <Panel title="Economic Calendar" className="lg:col-span-3">
        <div className="text-xs text-[#7E8CA0]">
          Illustrative calendar — for a live feed, connect a calendar API with your Twelve Data / news key in Settings.
        </div>
        <div className="grid sm:grid-cols-3 gap-2 mt-2">
          {[
            { t: "US CPI (YoY)", w: "High" }, { t: "Fed Funds Rate Decision", w: "High" }, { t: "India RBI Policy Rate", w: "Medium" },
          ].map((e, i) => (
            <div key={i} className="bg-[#131B26] rounded px-2.5 py-2 text-xs flex justify-between">
              <span>{e.t}</span>
              <span className={e.w === "High" ? "text-[#FF5D6C]" : "text-[#F2B441]"}>{e.w}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === "bull" ? "text-[#2FD98A]" : tone === "bear" ? "text-[#FF5D6C]" : "text-[#E8EEF4]";
  return (
    <div className="bg-[#131B26] rounded-md p-2.5">
      <div className="text-[11px] text-[#7E8CA0]">{label}</div>
      <div className={`mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
function LiveDot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[#7E8CA0]">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#2FD98A]" : "bg-[#F2B441]"}`} />
      {label || (ok ? "live" : "reconnecting")}
    </span>
  );
}

function RiskMeterMini({ account, positions }) {
  const exposure = positions.length;
  const dailyLossLimit = account.dailyStartBalance * (account.dailyLossLimitPct / 100);
  const dailyPnl = account.balance - account.dailyStartBalance;
  const used = Math.min(100, Math.max(0, (-dailyPnl / dailyLossLimit) * 100));
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs mb-1"><span className="text-[#7E8CA0]">Daily loss budget used</span><span className="mono">{fmt(used, 0)}%</span></div>
        <div className="h-2 bg-[#131B26] rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${used}%`, background: used > 70 ? "#FF5D6C" : used > 40 ? "#F2B441" : "#2FD98A" }} />
        </div>
      </div>
      <Stat label="Open Positions" value={exposure} />
      <Stat label="Risk / trade" value={`${account.riskPerTradePct}%`} />
    </div>
  );
}

/* ---------------------------------------------------------
   News Feed — live headlines (Finnhub) + AI impact summary (Claude)
--------------------------------------------------------- */
function NewsFeed({ finnhubKey }) {
  const [news, setNews] = useState([]);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    if (!finnhubKey) { setNews([]); setError(null); return; }
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`);
        if (!res.ok) throw new Error("status " + res.status);
        const data = await res.json();
        if (!stop) { setNews(Array.isArray(data) ? data.slice(0, 10) : []); setError(null); }
      } catch (e) {
        if (!stop) setError("Couldn't reach Finnhub (" + e.message + "). Check your API key in Settings.");
      }
    }
    poll();
    const t = setInterval(poll, 120000);
    return () => { stop = true; clearInterval(t); };
  }, [finnhubKey]);

  const analyze = async () => {
    if (!news.length) return;
    setSummarizing(true); setSummary(null);
    try {
      const headlines = news.map(n => `- ${n.headline} (${n.source})`).join("\n");
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 500,
          messages: [{
            role: "user",
            content: `Here are the latest general market headlines:\n${headlines}\n\nIn under 150 words, summarize the likely near-term market impact across major asset classes (equities, crypto, forex, commodities) implied by these headlines. Note overall tone (risk-on / risk-off / mixed) and flag anything time-sensitive. Be measured — this is a probabilistic read, not a prediction.`
          }],
        }),
      });
      const data = await res.json();
      setSummary(data?.content?.map(c => c.text || "").join("\n") || "Couldn't generate a summary right now.");
    } catch (e) {
      setSummary("Couldn't reach the AI service right now.");
    } finally {
      setSummarizing(false);
    }
  };

  if (!finnhubKey) {
    return <div className="text-xs text-[#7E8CA0]">Add a free Finnhub API key in Settings for a live headline feed and AI market-impact summaries.</div>;
  }

  return (
    <div>
      {error && <div className="text-xs text-[#F2B441] mb-2">{error}</div>}
      <div className="flex items-center justify-between mb-2">
        <LiveDot ok={!error} />
        <button onClick={analyze} disabled={summarizing || !news.length} className="text-xs px-2.5 py-1 rounded-md bg-[#4C8DFF]/15 text-[#4C8DFF] disabled:opacity-40">{summarizing ? "Analyzing…" : "AI market-impact summary"}
        </button>
      </div>
      {summary && <div className="bg-[#131B26] rounded-md p-3 text-xs text-[#E8EEF4] mb-3 whitespace-pre-wrap">{summary}</div>}
      <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
        {news.map((n, i) => (
          <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block bg-[#131B26] rounded px-2.5 py-1.5 text-xs hover:bg-[#1C2733]">
            <div className="text-[#E8EEF4]">{n.headline}</div>
            <div className="text-[#7E8CA0] mt-0.5">{n.source} · {n.datetime ? new Date(n.datetime * 1000).toLocaleString() : ""}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Paper Trading
--------------------------------------------------------- */
function PaperTrading({ cryptoPrices, tdKey, tdPrices, watchSymbols, forexRates, account, positions, openPosition, closePosition, killSwitch }) {
  const [market, setMarket] = useState("crypto"); // "crypto" | "forex" | "other"
  const [symbol, setSymbol] = useState("bitcoin");
  const [forexSymbol, setForexSymbol] = useState("EUR/USD");
  const [otherSymbol, setOtherSymbol] = useState(watchSymbols[0] || "XAU/USD");
  const [side, setSide] = useState("long");
  const [stopPct, setStopPct] = useState(2);
  const [targetPct, setTargetPct] = useState(4);

  const activeSymbol = market === "crypto" ? symbol : market === "forex" ? forexSymbol : otherSymbol.split(" ")[0].replace("(NSE)", ":NSE").replace("(BSE)", ":BSE");
  const price = market === "crypto" ? cryptoPrices[symbol]?.usd
    : market === "forex" ? forexRates?.[forexSymbol]?.price
    : Number(tdPrices?.[activeSymbol]?.close) || null;
  const riskAmt = account.balance * (account.riskPerTradePct / 100);
  const stopDistance = price ? price * (stopPct / 100) : 0;
  const qty = stopDistance > 0 ? riskAmt / stopDistance : 0;

  const submit = () => {
    if (!price || killSwitch.active) return;
    const stopLoss = side === "long" ? price * (1 - stopPct / 100) : price * (1 + stopPct / 100);
    const takeProfit = side === "long" ? price * (1 + targetPct / 100) : price * (1 - targetPct / 100);
    openPosition({ symbol: activeSymbol, side, qty, entryPrice: price, stopLoss, takeProfit, assetClass: market });
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Panel title="New Paper Trade">
        {killSwitch.active && <div className="text-xs text-[#FF5D6C] mb-3">Kill switch is active — new trades are blocked.</div>}
        <div className="flex gap-2 mb-3">
          <button onClick={() => setMarket("crypto")} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${market === "crypto" ? "bg-[#4C8DFF]/15 border-[#4C8DFF] text-[#4C8DFF]" : "border-[#1C2733] text-[#7E8CA0]"}`}>Crypto (live)</button>
          <button onClick={() => setMarket("forex")} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${market === "forex" ? "bg-[#4C8DFF]/15 border-[#4C8DFF] text-[#4C8DFF]" : "border-[#1C2733] text-[#7E8CA0]"}`}>Forex (live, free)</button>
          <button onClick={() => setMarket("other")} disabled={!tdKey} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border disabled:opacity-40 ${market === "other" ? "bg-[#4C8DFF]/15 border-[#4C8DFF] text-[#4C8DFF]" : "border-[#1C2733] text-[#7E8CA0]"}`}>Commodities / Stocks</button>
        </div>
        {market === "other" && !tdKey && <div className="text-[11px] text-[#7E8CA0] mb-2">Add a Twelve Data key in Settings to paper-trade commodities, stocks, or indices.</div>}
        {market === "forex" && <div className="text-[11px] text-[#7E8CA0] mb-2">Uses free ECB daily reference rates — fine for practicing risk/journal mechanics, not for reacting to intraday moves.</div>}
        <div className="space-y-3 text-sm">
          {market === "crypto" ? (
            <div>
              <label className="text-xs text-[#7E8CA0]">Symbol</label>
              <select value={symbol} onChange={e => setSymbol(e.target.value)} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1.5 mt-1">
                {CRYPTO_IDS.map(id => <option key={id} value={id}>{CRYPTO_LABELS[id]} — {id}</option>)}
              </select>
            </div>
          ) : market === "forex" ? (
            <div>
              <label className="text-xs text-[#7E8CA0]">Symbol</label>
              <select value={forexSymbol} onChange={e => setForexSymbol(e.target.value)} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1.5 mt-1">
                {Object.keys(forexRates || { "EUR/USD": 1, "GBP/USD": 1, "USD/JPY": 1, "USD/INR": 1 }).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs text-[#7E8CA0]">Symbol</label>
              <select value={otherSymbol} onChange={e => setOtherSymbol(e.target.value)} disabled={!tdKey} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1.5 mt-1">
                {watchSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setSide("long")} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${side === "long" ? "bg-[#2FD98A]/15 border-[#2FD98A] text-[#2FD98A]" : "border-[#1C2733] text-[#7E8CA0]"}`}>Long</button>
            <button onClick={() => setSide("short")} className={`flex-1 py-1.5 rounded-md text-xs font-semibold border ${side === "short" ? "bg-[#FF5D6C]/15 border-[#FF5D6C] text-[#FF5D6C]" : "border-[#1C2733] text-[#7E8CA0]"}`}>Short</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[#7E8CA0]">Stop %</label>
              <input type="number" value={stopPct} onChange={e => setStopPct(Number(e.target.value))} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1.5 mt-1 mono" />
            </div>
            <div>
              <label className="text-xs text-[#7E8CA0]">Target %</label>
              <input type="number" value={targetPct} onChange={e => setTargetPct(Number(e.target.value))} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1.5 mt-1 mono" />
            </div>
          </div>
          <div className="bg-[#131B26] rounded-md p-2.5 text-xs space-y-1 mono">
            <div className="flex justify-between"><span className="text-[#7E8CA0]">Live price</span><span>{price ? `$${fmt(price)}` : "loading…"}</span></div>
            <div className="flex justify-between"><span className="text-[#7E8CA0]">Risking</span><span>${fmt(riskAmt)} ({account.riskPerTradePct}%)</span></div>
            <div className="flex justify-between"><span className="text-[#7E8CA0]">Position size</span><span>{fmt(qty, 6)} units</span></div>
          </div>
          <button onClick={submit} disabled={!price || killSwitch.active || (market === "other" && !tdKey)} className="w-full py-2 rounded-md bg-[#4C8DFF] text-[#0A0E14] font-semibold text-sm disabled:opacity-40">
            Open {side === "long" ? "Long" : "Short"}
          </button>
        </div>
      </Panel>

      <Panel title="Open Positions" className="lg:col-span-2">
        {positions.length === 0 && <div className="text-xs text-[#7E8CA0]">No open positions.</div>}
        <div className="space-y-2">
          {positions.map(p => {
            const live = p.assetClass === "crypto" ? cryptoPrices[p.symbol]?.usd
              : p.assetClass === "forex" ? forexRates?.[p.symbol]?.price
              : Number(tdPrices?.[p.symbol]?.close) || null;
            const dir = p.side === "long" ? 1 : -1;
            const pnl = live ? (live - p.entryPrice) * p.qty * dir : 0;
            const label = p.assetClass === "crypto" ? CRYPTO_LABELS[p.symbol] : p.symbol;
            return (
              <div key={p.id} className="flex items-center justify-between bg-[#131B26] rounded-md px-3 py-2 text-xs">
                <div>
                  <div className="font-semibold">{label} <span className={p.side === "long" ? "text-[#2FD98A]" : "text-[#FF5D6C]"}>{p.side.toUpperCase()}</span></div>
                  <div className="text-[#7E8CA0] mono">entry ${fmt(p.entryPrice)} · SL ${fmt(p.stopLoss)} · TP ${fmt(p.takeProfit)}</div>
                </div>
                <div className="text-right">
                  <div className={`mono font-semibold ${pnl >= 0 ? "text-[#2FD98A]" : "text-[#FF5D6C]"}`}>{pnl >= 0 ? "+" : ""}${fmt(pnl)}</div>
                  <button onClick={() => closePosition(p.id, live || p.entryPrice)} className="text-[10px] text-[#7E8CA0] hover:text-[#E8EEF4] underline">close</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   AI Assistant (Claude API + voice)
--------------------------------------------------------- */
function AIAssistant({ account, positions, closedTrades, cryptoPrices }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "I'm your trading assistant. Ask me about a symbol, a setup, or your recent trades. I can reason over your paper account, but I'm not infallible and this isn't financial advice." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    const newMsgs = [...messages, { role: "user", content: q }];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    try {
      const context = `Paper account balance: $${fmt(account.balance)}. Open positions: ${JSON.stringify(positions.map(p => ({ symbol: p.symbol, side: p.side, entry: p.entryPrice })))}. Recent closed trades: ${JSON.stringify(closedTrades.slice(-5).map(t => ({ symbol: t.symbol, pnl: Math.round(t.pnl) })))}. Live crypto snapshot: ${JSON.stringify(Object.fromEntries(Object.entries(cryptoPrices).map(([k, v]) => [k, v.usd])))}.`;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1000,
          system: `You are a disciplined trading coach and market analyst inside a paper-trading app. Be concise (under ~150 words unless asked for depth). When giving a view, structure it as: setup/thesis, supporting factors, AI confidence (%), and key risks that would invalidate it. Never claim certainty or guarantee outcomes. Remind the user this is not financial advice only if it's contextually relevant, not every message. Context: ${context}`,
          messages: newMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const text = data?.content?.map(c => c.text || "").join("\n") || "I couldn't generate a response just now — try again in a moment.";
      setMessages(m => [...m, { role: "assistant", content: text }]);
      if (window.speechSynthesis && lastWasVoice.current) {
        const u = new SpeechSynthesisUtterance(text.replace(/[#*]/g, ""));
        window.speechSynthesis.speak(u);
      }
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: "Something went wrong reaching the AI service. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const lastWasVoice = useRef(false);

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice input isn't supported in this browser."); return; }
    if (listening) { recogRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.lang = "en-US";
    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      lastWasVoice.current = true;
      send(transcript);
    };
    r.onend = () => setListening(false);
    r.start();
    recogRef.current = r;
    setListening(true);
  };

  const suggestions = ["Should I trade Bitcoin right now?", "Why did my last trade lose?", "How much should I risk on ETH?", "Summarize today's crypto market."];

  return (
    <Panel title="AI Trading Assistant" right={<span className="text-[11px] text-[#7E8CA0]">text or voice</span>}>
      <div className="h-[420px] overflow-y-auto space-y-3 mb-3 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-[#4C8DFF]/15 text-[#E8EEF4]" : "bg-[#131B26] text-[#E8EEF4]"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && <div className="text-xs text-[#7E8CA0]">thinking…</div>}
        <div ref={endRef} />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {suggestions.map(s => (
          <button key={s} onClick={() => send(s)} className="text-[11px] px-2 py-1 rounded-full border border-[#1C2733] text-[#7E8CA0] hover:text-[#E8EEF4] hover:border-[#4C8DFF]">{s}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={toggleVoice} className={`px-3 rounded-md border ${listening ? "bg-[#FF5D6C]/15 border-[#FF5D6C] text-[#FF5D6C]" : "border-[#1C2733] text-[#7E8CA0]"}`}>
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { lastWasVoice.current = false; send(); } }}
          placeholder="Ask about a symbol, setup, or your trades…"
          className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm outline-none focus:border-[#4C8DFF]"
        />
        <button onClick={() => { lastWasVoice.current = false; send(); }} className="px-3 rounded-md bg-[#4C8DFF] text-[#0A0E14]"><Send size={16} /></button>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------
   Strategy Builder + Backtester
--------------------------------------------------------- */
function StrategyBuilder({ tdKey }) {
  const [desc, setDesc] = useState("Buy when price crosses above the 20-period average, exit when it crosses back below. Use a 2% stop and 5% target.");
  const [symbol, setSymbol] = useState("AAPL");
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState(null); // "live" | "simulated"

  const generate = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 300,
          messages: [{
            role: "user",
            content: `Convert this trading strategy description into ONLY a JSON object, no other text, no markdown fences, with fields: {"smaPeriod": number (5-100), "entry": "cross_above" or "cross_below", "stopLossPct": number, "takeProfitPct": number, "summary": short string}. Description: "${desc}"`
          }],
        }),
      });
      const data = await res.json();
      const text = (data?.content?.map(c => c.text || "").join("") || "{}").trim();
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setRules(parsed);

      let series;
      if (tdKey) {
        try {
          series = await fetchRealSeries(symbol, tdKey, "1day", 300);
          setDataSource("live");
        } catch (e) {
          series = genSeries(300, 100, 0.018);
          setDataSource("simulated");
          setError(`Couldn't fetch real history for "${symbol}" (${e.message}) — used simulated data instead. Check the symbol and your API key.`);
        }
      } else {
        series = genSeries(300, 100, 0.018);
        setDataSource("simulated");
      }
      runBacktest(parsed, series);
    } catch (e) {
      setError("Couldn't parse a strategy from that description — try rephrasing it more explicitly (indicator, entry/exit, stop/target).");
    } finally {
      setLoading(false);
    }
  };

  const runBacktest = (r, series) => {
    const period = Math.max(2, Math.min(100, Math.round(r.smaPeriod || 20)));
    let balance = 10000;
    let position = null;
    const equity = [];
    let wins = 0, losses = 0, grossWin = 0, grossLoss = 0, peak = balance, maxDD = 0;
    const trades = [];

    for (let i = 1; i < series.length; i++) {
      const avg = sma(series, period, i);
      const prevAvg = sma(series, period, i - 1);
      const c = series[i].close;
      if (avg && prevAvg) {const crossUp = series[i - 1].close <= prevAvg && c > avg;
        const crossDown = series[i - 1].close >= prevAvg && c < avg;
        if (!position && ((r.entry === "cross_above" && crossUp) || (r.entry !== "cross_above" && crossDown))) {
          position = { entry: c, i, stop: c * (1 - (r.stopLossPct || 2) / 100), target: c * (1 + (r.takeProfitPct || 4) / 100) };
        } else if (position) {
          const hitStop = series[i].low <= position.stop;
          const hitTarget = series[i].high >= position.target;
          const exitSignal = r.entry === "cross_above" ? crossDown : crossUp;
          if (hitStop || hitTarget || exitSignal) {
            const exitPrice = hitStop ? position.stop : hitTarget ? position.target : c;
            const pnl = (exitPrice - position.entry) / position.entry * balance * 0.1;
            balance += pnl;
            if (pnl >= 0) { wins++; grossWin += pnl; } else { losses++; grossLoss += Math.abs(pnl); }
            trades.push({ entry: position.entry, exit: exitPrice, pnl });
            position = null;
          }
        }
      }
      peak = Math.max(peak, balance);
      maxDD = Math.max(maxDD, (peak - balance) / peak * 100);
      equity.push({ x: i, v: balance });
    }
    const total = wins + losses;
    setResult({
      equity, winRate: total ? (wins / total) * 100 : 0, trades: total,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      maxDD, finalBalance: balance,
    });
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title="Describe your strategy in plain English">
        <div className="mb-3">
          <label className="text-xs text-[#7E8CA0]">Symbol {tdKey ? "(real daily history via Twelve Data)" : "(needs a Twelve Data key for real history — see Settings)"}</label>
          <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. AAPL, RELIANCE:NSE, EUR/USD" className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 mt-1 text-sm mono" />
        </div>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm outline-none focus:border-[#4C8DFF]" />
        <button onClick={generate} disabled={loading} className="mt-3 w-full py-2 rounded-md bg-[#4C8DFF] text-[#0A0E14] font-semibold text-sm disabled:opacity-40">
          {loading ? "Generating & backtesting…" : "Generate rules & backtest"}
        </button>
        {error && <div className="text-xs text-[#F2B441] mt-2">{error}</div>}
        {rules && (
          <div className="mt-3 bg-[#131B26] rounded-md p-2.5 text-xs mono space-y-1">
            <div>SMA period: {rules.smaPeriod}</div>
            <div>Entry: {rules.entry}</div>
            <div>Stop / Target: {rules.stopLossPct}% / {rules.takeProfitPct}%</div>
            <div className="text-[#7E8CA0]">{rules.summary}</div>
          </div>
        )}
        <div className="text-[11px] text-[#7E8CA0] mt-3">
          {dataSource === "live" ? `Backtested against real daily history for ${symbol} (Twelve Data).` : "Backtest runs against a simulated price series — add a Twelve Data key in Settings to backtest on real history."}
        </div>
      </Panel>

      <Panel title="Backtest Result" right={result && <LiveDot ok={dataSource === "live"} label={dataSource === "live" ? "real history" : "simulated"} />}>
        {!result && <div className="text-xs text-[#7E8CA0]">Generate a strategy to see results.</div>}
        {result && (
          <>
            <div className="grid grid-cols-4 gap-2 mb-3">
              <Stat label="Trades" value={result.trades} />
              <Stat label="Win rate" value={`${fmt(result.winRate, 0)}%`} />
              <Stat label="Profit factor" value={isFinite(result.profitFactor) ? fmt(result.profitFactor) : "∞"} />
              <Stat label="Max DD" value={`${fmt(result.maxDD, 1)}%`} tone="bear" />
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={result.equity}>
                <CartesianGrid stroke="#1C2733" vertical={false} />
                <XAxis dataKey="x" stroke="#7E8CA0" fontSize={11} hide />
                <YAxis stroke="#7E8CA0" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#131B26", border: "1px solid #1C2733", fontSize: 12 }} />
                <Line type="monotone" dataKey="v" stroke="#2FD98A" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Breakout / manipulation scanner
--------------------------------------------------------- */
function BreakoutScanner({ tdKey }) {
  const [symbol, setSymbol] = useState("AAPL");
  const [series, setSeries] = useState(() => genSeries(120, 100, 0.02));
  const [flags, setFlags] = useState([]);
  const [dataSource, setDataSource] = useState("simulated");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const rescan = async () => {
    setLoading(true); setError(null);
    let s;
    if (tdKey) {
      try {
        s = await fetchRealSeries(symbol, tdKey, "1h", 120);
        setDataSource("live");
      } catch (e) {
        s = genSeries(120, 100, 0.02);
        setDataSource("simulated");
        setError(`Couldn't fetch real candles for "${symbol}" (${e.message}) — showing simulated data instead.`);
      }
    } else {
      s = genSeries(120, 100, 0.02);
      setDataSource("simulated");
    }
    setSeries(s);
    setLoading(false);
    const found = [];
    const avgVol = s.reduce((a, c) => a + c.volume, 0) / s.length;
    for (let i = 5; i < s.length; i++) {
      const c = s[i];
      const range = c.high - c.low;
      const body = Math.abs(c.close - c.open);
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const volSpike = c.volume > avgVol * 1.8;
      if (volSpike && range > 0 && upperWick / range > 0.55 && c.close < c.open) {
        found.push({ i, type: "Possible stop hunt / bull trap", note: "Volume spike with long upper wick and rejection — high may have swept liquidity before reversing." });
      }
      if (volSpike && range > 0 && lowerWick / range > 0.55 && c.close > c.open) {
        found.push({ i, type: "Possible bear trap", note: "Volume spike with long lower wick and recovery — low may have swept stops before reversing." });
      }
      if (volSpike && body / range < 0.15 && range > 0) {
        found.push({ i, type: "Indecision on high volume", note: "Large volume but tiny body — possible absorption or spoofing footprint." });
      }
    }
    setFlags(found.slice(-6));
  };

  useEffect(() => { rescan(); }, []); // eslint-disable-line

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Panel
        title={dataSource === "live" ? `${symbol} — 1h candles (live)` : "Simulated price action"}
        className="lg:col-span-2"
        right={<button onClick={rescan} disabled={loading} className="text-xs text-[#4C8DFF]">{loading ? "Scanning…" : "Rescan"}</button>}
      >
        <div className="flex gap-2 mb-2">
          <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="symbol, e.g. AAPL" className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-2 py-1 text-xs mono" disabled={!tdKey} />
        </div>
        {error && <div className="text-[11px] text-[#F2B441] mb-2">{error}</div>}
        <div className="text-[11px] text-[#7E8CA0] mb-2">
          {tdKey ? "Scanning real hourly candles via Twelve Data." : "Pattern-detection logic demoed on simulated candles — add a Twelve Data key in Settings to scan real OHLCV."}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={series}>
            <CartesianGrid stroke="#1C2733" vertical={false} />
            <XAxis dataKey="i" stroke="#7E8CA0" fontSize={10} hide />
            <YAxis stroke="#7E8CA0" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#131B26", border: "1px solid #1C2733", fontSize: 12 }} />
            <Bar dataKey="close">
              {series.map((d, i) => <Cell key={i} fill={d.close >= d.open ? "#2FD98A" : "#FF5D6C"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Flags">
        {flags.length === 0 && <div className="text-xs text-[#7E8CA0]">No manipulation-pattern flags in this window.</div>}
        <div className="space-y-2">
          {flags.map((f, idx) => (
            <div key={idx} className="bg-[#131B26] rounded-md p-2.5 text-xs">
              <div className="flex items-center gap-1.5 text-[#F2B441] font-semibold"><AlertTriangle size={12} /> {f.type}</div>
              <div className="text-[#7E8CA0] mt-1">{f.note}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Journal
--------------------------------------------------------- */
function Journal({ closedTrades, account }) {
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const winRate = closedTrades.length ? (wins.length / closedTrades.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
  let peak = account.startingBalance, bal = account.startingBalance, maxDD = 0;
  closedTrades.forEach(t => { bal += t.pnl; peak = Math.max(peak, bal); maxDD = Math.max(maxDD, (peak - bal) / peak * 100); });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total trades" value={closedTrades.length} />
        <Stat label="Win rate" value={`${fmt(winRate, 0)}%`} />
        <Stat label="Profit factor" value={isFinite(profitFactor) ? fmt(profitFactor) : "∞"} />
        <Stat label="Max drawdown" value={`${fmt(maxDD, 1)}%`} tone="bear" />
      </div>
      <Panel title="Trade Log">
        {closedTrades.length === 0 && <div className="text-xs text-[#7E8CA0]">No closed trades yet — trades you close in Paper Trading appear here automatically.</div>}
        <div className="space-y-1.5">
          {[...closedTrades].reverse().map(t => (
            <div key={t.id} className="flex items-center justify-between text-xs bg-[#131B26] rounded px-3 py-2">
              <div>
                <span className="font-semibold">{CRYPTO_LABELS[t.symbol] || t.symbol}</span>{" "}
                <span className={t.side === "long" ? "text-[#2FD98A]" : "text-[#FF5D6C]"}>{t.side}</span>
                <div className="text-[#7E8CA0] mono">${fmt(t.entryPrice)} → ${fmt(t.exitPrice)}</div>
              </div>
              <div className="text-right mono">
                <div className={t.pnl >= 0 ? "text-[#2FD98A]" : "text-[#FF5D6C]"}>{t.pnl >= 0 ? "+" : ""}${fmt(t.pnl)}</div>
                <div className="text-[#7E8CA0]">{fmt(t.rMultiple)}R</div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Risk panel
--------------------------------------------------------- */
function RiskPanel({ account, setAccount, killSwitch, resetKillSwitch, positions }) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title="Risk Settings">
        <div className="space-y-4 text-sm">
          <div>
            <label className="text-xs text-[#7E8CA0]">Risk per trade (% of balance)</label>
            <input type="number" value={account.riskPerTradePct} onChange={e => setAccount(a => ({ ...a, riskPerTradePct: Number(e.target.value) }))} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 mt-1 mono" />
          </div>
          <div>
            <label className="text-xs text-[#7E8CA0]">Daily loss limit (% of day-start balance) — kill switch trigger</label>
            <input type="number" value={account.dailyLossLimitPct} onChange={e => setAccount(a => ({ ...a, dailyLossLimitPct: Number(e.target.value) }))} className="w-full bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 mt-1 mono" />
          </div>
          <div className="bg-[#131B26] rounded-md p-3 text-xs text-[#7E8CA0]">
            Correlated exposure: you currently hold <span className="text-[#E8EEF4] font-semibold">{positions.length}</span> open position(s).
            {positions.length >= 4 && <span className="text-[#F2B441] block mt-1">Several concurrent positions increases correlated risk if crypto moves as one — consider sizing down.</span>}
          </div>
        </div>
      </Panel>
      <Panel title="Kill Switch">
        <div className="text-sm space-y-3">
          <div className={`rounded-md p-3 text-xs ${killSwitch.active ? "bg-[#FF5D6C]/10 text-[#FF5D6C]" : "bg-[#2FD98A]/10 text-[#2FD98A]"}`}>
            {killSwitch.active ? killSwitch.reason || "Kill switch engaged." : "Trading is active. The kill switch engages automatically if your daily loss limit is breached, or you can trigger it manually from the top bar."}
          </div>
          {killSwitch.active && (
            <button onClick={resetKillSwitch} className="w-full py-2 rounded-md bg-[#4C8DFF] text-[#0A0E14] font-semibold text-sm">Reset for a new session</button>
          )}
          <div className="text-[11px] text-[#7E8CA0]">
            The kill switch is a discipline tool, not a guarantee — it only blocks new paper trades opened through this app.
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------
   Settings
--------------------------------------------------------- */
function SettingsPanel({ tdKey, setTdKey, finnhubKey, setFinnhubKey, watchSymbols, setWatchSymbols }) {
  const [draft, setDraft] = useState(tdKey);
  const [finnDraft, setFinnDraft] = useState(finnhubKey);
  const [newSym, setNewSym] = useState("");
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Panel title="Live data — Twelve Data API key">
        <p className="text-xs text-[#7E8CA0] mb-2">Powers live stocks, forex, indices, and commodity quotes (gold, silver, crude oil, copper, and more), plus real historical candles for the Strategy Builder and Breakout Scanner. Get a free key at <span className="text-[#4C8DFF]">twelvedata.com</span>. Stored only in this session, in memory — I can't generate this key for you, it's tied to your own account.</p>
        <div className="flex gap-2">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="paste API key" className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm mono" />
          <button onClick={() => setTdKey(draft)} className="px-3 rounded-md bg-[#4C8DFF] text-[#0A0E14] text-sm font-semibold">Save</button>
        </div>
        {tdKey && <div className="text-[11px] text-[#2FD98A] mt-2">Key active — live quotes and real historical data enabled.</div>}
      </Panel>
      <Panel title="News — Finnhub API key">
        <p className="text-xs text-[#7E8CA0] mb-2">Powers the live headline feed and AI market-impact summaries. Get a free key at <span className="text-[#4C8DFF]">finnhub.io</span>. Stored only in this session, in memory — same as above, this one's tied to your own account too.</p>
        <div className="flex gap-2">
          <input value={finnDraft} onChange={e => setFinnDraft(e.target.value)} placeholder="paste API key" className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm mono" />
          <button onClick={() => setFinnhubKey(finnDraft)} className="px-3 rounded-md bg-[#4C8DFF] text-[#0A0E14] text-sm font-semibold">Save</button>
        </div>
        {finnhubKey && <div className="text-[11px] text-[#2FD98A] mt-2">Key active — live news enabled on Dashboard.</div>}
      </Panel>
      <Panel title="Watchlist symbols">
        <div className="flex gap-2 mb-2">
          <input value={newSym} onChange={e => setNewSym(e.target.value)} placeholder="e.g. AMZN or USD/JPY" className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm" />
          <button onClick={() => { if (newSym.trim()) { setWatchSymbols(s => [...s, newSym.trim()]); setNewSym(""); } }} className="px-3 rounded-md border border-[#1C2733] text-[#7E8CA0]"><Plus size={16} /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {watchSymbols.map(s => (
            <span key={s} className="flex items-center gap-1 text-[11px] bg-[#131B26] border border-[#1C2733] rounded-full px-2 py-1">
              {s} <button onClick={() => setWatchSymbols(w => w.filter(x => x !== s))}><X size={10} /></button>
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
        }
