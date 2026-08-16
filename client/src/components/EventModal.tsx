import type { TrainingStats } from '../types';
import { fmtMoneyFull, fmtPct } from '../lib/format';

interface Props {
  type: string;
  stats: TrainingStats;
  walletBalance: number;
  bankruptCount: number;
  fortuneCount: number;
  onReview: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function EventModal({ type, stats, walletBalance, bankruptCount, fortuneCount, onReview, onNext, onClose }: Props) {
  const isBankrupt = type === 'bankrupt';
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[480px] animate-slideUp text-center">
        <div className="text-5xl mb-3">{isBankrupt ? '💸' : '🤑'}</div>
        <h2 className={`text-xl font-bold mb-2 ${isBankrupt ? 'text-red-500' : 'text-amber-500'}`}>{isBankrupt ? '破产！' : '暴富！'}</h2>
        <p className="text-sm text-slate-400 mb-4">
          {isBankrupt ? '资金已跌破 ¥1,000，回到起点重新开始。' : '恭喜！资金突破 1 亿大关，回到起点重新开始。'}
        </p>
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1 mb-4">
          <div>本局收益：<b className={stats.totalPnl >= 0 ? 'text-red-500' : 'text-green-500'}>{fmtPct(stats.totalPnlPct)}</b></div>
          <div className="text-slate-400">累计破产 {bankruptCount} 次 · 累计暴富 {fortuneCount} 次</div>
          <div className="text-slate-400">当前资金已重置为 {fmtMoneyFull(walletBalance)}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={onReview} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 transition">复盘</button>
          <button onClick={onNext} className="flex-1 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition">下一盘</button>
        </div>
      </div>
    </div>
  );
}
