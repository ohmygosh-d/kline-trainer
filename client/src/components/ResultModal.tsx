import type { TrainingState, TrainingStats } from '../types';
import { fmtMoneyFull, fmtPct, cls } from '../lib/format';

interface Props {
  training: TrainingState;
  stats: TrainingStats;
  walletBalance: number;
  bankruptCount: number;
  fortuneCount: number;
  onReview: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function ResultModal({ training, stats, walletBalance, bankruptCount, fortuneCount, onReview, onNext, onClose }: Props) {
  const periodLabel = training.period === 'daily' ? '日线' : training.period === 'weekly' ? '周线' : '月线';
  const dataLabel = training.isReal ? '真实行情' : '模拟行情';
  const hasAutoSold = training._autoSold;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[600px] max-h-[90vh] overflow-auto animate-slideUp">
        <h2 className="text-lg font-bold text-slate-800 mb-1">
          训练完成 · {stats.totalPnl >= 0 ? '盈利' : '亏损'}
        </h2>
        <div className="text-xs text-slate-400 mb-4">
          {training.symbol}（{training.code}）· {periodLabel} · 训练周期 {training.trainStartDate} ~ {training.trainEndDate} · <span className={training.isReal ? 'text-red-500' : 'text-slate-400'}>{dataLabel}</span>
        </div>
        {hasAutoSold && (
          <div className="text-xs text-amber-500 bg-amber-50 rounded-lg px-3 py-2 mb-3">⚠ 训练结束时仍有持仓，已按收盘价自动卖出</div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: '你的收益', val: fmtPct(stats.totalPnlPct), c: cls(stats.totalPnlPct) },
            { label: '股票涨幅', val: fmtPct(stats.stockReturnPct), c: cls(stats.stockReturnPct) },
            { label: '超额收益', val: fmtPct(stats.beatMarket), c: cls(stats.beatMarket) },
            { label: '最终资产', val: fmtMoneyFull(stats.finalEquity), c: '' },
            { label: '胜率', val: stats.totalTrades > 0 ? stats.winRate.toFixed(1) + '%' : '—', c: '' },
            { label: '盈亏比', val: stats.pnlRatio >= 99 ? '∞' : stats.pnlRatio.toFixed(2), c: '' },
          ].map(card => (
            <div key={card.label} className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-xs text-slate-400 mb-1">{card.label}</div>
              <div className={`font-bold text-lg ${card.c === 'up' ? 'text-red-500' : card.c === 'down' ? 'text-green-500' : 'text-slate-800'}`}>{card.val}</div>
            </div>
          ))}
        </div>

        <div className="text-xs text-slate-400 mb-4">
          交易 {stats.totalTrades} 笔 · 游戏资金 {fmtMoneyFull(walletBalance)} · 破产 {bankruptCount} 次 · 暴富 {fortuneCount} 次
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button onClick={onReview} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition">复盘</button>
          <button onClick={onNext} className="flex-1 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition">下一盘</button>
          <button onClick={onClose} className="flex-1 py-2.5 bg-slate-100 text-slate-400 rounded-lg text-sm font-medium hover:bg-slate-200 transition">关闭</button>
        </div>
      </div>
    </div>
  );
}
