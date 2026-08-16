import type { TrainingState } from '../types';
import { fmtPct, fmtPrice } from '../lib/format';

interface Props {
  training: TrainingState;
  replayIdx: number | null;
  onStep: (delta: number) => void;
  onReplay: () => void;
  onNextSession: () => void;
}

export function ReviewBar({ training, replayIdx, onStep, onReplay, onNextSession }: Props) {
  const sells = training.trades.filter(t => t.action === 'sell');
  const wins = sells.filter(t => (t.pnl ?? 0) > 0);
  const totalTrades = training.trades.length;
  const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;

  const startBar = training.bars[training.trainStart];
  const endBar = training.bars[Math.min(training.trainEnd - 1, training.bars.length - 1)];
  const stockReturnPct = startBar && endBar ? (endBar.close / startBar.close - 1) * 100 : 0;
  const beatLabel = stockReturnPct >= 0 ? '跑赢' : '跑输';

  const inReplay = replayIdx !== null;
  const curBar = inReplay ? (training.bars[replayIdx - 1] || training.bars[replayIdx]) : endBar;
  const progress = inReplay ? replayIdx - training.trainStart : training.trainEnd - training.trainStart;
  const total = training.trainEnd - training.trainStart;
  const done = inReplay && replayIdx >= training.trainEnd;

  const happened = inReplay
    ? training.trades.filter(t => t.index < replayIdx)
    : training.trades;

  return (
    <div className="border-t border-slate-200 bg-white">
      <div className="h-10 flex items-center px-4 gap-3 text-sm">
        <span className="font-bold text-slate-800">{training.symbol}</span>
        <span className="text-slate-400">{training.code}</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-500">交易 {totalTrades} 笔 · 胜率 {winRate.toFixed(0)}%</span>
        <span className="text-slate-300">|</span>
        <span className="text-blue-400">{beatLabel} {fmtPct(Math.abs(stockReturnPct))}</span>
        <div className="flex-1" />
        {inReplay ? (
          <>
            <button onClick={() => onStep(-1)} disabled={replayIdx <= training.trainStart} className="px-2 py-1 border border-slate-200 rounded text-xs hover:bg-slate-50 disabled:opacity-30">◀ 上一根</button>
            <span className="text-slate-500 text-xs tabular-nums">{progress}/{total}{done ? ' ✓' : ''}</span>
            <button onClick={() => onStep(1)} disabled={done} className="px-2 py-1 border border-slate-200 rounded text-xs hover:bg-slate-50 disabled:opacity-30">下一根 ▶</button>
            <span className="text-slate-400 text-xs">{curBar?.date}</span>
            <button onClick={onReplay} className="px-2 py-1 border border-slate-200 rounded text-xs text-slate-400 hover:bg-slate-50">⏮ 重播</button>
          </>
        ) : (
          <button onClick={onReplay} className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition">⏮ 逐根回放</button>
        )}
        <button onClick={onNextSession} className="px-4 py-1.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition">下一盘 ▶</button>
      </div>
      {happened.length > 0 && (
        <div className="max-h-32 overflow-auto px-4 pb-2 space-y-0.5 text-xs">
          {happened.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-slate-600">
              <span className="text-slate-400 w-12">{t.date}</span>
              <span className={`w-8 ${t.action === 'buy' ? 'text-red-500' : 'text-green-500'}`}>{t.action === 'buy' ? '买入' : '卖出'}</span>
              <span className="font-mono">{fmtPrice(t.price)}</span>
              <span className="text-slate-400">{t.qty}股</span>
              {t.pnl != null && (
                <span className={t.pnl >= 0 ? 'text-red-500' : 'text-green-500'}>
                  盈亏 {fmtPct((t.pnl / (t.price * t.qty || 1)) * 100)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {inReplay && happened.length === 0 && (
        <div className="px-4 pb-2 text-xs text-slate-400">本局无交易，点击"下一盘"开始新训练。</div>
      )}
    </div>
  );
}
