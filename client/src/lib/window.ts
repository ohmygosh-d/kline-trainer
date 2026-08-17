/**
 * window.ts — 训练窗口（按「日期」锚定，而非按「根数」）
 *
 * 关键设计：训练周期 = 同一个时间段。无论日线 / 周线 / 月线，
 * 训练开始日期(trainStart)与结束日期(trainEnd)都保持一致，
 * 切换周期只是换一个分辨率来观察同一段行情。
 *
 * 因此窗口以「日线」为基准计算两个边界日期，其余周期按日期对齐，
 * 根数可以不同，但覆盖的时间段完全一样。
 */
import type { Bar } from '../types';

/** 训练窗口长度（日线根数≈交易日数 ≈ 7 个月） */
export const WINDOW_DAILY_BARS = 150;
/** 复盘可见的后续走势（日线根数 ≈ 7 个月，直到今天） */
export const TAIL_DAILY_BARS = 150;

/** 第一个 date >= target 的下标；找不到返回 bars.length */
export function idxAtOrAfter(bars: Bar[], date: string): number {
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].date >= date) return i;
  }
  return bars.length;
}

/**
 * 以日线全量历史推导训练窗口的两个边界日期：
 *  - 训练结束日期 = 距今 TAIL 根日线之前
 *  - 训练开始日期 = 训练结束日期再往前 WINDOW 根日线
 * 这样日/周/月三档看到的都是「同一时间段」。
 */
export function computeWindowDates(daily: Bar[]): { start: string; end: string } {
  const L = daily.length;
  const WIN = WINDOW_DAILY_BARS;
  const TAIL = TAIL_DAILY_BARS;
  let trainEnd = L - TAIL;
  // 数据不足以留出完整复盘尾段时，把结束点尽量靠后，但保留一段历史
  if (trainEnd <= 0) trainEnd = Math.max(1, Math.floor(L * 0.8));
  let trainStart = trainEnd - WIN;
  if (trainStart < 0) trainStart = 0;
  return {
    start: daily[trainStart]?.date || daily[0]?.date || '',
    end: daily[trainEnd]?.date || daily[daily.length - 1]?.date || '',
  };
}
