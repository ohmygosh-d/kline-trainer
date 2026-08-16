import type { TrainingState } from '../types';
import { fmtPct } from '../lib/format';

interface Props {
  training: TrainingState;
  onNextSession: () => void;
}

export function ReviewBar({ training, onNextSession }: Props) {
  const stats = {
    totalPnlPct: 0,
    stockReturnPct: 0,
    beatMarket: 0,
    totalTrades: training.trades.length,
    winRate: 0,
  };

  // Calculate from trades
  const sells = training.trades.filter(t => t.action === 'sell');
  const wins = sells.filter(t => (t.pnl ?? 0) > 0);
  stats.winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;

  // Calculate pnl
  const startBar = training.bars[training.trainStart];
  const endBar = training.bars[training.trainEnd - 1];
  stats.stockReturnPct = startBar && endBar ? (endBar.close / startBar.close - 1) * 100 : 0;

  const beatLabel = stats.beatMarket >= 0 ? '跑赢' : '跑输';

  return (
    <div className="h-10 bg-white border-t border-slate-200 flex items-center px-4 gap-4 text-sm">
      <span className="font-bold text-slate-800">{training.symbol}</span>
      <span className="text-slate-400">{training.code}</span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">交易 {stats.totalTrades} 笔 · 胜率 {stats.winRate.toFixed(0)}%</span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">股票涨幅 {fmtPct(stats.stockReturnPct)}</span>
      <span className="text-slate-300">|</span>
      <span className="text-blue-400">{beatLabel} {fmtPct(Math.abs(stats.beatMarket))}</span>
      <span className="text-slate-300">|</span>
      <span className={`text-xs ${training.isReal ? 'text-red-500' : 'text-slate-400'}`}>{training.isReal ? '真实行情' : '模拟行情'}</span>
      <div className="flex-1" />
      <button
        onClick={onNextSession}
        className="px-4 py-1.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition"
      >下一盘 ▶</button>
    </div>
  );
}
