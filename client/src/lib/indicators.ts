/** 技术指标计算 — MACD / KDJ / RSI / BOLL */
import type { Bar } from '../types';

export function calcEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) { prev = values[i]; result.push(values[i]); continue; }
    prev = values[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

export function calcMA(bars: Bar[], period: number): (number | null)[] {
  return calcMAValues(bars.map(b => b.close), period);
}

export function calcMAValues(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

export function calcMACD(bars: Bar[], fast = 12, slow = 26, signal = 9) {
  const closes = bars.map(b => b.close);
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const dif = closes.map((_, i) => (emaFast[i] ?? 0) - (emaSlow[i] ?? 0));
  const deaArr = calcEMA(dif, signal);
  const hist = dif.map((d, i) => 2 * (d - (deaArr[i] ?? 0)));
  return { dif, dea: deaArr, hist };
}

export function calcKDJ(bars: Bar[], n = 9) {
  let k = 50, d = 50;
  const kArr: number[] = [], dArr: number[] = [], jArr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const start = Math.max(0, i - n + 1);
    let hn = -Infinity, ln = Infinity;
    for (let j = start; j <= i; j++) {
      hn = Math.max(hn, bars[j].high);
      ln = Math.min(ln, bars[j].low);
    }
    const rsv = hn === ln ? 50 : ((bars[i].close - ln) / (hn - ln)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    kArr.push(k); dArr.push(d); jArr.push(j);
  }
  return { k: kArr, d: dArr, j: jArr };
}

export function calcRSI(bars: Bar[], period = 6) {
  const result: number[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) { result.push(50); continue; }
    const change = bars[i].close - bars[i - 1].close;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }
  return result;
}

export function calcBOLL(bars: Bar[], period = 20, mult = 2) {
  const mid: (number | null)[] = [];
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) { mid.push(null); upper.push(null); lower.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close;
    const ma = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) varSum += (bars[j].close - ma) ** 2;
    const sd = Math.sqrt(varSum / period);
    mid.push(ma);
    upper.push(ma + mult * sd);
    lower.push(ma - mult * sd);
  }
  return { mid, upper, lower };
}
