import type { TrainingState } from '../types';
import { fmtMoneyFull, fmtPct, fmtPrice, clsColor } from '../lib/format';

interface Props {
  training: TrainingState | null;
  finished: boolean;
  onBuy: (type: 1 | 2) => void;
  onSell: (type: 1 | 2) => void;
  onNext: () => void;
  onFinish: () => void;
  onNewSession: () => void;
  speed: number;
  setSpeed: (v: number) => void;
  playing: boolean;
  togglePlay: () => void;
}

function trendCls(v: number) {
  if (v > 0) return 'text-red-500';
  if (v < 0) return 'text-green-500';
  return 'text-slate-500';
}

function trendSign(v: number) {
  return v > 0 ? '+' : '';
}

export function TradePanel({
  training,
  finished,
  onBuy,
  onSell,
  onNext,
  onFinish,
  onNewSession,
  speed,
  setSpeed,
  playing,
  togglePlay,
}: Props) {
  if (!training) return null;

  const initialCapital = training.capital || 100000;

  const bar = training.bars[training.visibleCount - 1];
  const prevBar = training.bars[training.visibleCount - 2];
  const price = bar?.close || 0;
  const prevClose = prevBar?.close || price;
  const dayChange = prevClose ? price - prevClose : 0;
  const dayChangePct = prevClose ? (dayChange / prevClose) * 100 : 0;
  const dayColor = clsColor(dayChange);

  const hasPosition = !!training.position;
  const pos = training.position;
  const cash = initialCapital - training.trades.reduce((s, t) => s + (t.action === 'buy' ? t.price * t.qty : -t.price * t.qty), 0);
  const posVal = pos ? pos.shares * price : 0;
  const totalEquity = cash + posVal;
  const pnl = totalEquity - initialCapital;
  const pnlPct = (pnl / initialCapital) * 100;
  const posPnl = pos ? (price - pos.entryPrice) * pos.shares : 0;

  // 交易统计
  const buyTrades = training.trades.filter(t => t.action === 'buy');
  const sellTrades = training.trades.filter(t => t.action === 'sell');
  const winTrades = sellTrades.filter(t => (t.pnl ?? 0) > 0);
  const remainingBars = Math.max(0, training.trainEnd - training.visibleCount);

  const speeds = [0.5, 1, 2, 3, 4];

  const InfoRow = ({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) => (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-mono ${valueClass || 'text-slate-700'}`}>{value}</span>
    </div>
  );

  const Section = ({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) => (
    <div className={`bg-white rounded-xl border border-slate-100 shadow-sm p-3 ${className}`}>
      {title && <div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>}
      {children}
    </div>
  );

  return (
    <aside className="w-full md:w-[340px] h-[44vh] md:h-full bg-slate-50 border-t md:border-t-0 md:border-l border-slate-200 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 最新价 */}
        <Section>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-slate-400 mb-1">最新价</div>
              <div className="text-3xl font-bold font-mono" style={{ color: dayColor }}>{fmtPrice(price)}</div>
            </div>
            <div className="flex items-center gap-2 text-right">
              <div className="text-sm font-semibold font-mono" style={{ color: dayColor }}>
                {dayChange >= 0 ? '▲' : '▼'} {fmtPrice(dayChange)}
              </div>
              <div className={`text-xs font-mono px-1.5 py-0.5 rounded ${dayChange > 0 ? 'bg-red-50' : dayChange < 0 ? 'bg-green-50' : 'bg-slate-50'}`} style={{ color: dayColor }}>
                {fmtPct(dayChangePct)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-50">
            {(['open', 'high', 'low', 'close'] as const).map(k => (
              <div key={k} className="text-center">
                <div className="text-[11px] text-slate-400 mb-0.5">{k === 'open' ? '开' : k === 'high' ? '高' : k === 'low' ? '低' : '收'}</div>
                <div className="font-mono text-sm font-medium text-slate-700">{fmtPrice(bar?.[k] || 0)}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* 训练信息 */}
        <Section title="训练信息">
          <InfoRow label="总爆竹" value={fmtMoneyFull(totalEquity)} valueClass="text-slate-800 font-bold" />
          <InfoRow label="使用爆竹数量" value={fmtMoneyFull(posVal)} />
          <InfoRow label="未使用爆竹数量" value={fmtMoneyFull(cash)} />
          <InfoRow label="本局收益" value={`${trendSign(pnl)}${fmtMoneyFull(pnl)}（${fmtPct(pnlPct)}）`} valueClass={trendCls(pnl)} />
          {pos && (
            <>
              <InfoRow label="成本价" value={fmtPrice(pos.entryPrice)} />
              <InfoRow label="持仓" value={`${pos.shares} 股`} />
              <InfoRow label="持仓盈亏" value={`${trendSign(posPnl)}${fmtMoneyFull(posPnl)}`} valueClass={trendCls(posPnl)} />
            </>
          )}
        </Section>

        {/* 训练数据 */}
        <Section title="训练数据">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between py-1"><span className="text-slate-400">剩余K线</span><span className="font-mono text-slate-700">{remainingBars} 根</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-400">开仓次数</span><span className="font-mono text-slate-700">{buyTrades.length}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-400">盈利次数</span><span className="font-mono text-red-500">{winTrades.length}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-400">亏损次数</span><span className="font-mono text-green-500">{sellTrades.length - winTrades.length}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-400">持仓天数</span><span className="font-mono text-slate-700">{pos ? training.visibleCount - pos.entryIndex : 0}</span></div>
            <div className="flex justify-between py-1"><span className="text-slate-400">交易胜率</span><span className="font-mono text-slate-700">{sellTrades.length ? ((winTrades.length / sellTrades.length) * 100).toFixed(1) + '%' : '0%'}</span></div>
          </div>
        </Section>

        {/* 操作按钮 */}
        <div className="grid grid-cols-2 gap-3">
          {!finished ? (
            <>
              <button
                onClick={() => onBuy(2)}
                disabled={hasPosition}
                className="h-[88px] rounded-2xl bg-gradient-to-b from-red-500 to-red-600 text-white shadow-md shadow-red-200 active:scale-[0.98] transition disabled:opacity-35 disabled:cursor-not-allowed flex flex-col items-center justify-center"
              >
                <div className="text-base font-bold">买入</div>
                <div className="text-[11px] opacity-90 mt-0.5">{hasPosition ? '已有持仓' : '可买全仓 · B'}</div>
              </button>
              <button
                onClick={() => onSell(2)}
                disabled={!hasPosition}
                className="h-[88px] rounded-2xl bg-gradient-to-b from-green-500 to-green-600 text-white shadow-md shadow-green-200 active:scale-[0.98] transition disabled:opacity-35 disabled:cursor-not-allowed flex flex-col items-center justify-center"
              >
                <div className="text-base font-bold">卖出</div>
                <div className="text-[11px] opacity-90 mt-0.5">{hasPosition ? `持仓 ${pos?.shares} 股 · M` : '无仓位可卖 · M'}</div>
              </button>
              <button
                onClick={onNext}
                disabled={finished}
                className="col-span-2 py-3.5 rounded-2xl bg-gradient-to-b from-pink-500 to-rose-500 text-white shadow-md shadow-pink-200 active:scale-[0.98] transition flex items-center justify-center gap-2"
              >
                <span className="text-base font-bold">持有 / 观望</span>
                <span className="text-xs opacity-80">下一根 K线</span>
                <kbd className="text-[10px] bg-white/20 border-white/30 text-white px-1.5 py-0.5 rounded">Space</kbd>
              </button>
            </>
          ) : (
            <button
              onClick={onNewSession}
              className="col-span-2 py-4 rounded-2xl bg-gradient-to-b from-brand-500 to-brand-600 text-white text-base font-bold shadow-md shadow-blue-200 active:scale-[0.98] transition animate-pulse"
            >
              新一局 ▶
            </button>
          )}
        </div>

        {/* 自动播放 */}
        {!finished && (
          <Section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">自动播放</span>
              <button
                onClick={togglePlay}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${playing ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-brand-50 text-brand-600 border border-brand-100'}`}
              >
                {playing ? '停止' : '开始'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {speeds.map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition ${speed === s ? 'bg-brand-500 text-white shadow-sm' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* 操作流水 */}
        <Section title="操作流水">
          <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
            {training.trades.length === 0 ? (
              <div className="text-xs text-slate-300 text-center py-2">暂无操作</div>
            ) : (
              training.trades.slice().reverse().slice(0, 20).map((t, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                  <span className={`font-semibold ${t.action === 'buy' ? 'text-red-500' : 'text-green-500'}`}>{t.action === 'buy' ? '买入' : '卖出'}</span>
                  <span className="text-slate-500">{fmtPrice(t.price)} × {t.qty}</span>
                  {typeof t.pnl === 'number' && <span className={`font-mono ${t.pnl >= 0 ? 'text-red-500' : 'text-green-500'}`}>{t.pnl >= 0 ? '+' : ''}{fmtMoneyFull(t.pnl)}</span>}
                </div>
              ))
            )}
          </div>
        </Section>
      </div>

      {/* 底部结束训练 */}
      {!finished && (
        <div className="p-3 border-t border-slate-200 bg-white">
          <button
            onClick={onFinish}
            className="w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 active:scale-[0.98] transition flex items-center justify-center gap-2"
          >
            结束训练并结算
            <kbd className="text-[10px] bg-slate-700 border-slate-600 text-white px-1.5 py-0.5 rounded">Alt+Enter</kbd>
          </button>
        </div>
      )}
    </aside>
  );
}
