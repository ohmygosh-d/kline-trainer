import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { StockAPI, WalletAPI, DrawingsAPI } from '../lib/api';
import { trainer } from '../lib/trainer';
import { wallet } from '../lib/wallet';
import { chart } from '../lib/chart';
import { ChartPanel } from '../components/ChartPanel';
import { TradePanel } from '../components/TradePanel';
import { DrawToolbar } from '../components/DrawToolbar';
import { WalletBar } from '../components/WalletBar';
import { ResultModal } from '../components/ResultModal';
import { EventModal } from '../components/EventModal';
import { ReviewBar } from '../components/ReviewBar';
import { Toast } from '../components/Toast';
import type { TrainingState, Drawing, StockData } from '../types';
import { computeWindowDates } from '../lib/window';

/** 以日线全量历史推导「同一时间段」的训练窗口（日/周/月三档共用） */
function windowFromDaily(daily: StockData | null, fallback: StockData): { start: string; end: string } {
  if (daily && daily.bars && daily.bars.length >= 200) return computeWindowDates(daily.bars);
  return computeWindowDates(fallback.bars);
}

export default function TrainPage() {
  const { user, wallet: ws, training, setTraining, showToast, finishTraining, syncWallet, logout } = useStore();
  const chartRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [event, setEvent] = useState<{ type: string; stats: any; state: TrainingState } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [indicators, setIndicators] = useState({ ma: true, vol: true, macd: false, kdj: false, rsi: false, boll: false });
  const [finished, setFinished] = useState(false);
  const INIT_PERIOD = (() => {
    const p = new URLSearchParams(location.search).get('period');
    return p === 'weekly' || p === 'monthly' ? p : 'daily';
  })();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>(INIT_PERIOD);

  // 开局：p=周期；code=指定股票（同股票换周期）。无 code 时为「新一局」（随机选股，仅训练结束后触发）
  const startNew = useCallback(async (p: 'daily' | 'weekly' | 'monthly', code?: string) => {
    setLoading(true);
    setShowResult(false);
    setShowEvent(false);
    setReviewMode(false);
    setReplayIdx(null);
    setFinished(false);
    chart.setReviewMode(false);
    try {
      if (code) {
        // 同股票换周期：只按 code 取，绝不偷偷回退到随机新股票；
        // 训练窗口日期沿用本局已确定的「同一时间段」，仅换分辨率并保留进度
        const data = await StockAPI.byCode(code, p);
        if ((data as any).fromCache) {
          showToast('网络异常，已使用本地缓存行情（非最新）', 'error');
        }
        const s = trainer.applyPeriod(data.bars, p);
        if (!s) {
          showToast('周期切换失败，已停留在原行情，可稍后重试', 'error');
        } else {
          setPeriod(p);
          setTraining(s);
          const pLabel = p === 'weekly' ? '周线' : p === 'monthly' ? '月线' : '日线';
          showToast(`切换至${pLabel}（同一只股票·同一时间段） · ${s.symbol}（${s.code}）`, 'success');
        }
      } else {
        // 新一局：随机选股（仅训练结束后由「下一盘」触发）
        const data = await StockAPI.random(p);
        if ((data as any).fromCache) {
          showToast('网络异常，已使用本地缓存行情（非最新）', 'error');
        }
        // 以日线全量历史推导训练窗口的两个边界日期（日/周/月共用，保证时间段一致）
        let daily: StockData | null = null;
        try { daily = await StockAPI.byCodeDaily(data.code); } catch { /* 用展示周期兜底 */ }
        const windowDates = windowFromDaily(daily, data);
        const s = trainer.startWithMarket(
          { bars: data.bars, code: data.code, symbol: data.name, startDate: data.bars[0]?.date || '', endDate: data.bars[data.bars.length - 1]?.date, isReal: data.isReal },
          { capital: wallet.balance, period: p },
          windowDates
        );
        setPeriod(p);
        setTraining(s);
        showToast(`新训练开始 · ${s.symbol}（${s.code}）· ${s.isReal ? '真实A股' : '模拟数据'}`, 'success');
      }
    } catch (e: any) {
      if (code) {
        // 同股票意图失败：保留当前训练，不换股票、不切周期
        showToast('该股票此周期数据获取失败，已停留在原行情，可稍后重试', 'error');
      } else {
        showToast(e?.response?.data?.error || '数据加载失败', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [period, setTraining, showToast]);

  // 新一局（训练结束后「下一盘」）：随机选股 → 会换股票（这是唯一换股票的地方）
  const newSession = useCallback(() => {
    startNew(period);
  }, [period, startNew]);

  // 日/周/月线切换：保持同一只股票换周期；训练结束前绝不更换股票
  const switchPeriod = (p: 'daily' | 'weekly' | 'monthly') => {
    if (!training || finished) return;
    if (p === training.period) return;
    startNew(p, training.code);
  };

  // Chart drawing persistence callbacks
  useEffect(() => {
    chart.onSaveDrawings = async (key, drawings) => {
      try { await DrawingsAPI.save(key.split('_')[0], key.split('_')[1], drawings); } catch {}
    };
    chart.onLoadDrawings = (key) => {
      // Synchronous fallback from localStorage
      const local = localStorage.getItem(`kt_draw_${key}`);
      return local ? JSON.parse(local) : [];
    };
  }, []);

  // Init chart when ref ready
  useEffect(() => {
    if (chartRef.current) {
      chart.init(chartRef.current);
      chart.setupCanvas();
    }
  }, []);

  // Update chart whenever training data changes
  useEffect(() => {
    if (!training || !chartRef.current) return;
    chart.init(chartRef.current);
    chart.setData(training.bars, training.trainStart, training.trainEnd, training.period);
    chart.setDrawingContext(`${training.code}_${training.period}`);
    chart.setActiveTool('cursor');
    chart.setProgress(training.visibleCount);
    chart.setTradeMarkers(training.trades || [], training.position);
  }, [training]);

  // Load first training session
  useEffect(() => {
    newSession();
    // Resize handler
    const onResize = () => chart.setupCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (finished) return;
      if (e.key === 'b' || e.key === 'B') { doBuy(1); e.preventDefault(); }
      else if (e.key === 'm' || e.key === 'M') { doSell(1); e.preventDefault(); }
      else if (e.key === ' ') { doNext(); e.preventDefault(); }
      else if (e.key === 'Escape') {
        if (chart.getActiveTool() !== 'cursor') chart.setActiveTool('cursor');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [training, finished]);

  const doBuy = (type: 1 | 2) => {
    if (!training || finished) return;
    const balance = wallet.balance;
    const price = training.bars[training.visibleCount - 1]?.close || 0;
    const qty = type === 1 ? Math.floor(balance * 0.5 / price / 100) * 100 : Math.floor(balance / price / 100) * 100;
    if (qty <= 0) { showToast('资金不足', 'error'); return; }
    const s = trainer.buy(qty);
    if (s) {
      chart.flashTrade(training.visibleCount - 1, 'buy', price, qty);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doSell = (type: 1 | 2) => {
    if (!training || !training.position || finished) return;
    const qty = type === 1 ? Math.floor(training.position.shares / 2 / 100) * 100 : training.position.shares;
    if (qty <= 0) { showToast('持仓不足', 'error'); return; }
    const price = training.bars[training.visibleCount - 1]?.close || 0;
    const s = trainer.sell(qty);
    if (s) {
      chart.flashTrade(training.visibleCount - 1, 'sell', price, qty);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doNext = () => {
    if (!training || finished) return;
    const s = trainer.next();
    if (s) {
      chart.setProgress(s.visibleCount);
      chart.setTradeMarkers(s.trades, s.position);
      setTraining(s);
    }
  };

  const doFinish = () => {
    if (!training || finished) return;
    trainer.finish();
  };

  // On finish callback
  useEffect(() => {
    trainer.onFinish(async (s) => {
      setFinished(true);
      const stats = trainer.getStats();
      if (!stats) return;
      const event = await finishTraining(stats, s);
      chart.setTradeMarkers(s.trades, null);
      setTraining(s);
      if (event === 'bankrupt' || event === 'fortune') {
        setEvent({ type: event, stats, state: s });
        setShowEvent(true);
      } else {
        setShowResult(true);
      }
    });
  }, []);

  const enterReview = () => {
    if (!training) return;
    setShowResult(false);
    setShowEvent(false);
    setReviewMode(true);
    setReplayIdx(null);
    chart.setReviewMode(true);
    chart.setTradeMarkers(training.trades || [], null);
    // 复盘：加载训练结束节点之后到今天为止的最新 K 线（数据已拉取，定位到边界处展示）
    const tail = Math.max(0, training.bars.length - training.trainEnd);
    const today = training.bars[training.bars.length - 1]?.date || '';
    showToast(`已加载训练结束后的最新走势（${tail} 根K线，至 ${today}）`, 'success');
  };

  const startReplay = () => {
    if (!training) return;
    setReplayIdx(training.trainStart);
    chart.setProgress(training.trainStart);
    chart.setTradeMarkers(training.trades.filter(t => t.index <= training!.trainStart), null);
  };

  const stepReplay = (delta: number) => {
    if (!training) return;
    setReplayIdx(prev => {
      const base = prev ?? training.trainEnd;
      const ni = Math.max(training.trainStart, Math.min(training.trainEnd, base + delta));
      chart.setProgress(ni);
      chart.setTradeMarkers(training.trades.filter(t => t.index <= ni), null);
      return ni;
    });
  };

  const toggleIndicator = (key: keyof typeof indicators) => {
    const next = { ...indicators, [key]: !indicators[key] };
    setIndicators(next);
    chart.toggleMA(next.ma);
    chart.toggleVol(next.vol);
    chart.toggleMACD(next.macd);
    chart.toggleKDJ(next.kdj);
    chart.toggleRSI(next.rsi);
    chart.toggleBOLL(next.boll);
  };

  if (loading && !training) {
    return (
      <div className="h-screen flex flex-col bg-slate-50">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
          <div className="font-bold text-slate-800">📈 K线练习助手</div>
          <div className="flex-1" />
          <div className="w-16 h-4 bg-slate-100 rounded animate-pulse" />
        </header>
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col p-2">
            <div className="flex-1 bg-white border border-slate-200 rounded-lg overflow-hidden relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 border-2 border-slate-200 border-t-brand-500 rounded-full animate-spin mx-auto mb-3" />
                  <div className="text-sm text-slate-400">正在随机选取全市场股票...</div>
                </div>
              </div>
            </div>
          </div>
          <aside className="w-72 bg-white border-l border-slate-200 p-3 space-y-3">
            <div className="h-16 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-20 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-12 bg-slate-50 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 flex items-center flex-wrap px-4 gap-2 sm:gap-4 py-1.5 min-h-12">
        <div className="font-bold text-slate-800">📈 K线练习助手</div>
        <WalletBar />
        <div className="flex-1" />
        <Link to="/history" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">训练记录</Link>
        <Link to="/profile" className="hidden sm:block text-sm text-slate-500 hover:text-brand-500">用户中心</Link>
        <div className="hidden sm:block text-sm text-slate-400">|</div>
        <span className="text-sm text-slate-600">{user?.username}</span>
        <button onClick={logout} className="text-sm text-slate-400 hover:text-red-500">退出</button>
      </header>

      {/* Main layout */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_320px] min-h-0 overflow-hidden">
        {/* Chart area */}
        <div className="flex flex-col p-2 min-h-0 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-1 px-1 flex-wrap">
            <DrawToolbar />
            {/* 周期切换：日线 / 周线 / 月线 —— 训练结束前切换只换周期、不换股票 */}
            <div className="flex items-center gap-1 mr-1">
              {(['daily', 'weekly', 'monthly'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => switchPeriod(p)}
                  disabled={finished}
                  title={finished ? '训练已结束，点击「下一盘」换一只股票' : '切换周期（同一只股票）'}
                  className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${period === p ? 'bg-brand-500 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'} ${finished ? 'opacity-40 cursor-not-allowed hover:text-slate-400' : ''}`}
                >{p === 'daily' ? '日线' : p === 'weekly' ? '周线' : '月线'}</button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <button onClick={() => chart.zoomBy(0.87)} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">−</button>
              <button onClick={() => chart.zoomBy(1.15)} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">+</button>
              <button onClick={() => chart.resetView()} className="px-2 py-1 bg-white border border-slate-200 rounded text-sm hover:bg-slate-50">⟲</button>
            </div>
            <div className="flex items-center gap-1 ml-2">
              {(['ma', 'vol', 'macd', 'kdj', 'rsi', 'boll'] as const).map(k => (
                <button
                  key={k}
                  onClick={() => toggleIndicator(k)}
                  className={`px-2 py-1 rounded text-xs font-medium transition ${indicators[k] ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-400 hover:text-slate-600'}`}
                >{k.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {/* Chart canvas */}
          <ChartPanel ref={chartRef} />
          {/* Stock info */}
          {training && (
            <div className="mt-1 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-4 text-sm flex-wrap">
              <span className="font-bold text-slate-800">{training.symbol}</span>
              <span className="text-slate-400">{training.code}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${training.isReal ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-slate-400'}`}>{training.isReal ? '真实A股' : '模拟'}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{training.period === 'weekly' ? '周线' : training.period === 'monthly' ? '月线' : '日线'}</span>
              <span className="text-slate-300">|</span>
              {reviewMode ? (
                <span className="text-amber-600 font-medium">复盘模式 · 上市 {training.bars[0]?.date} → 今天 {training.bars[training.bars.length - 1]?.date}（含训练结束后的最新走势）</span>
              ) : (
                <>
                  <span className="text-slate-500">进度 {training.dailyProgress} / {training.dailyTotal}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-500">训练区间 <span className="font-medium text-slate-700">{training.trainStartDate} ~ {training.trainEndDate}</span></span>
                  <span className="text-slate-300">|</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-brand-50 text-brand-600">日/周/月同一时间段</span>
                </>
              )}
            </div>
          )}
        </div>
        {/* Trade panel */}
        <TradePanel
          training={training}
          finished={finished}
          onBuy={doBuy}
          onSell={doSell}
          onNext={doNext}
          onFinish={doFinish}
          onNewSession={newSession}
        />
      </div>
      {/* Review bar */}
      {reviewMode && training && (
        <ReviewBar
          training={training}
          replayIdx={replayIdx}
          onStep={stepReplay}
          onReplay={startReplay}
          onNextSession={newSession}
        />
      )}
      {/* Modals */}
      {showResult && training && (
        <ResultModal
          training={training}
          stats={trainer.getStats()!}
          walletBalance={wallet.balance}
          bankruptCount={wallet.bankruptCount}
          fortuneCount={wallet.fortuneCount}
          onReview={enterReview}
          onNext={newSession}
          onClose={() => setShowResult(false)}
        />
      )}
      {showEvent && event && (
        <EventModal
          type={event.type}
          stats={event.stats}
          walletBalance={wallet.balance}
          bankruptCount={wallet.bankruptCount}
          fortuneCount={wallet.fortuneCount}
          onReview={enterReview}
          onNext={newSession}
          onClose={() => setShowEvent(false)}
        />
      )}
      <Toast />
    </div>
  );
}
