import { useStore } from '../store/store';
import type { TrainingState } from '../types';
import { fmtMoneyFull, fmtPct, fmtPrice } from '../lib/format';

interface Props {
  training: TrainingState | null;
  finished: boolean;
  onBuy: (type: 1 | 2) => void;
  onSell: (type: 1 | 2) => void;
  onNext: () => void;
  onFinish: () => void;
  onNewSession: () => void;
}

export function TradePanel({ training, finished, onBuy, onSell, onNext, onFinish, onNewSession }: Props) {
  const { showToast } = useStore();
  if (!training) return null;

  const bar = training.bars[training.visibleCount - 1];
  const price = bar?.close || 0;
  const hasPosition = !!training.position;
  const pos = training.position;
  const equity = (bar ? pos ? pos.shares * price + (training as any).cash || 0 : 0 : 0);

  // Calculate current equity
  const cash = 100000 - training.trades.reduce((s, t) => s + (t.action === 'buy' ? t.price * t.qty : -t.price * t.qty), 0);
  const posVal = pos ? pos.shares * price : 0;
  const totalEquity = cash + posVal;
  const pnl = totalEquity - 100000;
  const pnlPct = (pnl / 100000) * 100;

  return (
    <aside className="w-full md:w-72 h-[42vh] md:h-auto bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col overflow-hidden">
      {/* Price info */}
      <div className="p-3 border-b border-slate-200">
        <div className="grid grid-cols-4 gap-2 text-xs">
          {(['open', 'high', 'low', 'close'] as const).map(k => (
            <div key={k} className="text-center">
              <div className="text-slate-400 mb-0.5">{k === 'open' ? '开' : k === 'high' ? '高' : k === 'low' ? '低' : '收'}</div>
              <div className="font-mono font-semibold text-slate-700">{fmtPrice(bar?.[k] || 0)}</div>
            </div>
          ))}
        </div>
        {bar && (
          <div className="mt-2 text-center text-xs text-slate-400">{bar.date}</div>
        )}
      </div>

      {/* Position info */}
      <div className="p-3 border-b border-slate-200">
        <div className="text-xs text-slate-400 mb-2">持仓</div>
        {pos ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">持仓量</span><span className="font-mono">{pos.shares} 股</span></div>
            <div className="flex justify-between"><span className="text-slate-400">成本价</span><span className="font-mono">{fmtPrice(pos.entryPrice)}</span></div>
            <div className="flex justify-between">
              <span className="text-slate-400">浮动盈亏</span>
              <span className={`font-mono font-bold ${(price - pos.entryPrice) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                {fmtPct((price / pos.entryPrice - 1) * 100)}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-300 text-center py-2">空仓</div>
        )}
      </div>

      {/* Equity */}
      <div className="p-3 border-b border-slate-200">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">总资产</span>
          <span className="font-mono font-bold text-slate-800">{fmtMoneyFull(totalEquity)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-slate-400">盈亏</span>
          <span className={`font-mono font-bold ${pnl >= 0 ? 'text-red-500' : 'text-green-500'}`}>{fmtPct(pnlPct)}</span>
        </div>
      </div>

      {/* Trade buttons */}
      <div className="p-3 space-y-2 flex-1 overflow-auto">
        {!finished ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onBuy(1)}
                disabled={hasPosition}
                className="py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >半仓买入<kbd className="ml-1">B</kbd></button>
              <button
                onClick={() => onBuy(2)}
                disabled={hasPosition}
                className="py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >全仓买入</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onSell(1)}
                disabled={!hasPosition}
                className="py-2.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >半仓卖出<kbd className="ml-1">M</kbd></button>
              <button
                onClick={() => onSell(2)}
                disabled={!hasPosition}
                className="py-2.5 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >全仓卖出</button>
            </div>
            <button
              onClick={onNext}
              disabled={finished}
              className="w-full py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 transition"
            >观望下一根 ▶ <kbd className="ml-1">Space</kbd></button>
            <button
              onClick={onFinish}
              disabled={finished}
              className="w-full py-2 bg-slate-100 text-slate-500 rounded-lg text-sm font-medium hover:bg-slate-200 transition"
            >结束训练</button>
          </>
        ) : (
          <button
            onClick={onNewSession}
            className="w-full py-3 bg-brand-500 text-white rounded-lg text-sm font-bold hover:bg-brand-600 transition animate-fadeIn"
            style={{ animation: 'pulseBtn 2s ease-in-out infinite' }}
          >新一局 ▶</button>
        )}
      </div>

      <div className="p-3 border-t border-slate-200">
        <button
          onClick={() => { if (confirm('确定重新开始训练？当前进度将丢失')) onNewSession(); }}
          className="w-full py-1.5 text-xs text-slate-400 hover:text-slate-600 transition"
        >重新训练</button>
      </div>
    </aside>
  );
}
