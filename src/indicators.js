// Pure technical-analysis math. All functions take an array of candles:
// { i, datetime, open, high, low, close, volume } and return computed values.
// No React, no fetching — this file is intentionally side-effect free so the
// math can be trusted and (if you ever want) unit tested in isolation.

// EMA over a series, tolerant of leading nulls (used for MACD signal line,
// which is an EMA of the MACD line rather than of price).
export function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  const startIdx = values.findIndex(v => v != null);
  if (startIdx === -1) return out;
  let count = 0, sum = 0, seedIdx = -1;
  for (let i = startIdx; i < values.length; i++) {
    if (values[i] == null) continue;
    count++; sum += values[i];
    if (count === period) { seedIdx = i; break; }
  }
  if (seedIdx === -1) return out;
  let prev = sum / period;
  out[seedIdx] = prev;
  for (let i = seedIdx + 1; i < values.length; i++) {
    if (values[i] == null) { out[i] = prev; continue; }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function calcRSI(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null) ? v - signalLine[i] : null);
  return { macdLine, signalLine, histogram };
}

export function calcATR(candles, period = 14) {
  const n = candles.length;
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const out = new Array(n).fill(null);
  if (n < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function calcADX(candles, period = 14) {
  const n = candles.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose));
  }
  const wilderSmooth = (arr) => {
    const out = new Array(n).fill(null);
    if (n <= period) return out;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i];
    out[period] = sum;
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const trS = wilderSmooth(tr), plusDMS = wilderSmooth(plusDM), minusDMS = wilderSmooth(minusDM);
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const dx = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (trS[i] == null || trS[i] === 0) continue;
    plusDI[i] = 100 * (plusDMS[i] / trS[i]);
    minusDI[i] = 100 * (minusDMS[i] / trS[i]);
    const diSum = plusDI[i] + minusDI[i];
    dx[i] = diSum === 0 ? 0 : 100 * Math.abs(plusDI[i] - minusDI[i]) / diSum;
  }
  const adx = new Array(n).fill(null);
  const firstDxIdx = dx.findIndex(v => v != null);
  if (firstDxIdx !== -1 && n >= firstDxIdx + period) {
    let sum = 0;
    for (let i = firstDxIdx; i < firstDxIdx + period; i++) sum += dx[i];
    let prev = sum / period;
    adx[firstDxIdx + period - 1] = prev;
    for (let i = firstDxIdx + period; i < n; i++) {
      prev = (prev * (period - 1) + dx[i]) / period;
      adx[i] = prev;
    }
  }
  return { adx, plusDI, minusDI };
}

export function calcBollinger(closes, period = 20, mult = 2) {
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const mid = new Array(closes.length).fill(null);
  const width = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    const mean = sum / period;
    let variance = 0;
    for (let k = i - period + 1; k <= i; k++) variance += (closes[k] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    mid[i] = mean; upper[i] = mean + mult * sd; lower[i] = mean - mult * sd;
    width[i] = mean !== 0 ? (upper[i] - lower[i]) / mean : null;
  }
  return { upper, lower, mid, width };
}

export function calcVWAP(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typical * (candles[i].volume || 0);
    cumV += candles[i].volume || 0;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

export function calcIchimoku(candles) {
  const highLowAvg = (start, end) => {
    let hi = -Infinity, lo = Infinity;
    for (let i = start; i <= end; i++) { hi = Math.max(hi, candles[i].high); lo = Math.min(lo, candles[i].low); }
    return (hi + lo) / 2;
  };
  const n = candles.length;
  const tenkan = n >= 9 ? highLowAvg(n - 9, n - 1) : null;
  const kijun = n >= 26 ? highLowAvg(n - 26, n - 1) : null;
  const senkouA = (tenkan != null && kijun != null) ? (tenkan + kijun) / 2 : null;
  const senkouB = n >= 52 ? highLowAvg(n - 52, n - 1) : null;
  const cloudTop = (senkouA != null && senkouB != null) ? Math.max(senkouA, senkouB) : null;
  const cloudBottom = (senkouA != null && senkouB != null) ? Math.min(senkouA, senkouB) : null;
  return { tenkan, kijun, senkouA, senkouB, cloudTop, cloudBottom };
}

export function calcFibonacci(candles, lookback = 100) {
  const slice = candles.slice(-lookback);
  if (slice.length === 0) return null;
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  const range = high - low;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786].map(pct => ({ pct, price: high - range * pct }));
  return { high, low, levels };
}

export function calcVolumeProfile(candles, bins = 24) {
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
  const top = Math.max(...highs), bottom = Math.min(...lows);
  const binSize = (top - bottom) / bins || 1;
  const volAtBin = new Array(bins).fill(0);
  candles.forEach(c => {
    const mid = (c.high + c.low) / 2;
    let idx = Math.floor((mid - bottom) / binSize);
    idx = Math.max(0, Math.min(bins - 1, idx));
    volAtBin[idx] += c.volume || 0;
  });
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (volAtBin[i] > volAtBin[pocIdx]) pocIdx = i;
  const poc = bottom + binSize * (pocIdx + 0.5);
  const totalVol = volAtBin.reduce((a, b) => a + b, 0);
  let covered = volAtBin[pocIdx], lo = pocIdx, hi = pocIdx;
  while (covered < totalVol * 0.7 && (lo > 0 || hi < bins - 1)) {
    const volLo = lo > 0 ? volAtBin[lo - 1] : -1;
    const volHi = hi < bins - 1 ? volAtBin[hi + 1] : -1;
    if (volHi >= volLo) { hi++; covered += volAtBin[hi]; } else { lo--; covered += volAtBin[lo]; }
  }
  return { poc, valueAreaLow: bottom + binSize * lo, valueAreaHigh: bottom + binSize * (hi + 1) };
}

