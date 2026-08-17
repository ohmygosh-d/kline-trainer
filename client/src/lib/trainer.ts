/**
 * trainer.ts — 训练逻辑 (TypeScript)
 * 管理交易训练会话：买入/卖出/推进K线/结束/统计
 *
 * 训练窗口按「日期」锚定：同一个时间段在日/周/月线下完全一致，
 * 切换周期只是换分辨率，不换股票、不换训练区间。
 */

import type { Bar, Position, Trade, TrainingState, TrainingStats } from '../types';
import { idxAtOrAfter } from './window';

interface TrainerConfig {
  capital: number;
  fee: number;
  period: string;
}

interface InternalState {
  bars: Bar[];
  symbol: string;
  code: string;
  startDate: string;
  endDate: string | null;
  isReal: boolean;
  period: string;
  /** 训练窗口的起始日期（含）—— 所有周期共用，保证时间段一致 */
  windowStart: string;
  /** 训练窗口的结束日期（含）—— 即后续走势（复盘）的起点 */
  windowEnd: string;
  /** 当前周期下，训练第一根K线的下标 */
  trainStart: number;
  /** 当前周期下，训练区间的结束下标（不含，第一根复盘K线） */
  trainEnd: number;
  /** 已揭示K线数量（当前周期下标，含） */
  visibleCount: number;
  /** 当前进度所处的日期（用于跨周期对齐进度） */
  progressDate: string;
  dailyProgress: number;
  dailyTotal: number;
  cash: number;
  capital: number;
  position: { dir: string; qty: number; cost: number; entryIdx: number } | null;
  trades: Trade[];
  finished: boolean;
  fee: number;
  _autoSold: boolean;
}

export class Trainer {
  private state: InternalState | null = null;
  private config: TrainerConfig = { capital: 100000, fee: 0.0003, period: 'daily' };
  private equityCurve: number[] = [];
  private onFinishCb: ((s: TrainingState) => void) | null = null;

  setConfig(cfg: Partial<TrainerConfig>) { Object.assign(this.config, cfg); }
  getConfig(): TrainerConfig { return { ...this.config }; }
  onFinish(cb: (s: TrainingState) => void) { this.onFinishCb = cb; }

  /** 新一局：基于「同一时间段」的窗口日期，初始化训练 */
  startWithMarket(
    market: { bars: Bar[]; code: string; symbol: string; startDate: string; endDate?: string; isReal: boolean },
    cfg?: Partial<TrainerConfig>,
    windowDates?: { start: string; end: string },
  ): TrainingState {
    if (cfg) Object.assign(this.config, cfg);
    const bars = market.bars;
    const dates = windowDates || { start: bars[0]?.date || '', end: bars[bars.length - 1]?.date || '' };
    const trainStart = idxAtOrAfter(bars, dates.start);
    let trainEnd = idxAtOrAfter(bars, dates.end);
    if (trainEnd <= trainStart) trainEnd = Math.min(bars.length, trainStart + 1);

    this.state = {
      bars,
      symbol: market.symbol,
      code: market.code,
      startDate: market.startDate || bars[0]?.date || '',
      endDate: market.endDate || null,
      isReal: market.isReal,
      period: this.config.period,
      windowStart: dates.start,
      windowEnd: dates.end,
      trainStart,
      trainEnd,
      visibleCount: trainStart, // 开局即可见训练前的全部历史（上市 → 开始节点）
      progressDate: bars[Math.max(0, Math.min(trainStart, bars.length - 1))]?.date || '',
      dailyProgress: 0,
      dailyTotal: trainEnd - trainStart,
      cash: this.config.capital,
      capital: this.config.capital,
      position: null,
      trades: [],
      finished: false,
      fee: this.config.fee,
      _autoSold: false,
    };
    this.equityCurve = [];
    this.recordEquity();
    return this.getState()!;
  }

  /** 训练进行中切换周期：保持同一只股票、同一时间段，仅换分辨率并保留进度 */
  applyPeriod(bars: Bar[], period: string): TrainingState | null {
    if (!this.state) return null;
    const s = this.state;
    this.config.period = period;
    const trainStart = idxAtOrAfter(bars, s.windowStart);
    let trainEnd = idxAtOrAfter(bars, s.windowEnd);
    if (trainEnd <= trainStart) trainEnd = Math.min(bars.length, trainStart + 1);

    // 按当前进度日期对齐到新周期的对应K线
    let visible = idxAtOrAfter(bars, s.progressDate);
    if (visible > trainEnd) visible = trainEnd;
    if (visible < trainStart) visible = trainStart;

    s.bars = bars;
    s.period = period;
    s.trainStart = trainStart;
    s.trainEnd = trainEnd;
    s.visibleCount = visible;
    s.dailyTotal = trainEnd - trainStart;
    s.dailyProgress = visible - trainStart;
    s.progressDate = bars[Math.max(0, Math.min(visible - 1, bars.length - 1))]?.date || s.progressDate;
    return this.getState();
  }

  getWindowDates(): { start: string; end: string } | null {
    if (!this.state) return null;
    return { start: this.state.windowStart, end: this.state.windowEnd };
  }

  private currentBar(): Bar | null {
    if (!this.state || this.state.bars.length === 0) return null;
    const idx = Math.min(this.state.visibleCount - 1, this.state.bars.length - 1);
    return this.state.bars[Math.max(0, idx)];
  }

  private currentPrice(): number {
    return this.currentBar()?.close ?? 0;
  }

  private recordEquity() {
    if (!this.state) return;
    const posVal = this.state.position ? this.state.position.qty * this.currentPrice() : 0;
    this.equityCurve.push(this.state.cash + posVal);
  }

