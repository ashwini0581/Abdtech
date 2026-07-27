import React, { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { Layers, AlertTriangle, Target, Radio, Pause, TrendingUp, TrendingDown } from "lucide-react";
import {
  emaSeries, calcRSI, calcMACD, calcATR, calcADX, calcBollinger, calcVWAP,
  calcIchimoku, calcFibonacci, calcVolumeProfile, calcMarketStructure,
  findLiquidityGrabs, calcCandlestickRejection, elliottWaveGuess,
  simpleTimeframeBias, compositeBias,
} from "./indicators.js";

const COLORS = {
  bg: "#0F1620", border: "#1C2733", text: "#E8EEF4", sub: "#7E8CA0",
  bull: "#2FD98A", bear: "#FF5D6C", amber: "#F2B441", accent: "#4C8DFF",
};

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function Panel({ title, right, children, className = "" }) {
  return (
    <div className={`bg-[#0F1620] border border-[#1C2733] rounded-lg ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C2733]">
          <h3 className="text-sm font-semibold flex items-center gap-2">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function Row({ label, value, tone, sub }) {
  const color = tone === "bull" ? "text-[#2FD98A]" : tone === "bear" ? "text-[#FF5D6C]" : "text-[#E8EEF4]";
  return (
    <div className="bg-[#131B26] rounded-md p-2.5 flex items-center justify-between">
      <div>
        <div className="text-[11px] text-[#7E8CA0] uppercase tracking-wide">{label}</div>
        {sub && <div className="text-[10px] text-[#7E8CA0]">{sub}</div>}
      </div>
      <div className={`mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

async function fetchOHLCV(symbol, tdKey, interval, outputsize) {
  const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${tdKey}`);
  const data = await res.json();
  if (data.status === "error" || !data.values) throw new Error(data.message || "no data returned");
  const values = [...data.values].reverse();
  return values.map((v, i) => ({
    i, datetime: v.datetime,
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
    volume: Number(v.volume) || 0,
  }));
}

export default function TechnicalAnalysis({ tdKey }) {
  const [symbol, setSymbol] = useState("AAPL");
  const [interval, setInterval_] = useState("1h");
  const [candles, setCandles] = useState(null);
  const [mtf, setMtf] = useState({ h1: "neutral", h4: "neutral", daily: "neutral" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    if (!tdKey) { setError("Add a Twelve Data key in Settings — real indicators need real OHLCV history."); return; }
    setLoading(true); setError(null);
    try {
      const main = await fetchOHLCV(symbol, tdKey, interval, 200);
      if (main.length < 60) throw new Error("not enough history returned for reliable indicators");
      setCandles(main);
      // Multi-timeframe bias: fetch smaller windows on 1h/4h/1day independently.
      // Best-effort — if one fails, that timeframe just shows "neutral".
      const [h1, h4, daily] = await Promise.allSettled([
        interval === "1h" ? Promise.resolve(main) : fetchOHLCV(symbol, tdKey, "1h", 100),
        fetchOHLCV(symbol, tdKey, "4h", 100),
        fetchOHLCV(symbol, tdKey, "1day", 100),
      ]);
      setMtf({
        h1: h1.status === "fulfilled" ? simpleTimeframeBias(h1.value) : "neutral",
        h4: h4.status === "fulfilled" ? simpleTimeframeBias(h4.value) : "neutral",
        daily: daily.status === "fulfilled" ? simpleTimeframeBias(daily.value) : "neutral",
      });
    } catch (e) {
      setError(`Couldn't fetch data for "${symbol}" (${e.message}).`);
      setCandles(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, tdKey]);

  useEffect(() => { if (tdKey) run(); }, []); // eslint-disable-line

  if (!candles) {
    return (
      <div className="space-y-4">
        <SymbolBar symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval_={setInterval_} run={run} loading={loading} tdKey={tdKey} />
        <Panel title="Technical Analysis AI">
          {error && <div className="text-xs text-[#F2B441] mb-2">{error}</div>}
          <div className="text-xs text-[#7E8CA0]">Enter a symbol and run analysis to see composite bias, MACD, ADX/DMI, VWAP, Ichimoku, Bollinger Bands, volume profile, market structure, and more — all computed from real historical candles.</div>
        </Panel>
      </div>
    );
  }

  const closes = candles.map(c => c.close);
  const last = candles.length - 1;
  const lastCandle = candles[last];
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const atr = calcATR(candles, 14);
  const adx = calcADX(candles, 14);
  const boll = calcBollinger(closes, 20, 2);
  const vwap = calcVWAP(candles);
  const ichimoku = calcIchimoku(candles);
  const fib = calcFibonacci(candles, 100);
  const volProfile = calcVolumeProfile(candles, 24);
  const structure = calcMarketStructure(candles);
  const liquidity = findLiquidityGrabs(candles);
  const rejection = calcCandlestickRejection(lastCandle);
  const wave = elliottWaveGuess(candles);
  const priceAboveVWAP = vwap[last] != null ? lastCandle.close > vwap[last] : null;
  const priceAboveCloud = ichimoku.cloudTop != null ? lastCandle.close > ichimoku.cloudTop : null;
  const bias = compositeBias({
    macdHist: macd.histogram[last], plusDI: adx.plusDI[last], minusDI: adx.minusDI[last],
    priceAboveVWAP, structure: structure.structure, rsi: rsi[last],
  });

  const nearRecentLiquiditySweep = (liquidity.sellSideGrab && liquidity.sellSideGrab.i >= last - 3) ||
    (liquidity.buySideGrab && liquidity.buySideGrab.i >= last - 3);

  // Chart data with rolling EMA20/50 + Bollinger overlay
  const ema20 = emaSeries(closes, 20), ema50 = emaSeries(closes, 50);
  const chartData = candles.map((c, i) => ({
    x: i, close: c.close, ema20: ema20[i], ema50: ema50[i], bbU: boll.upper[i], bbL: boll.lower[i],
  }));

  // Verdict: needs |net| strength AND price outside the Bollinger mid-zone to call a real setup
  const inBollingerMiddle = boll.upper[last] != null && lastCandle.close < boll.upper[last] && lastCandle.close > boll.lower[last] &&
    Math.abs(lastCandle.close - boll.mid[last]) / (boll.upper[last] - boll.lower[last]) < 0.35;
  let verdict = { label: "Hold / No Setup", detail: "No structural breakout. Price oscillating within the Bollinger envelope.", icon: "pause" };
  if (Math.abs(bias.net) >= 3 && !inBollingerMiddle) {
    verdict = bias.net > 0
      ? { label: "Buy Setup", detail: "Composite signals align bullish with price outside the mid-range.", icon: "up" }
      : { label: "Sell Setup", detail: "Composite signals align bearish with price outside the mid-range.", icon: "down" };
  }

  return (
    <div className="space-y-4">
      <SymbolBar symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval_={setInterval_} run={run} loading={loading} tdKey={tdKey} />
      {error && <div className="text-xs text-[#F2B441]">{error}</div>}

      <Panel
        title={`Composite Bias: ${bias.label}`}
        right={<span className="text-xs text-[#7E8CA0] mono">Bull {bias.bull} · Bear {bias.bear} · Net {bias.net}</span>}
      >
        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border ${nearRecentLiquiditySweep ? "border-[#F2B441] text-[#F2B441]" : "border-[#2FD98A]/40 text-[#2FD98A]"}`}>
          {nearRecentLiquiditySweep ? <AlertTriangle size={12} /> : <span>✓</span>}
          {nearRecentLiquiditySweep ? "Possible trap — recent liquidity sweep nearby" : "No trap signature"}
        </span>
      </Panel>

      <Panel title="System Verdict" right={verdict.icon === "pause" ? <Pause size={16} className="text-[#7E8CA0]" /> : verdict.icon === "up" ? <TrendingUp size={16} className="text-[#2FD98A]" /> : <TrendingDown size={16} className="text-[#FF5D6C]" />}>
        <div className="text-lg font-semibold mb-1">{verdict.label}</div>
        <div className="text-xs text-[#7E8CA0]">{verdict.detail}</div>
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        <Row label="AI Trend" value={bias.net > 0 ? "Bullish" : bias.net < 0 ? "Bearish" : "Neutral"} tone={bias.net > 0 ? "bull" : bias.net < 0 ? "bear" : undefined} />
        <Row label="RSI (14)" value={fmt(rsi[last], 1)} sub={rsi[last] > 70 ? "Overbought" : rsi[last] < 30 ? "Oversold" : "Neutral"} tone={rsi[last] > 70 ? "bear" : rsi[last] < 30 ? "bull" : undefined} />
        <Row label="ATR (14)" value={fmt(atr[last])} sub="Volatility" />
        <Row label="Price vs VWAP" value={priceAboveVWAP == null ? "—" : priceAboveVWAP ? "Above" : "Below"} tone={priceAboveVWAP == null ? undefined : priceAboveVWAP ? "bull" : "bear"} />
      </div>

      <Panel title="Price Structure" right={<span className="text-xs text-[#7E8CA0]">{interval} · last {candles.length} bars</span>}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#1C2733" vertical={false} />
            <XAxis dataKey="x" hide />
            <YAxis stroke="#7E8CA0" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#131B26", border: "1px solid #1C2733", fontSize: 12 }} />
            <Line type="monotone" dataKey="close" stroke="#2FD98A" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="ema20" stroke="#4C8DFF" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="ema50" stroke="#FF5D6C" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="bbU" stroke="#7E8CA0" strokeWidth={1} dot={false} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="bbL" stroke="#7E8CA0" strokeWidth={1} dot={false} strokeDasharray="3 3" />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-3 mt-2 text-[10px] text-[#7E8CA0]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#2FD98A]" />price</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#4C8DFF]" />EMA20</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#FF5D6C]" />EMA50</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#7E8CA0]" />Bollinger</span>
        </div>
      </Panel>

      <Panel title="MACD (12,26,9)">
        <div className="grid grid-cols-2 gap-2">
          <Row label="MACD" value={fmt(macd.macdLine[last], 3)} sub={`Signal ${fmt(macd.signalLine[last], 3)}`} tone={macd.macdLine[last] > macd.signalLine[last] ? "bull" : "bear"} />
          <Row label="Histogram" value={fmt(macd.histogram[last], 3)} sub={macd.histogram[last] > 0 ? "Rising" : "Falling"} tone={macd.histogram[last] > 0 ? "bull" : "bear"} />
        </div>
      </Panel>

      <Panel title="ADX / DMI (14)">
        <div className="grid grid-cols-2 gap-2">
          <Row label="ADX" value={fmt(adx.adx[last], 1)} sub={adx.adx[last] > 25 ? "Strong trend" : "Weak trend"} />
          <Row label="+DI / −DI" value={`${fmt(adx.plusDI[last], 1)} / ${fmt(adx.minusDI[last], 1)}`} tone={adx.plusDI[last] > adx.minusDI[last] ? "bull" : "bear"} />
        </div>
      </Panel>

      <Panel title="Bollinger Bands (20, 2σ)">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Width" value={fmt((boll.width[last] || 0) * 100, 1) + "%"} sub="Relative to mean" />
          <Row label="%B" value={fmt(boll.upper[last] != null ? (lastCandle.close - boll.lower[last]) / (boll.upper[last] - boll.lower[last]) : null, 2)} sub="Position in bands" />
        </div>
      </Panel>

      <Panel title="Ichimoku Cloud">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Tenkan / Kijun" value={`${fmt(ichimoku.tenkan)} / ${fmt(ichimoku.kijun)}`} />
          <Row label="Cloud" value={ichimoku.cloudTop ? `${fmt(ichimoku.cloudBottom)} – ${fmt(ichimoku.cloudTop)}` : "—"} sub={priceAboveCloud == null ? "" : priceAboveCloud ? "Price above cloud" : "Price below cloud"} tone={priceAboveCloud == null ? undefined : priceAboveCloud ? "bull" : "bear"} />
        </div>
      </Panel>

      <Panel title="Volume Profile">
        <div className="grid grid-cols-2 gap-2">
          <Row label="POC" value={fmt(volProfile.poc)} sub="Point of control" />
          <Row label="Value Area" value={`${fmt(volProfile.valueAreaLow)} – ${fmt(volProfile.valueAreaHigh)}`} sub="70% of volume" />
        </div>
      </Panel>

      <Panel title="Market Structure / SMC">
        <div className="space-y-2">
          <Row label="Structure" value={structure.structure} tone={structure.structure === "HH/HL uptrend" ? "bull" : structure.structure === "LH/LL downtrend" ? "bear" : undefined} />
          <Row label="BOS" value={structure.bos} sub={structure.bos === "none" ? "No change of character" : undefined} tone={structure.bos === "bullish" ? "bull" : structure.bos === "bearish" ? "bear" : undefined} />
          {structure.bullishOB && <Row label="Bullish OB" value={`${fmt(structure.bullishOB.low)} – ${fmt(structure.bullishOB.high)}`} sub="Order block zone" tone="bull" />}
          {structure.bearishOB && <Row label="Bearish OB" value={`${fmt(structure.bearishOB.low)} – ${fmt(structure.bearishOB.high)}`} sub="Order block zone" tone="bear" />}
        </div>
      </Panel>

      <Panel title="Liquidity / Stop Hunts">
        <div className="space-y-2">
          {liquidity.sellSideGrab
            ? <Row label="Sell-side grab" value={fmt(liquidity.sellSideGrab.price)} sub={liquidity.sellSideGrab.datetime} tone="bull" />
            : <div className="text-xs text-[#7E8CA0]">No recent sell-side liquidity grab detected.</div>}
          {liquidity.buySideGrab
            ? <Row label="Buy-side grab" value={fmt(liquidity.buySideGrab.price)} sub={liquidity.buySideGrab.datetime} tone="bear" />
            : <div className="text-xs text-[#7E8CA0]">No recent buy-side liquidity grab detected.</div>}
        </div>
      </Panel>

      <Panel title="Candlestick Rejection">
        {rejection.doji && <Row label="Doji" value="Detected" sub="Indecision — body < 10% of range" />}
        {rejection.pinBarBullish && <Row label="Bullish Pin Bar" value="Detected" tone="bull" />}
        {rejection.pinBarBearish && <Row label="Bearish Pin Bar" value="Detected" tone="bear" />}
        {!rejection.doji && !rejection.pinBarBullish && !rejection.pinBarBearish && <div className="text-xs text-[#7E8CA0]">No rejection pattern on the latest candle.</div>}
      </Panel>

      <Panel title="Multi-Timeframe">
        <div className="space-y-2">
          <Row label="1H Bias" value={mtf.h1} tone={mtf.h1 === "bullish" ? "bull" : mtf.h1 === "bearish" ? "bear" : undefined} />
          <Row label="4H Bias" value={mtf.h4} tone={mtf.h4 === "bullish" ? "bull" : mtf.h4 === "bearish" ? "bear" : undefined} />
          <Row label="Daily Bias" value={mtf.daily} sub={mtf.h1 !== mtf.h4 || mtf.h4 !== mtf.daily ? "Mixed timeframes" : undefined} tone={mtf.daily === "bullish" ? "bull" : mtf.daily === "bearish" ? "bear" : undefined} />
        </div>
      </Panel>

      {fib && (
        <Panel title="Fibonacci Retracement" right={<span className="text-xs text-[#7E8CA0] mono">{fmt(fib.low)} – {fmt(fib.high)}</span>}>
          <div className="grid grid-cols-2 gap-2">
            {fib.levels.map(l => (
              <Row key={l.pct} label={`${(l.pct * 100).toFixed(1)}%`} value={fmt(l.price)} />
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Elliott Wave (probabilistic)">
        <div className="text-[11px] text-[#7E8CA0] mb-2">Heuristic swing-alternation check — not a rigorous Elliott Wave count. Treat as a rough tell, not gospel.</div>
        <Row label="Best guess wave" value={wave.label} sub={`Probability ${wave.probability}%`} tone={wave.label.includes("up") ? "bull" : wave.label.includes("down") ? "bear" : undefined} />
      </Panel>
    </div>
  );
}

function SymbolBar({ symbol, setSymbol, interval, setInterval_, run, loading, tdKey }) {
  return (
    <Panel title={<span className="flex items-center gap-2"><Layers size={15} /> Technical Analysis AI</span>}>
      <div className="flex gap-2 mb-2">
        <input
          value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
          placeholder="e.g. AAPL, RELIANCE:NSE, EUR/USD"
          className="flex-1 bg-[#131B26] border border-[#1C2733] rounded-md px-3 py-2 text-sm mono"
        />
        <select value={interval} onChange={e => setInterval_(e.target.value)} className="bg-[#131B26] border border-[#1C2733] rounded-md px-2 text-sm">
          <option value="15min">15m</option>
          <option value="1h">1H</option>
          <option value="4h">4H</option>
          <option value="1day">1D</option>
        </select>
      </div>
      <button onClick={run} disabled={loading || !tdKey} className="w-full py-2 rounded-md bg-[#2FD98A] text-[#0A0E14] font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2">
        <Radio size={14} /> {loading ? "Analyzing…" : "Run AI Analysis"}
      </button>
      {!tdKey && <div className="text-[11px] text-[#7E8CA0] mt-2">Needs a Twelve Data key in Settings — real indicators require real OHLCV history, no simulated fallback here.</div>}
    </Panel>
  );
    }
