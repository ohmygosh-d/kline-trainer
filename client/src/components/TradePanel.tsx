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

const INITIAL_CAPITAL = 100000;

export function TradePanel({ training, finished, onBuy, onSell, onNext, onFinish, onNewSession }: Props) {
  const { showToast } = useStore();
  if (!training) return null;

  const bar = training.bars[training.visibleCount - 1];
  const prevBar = training.bars[training.visibleCount - 2];
  const price = bar?.close || 0;
  const prevClose = prevBar?.close || price;
  const dayChange = prevClose ? price - prevClose : 0;
  const dayChangePct = prevClose ? (dayChange / prevClose) * 100 : 0;

  const hasPosition = !!training.position;
  const pos = training.position;
  const cash = INITIAL_CAPITAL - training.trades.reduce((s, t) => s + (t.action === 'buy' ? t.price * t.qty : -t.price * t.qty), 0);
  const posVal = pos ? pos.shares * price : 0;
  const totalEquity = cash + posVal;
  const pnl = totalEquity - INITIAL_CAPITAL;
  const pnlPct = (pnl / INITIAL_CAPITAL) * 100;
  const posPnl = pos ? (price - pos.entryPrice) * pos.shares : 0;
  const posPnlPct = pos ? (price / pos.entryPrice - 1) * 100 : 0;

  // 涨红跌绿（A股惯例）
  const trend = (v: number) => (v > 0 ? 'text-red-500' : v < 0 ? 'text-green-500' : 'text-slate-400');

  const Row = ({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) => (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${valueClass || 'text-slate-700'}`}>{value}</span>
    </div>
  );

  return (
    <aside className="w-full md:w-80 h-[44vh] md:h-auto bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col overflow-hidden">
      {/* 最新价 hero */}
      <div className="px-4 pt-3 pb-3 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-slate-400">最新价</span>
          <span className={`text-xs font-semibold font-mono ${trend(dayChange)}`}>
            {dayChange >= 0 ? '▲' : '▼'} {fmtPct(dayChangePct)}
          </span>
        </div>
        <div className={`text-3xl font-bold font-mono tracking-tight ${trend(dayChange)}`}>{fmtPrice(price)}</div>
        <div className="grid grid-cols-4 gap-1 mt-2.5">
          {(['open', 'high', 'low', 'close'] as const).map(k => (
            <div key={k} className="text-center">
              <div className="text-[11px] text-slate-400 mb-0.5">{k === 'open' ? '开' : k === 'high' ? '高' : k === 'low' ? '低' : '收'}</div>
              <div className="font-mono text-sm font-medium text-slate-600">{fmtPrice(bar?.[k] || 0)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 持仓 */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500">持仓</span>
          {pos && (
            <span className={`text-xs font-semibold font-mono ${trend(posPnl)}`}>
              {posPnl >= 0 ? '+' : ''}{fmtMoneyFull(posPnl)}（{fmtPct(posPnlPct)}）
            </span>
          )}
        </div>
        {pos ? (
          <div className="space-y-1.5">
            <Row label="持仓量" value={`${pos.shares} 股`} />
            <Row label="成本价" value={fmtPrice(pos.entryPrice)} />
            <Row label="当前市值" value={fmtMoneyFull(posVal)} />
          </div>
        ) : (
          <div className="text-sm text-slate-300 py-1">空仓</div>
        )}
      </div>

      {/* 资产概览 */}
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">总资产</span>
          <span className="text-[11px] text-slate-400">本金 {fmtMoneyFull(INITIAL_CAPITAL)}</span>
        </div>
        <div className="text-2xl font-bold font-mono text-slate-800 mt-0.5 tracking-tight">{fmtMoneyFull(totalEquity)}</div>
        <div className="flex items-center justify-between mt-2 text-sm">
          <span className="text-slate-400">累计盈亏</span>
          <span className={`font-mono font-bold ${trend(pnl)}`}>
            {pnl >= 0 ? '+' : ''}{fmtMoneyFull(pnl)} <span className="text-xs font-medium">（{fmtPct(pnlPct)}）</span>
          </span>
        </div>
        <div className="flex items-center justify-between mt-1 text-xs">
          <span className="text-slate-400">可用资金</span>
          <span className="font-mono text-slate-500">{fmtMoneyFull(cash)}</span>
        </div>
      </div>

      {/* 交易按钮 */}
      <div className="p-4 space-y-2.5 flex-1 overflow-auto">
        {!finished ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => onBuy(1)}
                disabled={hasPosition}
                className="py-3 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm"
              >半仓买入<kbd className="ml-1 opacity-80">B</kbd></button>
              <button
                onClick={() => onBuy(2)}
                disabled={hasPosition}
                className="py-3 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm"
              >全仓买入</button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => onSell(1)}
                disabled={!hasPosition}
                className="py-3 bg-green-500 text-white rounded-xl text-sm font-semibold hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm"
              >半仓卖出<kbd className="ml-1 opacity-80">M</kbd></button>
              <button
                onClick={() => onSell(2)}
                disabled={!hasPosition}
                className="py-3 bg-green-500 text-white rounded-xl text-sm font-semibold hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm"
              >全仓卖出</button>
            </div>
            <button
              onClick={onNext}
              disabled={finished}
              className="w-full py-3 bg-brand-500 text-white rounded-xl text-sm font-semibold hover:bg-brand-600 transition shadow-sm"
            >观望下一根 ▶ <kbd className="ml-1 opacity-80">Space</kbd></button>
            <button
              onClick={onFinish}
              disabled={finished}
              className="w-full py-2.5 bg-slate-100 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-200 transition"
            >结束训练</button>
          </>
        ) : (
          <button
            onClick={onNewSession}
            className="w-full py-3.5 bg-brand-500 text-white rounded-xl text-base font-bold hover:bg-brand-600 transition animate-fadeIn"
            style={{ animation: 'pulseBtn 2s ease-in-out infinite' }}
          >新一局 ▶</button>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-100">
        <button
          onClick={() => { if (confirm('确定重新开始训练？当前进度将丢失')) onNewSession(); }}
          className="w-full py-1.5 text-xs text-slate-400 hover:text-slate-600 transition"
        >重新训练</button>
      </div>
    </aside>
  );
}