  buy(qty: number): TrainingState | null {
    if (!this.state || this.state.position || this.state.finished) return this.getState();
    const price = this.currentPrice();
    if (price <= 0) return this.getState();
    const need = price * qty * (1 + this.state.fee);
    if (this.state.cash < need) {
      qty = Math.floor(this.state.cash / (price * (1 + this.state.fee)) / 100) * 100;
      if (qty <= 0) return this.getState();
    }
    const cost = price * qty;
    const fee = cost * this.state.fee;
    this.state.cash -= (cost + fee);
    this.state.position = { dir: 'long', qty, cost: price, entryIdx: this.state.visibleCount - 1 };
    this.state.trades.push({ action: 'buy', index: this.state.visibleCount - 1, price, qty, date: this.currentBar()?.date || '', type: 'full' });
    this.recordEquity();
    return this.getState();
  }

  sell(qty: number): TrainingState | null {
    if (!this.state || !this.state.position || this.state.finished) return this.getState();
    qty = Math.min(qty, this.state.position.qty);
    const price = this.currentPrice();
    const pnl = (price - this.state.position.cost) * qty - price * qty * this.state.fee;
    const proceeds = price * qty;
    const fee = proceeds * this.state.fee;
    this.state.cash += (proceeds - fee);
    this.state.position.qty -= qty;
    this.state.trades.push({ action: 'sell', index: this.state.visibleCount - 1, price, qty, pnl, date: this.currentBar()?.date || '', type: 'full' });
    if (this.state.position.qty <= 0) this.state.position = null;
    this.recordEquity();
    return this.getState();
  }

  next(): TrainingState | null {
    if (!this.state || this.state.finished) return this.getState();
    if (this.state.visibleCount >= this.state.trainEnd) { this.finish(); return this.getState(); }
    this.state.visibleCount++;
    this.state.progressDate = this.currentBar()?.date || this.state.progressDate;
    this.state.dailyProgress = this.state.visibleCount - this.state.trainStart;
    this.recordEquity();
    if (this.state.visibleCount >= this.state.trainEnd) {
      this.finish();
    }
    return this.getState();
  }

  close(): TrainingState | null {
    if (!this.state || !this.state.position) return this.getState();
    return this.sell(this.state.position.qty);
  }

  finish() {
    if (!this.state || this.state.finished) return;
    if (this.state.position) {
      const price = this.currentPrice();
      const pos = this.state.position;
      const pnl = (price - pos.cost) * pos.qty - price * pos.qty * this.state.fee;
      this.state.cash += price * pos.qty - price * pos.qty * this.state.fee;
      this.state.trades.push({ action: 'sell', index: this.state.visibleCount - 1, price, qty: pos.qty, pnl, date: this.currentBar()?.date || '', type: 'full' });
      this.state.position = null;
      this.state._autoSold = true;
    }
    this.state.finished = true;
    if (this.onFinishCb) this.onFinishCb(this.getState()!);
  }

  getState(): TrainingState | null {
    if (!this.state) return null;
    const pos = this.state.position;
    const price = this.currentPrice();
    const posVal = pos ? pos.qty * price : 0;
    const equity = this.state.cash + posVal;

    return {
      bars: this.state.bars,
      trainStart: this.state.trainStart,
      trainEnd: this.state.trainEnd,
      visibleCount: this.state.visibleCount,
      position: pos ? { entryPrice: pos.cost, entryIndex: pos.entryIdx, entryDate: this.state.bars[pos.entryIdx]?.date || '', qty: pos.qty, shares: pos.qty, capital: pos.cost * pos.qty, type: 'full' as const } : null,
      trades: this.state.trades.slice(),
      finished: this.state.finished,
      code: this.state.code,
      symbol: this.state.symbol,
      period: this.state.period,
      isReal: this.state.isReal,
      dailyProgress: this.state.dailyProgress,
      dailyTotal: this.state.dailyTotal,
      startDate: this.state.startDate,
      // 关键：训练区间日期在所有周期下完全一致
      trainStartDate: this.state.windowStart,
      trainEndDate: this.state.windowEnd,
      pnl: equity - this.state.capital,
      equity,
      _autoSold: this.state._autoSold,
    };
  }

  getStats(): TrainingStats | null {
    if (!this.state) return null;
    const sells = this.state.trades.filter(t => t.action === 'sell');
    const wins = sells.filter(t => (t.pnl ?? 0) > 0);
    const losses = sells.filter(t => (t.pnl ?? 0) < 0);
    const totalWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
    const s = this.getState()!;
    const startBar = this.state.bars[this.state.trainStart];
    const endBar = this.state.bars[Math.min(this.state.trainEnd - 1, this.state.bars.length - 1)];
    const stockReturnPct = startBar && endBar ? (endBar.close / startBar.close - 1) * 100 : 0;
    const pnlPct = s.pnl / this.state.capital * 100;
    return {
      totalPnl: s.pnl,
      totalPnlPct: pnlPct,
      stockReturnPct,
      beatMarket: pnlPct - stockReturnPct,
      totalTrades: sells.length,
      winRate: sells.length > 0 ? (wins.length / sells.length) * 100 : 0,
      pnlRatio: losses.length > 0 && totalLoss > 0 ? (totalWin / wins.length) / (totalLoss / losses.length) : (wins.length > 0 ? 99 : 0),
      finalEquity: s.equity || (this.state.cash + (this.state.position ? this.state.position.qty * this.currentPrice() : 0)),
      equityCurve: this.equityCurve.map((eq, i) => ({ index: i, equity: eq })),
    };
  }
}

export const trainer = new Trainer();