export function findSwings(candles, lookback = 3) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const windowSlice = candles.slice(i - lookback, i + lookback + 1);
    const isHigh = candles[i].high === Math.max(...windowSlice.map(c => c.high));
    const isLow = candles[i].low === Math.min(...windowSlice.map(c => c.low));
    if (isHigh) swings.push({ i, type: "high", price: candles[i].high });
    else if (isLow) swings.push({ i, type: "low", price: candles[i].low });
  }
  return swings;
}

export function calcMarketStructure(candles) {
  const swings = findSwings(candles, 3);
  const highs = swings.filter(s => s.type === "high");
  const lows = swings.filter(s => s.type === "low");
  let structure = "ranging";
  if (highs.length >= 2 && lows.length >= 2) {
    const h = highs.slice(-2), l = lows.slice(-2);
    if (h[1].price > h[0].price && l[1].price > l[0].price) structure = "HH/HL uptrend";
    else if (h[1].price < h[0].price && l[1].price < l[0].price) structure = "LH/LL downtrend";
  }
  const lastClose = candles[candles.length - 1].close;
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  let bos = "none";
  if (structure === "HH/HL uptrend" && lastLow && lastClose < lastLow.price) bos = "bearish";
  if (structure === "LH/LL downtrend" && lastHigh && lastClose > lastHigh.price) bos = "bullish";

  let bullishOB = null, bearishOB = null;
  for (let i = candles.length - 2; i > 0; i--) {
    const c = candles[i], next = candles[i + 1];
    const moveUp = (next.close - next.open) / next.open;
    const moveDown = (next.open - next.close) / next.open;
    if (!bullishOB && c.close < c.open && moveUp > 0.01) bullishOB = { low: c.low, high: c.high };
    if (!bearishOB && c.close > c.open && moveDown > 0.01) bearishOB = { low: c.low, high: c.high };
    if (bullishOB && bearishOB) break;
  }
  return { structure, bos, bullishOB, bearishOB };
}

export function findLiquidityGrabs(candles) {
  const avgVol = candles.reduce((a, c) => a + (c.volume || 0), 0) / candles.length;
  let sellSideGrab = null, buySideGrab = null;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 40); i--) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range <= 0) continue;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const volSpike = (c.volume || 0) > avgVol * 1.5;
    if (!sellSideGrab && lowerWick / range > 0.5 && c.close > c.open) sellSideGrab = { i, datetime: c.datetime, price: c.low, volSpike };
    if (!buySideGrab && upperWick / range > 0.5 && c.close < c.open) buySideGrab = { i, datetime: c.datetime, price: c.high, volSpike };
    if (sellSideGrab && buySideGrab) break;
  }
  return { sellSideGrab, buySideGrab };
}

export function calcCandlestickRejection(candle) {
  const range = candle.high - candle.low;
  if (range <= 0) return { doji: false, pinBarBullish: false, pinBarBearish: false };
  const body = Math.abs(candle.close - candle.open);
  const doji = body / range < 0.1;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const pinBarBullish = lowerWick / range > 0.6 && body / range < 0.3;
  const pinBarBearish = upperWick / range > 0.6 && body / range < 0.3;
  return { doji, pinBarBullish, pinBarBearish };
}

// Rough heuristic only — real Elliott Wave labeling is subjective even among
// professional analysts. This checks whether recent swings alternate cleanly
// (a loose proxy for "impulsive") and reports a confidence, not a certainty.
export function elliottWaveGuess(candles) {
  const swings = findSwings(candles, 3).slice(-6);
  if (swings.length < 5) return { label: "unclear", probability: 0 };
  let alternating = true;
  for (let i = 1; i < swings.length; i++) if (swings[i].type === swings[i - 1].type) alternating = false;
  const lastFew = swings.slice(-5);
  const trendUp = lastFew[lastFew.length - 1].price > lastFew[0].price;
  const label = alternating ? (trendUp ? "impulse up" : "impulse down") : "corrective / unclear";
  const probability = alternating ? (trendUp ? 78 : 74) : 40;
  return { label, probability };
}

export function simpleTimeframeBias(candles) {
  if (candles.length < 50) return "neutral";
  const closes = candles.map(c => c.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const last = closes.length - 1;
  if (ema20[last] == null || ema50[last] == null) return "neutral";
  if (closes[last] > ema20[last] && ema20[last] > ema50[last]) return "bullish";
  if (closes[last] < ema20[last] && ema20[last] < ema50[last]) return "bearish";
  return "neutral";
}

// Combines directional signals into a bull/bear vote count and a verdict.
export function compositeBias({ macdHist, plusDI, minusDI, priceAboveVWAP, structure, rsi }) {
  let bull = 0, bear = 0;
  if (macdHist > 0) bull++; else if (macdHist < 0) bear++;
  if (plusDI > minusDI) bull++; else if (minusDI > plusDI) bear++;
  if (priceAboveVWAP === true) bull++; else if (priceAboveVWAP === false) bear++;
  if (structure === "HH/HL uptrend") bull++; else if (structure === "LH/LL downtrend") bear++;
  if (rsi > 55) bull++; else if (rsi < 45) bear++;
  const net = bull - bear;
  const label = net > 0 ? "BULLISH" : net < 0 ? "BEARISH" : "NEUTRAL";
  return { bull, bear, net, label };
  }
